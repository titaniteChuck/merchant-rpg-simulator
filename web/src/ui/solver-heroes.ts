/**
 * U50: the Solver's hero table: every hero of the save is Must include, Neutral or Exclude for the next solve
 * (replaces the 🔒 locks on the party cards and the "Leave heroes out" chips). No DOM, so Node tests can check it.
 *
 * - Stored per save in this browser (localStorage `solver-heroes:<save>`, by save hero id; convenience only).
 * - A hero with no stored state is Neutral, or Exclude when its class is hidden (an expansion the visitor doesn't own).
 * - Migration: with no stored states yet, the heroes locked in the save's old stored party (`battle-party:<save>`
 *   `locked`, slot key -> true, from before U41) become Must include. The old left-out chips were never stored.
 * - solverPick(): the solve's pool and must-include heroes, or the one error that stops it.
 */

export type HeroPick = "must" | "neutral" | "exclude";
export const HERO_PICKS: readonly HeroPick[] = ["must", "neutral", "exclude"];
export type HeroPicks = Record<number, HeroPick>;

export const solverHeroesKey = (save: string): string => `solver-heroes:${save}`;

const isPick = (v: unknown): v is HeroPick => typeof v === "string" && (HERO_PICKS as readonly string[]).includes(v);

/** Stored states (JSON text, or null when none), only those of heroes this save has; null when none are stored. */
export function readHeroPicks(text: string | null, ids: readonly number[]): HeroPicks | null {
  if (!text) return null;
  try {
    const p = JSON.parse(text);
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const known = new Set(ids);
    return Object.fromEntries(Object.entries(p).filter(([id, v]) => known.has(Number(id)) && isPick(v)).map(([id, v]) => [Number(id), v])) as HeroPicks;
  } catch {
    return null;
  }
}

/**
 * The old locks of a stored party (`battle-party:<save>` JSON: slot key -> save hero index, `locked` slot keys) as
 * Must include states, by save hero id (`ids`: the save's hero ids in save order). Empty when none.
 */
export function picksFromOldLocks(partyText: string | null, ids: readonly number[]): HeroPicks {
  const out: HeroPicks = {};
  if (!partyText) return out;
  try {
    const p = JSON.parse(partyText);
    for (const [k, on] of Object.entries(p?.locked ?? {})) {
      const idx = p?.slots?.[k];
      if (on === true && typeof idx === "number" && idx >= 0 && idx < ids.length) out[ids[idx]] = "must";
    }
  } catch { /* broken: nothing to migrate */ }
  return out;
}

/**
 * Once per save, on either battle page (before the Simulator rewrites its party without `locked`): with no states
 * stored yet, the old locks become Must include and are stored. Storage blocked or broken: nothing happens.
 */
export function migrateOldLocks(store: Pick<Storage, "getItem" | "setItem">, save: string, ids: readonly number[]): void {
  try {
    if (store.getItem(solverHeroesKey(save)) !== null) return;
    const picks = picksFromOldLocks(store.getItem(`battle-party:${save}`), ids);
    if (Object.keys(picks).length) store.setItem(solverHeroesKey(save), JSON.stringify(picks));
  } catch { /* storage blocked */ }
}

/** A hero's state: its stored one, else Exclude for a hidden class, else Neutral. */
export const heroPick = (picks: HeroPicks, id: number, hidden = false): HeroPick => picks[id] ?? (hidden ? "exclude" : "neutral");

export interface SolverHero {
  id: number;
  name: string;
  /** Its class is hidden (an expansion the visitor doesn't own): Exclude unless set otherwise. */
  hidden?: boolean;
}

/**
 * The solve's heroes: `pool` (every hero not excluded) and `must` (in every result party), or the one error that
 * keeps the solve from running: more must-include heroes than the opponent takes (`questMax`) or than the largest
 * party size asked (`maxSize`).
 */
export function solverPick(heroes: readonly SolverHero[], picks: HeroPicks, maxSize: number, questMax: number):
  { pool: number[]; must: number[] } | { error: string } {
  const state = (h: SolverHero) => heroPick(picks, h.id, h.hidden);
  const must = heroes.filter((h) => state(h) === "must").map((h) => h.id);
  const pool = heroes.filter((h) => state(h) !== "exclude").map((h) => h.id);
  const n = must.length;
  if (n > questMax) return { error: `${n} heroes must be included: this opponent takes at most ${questMax}.` };
  if (n > maxSize) return { error: `${n} heroes must be included: raise the largest party size to ${n}.` };
  return { pool, must };
}

/** The summary of the table's fold: "Heroes · 2 in · 3 out" (counts left out when 0). */
export function picksSummary(heroes: readonly SolverHero[], picks: HeroPicks): string {
  const n = (p: HeroPick) => heroes.filter((h) => heroPick(picks, h.id, h.hidden) === p).length;
  const must = n("must"), out = n("exclude");
  return ["Heroes", ...(must ? [`${must} must`] : []), ...(out ? [`${out} out`] : [])].join(" · ");
}
