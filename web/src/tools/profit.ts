/**
 * Merchant profitability calculator: sell value vs. full production cost.
 * Port of the former tools/profit.py (removed 2026-11-23; the cost model is documented in
 * docs/tooling/profit-calculator). Browser-safe library (the battle page prices scrolls with it):
 *
 *   loadGameData(json)
 *   const s = new Solver(gameFromData(), { grade: 3 }).solve()
 *   const rows = buildRows(s, ["equipment", "consumable", "map"])
 *
 * Because maps need essences and give essences, costs are solved by repeated relaxation until they stop changing.
 */
import { addPrefix, addSuffix, band, type Climb, enchantEssence, PREFIX_GEM, type StepResult, suffixClimb, maxSuffixFor }
  from "./enchant.ts";
import { clamp, Game, KeyError, luaRound, PRESTIGE_TYPES, pyRound } from "./gamedata.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const INF = Infinity;
export const MAX_PRESTIGE = 2;
// Maps only go up to ascension 1: normal maps drop asc-1 essences, asc-1 maps drop asc-2 essences.
const MAX_PRESTIGE_BY_TYPE: Record<string, number> = { map: 1 };

export function ascLevels(itype: string): number[] {
  if (!PRESTIGE_TYPES.has(itype)) return [0];
  const top = MAX_PRESTIGE_BY_TYPE[itype] ?? MAX_PRESTIGE;
  return Array.from({ length: top + 1 }, (_, i) => i);
}

/** "type|id" keys for (itemType, id) pairs, so they can key a Map like Python tuples. */
export const k2 = (t: string, i: number) => `${t}|${i}`;
const un2 = (key: string): [string, number] => {
  const j = key.lastIndexOf("|");
  return [key.slice(0, j), Number(key.slice(j + 1))];
};
const k3 = (t: string, i: number, p: number) => `${t}|${i}|${p}`;
const sumOf = (xs: Iterable<number>) => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};
/** Python `{x:.df}` */
export const f = (x: number, d: number) =>
  Number.isFinite(x) ? pyRound(x, d).toFixed(d) : Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";

// --------------------------------------------------------------- loot model
/** E[quantity] of lootService.generateNormalItem. */
export function expectedFixedDrop(reward: number[], gradeBonus: number, luck: number): number {
  let lo = Math.trunc(reward[1] * gradeBonus * 10); // math.random truncates floats
  let hi = Math.trunc(reward[2] * gradeBonus * 10);
  if (hi < lo) [lo, hi] = [hi, lo];
  let total = 0;
  for (let x = lo; x <= hi; x++) total += clamp(luaRound((x + luck) / 10), 0, 5);
  return total / (hi - lo + 1);
}

/** {"type|id": expected amount} of lootService.generateParcelItem (`enemyAmount` scales item odds and material amounts). */
export function expectedParcel(g: Game, pname: string | undefined, grade: number, luck: number, enemyAmount = 1): Map<string, number> {
  const out = new Map<string, number>();
  const p = pname ? g.parcels[pname] : undefined;
  if (!p) return out;
  const nil = Math.max(p.nilOdds * g.gradeParcelBonus.get(grade)! - luck, 1);
  const total = nil + sumOf(p.itemList.map((e: Any) => e.odds * enemyAmount));
  for (const e of p.itemList) {
    const prob = e.odds * enemyAmount / total;
    let key: string, amount: number;
    if (e.id.length > 1) [key, amount] = [k2(e.id[0], e.id[1]), 1];
    else {
      key = k2("material", e.id[0]);
      const a: number[] = e.amount && e.amount.length ? e.amount : [1];
      if (a.length > 1) {
        let num = 0, den = 0;
        for (let i = 0; i + 1 < a.length; i += 2) (num += a[i] * a[i + 1], den += a[i + 1]);
        amount = num / den;
      } else amount = a[0];
      amount *= enemyAmount; // summed per enemy (weighted amounts) or multiplied (fixed)
    }
    out.set(key, (out.get(key) ?? 0) + prob * amount);
  }
  return out;
}

export function questLoot(g: Game, qid: number, grade: number, luck: number, rare = false, enemyAmount = 1): Map<string, number> {
  const q = g.quests.get(qid);
  const fixed = rare ? ["rewardB1", "rewardB2"] : ["rewardA1", "rewardA2"];
  const parcels = rare ? ["rewardB3", "rewardB4"] : ["rewardA3", "rewardA4"];
  const out = new Map<string, number>();
  const add = (key: string, v: number) => out.set(key, (out.get(key) ?? 0) + v);
  for (const k of fixed) {
    const r = q[k];
    if (Array.isArray(r) && r.length && r[0]) add(k2("material", r[0]), expectedFixedDrop(r, g.gradeBonus.get(grade)!, luck) * enemyAmount);
  }
  for (const k of parcels) for (const [key, amt] of expectedParcel(g, q[k], grade, luck, enemyAmount)) add(key, amt);
  return out;
}

const TREASURE_CHANCE: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 8, 5: 10 }; // obj.Map treasurePerRoomPerGradeChance
const TREASURE_ID = [99, 100, 101, 102, 103, 104];

