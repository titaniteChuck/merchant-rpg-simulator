/**
 * Levelling and prestige economics: how many hours a hero needs to reach its tier's max level on the best XP source
 * at each level band, and what a prestige tier gives against what it costs.
 *
 * Game rules (obj.Quest, obj.Hero, data.Default, scene.QuestMenu, obj.GameClass):
 * - A won quest gives every living hero round(exp / heroes) x amount (expB for the rare variant), then
 *   x (1 + expMod / 100) x questXpMod (Hero:addExperience). A lost quest kills the party (revive: level x 10 x tier gold).
 * - Launching a quest costs its `gold` x amount (Game:startQuest), won or lost; gathering quests cost 0 to 100 g.
 * - Only quest-board quests are single fights (scene.QuestMenu:drawEnemyLocations skips questType 8). Map bosses
 *   (91-98) and Treasure Bushes (99-104) are only met in a map run, so the plan weighs whole map runs instead: every
 *   room won gives each living hero round(exp x mapEnemyMod x 0.2 / heroes) (obj.combat.Campaign), and a run costs the
 *   map's craft time (crafter, quest-stats.ts mapCraftSeconds) plus the run time, and the map itself (gold).
 *   A hero needs level 10 to join a map (scene.maps.MapAssignHeroMenu).
 * - heroLevelRequirement[tier][level] = XP to reach `level`; max level 50 / 50 / 60 (maxHeroLevel). A save's `exp` is
 *   the XP already earned towards the next level.
 * - The hero a quest is opened from (the levelled hero: front 1 solo, front 2 in a party) needs
 *   level >= levelReq - heroLevelPrestigeBonus x (tier - 1) (2 per tier, scene.QuestMenu "Required level") and the
 *   quest's region open: regionLevelReqs[region] <= level + 2 x (tier - 1) (default.regionUnlockLevelMet). A companion
 *   joins when level > min(levelReq - 5, 0.75 x levelReq) (default.heroPartyLevelReq).
 * - The quest size cap (2 x tier - 1) comes from the highest tier among the heroes in the fight.
 * - An XP Boost potion adds expMod (+30 / +60 / +100) for 3 quests, or 3 rooms of a map run (one charge per room);
 *   a hero may drink it from level itemLevel - 5 - 4 x (tier - 1) (default.heroBoostLevelReq).
 * - Prestige (Hero:prestigeUp, default.canHeroPrestige): needs heroPrestigeLevelRequirement[tier + 1] and
 *   heroPrestigeCost[tier] gold; the hero goes back to level 1 with 0 XP, loses its potion and enchants, gets the new
 *   tier's growth and max level, 4 more enchant slots and a quest amount cap of 2 x tier - 1.
 * Pure, worker-safe; progress and cancel through SearchControl.
 */
import { G } from "../sim/data.ts";
import { D } from "../sim/defaults.ts";
import { fightSeed, maxQuestAmount, partyRules, SearchCancelled, soloRows, type SearchControl } from "./combat.ts";
import type { FightResult, Hero, Row, Sim } from "./engine.ts";
import { reviveGold } from "./farming.ts";
import { gameFromData } from "./gamedata.ts";
import { Solver } from "./profit.ts";
import { isBoardQuest, isCraftableMap, mapCraftSeconds, mapRunStats } from "./quest-stats.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** default.heroLevelPrestigeBonus: each tier above the first lowers a quest's start level by 2. */
export const LEVEL_PRESTIGE_BONUS = 2;

/** XP to go from `from` to `to` (same tier). */
export function xpBetween(tier: number, from: number, to: number): number {
  const req = G.heroLevelRequirement[tier];
  let total = 0;
  for (let l = from + 1; l <= to; l++) total += req[l] ?? 0;
  return total;
}

export const maxLevel = (tier: number): number => D.maxHeroLevel[tier];

const boardQuest = (k: number, q: Any): boolean => Boolean(q?.enemyHp && q.attackList && q.levelReq !== undefined && isBoardQuest(k));
const regionOpen = (region: number, level: number, tier: number): boolean => {
  const req = D.regionLevelReqs?.[region];
  return req !== undefined && req <= level + 2 * (tier - 1);
};

