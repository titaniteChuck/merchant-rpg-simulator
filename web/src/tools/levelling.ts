/**
 * Levelling and prestige economics: how many hours a hero needs to reach its tier's max level on the best XP source
 * at each level band, and what a prestige tier gives against what it costs.
 *
 * Game rules (obj.Quest, obj.Hero, data.Default):
 * - A won quest gives every living hero round(exp / heroes) x amount (expB for the rare variant), then
 *   x (1 + expMod / 100) x questXpMod (Hero:addExperience). A lost quest kills the party (revive: level x 10 x tier gold).
 * - Only quest-board quests are single fights (scene.QuestMenu:drawEnemyLocations skips questType 8). Map bosses
 *   (91-98) and Treasure Bushes (99-104) are only met in a map run, so the plan weighs whole map runs instead: every
 *   room won gives each living hero round(exp x mapEnemyMod x 0.2 / heroes) (obj.combat.Campaign), and a run costs the
 *   map's craft time (crafter, quest-stats.ts mapCraftSeconds) plus the run time, and the map itself (gold).
 *   A hero needs level 10 to join a map (scene.maps.MapAssignHeroMenu).
 * - heroLevelRequirement[tier][level] = XP to reach `level`; max level 50 / 50 / 60 (maxHeroLevel).
 * - A hero may take a quest when level > min(levelReq - 5, 0.75 x levelReq) (default.heroPartyLevelReq) and its
 *   region is open: regionLevelReqs[region] <= level + 2 x (tier - 1) (default.regionUnlockLevelMet).
 * - Prestige (Hero:prestigeUp, default.canHeroPrestige): needs heroPrestigeLevelRequirement[tier + 1] and
 *   heroPrestigeCost[tier] gold; the hero goes back to level 1 with 0 XP, loses its potion and enchants, gets the new
 *   tier's growth and max level, 4 more enchant slots and a quest amount cap of 2 x tier - 1.
 * Pure, worker-safe; progress and cancel through SearchControl.
 */
import { G } from "../sim/data.ts";
import { D } from "../sim/defaults.ts";
import { fightSeed, maxQuestAmount, SearchCancelled, type SearchControl } from "./combat.ts";
import type { FightResult, Hero, Row, Sim } from "./engine.ts";
import { reviveGold } from "./farming.ts";
import { gameFromData } from "./gamedata.ts";
import { Solver } from "./profit.ts";
import { isBoardQuest, isCraftableMap, mapCraftSeconds, mapRunStats } from "./quest-stats.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** XP to go from `from` to `to` (same tier). */
export function xpBetween(tier: number, from: number, to: number): number {
  const req = G.heroLevelRequirement[tier];
  let total = 0;
  for (let l = from + 1; l <= to; l++) total += req[l] ?? 0;
  return total;
}

export const maxLevel = (tier: number): number => D.maxHeroLevel[tier];

/**
 * Quest-board quests a hero of this level and tier may take (heroPartyLevelReq + regionUnlockLevelMet), with an enemy
 * to fight. Map bosses and Treasure Bushes (questType 8) are never on the board: see availableMaps.
 */
export function availableQuests(level: number, tier: number): number[] {
  const out: number[] = [];
  for (const [k, q] of Object.entries<Any>(G.questData)) {
    if (!q?.enemyHp || !q.attackList || q.levelReq === undefined || !isBoardQuest(Number(k))) continue;
    if (!(level > Math.min(q.levelReq - 5, q.levelReq * 0.75))) continue;
    const req = D.regionLevelReqs?.[q.region];
    if (req === undefined || req > level + 2 * (tier - 1)) continue;
    out.push(Number(k));
  }
  return out.sort((a, b) => a - b);
}

/** Maps a hero of this level can join (level >= 10, MapAssignHeroMenu) that a Scribe of `crafterLevel` can craft. */
export function availableMaps(level: number, crafterLevel = 60): number[] {
  if (level < 10) return [];
  return Object.keys(G.itemData?.map ?? {}).map(Number).filter((m) => isCraftableMap(m, crafterLevel)).sort((a, b) => a - b);
}