/** Expected room loot of one run (enemies + boss + treasure), excluding essence. */
export function mapLoot(g: Game, mid: number, grade: number, luck: number): Map<string, number> {
  const m = g.items.map.get(mid);
  const rooms = m.baseEnemyAmount + (grade <= 2 ? -1 : grade >= 4 ? 1 : 0);
  const pool: number[] = [];
  for (const e of m.enemyList ?? []) {
    if (Array.isArray(e)) for (let q = e[0]; q <= e[1]; q++) pool.push(q);
    else pool.push(e);
  }
  const out = new Map<string, number>();
  const add = (key: string, v: number) => out.set(key, (out.get(key) ?? 0) + v);
  const nEnemies = rooms - 1;
  for (const qid of pool) {
    const rareP = (g.quests.get(qid).abRand ?? 0) / 100;
    for (const [rare, w] of [[false, 1 - rareP], [true, rareP]] as const) {
      if (w <= 0) continue;
      for (const [key, amt] of questLoot(g, qid, grade, luck, rare)) add(key, amt * w * nEnemies / pool.length);
    }
  }
  const bosses: number[] = m.bossList ?? [];
  for (const b of bosses) for (const [key, amt] of questLoot(g, b, grade, luck, Boolean(m.isRareBoss))) add(key, amt / bosses.length);
  const treasures = TREASURE_CHANCE[grade] * rooms / 100;
  const tier = Math.ceil(m.itemLevel / 10);
  if (treasures && tier <= TREASURE_ID.length) { // game indexes past the list -> nil, no treasure
    for (const [key, amt] of questLoot(g, TREASURE_ID[tier - 1], grade, luck)) add(key, amt * treasures);
  }
  return out;
}

/** [prob, prefix id | 0, suffix id | 0] */
export type Outcome = [number, number, number];

/** Expected essence of one run; `outcomes` = modifier roll distribution of the map. */
export function mapEssence(g: Game, mid: number, prestige: number, grade: number, outcomes: Outcome[] = [[1.0, 0, 0]]): Map<string, number> {
  const br: number[] = g.items.map.get(mid).baseReward ?? [];
  const half = Math.floor(br.length / 2);
  const out = new Map<string, number>();
  for (let i = 0; i < half; i++) {
    const eid = g.prestigedEssence(br[i], prestige);
    if (eid === undefined) continue;
    out.set(k2("material", eid), sumOf(outcomes.map(([prob, pf, sf]) =>
      prob * luaRound(g.gradeBonus.get(grade)! * br[i + half] * mapEssenceMultiplier(g, pf, sf)))));
  }
  return out;
}

// ---------------------------------------------------------- modifier rolls
/** P(odds > math.random(1, 100)). */
export const rollChance = (odds: number) => clamp(Math.ceil(odds) - 1, 0, 100) / 100;

/** obj.Craft:startCrafting with every ingredient at `ingredientGrade`. */
export function craftGrade(crafterLevel: number, itemLevel: number, ingredientGrade: number): number {
  const start = clamp(pyRound(1 + (crafterLevel - itemLevel) / 4, 2), 1, 4.5); // default.itemStartGrade
  return clamp(luaRound((start + ingredientGrade + 0.25) / 2), 1, 5);
}

function eligible(table: Map<number, Any>, eff: number, prestige = 0, needWeight = true): [number, Any][] {
  const out: [number, Any][] = [];
  for (const [n, d] of table) {
    if (n <= 0 || (needWeight && !d.weight)) continue;
    if (d.ascLevel && prestige < d.ascLevel) continue;
    if (eff >= (d.minLevel ?? 0) && (d.maxLevel == null || eff <= d.maxLevel)) out.push([n, d]);
  }
  return out;
}

/**
 * Outcomes of Item:determinePrefix then determineSuffix on a fresh craft: [[prob, prefix, suffix]].
 * Equipment only rolls at craft grade > 2 and slot 6 never gets a suffix; maps always roll;
 * consumables never do. Ingredients are assumed plain.
 */
export function modifierOutcomes(g: Game, itype: string, iid: number, crafterLevel: number, ingredientGrade: number,
  prestige = 0): Outcome[] {
  const it = g.item(itype, iid);
  if (itype !== "equipment" && itype !== "map") return [[1.0, 0, 0]];
  const level = it.itemLevel ?? 1;
  const grade = craftGrade(crafterLevel, level, ingredientGrade);
  if (itype === "equipment" && grade <= 2) return [[1.0, 0, 0]];
  const effLevel = (gr: number) => luaRound(crafterLevel + gr * 2 - 4);
  const suffixOutcomes = (gr: number): [number, number][] => {
    if (itype === "equipment" && it.itemSlot === 6) return [[1.0, 0]];
    const eff = effLevel(gr);
    const odds = Math.min((eff - level) * 2, 40); // default.__craftSuffixOdds
    const pool = eligible(g.suffixes, eff, prestige);
    const pHit = pool.length ? rollChance(odds) : 0;
    const totalW = sumOf(pool.map(([, d]) => d.weight)) || 1;
    return [[1 - pHit, 0], ...(pHit ? pool.map(([n, d]) => [pHit * d.weight / totalW, n] as [number, number]) : [])];
  };
  const eff = effLevel(grade);
  const odds = Math.min((eff - level) * 2, 25); // default.__craftPrefixOdds
  const pool = eligible(g.prefixes, eff);
  const pHit = pool.length ? rollChance(odds) : 0;
  const totalW = sumOf(pool.map(([, d]) => d.weight)) || 1;
  const out: Outcome[] = [];
  for (const [ps, sx] of suffixOutcomes(grade)) out.push([(1 - pHit) * ps, 0, sx]);
  for (const [n, d] of pool) {
    const pw = pHit * d.weight / totalW;
    if (pw <= 0) continue;
    const newGrade = clamp(luaRound(grade + d.sell * 2), 1, 5);
    for (const [ps, sx] of suffixOutcomes(newGrade)) out.push([pw * ps, n, sx]);
  }
  return out.filter((o) => o[0] > 0);
}

