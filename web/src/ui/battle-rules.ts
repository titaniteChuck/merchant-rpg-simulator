/**
 * Party setup rules on the battle page (game 3.18), for the slots, Simulate, Clear all and the solver's Load:
 * - party quests (questData.party): front 2 is always filled (the game opens the party with the quest's hero there; it
 *   can be swapped, never emptied), at most questSize heroes (2-6; Desolation Wolf takes 3);
 * - solo quests: exactly one hero, in front 1;
 * - map runs: no required slot, up to 6.
 *
 * TODO(E21): the engine's E21 adds the same rules to web/src/tools/combat.ts (partyRules, requiredSlots,
 * partyProblem). Once it is on main, make rulesOf / problemOf thin wrappers over them (same results: the page then
 * follows the engine), and keep this module as the page's one entry point.
 */
import { G } from "../sim/data.ts";

export type SlotRef = { row: "front" | "back"; i: number };
export interface PartyRules {
  kind: "solo" | "party" | "map";
  maxSize: number;
  /** Slots that must hold a hero. */
  required: SlotRef[];
}
/** The opponent as the page holds it (battle.ts targetOf). */
export type PageTarget = { quest?: { id: number; rare?: boolean }; map?: unknown };

const FREE: PartyRules = { kind: "map", maxSize: 6, required: [] };

export function rulesOf(t: PageTarget | null | undefined): PartyRules {
  if (!t?.quest) return FREE;
  // deno-lint-ignore no-explicit-any
  const d: any = G.questData?.[t.quest.id];
  if (!d) return FREE;
  if (!d.party) return { kind: "solo", maxSize: 1, required: [{ row: "front", i: 0 }] };
  return { kind: "party", maxSize: Math.max(1, Math.min(6, Number(d.questSize) || 6)), required: [{ row: "front", i: 1 }] };
}

const slotName = (s: SlotRef) => `${s.row === "front" ? "Front" : "Back"} ${s.i + 1}`;

/** Why this layout can't fight the target (null: it can). `front` / `back`: anything non-null is a hero. */
export function problemOf(t: PageTarget | null | undefined, front: readonly unknown[], back: readonly unknown[]): string | null {
  const r = rulesOf(t);
  const n = [...front, ...back].filter((x) => x !== null && x !== undefined).length;
  if (r.kind === "solo") {
    if (n !== 1 || front[0] === null || front[0] === undefined) return "A solo quest takes exactly one hero, in Front 1.";
    return null;
  }
  const missing = r.required.filter((s) => (s.row === "front" ? front : back)[s.i] === null || (s.row === "front" ? front : back)[s.i] === undefined);
  if (missing.length) return `${missing.map(slotName).join(" and ")} must hold a hero: a party quest always fills it.`;
  if (n > r.maxSize) return `This quest takes at most ${r.maxSize} heroes (${n} in the party).`;
  return null;
}

/** One line for the party block: what the opponent allows. */
export function rulesText(r: PartyRules): string {
  if (r.kind === "solo") return "Solo quest: one hero, in Front 1 only.";
  if (r.kind === "party") return `Party quest: Front 2 is always filled, and this quest takes at most ${r.maxSize} hero${r.maxSize === 1 ? "" : "es"}.`;
  return "";
}
