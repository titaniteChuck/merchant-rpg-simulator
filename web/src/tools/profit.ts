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
import { addPrefix, addSuffix, band, type Climb, enchantEssence, PREFIX_GEM, resetPath, type StepResult, suffixClimb, maxSuffixFor }
  from "./enchant.ts";
import { clamp, Game, KeyError, luaRound, PRESTIGE_TYPES, pyRound } from "./gamedata.ts";
import { MAP_ONLY_QUEST_TYPE, mapCraftSeconds } from "./quest-stats.ts";

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

/** {"type|id": expected amount} of lootService.generateParcelItem (the quest amount, `enemyAmount` in the game, scales
 * item odds and material amounts). */
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
      amount *= enemyAmount; // rolled once per amount (weighted amounts) or multiplied (fixed)
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

/**
 * Expected essence of one run; `outcomes` = modifier roll distribution of the map. default.mapEssenceReward:
 * round(gradeBonus[grade] x amount x essenceBase x (1 + partyLuck / 100)) per essence (data.Default.lua:757), essenceBase
 * from mapEssenceMultiplier (prefix sell, suffix atk, prefix essence modifier).
 */
export function mapEssence(g: Game, mid: number, prestige: number, grade: number, outcomes: Outcome[] = [[1.0, 0, 0]],
  luck = 0): Map<string, number> {
  const br: number[] = g.items.map.get(mid).baseReward ?? [];
  const half = Math.floor(br.length / 2);
  const out = new Map<string, number>();
  for (let i = 0; i < half; i++) {
    const eid = g.prestigedEssence(br[i], prestige);
    if (eid === undefined) continue;
    out.set(k2("material", eid), sumOf(outcomes.map(([prob, pf, sf]) =>
      prob * luaRound(g.gradeBonus.get(grade)! * br[i + half] * mapEssenceMultiplier(g, pf, sf) * (1 + luck / 100)))));
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
 * consumables never do. Ingredients are plain unless `boost` says otherwise.
 */
export function modifierOutcomes(g: Game, itype: string, iid: number, crafterLevel: number, ingredientGrade: number,
  prestige = 0, boost: IngredientBoost = {}): Outcome[] {
  const it = g.item(itype, iid);
  if (itype !== "equipment" && itype !== "map") return [[1.0, 0, 0]];
  const level = it.itemLevel ?? 1;
  const grade = craftGrade(crafterLevel, level, ingredientGrade);
  if (itype === "equipment" && grade <= 2) return [[1.0, 0, 0]];
  const effLevel = (gr: number) => luaRound(crafterLevel + gr * 2 - 4);
  const suffixOutcomes = (gr: number): [number, number][] => {
    if (itype === "equipment" && it.itemSlot === 6) return [[1.0, 0]];
    const eff = effLevel(gr);
    const sb = itype === "equipment" ? boost.suffix ?? 0 : 0; // Item rolls only; Map has its own
    const odds = Math.min((eff - level) * 2 + 3 * sb, 40 + 3 * sb); // default.__craftSuffixOdds
    const pool = eligible(g.suffixes, eff, prestige);
    const pHit = pool.length ? rollChance(odds) : 0;
    const totalW = sumOf(pool.map(([, d]) => d.weight)) || 1;
    return [[1 - pHit, 0], ...(pHit ? pool.map(([n, d]) => [pHit * d.weight / totalW, n] as [number, number]) : [])];
  };
  const eff = effLevel(grade);
  const pb = itype === "equipment" && boost.prefix ? 20 : 0;
  const odds = Math.min((eff - level) * 2 + pb, 25 + pb); // default.__craftPrefixOdds
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

/**
 * Modded equipment ingredients (Player:removeItemForCrafting, Craft:removeMaterials): `suffix` = the sum over
 * ingredient types of the highest suffix tier used (+3 % suffix odds and cap per tier), `prefix` = any ingredient
 * has a prefix (+20 % prefix odds and cap).
 */
export interface IngredientBoost {
  prefix?: boolean;
  suffix?: number;
}

/**
 * Final essenceBase of a map: Map:applyPrefix (x (1 + sell)), Map:applySuffix (x (1 + atk)), then
 * default.finalMapMod folds the prefix's mapStats.essenceMod (Skilled x1.25, Expert's x1.5) into it, so
 * mapEssenceReward rounds once.
 */
export function mapEssenceMultiplier(g: Game, prefix: number, suffix: number): number {
  let m = 1.0;
  if (prefix) m *= 1 + (g.prefixes.get(prefix).sell ?? 0);
  if (suffix) m *= 1 + (g.suffixes.get(suffix).stats?.atk ?? 0);
  if (prefix) m *= g.prefixes.get(prefix).mapStats?.essenceMod ?? 1;
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
  /** Enchanter's Reset before enchanting (raises the item grade, so the odds): try 0..8 resets, keep the cheapest. */
  resetBeforeEnchant?: boolean;
  /** Also consider enchanting at a lower ascension, then ascending with the modifiers (buildRows best_strategy). */
  enchantOrder?: boolean;
  /** Per-source overrides from simulation (see farming.ts): quests keyed "qid" or "qid|rare", maps keyed "mid|asc". */
  sourceStats?: { quest?: Map<string, SourceStat>; map?: Map<string, SourceStat> };
  luck?: number;
  alloc?: "value" | "full";
  heroHourCost?: number;
  /** Gold per hour of Scribe time (crafting the map of a run); default 0: craft time only shows in hoursPerUnit. */
  crafterHourCost?: number;
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
  readonly crafterHourCost: number;
  readonly essenceFrom: Map<number, [number, number]>;
  readonly sourceStats: { quest?: Map<string, SourceStat>; map?: Map<string, SourceStat> };
  readonly resetBeforeEnchant: boolean;
  readonly enchantOrder: boolean;
  essenceChoice = new Map<number, [number, number, string]>(); // essence id -> (map id, prestige, variant label)
  cost = new Map<string, number>(); // "type|id|p" -> best unit cost
  how = new Map<string, string>(); // "type|id|p" -> description of best method
  /** Whether Python holds the cost as a float (ints come only from integer sell values and gold costs). */
  costFloat = new Map<string, boolean>();
  essenceSources = new Map<number, EssenceSource[]>();
  /**
   * Hours per unit of what comes from map runs ("type|id|0"): (map craft hours + run hours) / amount per run, for
   * essences and map-only loot (items no quest-board quest drops and no recipe makes).
   */
  hoursPerUnit = new Map<string, number>();
  /** Forced essence sources (essenceFrom) that can't price their essence, with the reason (the essence stays unpriced). */
  errors: string[] = [];
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
    this.crafterHourCost = o.crafterHourCost ?? 0;
    this.essenceFrom = o.essenceFrom ?? new Map();
    this.sourceStats = o.sourceStats ?? {};
    this.resetBeforeEnchant = o.resetBeforeEnchant ?? false;
    this.enchantOrder = o.enchantOrder ?? false;
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

  /**
   * Quests have a fixed gold cost, so their unit costs are computed once. Quest-board quests only: map bosses and
   * Treasure Bushes (questType 8, never on the board) are paid with a whole map run (see solve()).
   */
  private buildQuestSources(): Map<string, [number, string][]> {
    const src = new Map<string, [number, string][]>();
    const board = [...this.g.quests].filter(([, q]) => q.questType !== MAP_ONLY_QUEST_TYPE);
    const variants: [number, boolean][] = board.map(([qid]) => [qid, false]);
    // Rare variant (nameB/goldB, rewardB*): only offered at random, but the only quest source of boss trophies.
    for (const [qid, q] of board) if (q.rewardB1 || q.rewardB3) variants.push([qid, true]);
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
    // A forced source can need its own essence (Hard Tuvale Map: 50 Forest Essence in, ~200 out). Start each forced
    // essence at a huge upper bound: the loop only lowers costs, so the cycle converges down to its fixed point
    // x = (map cost without the essence + run cost - loot credit) / (yield - essence in the recipe), when one exists.
    const SEED = 1e12;
    for (const eid of this.essenceFrom.keys()) {
      const key = k3("material", eid, 0);
      if (!this.cost.has(key)) {
        this.cost.set(key, SEED);
        this.how.set(key, "unpriced");
        this.costFloat.set(key, true);
      }
    }
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
            st ? mixByGrade(st.grades, (gr) => mapEssence(g, mid, p, gr, outcomes, this.luck))
              : mapEssence(g, mid, p, this.grade, outcomes, this.luck), secs]));
      }
    }
    // Loot that no quest-board quest drops and no recipe makes: only a whole map run gives it (map bosses' trophies...).
    const mapOnly = (t: string, i: number) => !this.questSources.has(k2(t, i)) && !g.recipe(t, i);
    // Scribe hours of one map (the map and the lower maps its recipe consumes) at its craft grade: obj.Craft.
    const craftH = new Map<number, number>();
    for (const [mid, m] of g.items.map) {
      craftH.set(mid, mapCraftSeconds(mid, craftGrade(this.crafterLevel, m.itemLevel ?? 1, this.grade)) / 3600);
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
          const runH = mapStat(mid, p)?.timeH ?? (m.baseMapTime ?? 0) / 3600, mapH = craftH.get(mid) ?? 0;
          // one run: the map (crafted: gold + materials at their cost), the heroes' run time, the Scribe's craft time
          const runCost = mapCost + runH * this.heroHourCost + mapH * this.crafterHourCost;
          const loot = mapLootCache.get(`${mid}|${p}`)!;
          const credit = this.alloc === "full" ? 0 : sumOf([...loot].map(([k, a]) => a * this.svKey(k)));
          for (const [lkey, lamt] of loot) {
            const [lt, li] = un2(lkey);
            if (!g.items[lt]?.has(li) || lamt <= 0) continue;
            if (mapOnly(lt, li)) {
              // map-only loot (a map boss's trophy): one unit costs a whole run / the expected drops per run
              const key = k3(lt, li, 0);
              if (this.try(key, runCost / lamt, `map run ${m.name}${p ? ` asc${p}` : ""} (${f(lamt, 3)}/run; ` +
                `run cost ${f(runCost, 0)} g, ${f(mapH + runH, 2)} h craft + run)`)) {
                changed = true;
                this.hoursPerUnit.set(key, (mapH + runH) / lamt);
              }
            } else {
              // by-product of a run that quests also give: worth its sell value (the gold you give up by using it)
              changed = this.try(k3(lt, li, 0), this.sv(lt, li), `map loot ${m.name} (valued at sell price)`, false) || changed;
            }
          }
          const essValueOf = (ess: Map<string, number>) => sumOf([...ess].map(([k, a]) => a * this.svKey(k))) || 1;
          const bestPerEssence = new Map<string, [number, number, string, number, number]>();
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
                if (cur === undefined || unit < cur[0]) bestPerEssence.set(key, [unit, amt, label, runCost + extra, secs]);
              }
            }
          }
          for (const [key, [unit, amt, label, totalCost, encSecs]] of bestPerEssence) {
            const [kt, eid] = un2(key);
            if (label !== "as crafted") addSource(eid, [mid, p, unit, amt, totalCost, credit, label]);
            const forced = this.essenceFrom.get(eid);
            if (forced && (forced[0] !== mid || forced[1] !== p)) continue;
            if (this.try(k3(kt, eid, 0), unit, `map ${m.name}` + (p ? ` asc${p}` : "") +
              (label === "as crafted" ? "" : ` enchanted ${label}`) + ` (${f(amt, 0)} essence/run)` +
              (unit === 0 ? ", free by-product: the run's other loot pays for the map" : ""))) {
              changed = true;
              this.essenceChoice.set(eid, [mid, p, label]);
              this.hoursPerUnit.set(k3(kt, eid, 0), (mapH + runH + encSecs / 3600) / amt);
            }
          }
        }
      }
      if (!changed) break;
    }
    for (const [eid, [mid, p]] of this.essenceFrom) {
      const key = k3("material", eid, 0);
      if ((this.cost.get(key) ?? INF) < SEED / 2) continue;
      // no positive fixed point: the forced map uses at least as much of the essence as it yields, or can't be made
      for (const [k, v] of this.cost) if (v >= SEED / 2) (this.cost.delete(k), this.how.delete(k), this.costFloat.delete(k));
      this.errors.push(`${g.name("material", eid)} from ${g.items.map.get(mid)?.name ?? `map ${mid}`}${p ? ` asc${p}` : ""}: ` +
        "no positive cost (the map consumes at least as much of this essence as a run yields, or can't be crafted)");
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
  const grade0 = craftGrade(s.crafterLevel, s.g.item(itype, iid).itemLevel ?? 1, s.grade);
  // With resetBeforeEnchant, the item may be reset r times first (same r for every crafted outcome).
  const resets = s.resetBeforeEnchant
    ? resetPath(s.g, (t, i) => s.get(t, i, 0), itype, iid, p, grade0, s.enchanterLevel, 0)
    : [{ resets: 0, grade: grade0, cost: 0, seconds: 0 }];
  for (const k of [1, 2]) {
    let best: [number, number] | null = null;
    for (const r of resets) {
      const step = (kind: "prefix" | "suffix", modsBefore: number) => s.enchantStep(kind, itype, iid, p, r.grade, modsBefore);
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
          const [which, res] = options.reduce((a, b) => (b[1].cost < a[1].cost ? b : a));
          cost += res.cost;
          secs += res.seconds;
          hasP ||= which === "p";
          hasS ||= which === "s";
          mods++;
        }
        if (!feasible) break;
        // resets are only worth paying when the item still needs a modifier
        const needs = Number(Boolean(pf)) + Number(Boolean(sf)) < k;
        totalValue += prob * (sellByMods[mods] - cost - (needs ? r.cost : 0));
        totalTime += prob * (secs + (needs ? r.seconds : 0));
      }
      if (feasible && (best === null || totalValue > best[0])) best = [totalValue, totalTime];
    }
    if (best) out.set(k, best);
  }
  return out;
}

