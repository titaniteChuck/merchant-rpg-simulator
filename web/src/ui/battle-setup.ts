/**
 * Battle page v4 (U36) helpers without DOM, so Node tests can check them:
 * - enemyGroups(): the enemy picker's groups, by region and kind: "<Region>", "<Region> – Event", "<Region> – Map" for
 *   each region in turn (regionOf of wiki-data.ts). The Map group holds only what maps alone have: map bosses and the
 *   map Treasure Bushes.
 * - enemyStats(), enemyTurns(), questEntries(): the enemy card's stats and rotation, the picker's rare entries (U62;
 *   until then enemyRadar, the U39 spider chart's axes).
 * - solveShortlist(): the solver's results worth showing: no 0 % result, within 25 % of the best (win and score), at
 *   most 5; U72 order (compareSolutions): win rate, then fewest heroes dead, then most life left, then fewest scrolls.
 * - includedSlots(): which filled slots fight, from the hero cards' include boxes and the opponent's size cap.
 * - solveStatus(), sizeHelp() (R2 F31, F34): the Solver's texts, its one status line and its "?"s (U74: no "rough" chip,
 *   ROUGH_HELP deleted).
 * - solverFigures() (U51): a Solver row's grade, life remaining (U74 lifeRemaining) and heroes dead, from the setup's
 *   evaluation; partyLines() (U74): its Party cell's Back / Front / Scrolls lines.
 */
import { G } from "../sim/data.ts";
import { Enemy } from "../sim/enemy.ts";
import { seq } from "../sim/lua.ts";
import { fmt, fmt1 } from "./dom.ts";
import type { PartyRules } from "./battle-rules.ts";
import { locationOf } from "./battle-plan.ts";
import { isBoardQuest } from "../tools/quest-stats.ts";
import { enemyLevelSort, isEnemy, isGathering, isTreasureBush, regionOf, regionOfLevel } from "./wiki-data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** A quest the battle page can fight: a real enemy with HP and a rotation (gathering bushes included). */
export const isFightable = (id: number): boolean => {
  const q = G.questData?.[id];
  return !!(q?.enemyHp && q.attackList && q.name && isEnemy(id));
};

export interface EnemyGroup {
  /** Region id (1-6) and group: 0 region, 1 event, 2 map. */
  region: number;
  group: 0 | 1 | 2;
  label: string;
  ids: number[];
}

/**
 * The picker's groups of these enemy ids, region by region (region, event, map), each by level then id. `maps` false
 * (U42: Scribe hidden): no "– Map" groups, the map bosses and map Treasure Bushes left out.
 */
export function enemyGroups(ids: number[], maps = true): EnemyGroup[] {
  const by = new Map<string, EnemyGroup>();
  for (const id of ids) {
    const r = regionOf("enemy", id);
    if (!r) continue;
    const group: 0 | 1 | 2 = r.group === "map" || isTreasureBush(id) ? 2 : r.group === "event" ? 1 : 0;
    if (group === 2 && !maps) continue;
    const key = `${r.id}:${group}`;
    if (!by.has(key)) by.set(key, { region: r.id, group, label: `${r.full}${group === 1 ? " – Event" : group === 2 ? " – Map" : ""}`, ids: [] });
    by.get(key)!.ids.push(id);
  }
  const out = [...by.values()].sort((a, b) => a.region - b.region || a.group - b.group);
  for (const g of out) g.ids.sort((a, b) => enemyLevelSort(a) - enemyLevelSort(b) || a - b);
  return out;
}

/** The quest has a rare variant the engine can fight (its HP and its rotation). */
export const hasRareVariant = (id: number): boolean => G.questData?.[id]?.enemyHpB !== undefined && G.questData?.[id]?.attackListB !== undefined;
/** U62: the enemy picker's value: the quest id, then ":rare" for its rare variant (the Flow's enemy head used it already). */
export const questValue = (id: number | string, rare: boolean): string => `${id}${rare ? ":rare" : ""}`;
export const parseQuestValue = (v: string): { id: number; rare: boolean } => ({ id: Number(v.split(":")[0]), rare: v.endsWith(":rare") });
/** U62: a quest's entries in the enemy picker, [value, rare]: the enemy, then its rare variant when it has one. */
export const questEntries = (id: number): [string, boolean][] =>
  [[questValue(id, false), false], ...(hasRareVariant(id) ? [[questValue(id, true), true] as [string, boolean]] : [])];