/** default.heroPartyLevelReq: a hero of this level may join (not open) this quest. */
export const canJoin = (level: number, quest: number): boolean => {
  const r = G.questData[quest]?.levelReq ?? 0;
  return level > Math.min(r - 5, r * 0.75);
};

/** The lowest level that may open this quest at this tier (the quest board's "Required level"). */
export const startLevel = (quest: number, tier: number): number =>
  (G.questData[quest]?.levelReq ?? 0) - LEVEL_PRESTIGE_BONUS * (tier - 1);

/**
 * Quest-board quests a hero of this level and tier may join (heroPartyLevelReq + regionUnlockLevelMet), with an enemy
 * to fight. Map bosses and Treasure Bushes (questType 8) are never on the board: see availableMaps.
 */
export function availableQuests(level: number, tier: number): number[] {
  const out: number[] = [];
  for (const [k, q] of Object.entries<Any>(G.questData)) {
    if (!boardQuest(Number(k), q)) continue;
    if (!canJoin(level, Number(k)) || !regionOpen(q.region, level, tier)) continue;
    out.push(Number(k));
  }
  return out.sort((a, b) => a - b);
}

/** Quest-board quests a hero of this level and tier may open itself (start rule + region): the plan's candidates. */
export function openableQuests(level: number, tier: number): number[] {
  const out: number[] = [];
  for (const [k, q] of Object.entries<Any>(G.questData)) {
    if (!boardQuest(Number(k), q)) continue;
    if (level < startLevel(Number(k), tier) || !regionOpen(q.region, level, tier)) continue;
    out.push(Number(k));
  }
  return out.sort((a, b) => a - b);
}

/** Maps a hero of this level can join (level >= 10, MapAssignHeroMenu) that a Scribe of `crafterLevel` can craft. */
export function availableMaps(level: number, crafterLevel = 60): number[] {
  if (level < 10) return [];
  return Object.keys(G.itemData?.map ?? {}).map(Number).filter((m) => isCraftableMap(m, crafterLevel)).sort((a, b) => a - b);
}

/**
 * The quests and maps a plan may use for a visitor: quest-board quests `visible` lets through (expansion content the
 * visitor doesn't own is left out: Frentir quests need the Frozen Tome), and no map runs at all when the Scribe
 * expansion is hidden. Pass the result as LevellingOptions `quests` / `maps`.
 */
export function planSources(visible: (kind: "enemy" | "map", id: number) => boolean, scribeHidden: boolean):
  { quests: number[]; maps: number[] | "none" } {
  const quests = Object.keys(G.questData ?? {}).map(Number).filter((id) => isBoardQuest(id) && visible("enemy", id));
  const maps = scribeHidden ? "none" as const : Object.keys(G.itemData?.map ?? {}).map(Number).filter((id) => visible("map", id));
  return { quests, maps };
}

// ---------------------------------------------------------------- XP Boost potions
export interface XpBoost {
  id: number;
  /** English item name (pages show it through names.ts). */
  name: string;
  expMod: number;
  itemLevel: number;
  /** Quests (or map rooms) one potion lasts. */
  duration: number;
}

/** The XP Boost potions (Boost consumables with an expMod stat), weakest first. */
export function xpBoosts(): XpBoost[] {
  const out: XpBoost[] = [];
  for (const [k, it] of Object.entries<Any>(G.itemData?.consumable ?? {})) {
    if (it?.subType !== "Boost" || !it.stat?.expMod) continue;
    out.push({ id: Number(k), name: it.name, expMod: it.stat.expMod, itemLevel: it.itemLevel ?? 1, duration: it.duration ?? 3 });
  }
  return out.sort((a, b) => a.expMod - b.expMod || a.id - b.id);
}

/** default.heroBoostLevelReq: the level a hero of this tier may drink this potion from. */
export const boostLevel = (b: XpBoost, tier: number): number => b.itemLevel - 5 - 4 * (tier - 1);