/**
 * Enchant before ascending: reach asc `p` with `k` modifiers by taking the plain item at asc q < p, enchanting it
 * there (no or less essence per attempt, the Enchanter's level) and ascending it with its modifiers
 * (essence x (4 + mods), AscendItem keeps prefix, suffix and grade). Value = sell - (this route - cost at p), the
 * same convention as enchantStrategies, so buildRows can subtract the cost at p. Keys: "k|q".
 */
export function enchantOrderStrategies(s: Solver, itype: string, iid: number, p: number,
  sellByMods: number[]): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  if (itype !== "equipment" || p === 0 || s.enchanterLevel <= 0) return out;
  const it = s.g.item(itype, iid);
  if (it.lockPrestige) return out;
  const costP = s.get(itype, iid, p);
  if (costP === INF) return out;
  for (let q = 0; q < p; q++) {
    const costQ = s.get(itype, iid, q);
    if (costQ === INF) continue;
    const plan = enchantRoute(s, itype, iid, q);
    for (const k of [1, 2]) {
      const route = plan[k];
      if (!route) continue;
      let ascend = 0;
      for (let r = q + 1; r <= p; r++) {
        const [eid, eamt] = s.g.essenceForAscension(itype, iid, r, true, k);
        ascend += eamt * s.get("material", eid);
      }
      const total = costQ + route[0] + ascend;
      if (!Number.isFinite(total)) continue;
      out.set(`${k}|${q}`, [sellByMods[k] - (total - costP), route[1] + (p - q) * (it.itemLevel ?? 1) * 60, total]);
    }
  }
  return out;
}

