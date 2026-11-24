/**
 * Party setup rules on the battle page (game 3.18), for the slots, Simulate, Clear all and the solver's Load. Thin
 * wrappers over the engine's rules (E21: partyRules / partyProblem in web/src/tools/combat.ts), so the page follows
 * exactly what evaluate and the searches enforce:
 * - party quests (questData.party): front 2 is always filled, at most questSize heroes (2-6; Desolation Wolf takes 3);
 * - solo quests: exactly one hero, in front 1;
 * - map runs: no required slot, up to 6.
 */
import { type MapTarget, partyProblem, partyRules, type PartyRules, type QuestTarget } from "../tools/combat.ts";
import type { MapSpec } from "../tools/engine.ts";

export type { PartyRules };
/** The opponent as the page holds it (battle.ts targetOf), or null while the opponent card isn't built. */
export type PageTarget = { quest?: { id: number; rare?: boolean }; map?: MapSpec };

const engineTarget = (t: PageTarget | null | undefined): QuestTarget | MapTarget | null =>
  t?.quest ? { quest: t.quest.id, rare: t.quest.rare } : t?.map ? { map: t.map } : null;

const FREE: PartyRules = { kind: "map", maxSize: 6, required: [] };

export function rulesOf(t: PageTarget | null | undefined): PartyRules {
  const e = engineTarget(t);
  return e ? partyRules(e) : FREE;
}

/** Why the game wouldn't start this layout (partyProblem's text), or null. `front` / `back`: non-null = a hero. */
export function problemOf(t: PageTarget | null | undefined, front: readonly unknown[], back: readonly unknown[]): string | null {
  const e = engineTarget(t);
  return e ? partyProblem(e, front, back) : null;
}

/** One line for the party block: what the opponent allows. */
export function rulesText(r: PartyRules): string {
  if (r.kind === "solo") return "Solo quest: one hero, in Front 1 only.";
  if (r.kind === "party") return `Party quest: Front 2 is always filled, and this quest takes at most ${r.maxSize} hero${r.maxSize === 1 ? "" : "es"}.`;
  return "";
}