/** The strongest XP Boost a hero of this level and tier may drink, no stronger than `cap` (a potion id). */
export function xpBoostAt(level: number, tier: number, cap: number): XpBoost | undefined {
  const all = xpBoosts();
  const top = all.find((b) => b.id === cap);
  if (!top) return undefined;
  return all.filter((b) => b.expMod <= top.expMod && level >= boostLevel(b, tier)).at(-1);
}

// ---------------------------------------------------------------- one source
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
  /** Gold paid to launch one run (quest gold x amount; 0 for a map run, whose cost is the map). */
  launchGold?: number;
  /** XP Boost drunk on this source (potion id) and potions per run (1/3 per quest; 1 per map run: its first 3 rooms). */
  boost?: number;
  potionsPerRun?: number;
  /** Stopped early: it could no longer reach the minimum win or beat the best source (its figures are partial). */
  cut?: boolean;
}

/** The slot name a fight result gives a hero standing at this place ("front2", "back1"). */
function slotOf(hero: Hero, front: Row, back: Row): string | undefined {
  const f = front.indexOf(hero), b = back.indexOf(hero);
  return f >= 0 ? `front${f + 1}` : b >= 0 ? `back${b + 1}` : undefined;
}

/** Shortest possible quest time multiplier: the fastest grade, no battle time, the party's speed (gear only). */
function minQuestSeconds(quest: number, amount: number, members: Hero[]): number {
  const q = G.questData[quest];
  const fastest = Math.min(...Object.values<number>(G.gradeTime ?? { 0: 1 }));
  const speed = members.reduce((a, h) => a + (Number(h.speed) || 0), 0) * 0.01;
  return (q.time ?? 0) * amount * fastest * D.questTimeMod * (1 - Math.min(speed, 0.75));
}

/** Most XP per hour a quest can give this hero (every fight won at the fastest grade): to try the best first. */
export function questXpBound(hero: Hero, front: Row, back: Row, quest: number, amount = 1, expModBonus = 0): number {
  const q = G.questData[quest];
  const members = [...front, ...back].filter((h): h is Hero => Boolean(h));
  if (hero.level >= maxLevel(hero.prestigeLevel)) return 0;
  const xp = Math.round((q.exp ?? 0) / Math.max(members.length, 1)) * amount * (1 + ((hero.expMod ?? 0) + expModBonus) / 100) * D.questXpMod;
  const secs = minQuestSeconds(quest, amount, members);
  return secs > 0 ? xp * 3600 / secs : Infinity;
}

export interface QuestRateOptions {
  /** Extra expMod for every fight (an XP Boost lasts 3 quests: one potion per 3 runs keeps it on). */
  expModBonus?: number;
  /** Stop once the win rate can no longer reach this (the source is then `cut`). */
  stopBelow?: number;
  /** Stop once the XP per hour can no longer beat this (the source is then `cut`). */
  stopUnder?: number;
}

/**
 * XP per hour of one quest at one amount for `hero` in this party (same seeds 1..n). The hero must be in `front`
 * or `back`; XP is the hero's own (its share of the party's split). Quest-board quests only.
 */
