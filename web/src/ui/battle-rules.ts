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
import { enemyName } from "./names.ts";

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

/**
 * Why the game wouldn't start this layout, or null. `front` / `back`: non-null = a hero. The engine (partyProblem)
 * decides; the words are the page's (R1 F24): written from partyRules' data with the enemy's name in the visitor's
 * language (names.ts), never a quest id. The engine's English text stays for logs and errors.
 */
export function problemOf(t: PageTarget | null | undefined, front: readonly unknown[], back: readonly unknown[]): string | null {
  const e = engineTarget(t);
  if (!e || !partyProblem(e, front, back)) return null;
  return problemText(t!, rulesOf(t), front, back);
}

/** The page's words for a party problem (see problemOf), from the rules and the layout. */
export function problemText(t: PageTarget, r: PartyRules, front: readonly unknown[], back: readonly unknown[]): string {
  const empty = (x: unknown) => x === null || x === undefined;
  const size = [...front, ...back].filter((x) => !empty(x)).length;
  const who = t.quest ? enemyName(t.quest.id, Boolean(t.quest.rare)) ?? "This quest" : "This map";
  if (size === 0) return "Put at least one hero in the party.";
  if (r.kind === "solo") return `${who} is a solo quest: one hero, in Front 1.`;
  if (size > r.maxSize) return `${who} takes at most ${r.maxSize} hero${r.maxSize === 1 ? "" : "es"}, not ${size}.`;
  const miss = r.required.find((s) => empty((s.row === "front" ? front : back)[s.i]));
  if (miss) return `Put a hero in ${miss.row === "front" ? "Front" : "Back"} ${miss.i + 1}: the game always fills it for ${who}.`;
  return `${who} can't start with this party.`;
}

/** One line for the party block: what the opponent allows. */
export function rulesText(r: PartyRules): string {
  if (r.kind === "solo") return "Solo quest: one hero, in Front 1.";
  if (r.kind === "party") return `Party quest: Front 2 always filled, at most ${r.maxSize} hero${r.maxSize === 1 ? "" : "es"}.`;
  return "";
}
