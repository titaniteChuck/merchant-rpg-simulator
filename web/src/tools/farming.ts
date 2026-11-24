/**
 * Farming report: where a party should spend its time. Each source (a quest, or a map run with scrolls) is
 * simulated with the combat engine; its win rate, grade and time come from the simulation, and the economy
 * (loot, essence, costs) from the game's loot rules and the profit Solver's prices.
 *
 *   const rows = farmingReport(sim, { front, back }, [{ kind: "quest", quest: 80 }, { kind: "map", map: { id: 22 } }])
 *   rows[0].essence_per_hour, rows[0].gold_per_hour
 *
 * Map-only enemies (map bosses 91-98, Treasure Bushes 99-104: questType 8, never on the quest board) can't be fought
 * as a quest: a quest source naming one is run as the map that holds it (mapSourceFor), with that map's win rate, rooms,
 * loot, craft time and cost. A map row's time is the Scribe's craft time + the run; map-only drops get a unit cost of
 * (run cost) / (drops per run).
 *
 * Pure: no output, no Node APIs; progress and cancel through SearchControl (as the searches in combat.ts).
 */
import { G } from "../sim/data.ts";
import { D } from "../sim/defaults.ts";
import { checkAmount, fightSeed, SearchCancelled, type SearchControl } from "./combat.ts";
import type { MapSpec, Row, Scroll, Sim } from "./engine.ts";
import { type Game, gameFromData } from "./gamedata.ts";
import { craftGrade, questLoot, Solver, type SourceStat } from "./profit.ts";
import { isMapOnlyQuest, mapCraftSeconds, mapsWithQuest } from "./quest-stats.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** A quest fight, or a map run (catalog spec or a compact save string) with up to 3 scrolls. */
export type FarmSource =
  | { kind: "quest"; quest: number; rare?: boolean; /** enemy HP x amount, 1..maxQuestAmount */ amount?: number }
  | { kind: "map"; map: MapSpec; scrolls?: Scroll[] | null };

export interface FarmRow {
  kind: "quest" | "map";
  /** Quest id, or map id. */
  id: number;
  /** Map ascension (0 for quests). */
  asc: number;
  label: string;
  /** Runs simulated (map runs that failed inside the game's own code are left out and counted in `errors`). */
  n: number;
  errors: number;
  win: number;
  /** Average grade of the won runs (0 if none). */
  grade: number;
  /** Share of all runs ending at each grade 1..5 (lost runs are not counted). */
  grades: [grade: number, share: number][];
  /** Hours per run (lost runs included; a map: craft + run) and runs per hour. */
  time_h: number;
  /** Map rows: the Scribe's hours to craft the map (with the lower maps in its recipe) and the run's hours. */
  craft_h: number;
  run_h: number;
  /** A quest source that is map-only: the map run that replaced it ("Murlok Monarch: only in Murlok Madness Map"). */
  note?: string;
  /** Map-only drops (no quest-board quest gives them) per run, and their unit cost = run cost / drops per run. */
  map_only: Record<string, number>;
  map_only_unit_cost: Record<string, number>;
  runs_per_hour: number;
  /** Cost of one run: quest gold, the map consumed, every scroll equipped (all consumed when the map starts). */
  cost: { gold: number; map: number; scrolls: number; total: number };
  /** Base sell value of the loot per run, essence excluded. */
  loot_value: number;
  /** Essence per run by name, its total, and its value at the Solver's unit cost (what it would cost otherwise). */
  essence: Record<string, number>;
  essence_total: number;
  essence_value: number;
  /** Average hero death rate over the party. */
  death_rate: number;
  /** XP per run and per hour, averaged over the party's heroes (with their expMod and the mode's questXpMod;
   * a hero at its tier's max level gains nothing in game). */
  xp_per_run: number;
  xp_per_hour: number;
  /** Gold per run to revive dead heroes (level x 10 x tier each; a lost quest kills the whole party). */
  revive_gold: number;
  /** Per hour: gold (loot value - cost), essence, and both together (essence at its unit cost). */
  gold_per_hour: number;
  essence_per_hour: number;
  value_per_hour: number;
}

export interface FarmingOptions {
  /** Runs per source (default 100 fights, 30 map runs) and first seed (common random numbers across sources). */
  n?: number;
  mapRuns?: number;
  seed0?: number;
  /** Prices for costs and essence value (default: a Solver at grade 3, solved once). */
  solver?: Solver;
  /** Grade of the maps run for a map-only quest source (default 3) and the Scribe level (default 60) for craft time. */
  mapGrade?: number;
  crafterLevel?: number;
}