/** Map:applyPrefix / applySuffix effect on essenceBase. */
export function mapEssenceMultiplier(g: Game, prefix: number, suffix: number): number {
  let m = 1.0;
  if (prefix) m *= 1 + (g.prefixes.get(prefix).sell ?? 0);
  if (suffix) m *= 1 + (g.suffixes.get(suffix).stats?.atk ?? 0);
  return m;
}

// ------------------------------------------------------------- cost solver
/** Simulated performance of one quest or map run: share of runs ending at each grade (1..5; lost runs left out,
 * shares need not sum to 1) and hours per run. Replaces the global grade for that source's loot, essence and time. */
export interface SourceStat {
  grades: [grade: number, share: number][];
  timeH?: number;
}

/** Expected loot or essence over a grade distribution. */
export function mixByGrade(grades: [number, number][], fn: (grade: number) => Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [grade, share] of grades) {
    if (!share) continue;
    for (const [k, v] of fn(grade)) out.set(k, (out.get(k) ?? 0) + share * v);
  }
  return out;
}

export interface SolverOptions {
  grade?: number;
  /** Per-source overrides from simulation (see farming.ts): quests keyed "qid" or "qid|rare", maps keyed "mid|asc". */
  sourceStats?: { quest?: Map<string, SourceStat>; map?: Map<string, SourceStat> };
  luck?: number;
  alloc?: "value" | "full";
  heroHourCost?: number;
  /** essence id -> [map id, prestige] */
  essenceFrom?: Map<number, [number, number]>;
  crafterLevel?: number;
  mapMods?: boolean;
  enchanterLevel?: number;
  mapEnchant?: boolean;
  mapSuffixMax?: number | null;
}

/** [mid, p, unit, amt, run_cost, credit, label] */
export type EssenceSource = [number, number, number, number, number, number, string];
type Variant = [string, () => number, Outcome[], number];

export class Solver {
  readonly g: Game;
  readonly grade: number;
  readonly luck: number;
  readonly alloc: "value" | "full";
  readonly crafterLevel: number;
  readonly mapMods: boolean;
  readonly enchanterLevel: number;
  readonly mapEnchant: boolean;
  readonly mapSuffixMax: number | null;
  readonly heroHourCost: number;
  readonly essenceFrom: Map<number, [number, number]>;
  readonly sourceStats: { quest?: Map<string, SourceStat>; map?: Map<string, SourceStat> };
  essenceChoice = new Map<number, [number, number, string]>(); // essence id -> (map id, prestige, variant label)
  cost = new Map<string, number>(); // "type|id|p" -> best unit cost
  how = new Map<string, string>(); // "type|id|p" -> description of best method
  /** Whether Python holds the cost as a float (ints come only from integer sell values and gold costs). */
  costFloat = new Map<string, boolean>();
  essenceSources = new Map<number, EssenceSource[]>();
  private enchantCache = new Map<string, StepResult | null>();
  private questSources: Map<string, [number, string][]>;

  constructor(g: Game, o: SolverOptions = {}) {
    this.g = g;
    this.grade = o.grade ?? 3;
    this.luck = o.luck ?? 0;
    this.alloc = o.alloc ?? "value";
    this.crafterLevel = o.crafterLevel ?? 60;
    this.mapMods = o.mapMods ?? true;
    this.enchanterLevel = o.enchanterLevel ?? 60;
    this.mapEnchant = (o.mapEnchant ?? true) && this.enchanterLevel > 0;
    this.mapSuffixMax = o.mapSuffixMax ?? null;
    this.heroHourCost = o.heroHourCost ?? 0;
    this.essenceFrom = o.essenceFrom ?? new Map();
    this.sourceStats = o.sourceStats ?? {};
    this.questSources = this.buildQuestSources();
  }

  /** addPrefix / addSuffix at final prices, memoized (call after solve()). */
  enchantStep(kind: "prefix" | "suffix", itype: string, iid: number, p: number, grade: number, modsBefore: number): StepResult | null {
    const key = JSON.stringify([kind, itype, iid, p, grade, modsBefore]);
    if (!this.enchantCache.has(key)) {
      const fn = kind === "prefix" ? addPrefix : addSuffix;
      this.enchantCache.set(key, fn(this.g, (t, i) => this.get(t, i, 0), itype, iid, p, grade, this.enchanterLevel, modsBefore));
    }
    return this.enchantCache.get(key)!;
  }

  sv(itype: string, iid: number, p = 0): number {
    try {
      return this.g.sellValue(itype, iid, p);
    } catch (e) {
      if (e instanceof KeyError) return 0;
      throw e;
    }
  }

  private svKey(key: string): number {
    return this.sv(...un2(key));
  }

