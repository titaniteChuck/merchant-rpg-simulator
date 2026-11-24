/**
 * Battle page v4 (U36) helpers without DOM, so Node tests can check them:
 * - enemyGroups(): the enemy picker's groups, by region and kind: "<Region>", "<Region> – Event", "<Region> – Map" for
 *   each region in turn (regionOf of wiki-data.ts). The Map group holds only what maps alone have: map bosses and the
 *   map Treasure Bushes.
 * - enemyStatMax(): the enemy radar's rims, the highest value of each stat over every enemy (rare variants included),
 *   computed once.
 * - solveShortlist(): the solver's results worth showing: no 0 % result, within 25 % of the best (win and score), at
 *   most 5.
 * - includedSlots(): which filled slots fight, from the hero cards' include boxes and the opponent's size cap.
 */
import { G } from "../sim/data.ts";
import type { PartyRules } from "./battle-rules.ts";
import { locationOf } from "./battle-plan.ts";
import { enemyLevelSort, isEnemy, isTreasureBush, regionOf } from "./wiki-data.ts";
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

let statMax: Record<string, number> | null = null;
/** Highest base value of each radar stat (ENEMY_STATS keys) over every fightable enemy, rare variants included. */
export function enemyStatMax(): Record<string, number> {
  if (statMax) return statMax;
  const out: Record<string, number> = {};
  for (const [id, q] of Object.entries<Any>(G.questData ?? {})) {
    if (!isFightable(Number(id))) continue;
    for (const [k] of ENEMY_STATS) out[k] = Math.max(out[k] ?? 0, Number(q[k]) || 0, Number(q[`${k}B`]) || 0);
  }
  statMax = out;
  return out;
}

/** True when a rate prints as "0.0%" (the page's pct). */
const showsZero = (x: number) => Math.round(x * 1000) === 0;

/**
 * The solver's results to show (U36): never a 0 % result, only setups within `slack` (25 %) of the best one found, on
 * the win rate (win ≥ 0.75 × best win) and on the ranking score (score ≥ 0.75 × best score), at most `max` (5), in the
 * solver's own order (winners first, the smallest first).
 */
export function solveShortlist<T extends { ev: { win: number }; score: number }>(results: T[], max = 5, slack = 0.25): T[] {
  const live = results.filter((c) => !showsZero(c.ev.win));
  if (!live.length) return [];
  const bestWin = Math.max(...live.map((c) => c.ev.win));
  const bestScore = Math.max(...live.map((c) => c.score));
  return live.filter((c) => c.ev.win >= (1 - slack) * bestWin && (bestScore <= 0 || c.score >= (1 - slack) * bestScore)).slice(0, max);
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