export function questXpRate(sim: Sim, hero: Hero, front: Row, back: Row, quest: number, amount = 1, n = 30,
  o: QuestRateOptions = {}): XpSource {
  const q = G.questData[quest];
  if (!isBoardQuest(quest)) throw new Error(`${q?.name ?? `quest ${quest}`} is not on the quest board: it is fought in a map run (mapXpRate)`);
  const members = [...front, ...back].filter((h): h is Hero => Boolean(h));
  const share = Math.round((q.exp ?? 0) / Math.max(members.length, 1)) * amount;
  const mult = (1 + ((hero.expMod ?? 0) + (o.expModBonus ?? 0)) / 100) * D.questXpMod;
  const atMax = hero.level >= maxLevel(hero.prestigeLevel);
  const slot = slotOf(hero, front, back);
  const minSecs = o.stopUnder !== undefined ? minQuestSeconds(quest, amount, members) : 0;
  const xpMax = atMax ? 0 : share * mult;
  let xp = 0, secs = 0, wins = 0, revive = 0, done = 0, cut = false;
  for (let k = 0; k < n; k++) {
    const left = n - k;
    if (o.stopBelow && (wins + left) / n < o.stopBelow) { cut = true; break; }
    if (o.stopUnder !== undefined && k > 0 && minSecs > 0 && (xp + left * xpMax) * 3600 / (secs + left * minSecs) < o.stopUnder) {
      cut = true;
      break;
    }
    const res: FightResult = sim.fight(quest, front, back, { seed: fightSeed(1, k), amount });
    done++;
    secs += res.questTime;
    // The hero by its slot: a companion may share its name and class.
    const me = res.heroes.find((h) => h.slot === slot)!;
    if (res.won) {
      wins++;
      if (!me.dead && !atMax) xp += share * mult;
    }
    for (const h of res.heroes) if (!res.won || h.dead) revive += reviveGold(h);
  }
  const d = Math.max(done, 1);
  const hoursPerRun = secs / d / 3600;
  return { kind: "quest", quest, label: q.name, amount, win: wins / d, xpPerRun: xp / d, hoursPerRun, reviveGold: revive / d,
    xpPerHour: hoursPerRun > 0 ? xp / d / hoursPerRun : 0, launchGold: (q.gold ?? 0) * amount, ...(cut ? { cut } : {}) };
}

/**
 * XP per hour of whole runs of one map for `hero` in this party (seeds 1..n): the hero's XP over every room won while
 * alive (a lost run keeps the rooms won before), time = the map's craft time + the run's time, revive gold of the
 * heroes dead at the end. `stopBelow`: stop early once the win rate can no longer reach it (win is then a bound).
 * `boost`: the hero drinks this XP Boost before each run (it lasts its first `duration` rooms).
 */
export function mapXpRate(sim: Sim, hero: Hero, front: Row, back: Row, map: number,
  o: { asc?: number; grade?: number; n?: number; stopBelow?: number; boost?: XpBoost;
    stopUnder?: { xpPerHour: number; xpMax: number; minHours: number } } = {}): XpSource {
  const asc = o.asc ?? 0, grade = o.grade ?? 3, n = o.n ?? 10;
  const m = G.itemData.map[map];
  const slot = slotOf(hero, front, back);
  let xp = 0, secs = 0, wins = 0, revive = 0, done = 0, cut = false;
  try {
    for (let k = 0; k < n; k++) {
      if (o.stopBelow && (wins + n - k) / n < o.stopBelow) { cut = true; break; }
      const u = o.stopUnder;
      if (u && done > 0 && u.minHours > 0) {
        const craftH = mapCraftSeconds(map, grade, sim.mode) / 3600, left = n - k;
        if ((xp + left * u.xpMax) / (secs / 3600 + done * craftH + left * u.minHours) < u.xpPerHour) { cut = true; break; }
      }
      if (o.boost) {
        hero.boost = false;
        hero.applyBoost(o.boost.id, { expMod: o.boost.expMod }, 0, o.boost.duration);
        hero._keepBoost = true;
      }
      let res;
      try {
        res = sim.mapRun({ id: map, prestigeLevel: asc, grade }, front, back, fightSeed(1, k));
      } catch {
        continue; // the game's own code fails on this layout
      }
      done++;
      secs += res.time;
      if (res.won) wins++;
      const me = res.heroes.find((h) => h.slot === slot);
      if (me && hero.level < maxLevel(hero.prestigeLevel)) xp += me.xp ?? 0;
      for (const h of res.heroes) if (h.dead) revive += reviveGold(h);
    }
  } finally {
    if (o.boost) {
      hero._keepBoost = false;
      hero.boost = false;
      hero.determineStats();
    }
  }
  const d = Math.max(done, 1);
  const runHours = secs / d / 3600, craftHours = mapCraftSeconds(map, grade, sim.mode) / 3600;
  const hoursPerRun = runHours + craftHours;
  const boss = Object.values<number>(m.bossList ?? {})[0] ?? 0;
  return { kind: "map", quest: boss, map, asc, label: `${m.name}${asc ? ` asc ${asc}` : ""} (run)`, amount: 1,
    win: wins / d, xpPerRun: xp / d, hoursPerRun, craftHours, runHours, reviveGold: revive / d,
    xpPerHour: hoursPerRun > 0 ? xp / d / hoursPerRun : 0, launchGold: 0, ...(cut ? { cut } : {}) };
}