export interface XpSource {
  /** "quest": one quest-board fight; "map": one whole map run (crafted, then fought room by room to the boss). */
  kind: "quest" | "map";
  /** Quest id; for a map run, the map's (first) boss, for pages that only show a quest (prefer `label`). */
  quest: number;
  /** Map id and ascension (map runs only). */
  map?: number;
  asc?: number;
  /** "Maexna", "Murlok Madness Map (run)". */
  label: string;
  amount: number;
  win: number;
  /** Per run, for the levelling hero: XP (with its expMod), hours (quest time; map: craft + run) and revive gold. */
  xpPerRun: number;
  hoursPerRun: number;
  /** Map runs: crafter hours (the map and the lower maps in its recipe) and run hours; hoursPerRun is their sum. */
  craftHours?: number;
  runHours?: number;
  reviveGold: number;
  xpPerHour: number;
}

/**
 * XP per hour of one quest at one amount for `hero` in this party (same seeds 1..n). The hero must be in `front`
 * or `back`; XP is the hero's own (its share of the party's split). Quest-board quests only.
 */
export function questXpRate(sim: Sim, hero: Hero, front: Row, back: Row, quest: number, amount = 1, n = 30): XpSource {
  const q = G.questData[quest];
  if (!isBoardQuest(quest)) throw new Error(`${q?.name ?? `quest ${quest}`} is not on the quest board: it is fought in a map run (mapXpRate)`);
  const members = [...front, ...back].filter((h): h is Hero => Boolean(h));
  const share = Math.round((q.exp ?? 0) / Math.max(members.length, 1)) * amount;
  const mult = (1 + (hero.expMod ?? 0) / 100) * D.questXpMod;
  let xp = 0, secs = 0, wins = 0, revive = 0;
  for (let k = 0; k < n; k++) {
    const res: FightResult = sim.fight(quest, front, back, { seed: fightSeed(1, k), amount });
    secs += res.questTime;
    const me = res.heroes.find((h) => h.name === hero.name && h.class === hero.class)!;
    if (res.won) {
      wins++;
      if (!me.dead && hero.level < maxLevel(hero.prestigeLevel)) xp += share * mult;
    }
    for (const h of res.heroes) if (!res.won || h.dead) revive += reviveGold(h);
  }
  const hoursPerRun = secs / n / 3600;
  return { kind: "quest", quest, label: q.name, amount, win: wins / n, xpPerRun: xp / n, hoursPerRun, reviveGold: revive / n,
    xpPerHour: hoursPerRun > 0 ? xp / n / hoursPerRun : 0 };
}

/**
 * XP per hour of whole runs of one map for `hero` in this party (seeds 1..n): the hero's XP over every room won while
 * alive (a lost run keeps the rooms won before), time = the map's craft time + the run's time, revive gold of the
 * heroes dead at the end. `stopBelow`: stop early once the win rate can no longer reach it (win is then a bound).
 */