/**
 * The map run to farm a map-only enemy (questType 8): the craftable map where it is fought most often per run, the
 * lowest-level one on ties (its boss for 91-98, a treasure room for 99-104). Undefined for a quest-board quest.
 */
export function mapSourceFor(quest: number, grade = 3, crafterLevel = 60): { map: number; perRun: number } | undefined {
  if (!isMapOnlyQuest(quest)) return undefined;
  const all = mapsWithQuest(quest, grade, crafterLevel);
  all.sort((a, b) => b.perRun - a.perRun || (G.itemData.map[a.map].itemLevel ?? 0) - (G.itemData.map[b.map].itemLevel ?? 0));
  return all[0] ? { map: all[0].map, perRun: all[0].perRun } : undefined;
}

/** default.heroReviveCost: level x 10, x tier from tier 2. */
export function reviveGold(h: { level: number; prestige?: number; prestigeLevel?: number }): number {
  const p = h.prestige ?? h.prestigeLevel ?? 1;
  return p > 1 ? h.level * 10 * p : h.level * 10;
}

const isEssence = (g: Game, itype: string, iid: number) => itype === "material" && g.items.material?.get(iid)?.subType === "essence";

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Simulate every source with this party and rank nothing: rows come back in `sources` order. */
export function farmingReport(sim: Sim, party: { front: Row; back: Row }, sources: FarmSource[], o: FarmingOptions = {},
  ctl: SearchControl = {}): FarmRow[] {
  const g = gameFromData();
  const solver = o.solver ?? new Solver(g).solve();
  const seed0 = o.seed0 ?? 1;
  const unit = (itype: string, iid: number, p = 0) => {
    const c = solver.get(itype, iid, p);
    return Number.isFinite(c) ? c : g.sellValue(itype, iid, p);
  };
  const mapGrade = o.mapGrade ?? 3, crafterLevel = o.crafterLevel ?? 60;
  // A map-only enemy is farmed with the map that holds it, never as a standalone quest.
  const notes = new Map<number, string>();
  sources = sources.map((s, i) => {
    if (s.kind !== "quest" || !isMapOnlyQuest(s.quest)) return s;
    const name = G.questData[s.quest]?.name ?? `quest ${s.quest}`;
    const via = mapSourceFor(s.quest, mapGrade, crafterLevel);
    if (!via) throw new Error(`${name} is only fought in maps, and no craftable map holds it`);
    notes.set(i, `${name}: only in map runs, farmed with ${G.itemData.map[via.map].name} (${via.perRun.toFixed(2)} per run)`);
    return { kind: "map", map: { id: via.map, prestigeLevel: 0, grade: mapGrade } };
  });
  const total = sources.reduce((acc, s) => acc + (s.kind === "quest" ? (o.n ?? 100) : (o.mapRuns ?? 30)), 0);
  let done = 0;
  ctl.onProgress?.(0, total, "farming");
  const step = () => {
    if (ctl.shouldStop?.()) throw new SearchCancelled();
  };
  const tick = () => ctl.onProgress?.(++done, total, "farming");
  const rows: FarmRow[] = [];

  for (const src of sources) {
    if (src.kind === "quest") {
      const n = o.n ?? 100, amount = src.amount ?? 1;
      const q = G.questData[src.quest];
      if (!q?.enemyHp || !q.attackList) throw new Error(`quest ${src.quest} has no enemy to fight`);
      if (src.rare && (q.enemyHpB === undefined || q.attackListB === undefined)) throw new Error(`quest ${src.quest} has no rare variant`);
      checkAmount(sim, party.front, party.back, src.rare ?? false, amount);
      const gold = (src.rare ? (q.goldB ?? q.gold) : q.gold) ?? 0;
      let wins = 0;
      const times: number[] = [], grades: number[] = [], deaths: number[] = [];
      const gradeCount = new Map<number, number>();
      const loot = new Map<string, number>();
      const members = [...party.front, ...party.back].filter((h): h is Any => Boolean(h));
      const baseExp = (src.rare ? q.expB ?? q.exp : q.exp) ?? 0;
      // Quest:calculateExperience: round(exp / heroes) x amount per living hero of a won quest
      const share = Math.round(baseExp / Math.max(members.length, 1)) * amount;
      let xp = 0, revive = 0;
      for (let k = 0; k < n; k++) {
        step();
        const res = sim.fight(src.quest, party.front, party.back, { seed: fightSeed(seed0, k), isRare: src.rare ?? false, amount });
        times.push(res.questTime / 3600);
        deaths.push(mean(res.heroes.map((h) => (h.dead ? 1 : 0))));
        if (res.won) {
          for (const h of res.heroes) {
            const m = members.find((x) => x.name === h.name && x.class === h.class);
            // Hero:addExperience: nothing at the tier's max level
            if (!h.dead && m && m.level < D.maxHeroLevel[m.prestigeLevel]) xp += share * (1 + (m.expMod ?? 0) / 100) * D.questXpMod;
          }
        }
        // Quest:updateHeroAfterQuest: a lost quest kills every hero; a dead hero is revived for gold
        for (const h of res.heroes) if (!res.won || h.dead) revive += reviveGold(h);
        if (res.won) {
          wins++;
          grades.push(res.grade);
          gradeCount.set(res.grade, (gradeCount.get(res.grade) ?? 0) + 1);
          // Quest:createRewards only rolls loot for a won quest (grade > 0), with the party's luck.
          for (const [key, amt] of questLoot(g, src.quest, res.grade, res.partyLuck, src.rare ?? false, amount)) {
            loot.set(key, (loot.get(key) ?? 0) + amt);
          }
        }
        tick();
      }
      rows.push(finish(g, unit, {
        kind: "quest", id: src.quest, asc: 0, craft_h: 0,
        label: `${src.rare ? (q.nameB || q.name) + " [rare]" : q.name}${amount > 1 ? ` x${amount}` : ""}`,
        n, errors: 0, wins, grades, gradeCount, time_h: mean(times), death_rate: mean(deaths),
        xp: xp / n / Math.max(members.length, 1), revive: revive / n,
        cost: { gold, map: 0, scrolls: 0 },
        rewards: [...loot].map(([key, amt]) => {
          const [itype, iid] = key.split("|");
          return { itemType: itype, itemID: Number(iid), amount: amt / n, prestigeLevel: 0 };
        }),
      }, solver));
    } else {
      const n = o.mapRuns ?? 30;
      const scrolls = src.scrolls?.length ? src.scrolls : null;
      const m = sim.makeMap(src.map, 1);
      const mapId = m.id as number, asc = (m.prestigeLevel ?? 0) as number;
      let wins = 0, errors = 0, xp = 0, revive = 0;
      const times: number[] = [], grades: number[] = [], deaths: number[] = [];
      const gradeCount = new Map<number, number>();
      const rewards = new Map<string, number>();
      for (let k = 0; k < n; k++) {
        step();
        let res;
        try {
          res = sim.mapRun(src.map, party.front, party.back, fightSeed(seed0, k), scrolls ? scrolls.map((x) => ({ ...x })) : null);
        } catch {
          errors++; // the game's own code fails on this layout (e.g. level-70 treasure rooms)
          tick();
          continue;
        }
        times.push(res.time / 3600);
        deaths.push(mean(res.heroes.map((h) => (h.dead ? 1 : 0))));
        xp += mean(res.heroes.map((h: Any) => h.xp ?? 0)); // Campaign: per room won, living heroes
        for (const h of res.heroes) if (h.dead) revive += reviveGold(h);
        if (res.won) {
          wins++;
          grades.push(res.grade);
          gradeCount.set(res.grade, (gradeCount.get(res.grade) ?? 0) + 1);
        }
        for (const r of res.rewards) {
          const key = `${r.itemType}|${r.itemID}|${r.prestigeLevel ?? 0}`;
          rewards.set(key, (rewards.get(key) ?? 0) + (r.itemType === "material" ? r.amount : 1));
        }
        tick();
      }
      const ok = n - errors;
      // Scribe time of the map: obj.Craft at the map's grade (a catalog spec's grade, else its craft grade)
      const mapGr = Number.isFinite(m.grade) ? m.grade : craftGrade(crafterLevel, G.itemData.map[mapId]?.itemLevel ?? 1, 3);
      const craftHours = mapCraftSeconds(mapId, mapGr, sim.mode) / 3600;
      const scrollCost = (scrolls ?? []).reduce((acc, x) => acc + unit("consumable", x.id, x.prestigeLevel ?? 0), 0);
      rows.push(finish(g, unit, {
        kind: "map", id: mapId, asc,
        label: `${m.name}${asc ? ` asc ${asc}` : ""}${scrolls ? ` + ${scrolls.map((x) => G.itemData.consumable[x.id]?.name ?? x.id).join(", ")}` : ""}`,
        n: ok, errors, wins, grades, gradeCount, time_h: mean(times), craft_h: craftHours, death_rate: mean(deaths),
        xp: ok ? xp / ok : 0, revive: ok ? revive / ok : 0, note: notes.get(rows.length),
        cost: { gold: 0, map: unit("map", mapId, asc), scrolls: scrollCost },
        rewards: ok ? [...rewards].map(([key, amt]) => {
          const [itype, iid, p] = key.split("|");
          return { itemType: itype, itemID: Number(iid), amount: amt / ok, prestigeLevel: Number(p) };
        }) : [],
      }, solver));
    }
  }
  return rows;
}