/** Same source (merged across bands): the same quest at the same amount, or the same map at the same ascension, with
 * the same potion. */
export const sourceKey = (s: XpSource): string =>
  `${s.kind === "map" ? `map|${s.map}|${s.asc ?? 0}` : `quest|${s.quest}|${s.amount}`}${s.boost ? `|b${s.boost}` : ""}`;

// ---------------------------------------------------------------- the plan
export interface LevelStep {
  fromLevel: number;
  toLevel: number;
  /** Best source at fromLevel (the hero is rebuilt at that level, gear above it ignored as in game). */
  source: XpSource;
  xpNeeded: number;
  /** Whole runs (the last one rounded up), and the exact count the hours and gold come from. */
  runs: number;
  runsExact: number;
  hours: number;
  /** The step's own figures over all its bands: win (by runs), XP per run and XP per hour (XP needed / hours). */
  win: number;
  xpPerRun: number;
  xpPerHour: number;
  reviveGold: number;
  /** Gold of the quest launches (quest gold x amount per run). */
  launchGold: number;
  /** XP Boost potions drunk (one per 3 quests, one per map run) and their gold. */
  potions: number;
  potionGold: number;
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
  /** Other heroes fighting alongside (raw save records), front row first; default solo. They join party quests they
   * may join (heroPartyLevelReq) and map runs, never solo quests. */
  companions?: Any[];
  /** Fights per candidate (default 30); quest ids to consider (default every quest-board quest the hero may open). */
  n?: number;
  quests?: number[];
  /** Amounts to try (default 1 and the max of the heroes in the fight). */
  amounts?: "one" | "max" | "all";
  /** Only sources won at least this often (default 0.5; for a map run, whole runs won). */
  minWin?: number;
  /** XP Boost potion (consumable id): at each band the hero drinks the strongest one it may, up to this one. */
  xpBoost?: number;
  /** Map runs as XP sources: "none" leaves them out; default every craftable map (from hero level 10). */
  maps?: number[] | "none";
  /** Runs per map candidate (default 10), map grade (default 3), Scribe level (default 60: which maps it can craft). */
  mapRuns?: number;
  mapGrade?: number;
  crafterLevel?: number;
  /** Prices of the maps and potions consumed (default: a Solver at grade 3, solved only when one is needed); a
   * function is called only then. */
  solver?: Solver | (() => Solver);
}

export interface LevellingPlan {
  tier: number;
  from: number;
  to: number;
  /** XP the hero already had towards from + 1 (counted when the plan starts at the hero's own level). */
  startExp: number;
  steps: LevelStep[];
  hours: number;
  runs: number;
  reviveGold: number;
  launchGold: number;
  potions: number;
  potionGold: number;
  /** Gold of the maps the plan consumes. */
  mapGold: number;
  /** Launch + revive + potions + maps. */
  gold: number;
  /** Bands with no source won often enough (the plan stops there). */
  stuckAt?: number;
}