export function mapXpRate(sim: Sim, hero: Hero, front: Row, back: Row, map: number,
  o: { asc?: number; grade?: number; n?: number; stopBelow?: number } = {}): XpSource {
  const asc = o.asc ?? 0, grade = o.grade ?? 3, n = o.n ?? 10;
  const m = G.itemData.map[map];
  let xp = 0, secs = 0, wins = 0, revive = 0, done = 0;
  for (let k = 0; k < n; k++) {
    if (o.stopBelow && (wins + n - k) / n < o.stopBelow) break;
    let res;
    try {
      res = sim.mapRun({ id: map, prestigeLevel: asc, grade }, front, back, fightSeed(1, k));
    } catch {
      continue; // the game's own code fails on this layout
    }
    done++;
    secs += res.time;
    if (res.won) wins++;
    const me = res.heroes.find((h) => h.name === hero.name && h.class === hero.class);
    if (me && hero.level < maxLevel(hero.prestigeLevel)) xp += me.xp ?? 0;
    for (const h of res.heroes) if (h.dead) revive += reviveGold(h);
  }
  const d = Math.max(done, 1);
  const runHours = secs / d / 3600, craftHours = mapCraftSeconds(map, grade, sim.mode) / 3600;
  const hoursPerRun = runHours + craftHours;
  const boss = Object.values<number>(m.bossList ?? {})[0] ?? 0;
  return { kind: "map", quest: boss, map, asc, label: `${m.name}${asc ? ` asc ${asc}` : ""} (run)`, amount: 1,
    win: wins / d, xpPerRun: xp / d, hoursPerRun, craftHours, runHours, reviveGold: revive / d,
    xpPerHour: hoursPerRun > 0 ? xp / d / hoursPerRun : 0 };
}

/** Same source (merged across bands): the same quest at the same amount, or the same map at the same ascension. */
export const sourceKey = (s: XpSource): string => (s.kind === "map" ? `map|${s.map}|${s.asc ?? 0}` : `quest|${s.quest}|${s.amount}`);

export interface LevelStep {
  fromLevel: number;
  toLevel: number;
  /** Best source at fromLevel (the hero is rebuilt at that level, gear above it ignored as in game). */
  source: XpSource;
  xpNeeded: number;
  runs: number;
  hours: number;
  reviveGold: number;
  /** Map runs: gold of the maps consumed (craft gold + materials at the profit Solver's cost); 0 for quests. */
  mapGold: number;
  /** Level bands merged into this step (the same source was the best in each consecutive band). */
  bands: number;
}

export interface LevellingOptions {
  /** Target level (default the tier's max). */
  to?: number;
  /** Levels per band (default 5): the source is re-chosen at the start of each band; consecutive bands with the
   * same best source make one step. */
  band?: number;
  /** Other heroes fighting alongside (raw save records), front row first; default solo. */
  companions?: Any[];
  /** Fights per candidate (default 30); quest ids to consider (default every quest-board quest the hero may take). */
  n?: number;
  quests?: number[];
  /** Amounts to try (default 1 and the party's max). */
  amounts?: "one" | "max" | "all";
  /** Only sources won at least this often (default 0.5; for a map run, whole runs won). */
  minWin?: number;
  /** Extra expMod (XP Boost potions: +30 / +60 / +100) for the whole plan. */
  expModBonus?: number;
  /** Map runs as XP sources: "none" leaves them out; default every craftable map (from hero level 10). */
  maps?: number[] | "none";
  /** Runs per map candidate (default 10), map grade (default 3), Scribe level (default 60: which maps it can craft). */
  mapRuns?: number;
  mapGrade?: number;
  crafterLevel?: number;
  /** Prices of the maps consumed (default: a Solver at grade 3, solved only when a map run is chosen). */
  solver?: Solver;
}

export interface LevellingPlan {
  tier: number;
  from: number;
  to: number;
  steps: LevelStep[];
  hours: number;
  runs: number;
  reviveGold: number;
  /** Gold of the maps the plan consumes. */
  mapGold: number;
  /** Bands with no source won often enough (the plan stops there). */
  stuckAt?: number;
}

/** Merge consecutive steps that use the same source (one step per source change, not per band). */
export function mergeSteps(steps: LevelStep[]): LevelStep[] {
  const out: LevelStep[] = [];
  for (const s of steps) {
    const prev = out.at(-1);
    if (prev && prev.toLevel === s.fromLevel && sourceKey(prev.source) === sourceKey(s.source)) {
      out[out.length - 1] = { ...prev, toLevel: s.toLevel, xpNeeded: prev.xpNeeded + s.xpNeeded, runs: prev.runs + s.runs,
        hours: prev.hours + s.hours, reviveGold: prev.reviveGold + s.reviveGold, mapGold: prev.mapGold + s.mapGold,
        bands: prev.bands + s.bands };
    } else out.push({ ...s });
  }
  return out;
}