  /** Quests have a fixed gold cost, so their unit costs are computed once. */
  private buildQuestSources(): Map<string, [number, string][]> {
    const src = new Map<string, [number, string][]>();
    const variants: [number, boolean][] = [...this.g.quests.keys()].map((qid) => [qid, false]);
    // Rare variant (nameB/goldB, rewardB*): only offered at random, but the only quest source of boss trophies.
    for (const [qid, q] of this.g.quests) if (q.rewardB1 || q.rewardB3) variants.push([qid, true]);
    for (const [qid, rare] of variants) {
      const q = this.g.quests.get(qid);
      const gold = (rare ? (q.goldB !== undefined ? q.goldB : q.gold) : (q.gold ?? 0)) || 0;
      const qname = (q.nameB || q.name) + (rare ? " [rare]" : "");
      const st = this.sourceStats.quest?.get(rare ? `${qid}|rare` : `${qid}`);
      const timeH = st?.timeH ?? (q.time ?? 0) * this.g.gradeTime.get(this.grade)! / 3600;
      const runCost = gold + timeH * this.heroHourCost;
      const loot = st ? mixByGrade(st.grades, (gr) => questLoot(this.g, qid, gr, this.luck, rare))
        : questLoot(this.g, qid, this.grade, this.luck, rare);
      const totalValue = sumOf([...loot].map(([k, a]) => a * this.svKey(k)));
      for (const [key, amt] of loot) {
        if (amt <= 0) continue;
        const unit = this.alloc === "full" || totalValue === 0 ? runCost / amt : runCost * this.svKey(key) / totalValue;
        if (!src.has(key)) src.set(key, []);
        src.get(key)!.push([unit, `quest ${qname} (${gold}g, ${f(amt, 2)}/run)`]);
      }
    }
    return src;
  }

  /** [[label, extra cost fn, modifier outcomes, enchant seconds]] for one map: as crafted, or enchanted. */
  private mapVariants(mid: number, p: number): Variant[] {
    const g = this.g;
    const base = this.mapMods ? modifierOutcomes(g, "map", mid, this.crafterLevel, this.grade, p) : [[1.0, 0, 0] as Outcome];
    const variants: Variant[] = [["as crafted", () => 0.0, base, 0.0]];
    if (!this.mapEnchant) return variants;
    const level = g.items.map.get(mid).itemLevel ?? 1;
    const grade = craftGrade(this.crafterLevel, level, this.grade);
    let top = maxSuffixFor(g, p);
    if (this.mapSuffixMax !== null) top = Math.min(top, this.mapSuffixMax);
    const eff = luaRound(this.enchanterLevel + 5 + grade * 2); // Enchant:enchantPrefix pool level
    const pool: [number, number][] = [];
    for (const [n, d] of g.prefixes) {
      if (n > 0 && d.weight && eff >= (d.minLevel ?? 0) && (d.maxLevel == null || eff <= d.maxLevel)) pool.push([d.weight, n]);
    }
    const poolW = sumOf(pool.map(([w]) => w));
    const unit = (t: string, i: number) => this.get(t, i, 0);
    const gemId = band(PREFIX_GEM, level)!;

    /** addPrefix cost is linear in prices: split it into gold, gems, essence units. */
    const prefixComponents = (modsBefore: number): [number, number, number, number | undefined] | null => {
      const zero = () => 0.0;
      const only = (target: number | undefined) => (_t: string, i: number) => (i === target ? 1.0 : 0.0);
      const b = addPrefix(g, zero, "map", mid, p, grade, this.enchanterLevel, modsBefore);
      if (b === null) return null;
      const [eid] = enchantEssence(g, "map", mid, p, modsBefore);
      const gems = addPrefix(g, only(gemId), "map", mid, p, grade, this.enchanterLevel, modsBefore)!.cost - b.cost;
      const ess = eid ? addPrefix(g, only(eid), "map", mid, p, grade, this.enchanterLevel, modsBefore)!.cost - b.cost : 0.0;
      return [b.cost, gems, ess, eid];
    };
    const prefixComp = [prefixComponents(0), prefixComponents(1)];
    for (let k = 0; k <= top; k++) {
      const climb: Climb | null = k ? suffixClimb(g, "map", mid, p, grade, this.enchanterLevel, k) : null;
      if (k && climb === null) continue;
      for (const withPrefix of [false, true]) {
        if (k === 0 && !withPrefix) continue;
        if (withPrefix && !poolW) continue;
        const extra = () => {
          let total = 0.0;
          if (climb) {
            total += climb.gold + climb.runes * unit("material", climb.rune_id);
            if (climb.essence) total += climb.essence * unit("material", climb.essence_id!);
          }
          if (withPrefix) {
            const comp = prefixComp[Number(k > 0)];
            if (comp === null) return INF;
            const [gold, gems, ess, eid] = comp;
            total += gold + gems * unit("material", gemId);
            if (ess) total += ess * unit("material", eid!);
          }
          return total;
        };
        const secs = (climb ? climb.seconds : 0) + (withPrefix ? level * 10 : 0);
        const outcomes: Outcome[] = withPrefix ? pool.map(([w, n]) => [w / poolW, n, k]) : [[1.0, 0, k]];
        const label = (k ? `+${k} suffix` : "") + (k && withPrefix ? " & " : "") + (withPrefix ? "prefix" : "");
        variants.push([label, extra, outcomes, secs]);
      }
    }
    return variants;
  }

  get(itype: string, iid: number, p = 0): number {
    if (!PRESTIGE_TYPES.has(itype)) p = 0;
    return this.cost.get(k3(itype, iid, p)) ?? INF;
  }

  /** Python type of get(): float unless the cost is a known integer. */
  isFloat(itype: string, iid: number, p = 0): boolean {
    if (!PRESTIGE_TYPES.has(itype)) p = 0;
    return this.costFloat.get(k3(itype, iid, p)) ?? true; // inf
  }

  private try(key: string, value: number, how: string, isFloat = true): boolean {
    if (value < (this.cost.get(key) ?? INF) - 1e-9) {
      this.cost.set(key, value);
      this.how.set(key, how);
      this.costFloat.set(key, isFloat);
      return true;
    }
    return false;
  }