/** Merge consecutive steps that use the same source (one step per source change, not per band). */
export function mergeSteps(steps: LevelStep[]): LevelStep[] {
  const out: LevelStep[] = [];
  const exact = (s: LevelStep) => s.runsExact ?? s.runs;
  for (const s of steps) {
    const prev = out.at(-1);
    if (prev && prev.toLevel === s.fromLevel && sourceKey(prev.source) === sourceKey(s.source)) {
      const runsExact = exact(prev) + exact(s), xpNeeded = prev.xpNeeded + s.xpNeeded, hours = prev.hours + s.hours;
      const potionsExact = (prev.potions ?? 0) + (s.potions ?? 0);
      out[out.length - 1] = { ...prev, toLevel: s.toLevel, xpNeeded, runsExact, runs: Math.ceil(runsExact - 1e-9), hours,
        win: runsExact > 0 ? ((prev.win ?? prev.source.win) * exact(prev) + (s.win ?? s.source.win) * exact(s)) / runsExact : prev.win,
        xpPerRun: runsExact > 0 ? xpNeeded / runsExact : 0, xpPerHour: hours > 0 ? xpNeeded / hours : 0,
        reviveGold: prev.reviveGold + s.reviveGold, launchGold: (prev.launchGold ?? 0) + (s.launchGold ?? 0),
        potions: potionsExact, potionGold: (prev.potionGold ?? 0) + (s.potionGold ?? 0), mapGold: prev.mapGold + s.mapGold,
        bands: prev.bands + s.bands };
    } else out.push({ ...s });
  }
  // Potions are bought whole.
  return out.map((s) => ({ ...s, potions: Math.ceil((s.potions ?? 0) - 1e-9) }));
}

interface Candidate {
  idx: number;
  kind: "quest" | "map";
  id: number;
  amount: number;
  rows: [Row, Row];
  /** Most XP per hour it could give (quests: a true bound; maps: every room won, 1.5 x the expected rooms). */
  ub: number;
  /** Maps: XP per run with every room won (1.5 x the expected rooms) and the shortest run (craft + a quarter of the walk). */
  xpMax?: number;
  minHours?: number;
}

/**
 * Hours from the hero's level (or `from`) to `to`, choosing the best XP/h source at every band: a quest-board quest
 * (single fights) or a whole map run (craft + run time). Consecutive bands with the same best source are one step.
 * Candidates are tried best bound first; a candidate stops as soon as it can't reach the minimum win or beat the best
 * so far (same choice as trying them all, much less simulation).
 */