/** Cheapest way from a plain item at asc p to 1 and 2 modifiers: [cost, seconds] (with resets if enabled). */
function enchantRoute(s: Solver, itype: string, iid: number, p: number): Record<number, [number, number] | null> {
  const sell = [0, 0, 0];
  const strat = enchantStrategies(s, itype, iid, p, [[1.0, 0, 0]], sell);
  const res: Record<number, [number, number] | null> = { 1: null, 2: null };
  for (const k of [1, 2]) {
    const v = strat.get(k);
    if (v) res[k] = [-v[0], v[1]]; // sell 0: value = -cost
  }
  return res;
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
        if (s.enchantOrder) {
          for (const [key, [netSell, secs]] of enchantOrderStrategies(s, itype, iid, p, sellByMods)) {
            const [k, q] = key.split("|").map(Number);
            strategies.set(`enchant to ${k} mod${k > 1 ? "s" : ""} at asc ${q}, then ascend`, [netSell - cost, secs]);
          }
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

/** Enchant before or after ascending (needs a Solver; resets follow its resetBeforeEnchant). Per item, asc and mod count. */
export function buildEnchantOrderRows(s: Solver): Row[] {
  const g = s.g;
  const rows: Row[] = [];
  for (const [iid, it] of g.items.equipment) {
    if (it.lockPrestige) continue;
    for (let p = 1; p <= MAX_PRESTIGE; p++) {
      const costP = s.get("equipment", iid, p);
      if (costP === INF) continue;
      const after = enchantRoute(s, "equipment", iid, p);
      const before = enchantOrderStrategies(s, "equipment", iid, p, [0, 0, 0]);
      for (const k of [1, 2]) {
        const a = after[k];
        let best: [number, number] | null = null; // [total, q]
        for (const [key, [, , total]] of before) {
          const [kk, q] = key.split("|").map(Number);
          if (kk === k && (best === null || total < best[0])) best = [total, q];
        }
        if (!a && !best) continue;
        const afterTotal = a ? costP + a[0] : INF;
        rows.push({
          type: "equipment", id: iid, name: it.name, level: it.itemLevel ?? "", asc: p, mods: k,
          cost_enchant_after: rf(afterTotal, 1), best_before_at_asc: best ? best[1] : "",
          cost_enchant_before: best ? rf(best[0], 1) : "",
          saving: best && Number.isFinite(afterTotal) ? rf(afterTotal - best[0], 1) : "",
          cheaper: !best ? "after" : best[0] < afterTotal - 1e-9 ? `before (at asc ${best[1]})` : "after",
        });
      }
    }
  }
  return rows;
}

/** Reset before a first prefix / suffix: best number of resets, grade reached and saving, per item at asc 0..2. */
export function buildResetRows(s: Solver, maxResets = 8): Row[] {
  const g = s.g;
  const rows: Row[] = [];
  const unit = (t: string, i: number) => s.get(t, i, 0);
  for (const [iid, it] of g.items.equipment) {
    for (const p of ascLevels("equipment")) {
      if (p > 0 && it.lockPrestige) continue;
      if (s.get("equipment", iid, p) === INF) continue;
      const grade = craftGrade(s.crafterLevel, it.itemLevel ?? 1, s.grade);
      const path = resetPath(g, unit, "equipment", iid, p, grade, s.enchanterLevel, 0, maxResets);
      const row: Row = { type: "equipment", id: iid, name: it.name, level: it.itemLevel ?? "", asc: p, craft_grade: grade };
      for (const kind of ["prefix", "suffix"] as const) {
        const plain = s.enchantStep(kind, "equipment", iid, p, grade, 0);
        if (!plain) continue;
        let best = { resets: 0, grade, total: plain.cost };
        for (const r of path.slice(1)) {
          const st = s.enchantStep(kind, "equipment", iid, p, r.grade, 0);
          if (st && r.cost + st.cost < best.total - 1e-9) best = { resets: r.resets, grade: r.grade, total: r.cost + st.cost };
        }
        row[`${kind}_cost`] = rf(plain.cost, 1);
        row[`${kind}_resets`] = best.resets;
        row[`${kind}_grade`] = best.grade;
        row[`${kind}_cost_with_resets`] = rf(best.total, 1);
        row[`${kind}_saving`] = rf(plain.cost - best.total, 1);
      }
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Crafting with modded equipment ingredients: expected sell value of the result with plain ingredients, with one
 * prefixed ingredient, and with one +1-suffix ingredient, against the cost of enchanting that ingredient first.
 * Asc 0, grade from the Solver; only recipes that use equipment.
 */
export function buildIngredientBoostRows(s: Solver): Row[] {
  const g = s.g;
  const rows: Row[] = [];
  for (const [iid, it] of g.items.equipment) {
    const rec = g.recipe("equipment", iid);
    if (!rec || s.get("equipment", iid, 0) === INF) continue;
    const equipIngredients = rec.filter(([t]) => t === "equipment");
    if (!equipIngredients.length) continue;
    const sellByMods = [0, 1, 2].map((m) => g.sellValue("equipment", iid, 0, m));
    const ev = (boost: IngredientBoost) => sumOf(modifierOutcomes(g, "equipment", iid, s.crafterLevel, s.grade, 0, boost)
      .map(([pr, pf, sf]) => pr * sellByMods[Number(Boolean(pf)) + Number(Boolean(sf))]));
    const plain = ev({});
    // cheapest ingredient to enchant (one modded unit is enough: the boost takes the best ingredient)
    let pre: [number, string] | null = null, suf: [number, string] | null = null;
    for (const [, mid] of equipIngredients) {
      const ing = g.item("equipment", mid);
      const grade = craftGrade(s.crafterLevel, ing.itemLevel ?? 1, s.grade);
      const a = s.enchantStep("prefix", "equipment", mid, 0, grade, 0);
      const b = s.enchantStep("suffix", "equipment", mid, 0, grade, 0);
      if (a && (!pre || a.cost < pre[0])) pre = [a.cost, ing.name];
      if (b && (!suf || b.cost < suf[0])) suf = [b.cost, ing.name];
    }
    const withPrefix = ev({ prefix: true }), withSuffix = ev({ suffix: 1 });
    rows.push({
      type: "equipment", id: iid, name: it.name, level: it.itemLevel ?? "",
      ingredients: equipIngredients.map(([, mid]) => g.name("equipment", mid)).join(", "),
      ev_sell_plain: rf(plain, 1),
      ev_sell_prefixed_ingredient: rf(withPrefix, 1), prefix_ingredient_cost: pre ? rf(pre[0], 1) : "",
      prefix_gain: pre ? rf(withPrefix - plain - pre[0], 1) : "",
      ev_sell_suffixed_ingredient: rf(withSuffix, 1), suffix_ingredient_cost: suf ? rf(suf[0], 1) : "",
      suffix_gain: suf ? rf(withSuffix - plain - suf[0], 1) : "",
    });
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
        cost_per_essence: rf(unit, 2), chosen: ch && ch[0] === mid && ch[1] === p && ch[2] === label ? "yes" : "",
        // the run's other loot pays for the map: the essence costs nothing (floored at 0, never negative)
        free_byproduct: unit === 0 && amt > 0 ? "yes" : "" });
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
  for (const e of s.errors) lines.push(`warning: forced essence source ${e}\n`);
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