  solve(maxIter = 500): this {
    const g = this.g;
    for (const [key, sources] of this.questSources) {
      const [t, i] = un2(key);
      for (const [unit, how] of sources) this.try(k3(t, i, 0), unit, how);
    }
    const mapLootCache = new Map<string, Map<string, number>>(); // "mid|p"
    const mapStat = (mid: number, p: number) => this.sourceStats.map?.get(`${mid}|${p}`);
    for (const mid of g.items.map.keys()) {
      const plain = mapLoot(g, mid, this.grade, this.luck);
      for (const p of ascLevels("map")) {
        const st = mapStat(mid, p);
        mapLootCache.set(`${mid}|${p}`, st ? mixByGrade(st.grades, (gr) => mapLoot(g, mid, gr, this.luck)) : plain);
      }
    }
    // essence yield of each variant doesn't depend on prices: compute it once
    const mapVariants = new Map<string, [string, () => number, Map<string, number>, number][]>();
    for (const mid of g.items.map.keys()) {
      for (const p of ascLevels("map")) {
        const st = mapStat(mid, p);
        mapVariants.set(`${mid}|${p}`, this.mapVariants(mid, p)
          .map(([label, extraFn, outcomes, secs]) => [label, extraFn,
            st ? mixByGrade(st.grades, (gr) => mapEssence(g, mid, p, gr, outcomes)) : mapEssence(g, mid, p, this.grade, outcomes), secs]));
      }
    }
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      // crafted items / materials at every ascension level
      for (const [itype, entries] of Object.entries(g.items)) {
        const levels = ascLevels(itype);
        for (const [iid, it] of entries) {
          const rec = g.recipe(itype, iid);
          for (const p of levels) {
            if (p > 0 && it.lockPrestige) continue;
            if (rec) {
              let total = it.cost || 0;
              let fl = !Number.isInteger(total);
              for (const [mtype, mid, amt] of rec) {
                total += amt * this.get(mtype, mid, p);
                fl ||= !Number.isInteger(amt) || this.isFloat(mtype, mid, p);
              }
              if (p > 0) {
                const [eid, eamt] = g.essenceForAscension(itype, iid, p, false);
                total += eamt * this.get("material", eid);
                fl ||= this.isFloat("material", eid);
              }
              if (total < INF) {
                changed = this.try(k3(itype, iid, p), total, `craft (${crafterName(g, it)})` + (p ? ` at asc ${p}` : ""), fl) || changed;
              }
            }
            if (p > 0) {
              const prev = this.get(itype, iid, p - 1);
              const [eid, eamt] = g.essenceForAscension(itype, iid, p, true);
              const total = prev + eamt * this.get("material", eid);
              if (total < INF) {
                changed = this.try(k3(itype, iid, p), total, `ascend asc${p - 1} item (+${eamt}x ${g.name("material", eid)})`,
                  this.isFloat(itype, iid, p - 1) || this.isFloat("material", eid)) || changed;
              }
            }
          }
        }
      }
      // essence from map runs
      this.essenceSources = new Map();
      const addSource = (eid: number, s: EssenceSource) => {
        if (!this.essenceSources.has(eid)) this.essenceSources.set(eid, []);
        this.essenceSources.get(eid)!.push(s);
      };
      for (const [mid, m] of g.items.map) {
        for (const p of ascLevels("map")) {
          const mapCost = this.get("map", mid, p);
          if (mapCost === INF) continue;
          const runCost = mapCost + (mapStat(mid, p)?.timeH ?? (m.baseMapTime ?? 0) / 3600) * this.heroHourCost;
          const loot = mapLootCache.get(`${mid}|${p}`)!;
          const credit = this.alloc === "full" ? 0 : sumOf([...loot].map(([k, a]) => a * this.svKey(k)));
          // loot found only in maps is priced at its sell value (the gold you give up by using it)
          for (const [lkey, lamt] of loot) {
            const [lt, li] = un2(lkey);
            if (g.items[lt]?.has(li) && lamt > 0) {
              changed = this.try(k3(lt, li, 0), this.sv(lt, li), `map loot ${m.name} (valued at sell price)`, false) || changed;
            }
          }
          const essValueOf = (ess: Map<string, number>) => sumOf([...ess].map(([k, a]) => a * this.svKey(k))) || 1;
          const bestPerEssence = new Map<string, [number, number, string, number]>();
          for (const [label, extraFn, ess, secs] of mapVariants.get(`${mid}|${p}`)!) {
            if (!ess.size) continue;
            const extra = extraFn();
            if (extra === INF) continue;
            const essValue = essValueOf(ess);
            const net = Math.max(runCost + extra + secs / 3600 * this.heroHourCost - credit, 0);
            for (const [key, amt] of ess) {
              if (amt <= 0) continue;
              const unit = ess.size > 1 ? net * this.svKey(key) / essValue : net / amt;
              const cur = bestPerEssence.get(key);
              if (label === "as crafted" || cur === undefined || unit < cur[0]) {
                if (label === "as crafted") addSource(un2(key)[1], [mid, p, unit, amt, runCost, credit, label]);
                if (cur === undefined || unit < cur[0]) bestPerEssence.set(key, [unit, amt, label, runCost + extra]);
              }
            }
          }
          for (const [key, [unit, amt, label, totalCost]] of bestPerEssence) {
            const [kt, eid] = un2(key);
            if (label !== "as crafted") addSource(eid, [mid, p, unit, amt, totalCost, credit, label]);
            const forced = this.essenceFrom.get(eid);
            if (forced && (forced[0] !== mid || forced[1] !== p)) continue;
            if (this.try(k3(kt, eid, 0), unit, `map ${m.name}` + (p ? ` asc${p}` : "") +
              (label === "as crafted" ? "" : ` enchanted ${label}`) + ` (${f(amt, 0)} essence/run)`)) {
              changed = true;
              this.essenceChoice.set(eid, [mid, p, label]);
            }
          }
        }
      }
      if (!changed) break;
    }
    return this;
  }
}