export function levellingPlan(sim: Sim, raw: Any, o: LevellingOptions & { from?: number } = {}, ctl: SearchControl = {}): LevellingPlan {
  const tier = raw.prestigeLevel ?? 1;
  const from = Math.max(1, o.from ?? raw.level ?? 1), to = Math.min(o.to ?? maxLevel(tier), maxLevel(tier));
  const startExp = from === (raw.level ?? 1) ? Math.max(0, Number(raw.exp) || 0) : 0;
  const band = o.band ?? 5, n = o.n ?? 30, minWin = o.minWin ?? 0.5;
  const mapRuns = o.mapRuns ?? 10, mapGrade = o.mapGrade ?? 3, crafterLevel = o.crafterLevel ?? 60;
  let solver: Solver | undefined;
  const price = (type: string, id: number, asc = 0) => {
    solver ??= typeof o.solver === "function" ? o.solver() : o.solver ?? new Solver(gameFromData()).solve();
    const c = solver.get(type, id, asc);
    return Number.isFinite(c) ? c : 0;
  };
  const bands: number[] = [];
  for (let l = from; l < to; l += band) bands.push(l);

  // Every band's hero, party and candidates first: the progress counts candidates.
  const plans = bands.map((l) => {
    const hero = sim.hero({ ...structuredClone(raw), level: l, exp: 0 });
    const boost = o.xpBoost ? xpBoostAt(l, tier, o.xpBoost) : undefined;
    const bonus = boost?.expMod ?? 0;
    const companions = (o.companions ?? []).map((c) => sim.hero(structuredClone(c)));
    // Map runs have no required slot: the hero in front 1, the companions after it.
    const front: Row = [hero, ...companions.slice(0, 2)], back: Row = companions.slice(2, 5);
    // Quests follow the game's party rules (combat.ts partyRules): a solo quest takes the hero alone in front 1; a party
    // quest has the hero in front 2 (soloRows, it opens the quest) and the companions that may join in the other slots,
    // up to the quest's size.
    const questRows = (q: number): [Row, Row] => {
      const [f, b] = soloRows({ quest: q }, hero);
      const rules = partyRules({ quest: q });
      if (rules.kind === "solo") return [f, b];
      const free: [Row, number][] = [[f, 0], [f, 2], [b, 0], [b, 1], [b, 2]];
      companions.filter((c) => canJoin(c.level, q)).slice(0, Math.max(0, rules.maxSize - 1))
        .forEach((c, k) => { const [row, i] = free[k]; row[i] = c; });
      return [f, b];
    };
    const open = openableQuests(l, tier);
    const quests = o.quests ? open.filter((q) => o.quests!.includes(q)) : open;
    const cands: Candidate[] = [];
    for (const q of quests) {
      const rows = questRows(q);
      const cap = maxQuestAmount([...rows[0], ...rows[1]], false, sim.mode);
      const amounts = o.amounts === "one" ? [1] : o.amounts === "max" ? [cap] : [...new Set([1, cap])];
      for (const a of amounts) {
        cands.push({ idx: cands.length, kind: "quest", id: q, amount: a, rows, ub: questXpBound(hero, ...rows, q, a, bonus) });
      }
    }
    const mapList = o.maps === "none" ? [] : o.maps;
    const maps = o.maps === "none" ? [] : availableMaps(l, crafterLevel).filter((m) => !mapList || mapList.includes(m));
    for (const mid of maps) {
      // Every room won (solo share, 1.5 x the expected rooms) at the shortest time (craft + a quarter of the walk:
      // speed cuts at most 75 %).
      const ub = mapRunStats(mid, { grade: mapGrade, heroes: 1, expMod: (hero.expMod ?? 0) + bonus, mode: sim.mode });
      const minH = (ub.craftSeconds + 0.25 * ub.runSeconds) / 3600;
      cands.push({ idx: cands.length, kind: "map", id: mid, amount: 1, rows: [front, back], ub: minH > 0 ? 1.5 * ub.xpPerHero / minH : Infinity,
        xpMax: 1.5 * ub.xpPerHero, minHours: minH });
    }
    // Quests first (cheap fights), then map runs (a whole run each): the best quest lets most maps be skipped.
    cands.sort((a, b) => Number(a.kind === "map") - Number(b.kind === "map") || b.ub - a.ub || a.idx - b.idx);
    return { l, hero, boost, cands };
  });
  const total = plans.reduce((a, p) => a + p.cands.length, 0);
  let done = 0;
  ctl.onProgress?.(0, total, `level ${from}`);

  const steps: LevelStep[] = [];
  let stuckAt: number | undefined;
  for (const [bi, { l, hero, boost, cands }] of plans.entries()) {
    let best: XpSource | null = null, bestIdx = Infinity;
    for (const c of cands) {
      if (ctl.shouldStop?.()) throw new SearchCancelled();
      ctl.onProgress?.(++done, total, `level ${l}`);
      // Can't beat the best so far, even with every fight won at the fastest time.
      if (best && (c.kind === "map" ? c.ub <= best.xpPerHour : c.ub < best.xpPerHour)) continue;
      let s: XpSource;
      if (c.kind === "quest") {
        s = questXpRate(sim, hero, ...c.rows, c.id, c.amount, n, { expModBonus: boost?.expMod, stopBelow: minWin, stopUnder: best?.xpPerHour });
        if (boost) s = { ...s, boost: boost.id, potionsPerRun: 1 / boost.duration };
      } else {
        s = mapXpRate(sim, hero, ...c.rows, c.id, { grade: mapGrade, n: mapRuns, stopBelow: minWin, boost,
          ...(best ? { stopUnder: { xpPerHour: best.xpPerHour, xpMax: c.xpMax!, minHours: c.minHours! } } : {}) });
        if (boost) s = { ...s, boost: boost.id, potionsPerRun: 1 };
      }
      if (s.cut || s.win < minWin) continue;
      if (!best || s.xpPerHour > best.xpPerHour || (s.xpPerHour === best.xpPerHour && c.idx < bestIdx)) {
        best = s;
        bestIdx = c.idx;
      }
    }
    if (!best || best.xpPerRun <= 0) {
      stuckAt = l;
      break;
    }
    const top = Math.min(l + band, to);
    const need = Math.max(0, xpBetween(tier, l, top) - (bi === 0 ? startExp : 0));
    const runsExact = need / best.xpPerRun;
    const potions = runsExact * (best.potionsPerRun ?? 0);
    steps.push({ fromLevel: l, toLevel: top, source: best, xpNeeded: need, runs: Math.ceil(runsExact - 1e-9), runsExact,
      hours: runsExact * best.hoursPerRun, win: best.win, xpPerRun: best.xpPerRun, xpPerHour: best.xpPerHour,
      reviveGold: runsExact * best.reviveGold, launchGold: runsExact * (best.launchGold ?? 0),
      potions, potionGold: best.boost ? potions * price("consumable", best.boost) : 0,
      mapGold: best.kind === "map" ? runsExact * price("map", best.map!, best.asc ?? 0) : 0, bands: 1 });
  }
  ctl.onProgress?.(total, total, "done");
  const merged = mergeSteps(steps);
  const sum = (f: (s: LevelStep) => number) => merged.reduce((a, s) => a + f(s), 0);
  const reviveGold = sum((s) => s.reviveGold), launchGold = sum((s) => s.launchGold), potionGold = sum((s) => s.potionGold);
  const mapGold = sum((s) => s.mapGold);
  return { tier, from, to, startExp, steps: merged, hours: sum((s) => s.hours), runs: sum((s) => s.runs), reviveGold, launchGold,
    potions: sum((s) => s.potions), potionGold, mapGold, gold: reviveGold + launchGold + potionGold + mapGold,
    ...(stuckAt !== undefined ? { stuckAt } : {}) };
}