/**
 * Hours from the hero's level (or `from`) to `to`, choosing the best XP/h source at every band: a quest-board quest
 * (single fights) or a whole map run (craft + run time). Consecutive bands with the same best source are one step.
 */
export function levellingPlan(sim: Sim, raw: Any, o: LevellingOptions & { from?: number } = {}, ctl: SearchControl = {}): LevellingPlan {
  const tier = raw.prestigeLevel ?? 1;
  const from = o.from ?? raw.level ?? 1, to = Math.min(o.to ?? maxLevel(tier), maxLevel(tier));
  const band = o.band ?? 5, n = o.n ?? 30, minWin = o.minWin ?? 0.5;
  const mapRuns = o.mapRuns ?? 10, mapGrade = o.mapGrade ?? 3, crafterLevel = o.crafterLevel ?? 60;
  let solver = o.solver;
  const mapPrice = (mid: number, asc: number) => {
    solver ??= new Solver(gameFromData()).solve();
    const c = solver.get("map", mid, asc);
    return Number.isFinite(c) ? c : 0;
  };
  const steps: LevelStep[] = [];
  const bands: number[] = [];
  for (let l = from; l < to; l += band) bands.push(l);
  let done = 0;
  let stuckAt: number | undefined;
  for (const l of bands) {
    if (ctl.shouldStop?.()) throw new SearchCancelled();
    const hero = sim.hero({ ...structuredClone(raw), level: l, exp: 0 });
    if (o.expModBonus) hero.expMod = (hero.expMod ?? 0) + o.expModBonus;
    const companions = (o.companions ?? []).map((c) => sim.hero(structuredClone(c)));
    // TODO(E21): a solo hero on a party quest stands in front 1 here; the game needs front 2 (combat.ts partyRules).
    // Build the layout with soloRows(target, hero) / partyRules once E21 is on main.
    const front: Row = [hero, ...companions.slice(0, 2)], back: Row = companions.slice(2, 5);
    const maxAmt = maxQuestAmount([...front, ...back], false, sim.mode);
    const amounts = o.amounts === "one" ? [1] : o.amounts === "max" ? [maxAmt] : [...new Set([1, maxAmt])];
    let best: XpSource | null = null;
    const quests = (o.quests ?? availableQuests(l, tier)).filter((q) => availableQuests(l, tier).includes(q));
    for (const q of quests) {
      for (const a of amounts) {
        if (ctl.shouldStop?.()) throw new SearchCancelled();
        const s = questXpRate(sim, hero, front, back, q, a, n);
        if (s.win >= minWin && (!best || s.xpPerHour > best.xpPerHour)) best = s;
      }
    }
    const mapList = o.maps === "none" ? [] : o.maps;
    const maps = o.maps === "none" ? [] : availableMaps(l, crafterLevel).filter((m) => !mapList || mapList.includes(m));
    for (const mid of maps) {
      if (ctl.shouldStop?.()) throw new SearchCancelled();
      if (hero.level >= maxLevel(tier)) break;
      // Skip a map that can't beat the best source even with every room won (solo share, 1.5 x the expected rooms)
      // at its shortest time (craft + a quarter of the walk: speed cuts at most 75 %).
      const ub = mapRunStats(mid, { grade: mapGrade, heroes: 1, expMod: hero.expMod ?? 0, mode: sim.mode });
      const minH = (ub.craftSeconds + 0.25 * ub.runSeconds) / 3600;
      if (best && minH > 0 && 1.5 * ub.xpPerHero / minH <= best.xpPerHour) continue;
      const s = mapXpRate(sim, hero, front, back, mid, { grade: mapGrade, n: mapRuns, stopBelow: minWin });
      if (s.win >= minWin && (!best || s.xpPerHour > best.xpPerHour)) best = s;
    }
    ctl.onProgress?.(++done, bands.length, `level ${l}`);
    if (!best || best.xpPerRun <= 0) {
      stuckAt = l;
      break;
    }
    const top = Math.min(l + band, to);
    const need = xpBetween(tier, l, top);
    const runs = Math.ceil(need / best.xpPerRun);
    steps.push({ fromLevel: l, toLevel: top, source: best, xpNeeded: need, runs, hours: runs * best.hoursPerRun,
      reviveGold: runs * best.reviveGold, mapGold: best.kind === "map" ? runs * mapPrice(best.map!, best.asc ?? 0) : 0, bands: 1 });
  }
  const merged = mergeSteps(steps);
  const sum = (f: (s: LevelStep) => number) => merged.reduce((a, s) => a + f(s), 0);
  return { tier, from, to, steps: merged, hours: sum((s) => s.hours), runs: sum((s) => s.runs), reviveGold: sum((s) => s.reviveGold),
    mapGold: sum((s) => s.mapGold), ...(stuckAt !== undefined ? { stuckAt } : {}) };
}