export function crafterName(g: Game, it: Any): string {
  return g.crafters.get(it.crafterID)?.name ?? "?";
}

// ------------------------------------------------------- enchant strategies
/**
 * Expected value of "take the item as it comes out, then enchant up to k modifiers" for k = 1, 2.
 * Returns {k: [ev_sell - ev_enchant_cost, ev_seconds]}.
 */
export function enchantStrategies(s: Solver, itype: string, iid: number, p: number, outcomes: Outcome[],
  sellByMods: number[]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  if (itype !== "equipment" || s.enchanterLevel <= 0) return out;
  const grade = craftGrade(s.crafterLevel, s.g.item(itype, iid).itemLevel ?? 1, s.grade);
  const step = (kind: "prefix" | "suffix", modsBefore: number) => s.enchantStep(kind, itype, iid, p, grade, modsBefore);
  for (const k of [1, 2]) {
    let totalValue = 0.0, totalTime = 0.0, feasible = true;
    for (const [prob, pf, sf] of outcomes) {
      let hasP = Boolean(pf), hasS = Boolean(sf);
      let cost = 0.0, secs = 0.0;
      let mods = Number(hasP) + Number(hasS);
      // add the cheapest missing modifiers until k is reached
      while (mods < k) {
        const options: ["p" | "s", StepResult][] = [];
        if (!hasP && step("prefix", mods)) options.push(["p", step("prefix", mods)!]);
        if (!hasS && step("suffix", mods)) options.push(["s", step("suffix", mods)!]);
        if (!options.length) {
          feasible = false;
          break;
        }
        const [which, r] = options.reduce((a, b) => (b[1].cost < a[1].cost ? b : a));
        cost += r.cost;
        secs += r.seconds;
        hasP ||= which === "p";
        hasS ||= which === "s";
        mods++;
      }
      if (!feasible) break;
      totalValue += prob * (sellByMods[mods] - cost);
      totalTime += prob * secs;
    }
    if (feasible) out.set(k, [totalValue, totalTime]);
  }
  return out;
}

// ------------------------------------------------------------------ report
/** str() of a Python float: 12 -> "12.0", inf -> "inf", 5e-05 and 1e+16 in Python's exponent style. */
export function pyFloatStr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (Object.is(x, -0)) return "-0.0";
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e16)) return x.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

/** A number Python holds as a float: prints as Python does (str/CSV), compares and sorts as a number. */
export class PyFloat {
  readonly v: number;
  constructor(v: number) {
    this.v = v;
  }
  valueOf(): number {
    return this.v;
  }
  toString(): string {
    return pyFloatStr(this.v);
  }
  toJSON(): number {
    return this.v;
  }
}
/** round(x, d) as Python types it: a float when `isFloat`, else an int. */
const rf = (x: number, d: number, isFloat = true): Cell => (isFloat ? new PyFloat(pyRound(x, d)) : pyRound(x, d));

/** "" for a missing value, as the Python reports write it. */
type Cell = number | string | PyFloat;
export type Row = Record<string, Cell>;

/** (itemType, id, asc) -> count, e.g. from save.ts owned(). */
export type Owned = Map<string, number>;

export function buildRows(s: Solver, types: string[], owned?: Owned | null): Row[] {
  const g = s.g;
  const rows: Row[] = [];
  for (const itype of types) {
    const levels = ascLevels(itype);
    for (const [iid, it] of g.items[itype]) {
      for (const p of levels) {
        const key = k3(itype, iid, p);
        const cost = s.cost.get(key) ?? INF;
        if (cost === INF) continue;
        const how = s.how.get(key) ?? "";
        const sell = g.sellValue(itype, iid, p);
        const sellByMods = [0, 1, 2].map((m) => g.sellValue(itype, iid, p, m));
        // Only a fresh craft rolls modifiers; an ascended plain item stays plain.
        const outcomes = how.startsWith("craft") ? modifierOutcomes(g, itype, iid, s.crafterLevel, s.grade, p) : [[1.0, 0, 0] as Outcome];
        // sum() of no probabilities is the int 0 in Python
        const pSum = (pick: (o: Outcome) => unknown): Cell => {
          const ps = outcomes.filter(pick).map((o) => o[0]);
          return rf(100 * sumOf(ps), 1, ps.length > 0);
        };
        const evSell = sumOf(outcomes.map((o) => o[0] * sellByMods[Number(Boolean(o[1])) + Number(Boolean(o[2]))]));
        const profit = sell - cost;
        const evProfit = evSell - cost;
        const strategies = new Map<string, [number, number]>([["sell as crafted", [evProfit, 0.0]]]);
        for (const [k, [netSell, secs]] of enchantStrategies(s, itype, iid, p, outcomes, sellByMods)) {
          strategies.set(`enchant to ${k} mod` + (k > 1 ? "s" : ""), [netSell - cost, secs]);
        }
        const [bestName, [bestProfit, bestSecs]] = [...strategies].reduce((a, b) => (b[1][0] > a[1][0] ? b : a));
        const ench1 = strategies.get("enchant to 1 mod");
        const ench2 = strategies.get("enchant to 2 mods");
        let runH = (it.runTime || 0) / 3600;
        if (p && how.startsWith("ascend")) runH = (it.itemLevel ?? 1) * 60 / 3600; // default.itemAscendTime
        const row: Row = {
          type: itype, id: iid, name: it.name, asc: p,
          level: it.itemLevel ?? "", rarity: it.rarity ?? "",
          crafter: it.crafterID ? crafterName(g, it) : "",
          sell, sell_1mod: sellByMods[1], sell_2mod: sellByMods[2],
          "p_prefix%": pSum((o) => o[1]), "p_suffix%": pSum((o) => o[2]),
          "p_both%": pSum((o) => o[1] && o[2]), ev_sell: rf(evSell, 1),
          cost: rf(cost, 2, s.costFloat.get(key)), profit: rf(profit, 2, s.costFloat.get(key)),
          "margin%": cost > 0 ? rf(100 * profit / cost, 1) : "",
          ev_profit: rf(evProfit, 2),
          "ev_margin%": cost > 0 ? rf(100 * evProfit / cost, 1) : "",
          craft_min: rf(runH * 60, 1),
          profit_per_craft_hour: runH ? rf(profit / runH, 1) : "",
          ev_profit_per_craft_hour: runH ? rf(evProfit / runH, 1) : "",
          ench1_profit: ench1 ? rf(ench1[0], 2) : "",
          ench2_profit: ench2 ? rf(ench2[0], 2) : "",
          best_strategy: bestName, best_profit: rf(bestProfit, 2),
          "best_margin%": cost > 0 ? rf(100 * bestProfit / cost, 1) : "",
          enchant_min: rf(bestSecs / 60, 1),
          how,
        };
        if (owned) row.owned = owned.get(key) ?? 0;
        rows.push(row);
      }
    }
  }
  return rows;
}