/**
 * U62: the enemy card's rotation: its skill on turns 1-5 (turn 6 is turn 1 again) from its timeline (`tl`, the data the
 * Flow and the wiki's timeline strip use), else the game's rotation of that variant.
 */
export function enemyTurns(id: number, rare: boolean, tl: { slots: { name: string }[] } | null): string[] {
  const d = G.questData[id];
  return tl?.slots.map((s) => s.name) ?? seq<string>((rare ? d.attackListB : d.attackList) ?? {}).slice(0, 5);
}

/**
 * U62: the enemy card's stats, the same eight as a hero card's (fighter-card.ts CARD_STATS), as the engine fights it
 * (sim/enemy.ts: the game mode's enemy multipliers, Acc 100 and Crit 0, HP times the quest size).
 */
export function enemyStats(id: number, rare = false, amount = 1): Record<string, number> {
  const e: Any = new Enemy({ questID: id, isRare: rare, amount: Math.max(1, Math.trunc(amount) || 1) });
  return Object.fromEntries(["maxHP", "atk", "matk", "def", "mdef", "acc", "eva", "crit"].map((k) => [k, Number(e[k]) || 0]));
}

/** True when a rate prints as "0.0%" (the page's pct). */
const showsZero = (x: number) => Math.round(x * 1000) === 0;

/** How many scrolls a solver result uses (a map run's loadout, repeats counted; none on a quest). */
export const scrollCount = (c: { scrolls?: readonly number[] | null }): number => c.scrolls?.length ?? 0;

/** U51: the grade letters, D (1) to S (5). */
const GRADE_ABC = ["D", "C", "B", "A", "S"];
/**
 * U51: a Solver row's grade, life left and heroes dead, from what the evaluation already measured (combat.ts
 * evaluate / evaluateMap): `grade` the average grade of the won fights or runs as a letter (null when none was won),
 * `gradeAvg` that average (1 = D … 5 = S); `life` the life remaining (U74, lifeRemaining: the average HP left of the
 * heroes still standing at the end, fallen heroes left out; null when nobody ever stands; U51 to U73: the party's HP
 * over its max HP, fallen heroes counting 0); `dead` the heroes down at the end, on average (the sum of the heroes'
 * death rates), of `size` heroes.
 */
export function solverFigures(ev: { win: number; grade: number; heroes: Record<string, LifeHero> }):
  { grade: string | null; gradeAvg: number; life: number | null; dead: number; size: number } {
  const heroes = Object.values(ev.heroes ?? {});
  const won = ev.win > 0 && ev.grade > 0;
  return {
    grade: won ? GRADE_ABC[Math.min(4, Math.max(0, Math.round(ev.grade) - 1))] : null,
    gradeAvg: won ? ev.grade : 0,
    life: lifeRemaining(ev),
    dead: heroes.reduce((a, h) => a + (Number(h.death_rate) || 0), 0),
    size: heroes.length,
  };
}

/** U74: what lifeRemaining reads of a hero's evaluation (combat.ts HeroEval). */
export type LifeHero = { death_rate: number; hp_left_frac?: number };

/**
 * U74: life remaining, the Simulator's "Life left" (worst-run.ts runStats) from an evaluation: the average HP left, as a
 * share of max HP, of every hero still standing at the end of every fight or run (fallen heroes left out). The
 * evaluation already has each hero's HP share at the end averaged over the runs with a fall as 0 (`hp_left_frac`) and
 * its death rate, so it is Σ hp_left_frac / Σ (1 − death_rate): the standing heroes' HP shares over their count.
 * Null when nobody ever stands (or no heroes). The engine's own `hp_left` (the party's HP over its max HP, a fall
 * counting 0; the search's score uses it) is left as it is.
 */