export interface TierView {
  tier: number;
  maxLevel: number;
  stats: Record<string, number>;
  enchantSlots: number;
  questAmountCap: number;
  /** Solo result on the reference quest at the tier's max level (same seeds). */
  ref: { win: number; enemyPeak: number; score: number };
}

export interface PrestigePayoff {
  current: TierView;
  next: TierView;
  /** Requirement and cost of prestiging now. */
  levelRequired: number;
  gold: number;
  enchantsLost: number;
  /** Levelling back from 1 to the new tier's max. */
  relevel: LevellingPlan;
}

/**
 * What the next prestige tier gives and costs for this hero: stats and a reference fight at each tier's max level
 * (current gear and enchants; the new tier without enchants, as after prestiging), against the gold, the lost
 * enchants and the hours to level back up.
 */
export function prestigePayoff(sim: Sim, raw: Any, ref: { quest: number; n?: number }, o: LevellingOptions = {},
  ctl: SearchControl = {}): PrestigePayoff {
  const tier = raw.prestigeLevel ?? 1;
  if (tier >= (G.heroMaxPrestigeLevel ?? 3)) throw new Error(`${raw.name} is already at the last tier (${tier})`);
  const view = (t: number, keepEnchants: boolean): TierView => {
    const r = { ...structuredClone(raw), prestigeLevel: t, level: maxLevel(t), exp: 0 };
    if (!keepEnchants) (delete r.enchantList, delete r.enchantPrestige, r.enchantsUsed = 0);
    const h = sim.hero(r);
    const st = sim.stats(h);
    let wins = 0, peak = 0, score = 0;
    const n = ref.n ?? 50;
    for (let k = 0; k < n; k++) {
      // TODO(E21): use soloRows(ref.quest, h) (combat.ts): a party quest needs the hero in front 2.
      const res = sim.fight(ref.quest, [h], [], { seed: fightSeed(1, k) });
      if (res.won) wins++;
      peak += 1 - Math.max(res.enemyMinHP ?? res.enemyHP, 0) / res.enemyMaxHP;
    }
    score = wins / n * 1e6 + peak / n * 1e4;
    return { tier: t, maxLevel: maxLevel(t), stats: st, enchantSlots: 8 + 4 * (t - 1), questAmountCap: maxQuestAmount([h], false, sim.mode),
      ref: { win: wins / n, enemyPeak: peak / n, score } };
  };
  const current = view(tier, true), next = view(tier + 1, false);
  const relevel = levellingPlan(sim, { ...structuredClone(raw), prestigeLevel: tier + 1, level: 1, exp: 0, enchantList: undefined },
    { ...o, from: 1 }, ctl);
  return {
    current, next,
    levelRequired: G.heroPrestigeLevelRequirement[tier + 1], gold: G.heroPrestigeCost[tier],
    enchantsLost: (raw.enchantList ?? []).length, relevel,
  };
}