/** Should I ascend the item I already hold? Gain of one upgrade for 0, 1 or 2 modifiers. */
export function buildAscendModdedRows(s: Solver): Row[] {
  const g = s.g;
  const rows: Row[] = [];
  for (const itype of ["equipment", "consumable"]) {
    for (const [iid, it] of g.items[itype]) {
      if (it.lockPrestige || !s.cost.has(k3(itype, iid, 0))) continue;
      for (let p = 1; p <= MAX_PRESTIGE; p++) {
        const row: Row = { type: itype, id: iid, name: it.name, level: it.itemLevel ?? "", rarity: it.rarity ?? "",
          from_asc: p - 1, to_asc: p };
        let eid = 0;
        for (let m = 0; m < (itype === "equipment" ? 3 : 1); m++) {
          let eamt;
          [eid, eamt] = g.essenceForAscension(itype, iid, p, true, m);
          const ecost = eamt * s.get("material", eid);
          const gain = g.sellValue(itype, iid, p, m) - g.sellValue(itype, iid, p - 1, m) - ecost;
          row[`essence_${m}mod`] = eamt;
          row[`gain_${m}mod`] = rf(gain, 1, s.isFloat("material", eid));
        }
        row.essence = g.name("material", eid);
        rows.push(row);
      }
    }
  }
  return rows;
}

/** Per equipment and ascension: odds, attempts, cost and time of a first prefix / +1 suffix, and the price gain. */
export function buildEnchantRows(s: Solver): Row[] {
  const g = s.g;
  const rows: Row[] = [];
  for (const [iid, it] of g.items.equipment) {
    for (const p of ascLevels("equipment")) {
      if (!s.cost.has(k3("equipment", iid, p))) continue;
      const grade = craftGrade(s.crafterLevel, it.itemLevel ?? 1, s.grade);
      const gain1 = g.sellValue("equipment", iid, p, 1) - g.sellValue("equipment", iid, p, 0);
      const row: Row = { id: iid, name: it.name, asc: p, level: it.itemLevel ?? "", rarity: it.rarity ?? "",
        item_grade: grade, sell: g.sellValue("equipment", iid, p), gain_1mod: gain1,
        gain_2mod: g.sellValue("equipment", iid, p, 2) - g.sellValue("equipment", iid, p, 0) };
      for (const kind of ["prefix", "suffix"] as const) {
        const r = s.enchantStep(kind, "equipment", iid, p, grade, 0);
        row[`${kind}_chance%`] = r ? new PyFloat(r["chance%"]) : "";
        row[`${kind}_attempts`] = r ? rf(r.attempts, 2) : "";
        row[`${kind}_cost`] = r ? rf(r.cost, 1) : "";
        row[`${kind}_min`] = r ? rf(r.seconds / 60, 1) : "";
        row[`${kind}_net`] = r ? rf(gain1 - r.cost, 1) : "";
      }
      rows.push(row);
    }
  }
  return rows;
}

export function buildEssenceRows(s: Solver): Row[] {
  const g = s.g;
  const rows: Row[] = [];
  for (const eid of [...s.essenceSources.keys()].sort((a, b) => a - b)) {
    const srcs = [...s.essenceSources.get(eid)!].sort((a, b) => a[2] - b[2]);
    for (const [mid, p, unit, amt, runCost, credit, label] of srcs) {
      const ch = s.essenceChoice.get(eid);
      rows.push({ essence: g.name("material", eid), essence_id: eid, map: g.items.map.get(mid).name, map_id: mid, map_asc: p,
        // credit is the int 0 with --alloc full
        enchant: label, essence_per_run: rf(amt, 1), map_cost: rf(runCost, 1), loot_credit: rf(credit, 1, s.alloc !== "full"),
        cost_per_essence: rf(unit, 2), chosen: ch && ch[0] === mid && ch[1] === p && ch[2] === label ? "yes" : "" });
    }
  }
  return rows;
}