export function lifeRemaining(ev: { heroes?: Record<string, LifeHero> }): number | null {
  const heroes = Object.values(ev.heroes ?? {});
  const standing = heroes.reduce((a, h) => a + Math.max(0, 1 - (Number(h.death_rate) || 0)), 0);
  if (standing < 1e-9) return null;
  const hp = heroes.reduce((a, h) => a + Math.max(0, Number(h.hp_left_frac) || 0), 0);
  return Math.max(0, Math.min(1, hp / standing));
}

/**
 * U74: a Solver result's Party cell, three lines: the back row's heroes, the front row's (each in slot order, empty
 * slots left out), then the scrolls the run uses (repeats kept; none on a quest). An empty line has no ids.
 */
export function partyLines(c: { layout: { front: readonly (number | null)[]; back: readonly (number | null)[] }; scrolls?: readonly number[] | null }):
  { label: "Back" | "Front" | "Scrolls"; kind: "hero" | "scroll"; ids: number[] }[] {
  const heroes = (row: readonly (number | null)[]) => row.filter((id): id is number => id !== null);
  return [
    { label: "Back", kind: "hero", ids: heroes(c.layout.back) },
    { label: "Front", kind: "hero", ids: heroes(c.layout.front) },
    { label: "Scrolls", kind: "scroll", ids: [...(c.scrolls ?? [])] },
  ];
}

/** U72: a solution's figures the order reads (an evaluation without heroes counts as none dead, no life). */
type Ranked = { ev: { win: number; heroes?: Record<string, LifeHero> }; scrolls?: readonly number[] | null };

/**
 * U72: the Solver's order of two solutions: the higher win rate first (100 % first), then the fewest heroes dead on
 * average, then the most life remaining (U74: lifeRemaining, the shown "Life remaining"; none standing counts 0): the
 * best run wins every time, nobody dies and it ends at full health. Then the fewest scrolls (none first, E25); a tie is
 * 0, so a stable sort keeps the solver's own order (the fewest heroes, then its score).
 */
export function compareSolutions(a: Ranked, b: Ranked): number {
  const dead = (c: Ranked) => Object.values(c.ev.heroes ?? {}).reduce((n, h) => n + (Number(h.death_rate) || 0), 0);
  const life = (c: Ranked) => lifeRemaining(c.ev) ?? 0;
  const near = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x);
  return near(b.ev.win - a.ev.win) || near(dead(a) - dead(b)) || near(life(b) - life(a)) || scrollCount(a) - scrollCount(b);
}

/**
 * The solver's results to show (U36): never a 0 % result, only setups within `slack` (25 %) of the best one found, on
 * the win rate (win ≥ 0.75 × best win) and on the ranking score (score ≥ 0.75 × best score), at most `max` (5).
 * Order (U72, compareSolutions): win rate (highest first), heroes dead (fewest first), life left (most first), then
 * the fewest scrolls (E25), then the solver's own order. The order is applied before the cut to `max`.
 */
export function solveShortlist<T extends Ranked & { score: number }>(results: T[], max = 5, slack = 0.25): T[] {
  const live = results.filter((c) => !showsZero(c.ev.win));
  if (!live.length) return [];
  const bestWin = Math.max(...live.map((c) => c.ev.win));
  const bestScore = Math.max(...live.map((c) => c.score));
  const kept = live.filter((c) => c.ev.win >= (1 - slack) * bestWin && (bestScore <= 0 || c.score >= (1 - slack) * bestScore));
  return kept.sort(compareSolutions).slice(0, max);
}

export interface SlotRef {
  key: string;
  row: "front" | "back";
  i: number;
}

/**
 * The filled slots that fight (U36). A hero ticked out on its card stays in its slot but doesn't fight. When more are
 * ticked in than the opponent takes (`rules.maxSize`), the first ones are kept in the game's slot order (back 1,
 * front 1, back 2, front 2, back 3, front 3: the party locations), the required slots first (the game always fills
 * them), and the rest are left out automatically (`capped`).
 */