interface Partial_ {
  kind: "quest" | "map";
  id: number;
  asc: number;
  label: string;
  n: number;
  errors: number;
  wins: number;
  grades: number[];
  gradeCount: Map<number, number>;
  /** Run hours (quest time, or the map run) and the map's craft hours (0 for a quest). */
  time_h: number;
  craft_h: number;
  note?: string;
  death_rate: number;
  xp: number;
  revive: number;
  cost: { gold: number; map: number; scrolls: number };
  /** Expected amount per run of each reward. */
  rewards: { itemType: string; itemID: number; amount: number; prestigeLevel: number }[];
}

function finish(g: Game, unit: (t: string, i: number, p?: number) => number, x: Partial_, solver?: Solver): FarmRow {
  let lootValue = 0, essTotal = 0, essValue = 0;
  const essence: Record<string, number> = {};
  const costTotal = x.cost.gold + x.cost.map + x.cost.scrolls;
  const mapOnly: Record<string, number> = {}, mapOnlyUnit: Record<string, number> = {};
  for (const r of x.rewards) {
    if (x.kind === "map" && solver?.how.get(`${r.itemType}|${r.itemID}|0`)?.startsWith("map run") && r.amount > 0) {
      const name = g.name(r.itemType, r.itemID);
      mapOnly[name] = (mapOnly[name] ?? 0) + r.amount;
    }
    if (isEssence(g, r.itemType, r.itemID)) {
      const name = g.name("material", r.itemID);
      essence[name] = (essence[name] ?? 0) + r.amount;
      essTotal += r.amount;
      essValue += r.amount * unit("material", r.itemID);
    } else {
      try {
        lootValue += r.amount * g.sellValue(r.itemType, r.itemID, r.prestigeLevel);
      } catch {
        // an item without a sell value (placeholder): worth nothing
      }
    }
  }
  for (const [name, amt] of Object.entries(mapOnly)) mapOnlyUnit[name] = costTotal / amt;
  const time = x.time_h + x.craft_h; // a map run: craft it, then run it
  const perHour = (v: number) => (time > 0 ? v / time : 0);
  return {
    kind: x.kind, id: x.id, asc: x.asc, label: x.label, n: x.n, errors: x.errors,
    win: x.n ? x.wins / x.n : 0, grade: mean(x.grades),
    grades: [1, 2, 3, 4, 5].map((gr): [number, number] => [gr, x.n ? (x.gradeCount.get(gr) ?? 0) / x.n : 0]),
    time_h: time, craft_h: x.craft_h, run_h: x.time_h, runs_per_hour: perHour(1),
    ...(x.note ? { note: x.note } : {}), map_only: mapOnly, map_only_unit_cost: mapOnlyUnit,
    cost: { ...x.cost, total: costTotal },
    loot_value: lootValue, essence, essence_total: essTotal, essence_value: essValue,
    death_rate: x.death_rate,
    xp_per_run: x.xp, xp_per_hour: perHour(x.xp), revive_gold: x.revive,
    gold_per_hour: perHour(lootValue - costTotal),
    essence_per_hour: perHour(essTotal),
    value_per_hour: perHour(lootValue + essValue - costTotal),
  };
}