/** 'Forest Essence=Hard Tuvale Map' or '33=2@0' -> essence id -> [map id, asc]. */
export function parseEssenceFrom(values: string[] | undefined, g: Game): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const byName = new Map([...g.items.material].map(([mid, m]) => [String(m.name).toLowerCase(), mid]));
  const mapsByName = new Map([...g.items.map].map(([mid, m]) => [String(m.name).toLowerCase(), mid]));
  const lookup = (table: Map<string, number>, s: string, what: string) => {
    if (/^\d+$/.test(s)) return Number(s);
    const id = table.get(s.toLowerCase());
    if (id === undefined) throw new Error(`unknown ${what}: ${s}`);
    return id;
  };
  for (const v of values ?? []) {
    const i = v.indexOf("=");
    if (i < 0) throw new Error(`--essence-from: expected ESSENCE=MAP[@ASC], got ${v}`);
    const [mp, p] = v.slice(i + 1).split("@");
    out.set(lookup(byName, v.slice(0, i), "essence"), [lookup(mapsByName, mp, "map"), Number(p || 0)]);
  }
  return out;
}

/** Sort as the former profit.py did: by `key` descending, "" last, ties in table order. */
export function sortRows(rows: Row[], key: string): Row[] {
  const v = (r: Row) => (r[key] === "" || r[key] === undefined ? -INF : Number(r[key]));  // PyFloat -> valueOf
  return rows.sort((a, b) => v(b) - v(a) || 0);
}

// ------------------------------------------------------------------ CSV
/** CSV as csv.DictWriter writes it (numbers in JS notation: 35 where Python may write 35.0). */
export function toCsv(rows: Row[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const cell = (v: Cell | undefined) => {
    const s = v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\r\n") + "\r\n";
}

export interface ProfitReport {
  tag: string;
  rows: Row[];
  essence: Row[];
  ascendModded: Row[];
  enchant: Row[];
  solver: Solver;
  lines: string[];
}

export interface ProfitOptions extends SolverOptions {
  types?: string[];
  sort?: string;
  top?: number;
  essenceFromSpecs?: string[];
  owned?: Owned | null;
  /** How the summary prints luck and hero hour cost (Python: "0" by default, "3.0" when given on the command line). */
  labels?: { luck?: string; heroHourCost?: string };
}

/** Every table of the profit model plus the summary lines, without touching files. */
export function profitReport(g: Game, o: ProfitOptions = {}): ProfitReport {
  const grade = o.grade ?? 3, alloc = o.alloc ?? "value", sort = o.sort ?? "best_profit", top = o.top ?? 25;
  const s = new Solver(g, { ...o, grade, alloc, essenceFrom: o.essenceFrom ?? parseEssenceFrom(o.essenceFromSpecs, g) }).solve();
  const types = o.types?.length ? o.types : ["equipment", "consumable", "map"];
  const rows = sortRows(buildRows(s, types, o.owned), sort);
  const tag = `g${grade}_${alloc}`;
  const unpriced = types.flatMap((t) => [...g.items[t].keys()].filter((i) => !s.cost.has(k3(t, i, 0))));
  const lines: string[] = [];
  const pfs = (x: Cell) => (typeof x === "number" && Number.isInteger(x) ? x.toFixed(1) : String(x)); // str(float)
  lines.push(`grade ${grade}, luck ${o.labels?.luck ?? o.luck ?? 0}, alloc ${alloc}, ` +
    `hero hour cost ${o.labels?.heroHourCost ?? o.heroHourCost ?? 0}, ` +
    `crafter level ${s.crafterLevel}, enchanter level ${s.enchanterLevel}, ` +
    `map modifiers ${s.mapMods ? "on" : "off"}, map enchanting ${s.mapEnchant ? "on" : "off"}` +
    (s.mapSuffixMax !== null ? ` (max suffix +${s.mapSuffixMax})` : ""));
  lines.push(`${rows.length} priced (item, ascension) rows; ${unpriced.length} items without a known source at asc 0\n`);
  lines.push("Essence: cheapest source");
  for (const eid of [...s.essenceSources.keys()].sort((a, b) => a - b)) {
    lines.push(`  ${g.name("material", eid).padEnd(22)} ${f(s.cost.get(k3("material", eid, 0)) ?? INF, 2).padStart(8)} g  via ` +
      (s.how.get(k3("material", eid, 0)) ?? "-"));
  }
  lines.push(`\nTop ${top} by ${sort}:`);
  lines.push(`${"name".padEnd(30)} ${"asc".padStart(3)} ${"lvl".padStart(3)} ${"sell".padStart(8)} ${"+1 mod".padStart(8)} ` +
    `${"+2 mod".padStart(8)} ${"cost".padStart(8)} ${"ev_profit".padStart(9)} ${"best_profit".padStart(11)} ` +
    `${"best_marg%".padStart(10)}  ${"best strategy".padEnd(18)} how`);
  for (const r of rows.slice(0, top)) {
    lines.push(`${String(r.name).slice(0, 30).padEnd(30)} ${String(r.asc).padStart(3)} ${String(r.level).padStart(3)} ` +
      `${String(r.sell).padStart(8)} ${String(r.sell_1mod).padStart(8)} ${String(r.sell_2mod).padStart(8)} ` +
      `${f(Number(r.cost), 0).padStart(8)} ${f(Number(r.ev_profit), 0).padStart(9)} ${f(Number(r.best_profit), 0).padStart(11)} ` +
      `${pfs(r["best_margin%"]).padStart(10)}  ${String(r.best_strategy).padEnd(18)} ${r.how}`);
  }
  return { tag, rows, essence: buildEssenceRows(s), ascendModded: buildAscendModdedRows(s), enchant: buildEnchantRows(s), solver: s, lines };
}