export function includedSlots(filled: SlotRef[], excluded: ReadonlySet<string>, rules: PartyRules): { included: SlotRef[]; capped: SlotRef[] } {
  const required = (s: SlotRef) => rules.required.some((r) => r.row === s.row && r.i === s.i);
  const order = filled.filter((s) => !excluded.has(s.key))
    .sort((a, b) => Number(required(b)) - Number(required(a)) || locationOf(a.row, a.i) - locationOf(b.row, b.i));
  return { included: order.slice(0, rules.maxSize), capped: order.slice(rules.maxSize) };
}

// ---------------------------------------------------------------- R1: a useful start for a fresh save (F02)
/**
 * The opponent of a fresh save (nothing remembered, R1 F02): the toughest quest-board enemy of the region the save's
 * strongest heroes are in (regionOfLevel of the highest hero level), at or below that level: the highest level first,
 * then the strongest (HP × attack). Gathering quests (bushes), bosses (Epic, Final, event bosses: a start, not a wall),
 * map-only enemies and what `visible` leaves out are skipped. With nothing in that region, the toughest such quest anywhere at or below the level; null
 * when nothing fits.
 */
export function defaultQuest(maxLevel: number, visible: (id: number) => boolean = () => true): number | null {
  const power = (id: number) => {
    const q = G.questData[id];
    return (Number(q.enemyHp) || 0) * ((Number(q.enemyAtk) || 0) + (Number(q.enemyMatk) || 0));
  };
  const ok = Object.keys(G.questData ?? {}).map(Number).filter((id) => {
    const q = G.questData[id];
    return isFightable(id) && isBoardQuest(id) && !isGathering(id) && !isTreasureBush(id) && q.questType !== 6
      && !/boss/i.test(String(q.title ?? "")) && (Number(q.levelReq) || 0) <= maxLevel && visible(id);
  });
  const best = (ids: number[]) => ids.sort((a, b) => (Number(G.questData[b].levelReq) || 0) - (Number(G.questData[a].levelReq) || 0)
    || power(b) - power(a) || a - b)[0] ?? null;
  const region = regionOfLevel(maxLevel);
  return best(ok.filter((id) => regionOf("enemy", id)?.id === region)) ?? best(ok);
}

export interface HeroPick {
  /** Index in the save's hero list. */
  idx: number;
  level: number;
  prestige: number;
  maxHP: number;
}

/**
 * A fresh save's party (R1 F02) under the opponent's rules: the strongest heroes (ascension, level, max HP), as many as
 * the opponent takes (`rules.maxSize`), the toughest (max HP) in front. Slots are filled in this order: the required
 * slot first (Front 2 on a party quest, Front 1 on a solo quest), then Front 1, Front 3, Front 2, Back 1, Back 2,
 * Back 3. Returns slot key ("front1") -> hero index.
 */
export function defaultSlots(heroes: HeroPick[], rules: PartyRules): Record<string, number> {
  const chosen = [...heroes].sort((a, b) => b.prestige - a.prestige || b.level - a.level || b.maxHP - a.maxHP || a.idx - b.idx)
    .slice(0, Math.max(0, Math.min(6, rules.maxSize)))
    .sort((a, b) => b.maxHP - a.maxHP || a.idx - b.idx);
  const order = [...rules.required.map((s) => `${s.row}${s.i}`), "front0", "front2", "front1", "back0", "back1", "back2"]
    .filter((k, n, all) => all.indexOf(k) === n);
  const out: Record<string, number> = {};
  chosen.forEach((h, k) => (out[order[k]] = h.idx));
  return out;
}

// ---------------------------------------------------------------- R1: damage without overkill (F22)
/** The enemy's max HP in a quest result (enemy_dmg_total / enemy_dmg_total_frac: the same every fight), or null. */
export function enemyMaxHp(ev: { enemy_dmg_total?: number; enemy_dmg_total_frac?: number }): number | null {
  const frac = ev.enemy_dmg_total_frac ?? 0;
  return frac > 0 && ev.enemy_dmg_total ? ev.enemy_dmg_total / frac : null;
}