// ---------------------------------------------------------------- prestige
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

/** The relevel plan's input: the hero right after prestiging (level 1, 0 XP, no enchants, next tier), from 1 to the
 * new tier's max level (the page's target applies to the current tier only). */
export function relevelInput(raw: Any, o: LevellingOptions = {}): [Any, LevellingOptions & { from: number }] {
  const tier = raw.prestigeLevel ?? 1;
  return [{ ...structuredClone(raw), prestigeLevel: tier + 1, level: 1, exp: 0, enchantList: undefined }, { ...o, from: 1, to: undefined }];
}

/**
 * What the next prestige tier gives and costs for this hero: stats and a reference fight at each tier's max level
 * (current gear and enchants; the new tier without enchants, as after prestiging), against the gold, the lost
 * enchants and the hours to level back up to the new max. `relevel`: a plan already computed for relevelInput.
 */
export function prestigePayoff(sim: Sim, raw: Any, ref: { quest: number; n?: number }, o: LevellingOptions = {},
  ctl: SearchControl = {}, relevel?: LevellingPlan): PrestigePayoff {
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
      // The hero alone where the game puts it: front 1 in a solo quest, front 2 in a party quest (combat.ts soloRows).
      const res = sim.fight(ref.quest, ...soloRows({ quest: ref.quest }, h), { seed: fightSeed(1, k) });
      if (res.won) wins++;
      peak += 1 - Math.max(res.enemyMinHP ?? res.enemyHP, 0) / res.enemyMaxHP;
    }
    score = wins / n * 1e6 + peak / n * 1e4;
    return { tier: t, maxLevel: maxLevel(t), stats: st, enchantSlots: 8 + 4 * (t - 1), questAmountCap: maxQuestAmount([h], false, sim.mode),
      ref: { win: wins / n, enemyPeak: peak / n, score } };
  };
  const current = view(tier, true), next = view(tier + 1, false);
  relevel ??= levellingPlan(sim, ...relevelInput(raw, o), ctl);
  return {
    current, next,
    levelRequired: G.heroPrestigeLevelRequirement[tier + 1], gold: G.heroPrestigeCost[tier],
    enchantsLost: (raw.enchantList ?? []).length, relevel,
  };
}
