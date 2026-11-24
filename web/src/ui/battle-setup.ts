/**
 * Battle page v4 (U36) helpers without DOM, so Node tests can check them:
 * - enemyGroups(): the enemy picker's groups, by region and kind: "<Region>", "<Region> – Event", "<Region> – Map" for
 *   each region in turn (regionOf of wiki-data.ts). The Map group holds only what maps alone have: map bosses and the
 *   map Treasure Bushes.
 * - enemyRadar(): the enemy radar (U39): HP as text (times the quest size), the other stats on one common rim (the
 *   enemy's highest of Atk, Matk, Def, Mdef), Eva on a fixed rim of 200.
 * - solveShortlist(): the solver's results worth showing: no 0 % result, within 25 % of the best (win and score), at
 *   most 5; winners first, then within each tier the fewest scrolls first (E25).
 * - includedSlots(): which filled slots fight, from the hero cards' include boxes and the opponent's size cap.
 */
import { G } from "../sim/data.ts";
import type { PartyRules } from "./battle-rules.ts";
import { locationOf } from "./battle-plan.ts";
import { isBoardQuest } from "../tools/quest-stats.ts";
import { enemyLevelSort, isEnemy, isGathering, isTreasureBush, regionOf, regionOfLevel } from "./wiki-data.ts";
import { ENEMY_STATS } from "./wiki-enemies.ts";

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

/** The picker's groups of these enemy ids, region by region (region, event, map), each by level then id. */
export function enemyGroups(ids: number[]): EnemyGroup[] {
  const by = new Map<string, EnemyGroup>();
  for (const id of ids) {
    const r = regionOf("enemy", id);
    if (!r) continue;
    const group: 0 | 1 | 2 = r.group === "map" || isTreasureBush(id) ? 2 : r.group === "event" ? 1 : 0;
    const key = `${r.id}:${group}`;
    if (!by.has(key)) by.set(key, { region: r.id, group, label: `${r.full}${group === 1 ? " – Event" : group === 2 ? " – Map" : ""}`, ids: [] });
    by.get(key)!.ids.push(id);
  }
  const out = [...by.values()].sort((a, b) => a.region - b.region || a.group - b.group);
  for (const g of out) g.ids.sort((a, b) => enemyLevelSort(a) - enemyLevelSort(b) || a - b);
  return out;
}

/** The evasion axis's rim (U39): always 200; an enemy with 200 or more sits on the rim. */
export const EVA_RIM = 200;

export interface EnemyRadar {
  /** HP for the quest size (one enemy with `amount`× HP): shown as text, not on the radar. */
  hp: number;
  baseHp: number;
  amount: number;
  /** The other stats, in ENEMY_STATS order: Atk, Matk, Def and Mdef on one common rim (the highest of the four), Eva on 200. */
  axes: { key: string; label: string; value: number; max: number }[];
}

/**
 * The enemy radar (U39): HP left out (as text, with the quest size), the other axes on one scale, this enemy's own
 * highest stat, so an enemy with huge stats (the Mighty Bush) no longer squashes everyone else's shape. Evasion has its
 * own fixed rim, 200.
 */
export function enemyRadar(q: Any, rare = false, amount = 1): EnemyRadar {
  const sfx = rare ? "B" : "";
  const val = (k: string) => Number(q?.[`${k}${sfx}`]) || 0;
  const n = Math.max(1, Math.trunc(amount) || 1);
  const stats = ENEMY_STATS.filter(([k]) => k !== "enemyHp");
  const common = Math.max(0, ...stats.filter(([k]) => k !== "enemyEva").map(([k]) => val(k)));
  return {
    hp: val("enemyHp") * n, baseHp: val("enemyHp"), amount: n,
    axes: stats.map(([k, label]) => ({ key: k, label, value: val(k), max: k === "enemyEva" ? EVA_RIM : common })),
  };
}

/** True when a rate prints as "0.0%" (the page's pct). */
const showsZero = (x: number) => Math.round(x * 1000) === 0;

/** How many scrolls a solver result uses (a map run's loadout, repeats counted; none on a quest). */
export const scrollCount = (c: { scrolls?: readonly number[] | null }): number => c.scrolls?.length ?? 0;

/**
 * The solver's results to show (U36): never a 0 % result, only setups within `slack` (25 %) of the best one found, on
 * the win rate (win ≥ 0.75 × best win) and on the ranking score (score ≥ 0.75 × best score), at most `max` (5).
 * Order (E25): winners (win ≥ `winAt`, the solver's 90 %) first, as the solver ranks them; within the winners, and
 * within the others, the fewest scrolls first (none first), then the solver's own order (winners: the fewest heroes,
 * then score; others: score). A scroll-free setup never jumps over a better one blindly: a clearly weaker one (40 %
 * against 95 %) is outside the 25 % window, and a non-winner always stays below every winner. The order is applied
 * before the cut to `max`, so a scroll-free setup just past the top 5 can take the place of a scroll-using one.
 */
export function solveShortlist<T extends { ev: { win: number }; score: number; scrolls?: readonly number[] | null }>(
  results: T[], max = 5, slack = 0.25, winAt = 0.9,
): T[] {
  const live = results.filter((c) => !showsZero(c.ev.win));
  if (!live.length) return [];
  const bestWin = Math.max(...live.map((c) => c.ev.win));
  const bestScore = Math.max(...live.map((c) => c.score));
  const kept = live.filter((c) => c.ev.win >= (1 - slack) * bestWin && (bestScore <= 0 || c.score >= (1 - slack) * bestScore));
  // a stable sort: the solver's order holds between setups of the same tier and scroll count
  const tier = (c: T) => (c.ev.win >= winAt ? 0 : 1);
  return kept.sort((a, b) => tier(a) - tier(b) || scrollCount(a) - scrollCount(b)).slice(0, max);
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