/**
 * The damage per fight that really came off the enemy (R1 F22): the heroes' damage counts the overkill of the last
 * hits (1,391 + 2,237 against Maexna's 250 HP), so the party's total is capped at the enemy's max HP and each hero
 * keeps its share. Returns hero slot -> [effective, dealt]; dealt unchanged when the max HP is unknown or not passed.
 */
export function effectiveDamage(ev: { heroes: Record<string, { dmg: number }>; enemy_dmg_total?: number; enemy_dmg_total_frac?: number }): Record<string, [number, number]> {
  const sum = Object.values(ev.heroes).reduce((s, h) => s + h.dmg, 0);
  const maxHp = enemyMaxHp(ev) ?? 0;
  const k = maxHp > 0 && sum > maxHp ? maxHp / sum : 1;
  return Object.fromEntries(Object.entries(ev.heroes).map(([slot, h]) => [slot, [h.dmg * k, h.dmg]]));
}

// ---------------------------------------------------------------- R2: the Solver's texts (F31, F34, F35)
/** R2 F31: the "?" of the "Party 1 – 5" sizes: what they are, and the opponent's limit (`cap` heroes, 6 = none). */
export function sizeHelp(cap: number): string[] {
  return ["The smallest and the largest party to try: parties grow one hero at a time from the smallest.",
    ...(cap === 1 ? ["A solo quest: one hero."] : cap < 6 ? [`This quest takes at most ${cap} heroes.`] : [])];
}

export interface SolveRun {
  /** Setups listed that win 90 % or more, setups listed, setups the search returned, evaluations. */
  wins: number;
  listed: number;
  found: number;
  tried: number;
  /** The search's time and its budget, in ms. */
  ms: number;
  budgetMs: number;
  /** The search ended before its end (PartiesResult.stopped): its time budget ran out, or Cancel (`cancelled`). */
  stopped: boolean;
  cancelled: boolean;
  /** A map run (runs), else a quest (fights). */
  map: boolean;
}

/**
 * R2 F34: the Solver's one status line, "3 setups ≥ 90 % · 5.0 s" ("cancelled at 3.2 s" after a Cancel), and the
 * paragraphs of its "?": what the line counts, how the search ended, what was evaluated and left out. A search that
 * used its whole time budget ended as asked: it is said plainly, not as a failure; only Cancel reads as stopped.
 */
export function solveStatus(r: SolveRun): { line: string; help: string[] } {
  const s = (n: number) => (n === 1 ? "" : "s");
  const secs = `${fmt1.format(r.ms / 1000)} s`, budget = `${fmt.format(Math.round(r.budgetMs / 1000))} s`;
  const unit = r.map ? "runs" : "fights";
  const line = `${r.wins ? `${r.wins} setup${s(r.wins)} ≥ 90 %` : "No setup ≥ 90 % yet"} · ${r.cancelled ? `cancelled at ${secs}` : secs}`;
  const ended = r.cancelled ? `Cancelled after ${secs}: these are the setups found so far.`
    : r.stopped ? `The search used its whole time budget (${budget}) and lists the best setups found in that time. More time can find smaller or stronger parties.`
    : `The search was complete after ${secs}, within its time budget (${budget}).`;
  const left = r.found - r.listed;
  return {
    line,
    help: [
      r.wins ? `${r.wins} of the ${r.listed} setup${s(r.listed)} listed win${r.wins === 1 ? "s" : ""} 90 % of the ${unit} or more.`
        : `No setup wins 90 % of the ${unit} yet: the closest ones are listed.`,
      ended,
      `${fmt.format(r.tried)} evaluation${s(r.tried)}${left > 0 ? `; ${left} weaker setup${s(left)} not listed` : ""}. Only setups within 25 % of the best one are listed, at most 5.`,
      "Fixed seeds: every candidate is tested on the same rolls.",
    ],
  };
}