/**
 * Solver overrides from a farming report: each simulated source's grade distribution and time replace the
 * global grade (won map runs often end at S, not B), so essence and loot costs follow what this party achieves.
 *   new Solver(g, { sourceStats: sourceStatsFrom(rows) }).solve()
 * Only quests without rare/enemy-count variants and maps without scrolls are used (the Solver has no scroll cost);
 * a map-only quest source counts as its map.
 */
export function sourceStatsFrom(rows: FarmRow[], sources: FarmSource[]): { quest: Map<string, SourceStat>; map: Map<string, SourceStat> } {
  const quest = new Map<string, SourceStat>(), map = new Map<string, SourceStat>();
  rows.forEach((r, i) => {
    const s = sources[i];
    const stat: SourceStat = { grades: r.grades, timeH: r.run_h }; // the Solver adds the map's craft time itself
    if (s.kind === "quest" && r.kind === "map" && !map.has(`${r.id}|${r.asc}`)) map.set(`${r.id}|${r.asc}`, stat);
    else if (s.kind === "quest" && (s.amount ?? 1) === 1) quest.set(s.rare ? `${r.id}|rare` : `${r.id}`, stat);
    if (s.kind === "map" && !s.scrolls?.length) map.set(`${r.id}|${r.asc}`, stat);
  });
  return { quest, map };
}

