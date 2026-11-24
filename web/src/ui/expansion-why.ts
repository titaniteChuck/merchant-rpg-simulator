/**
 * Why the site thinks the visitor doesn't own an expansion (R1 F31), for the pages of hidden content: the switch was
 * set by hand, the save was read and shows no sign of it, or no save is loaded. Each source gets its own words (the
 * hidden page used to say "as far as your save shows" even when the visitor had set the switch by hand).
 */
import { type Expansion, inferredState, overrideOf, owns } from "./expansion-state.ts";

export type NotOwnedSource = "hand" | "save" | "no-save";

/** Where "not owned" comes from for one expansion. */
export function notOwnedSource(x: Expansion): NotOwnedSource {
  if (overrideOf(x) === false) return "hand";
  return inferredState().source !== null ? "save" : "no-save";
}

const WORDS: Record<NotOwnedSource, string> = {
  hand: "you set it to not owned",
  save: "your save shows no sign of it",
  "no-save": "no save loaded",
};

/**
 * The words in brackets after "which you don't own": "(you set it to not owned)", "(your save shows no sign of it)",
 * "(no save loaded)"; one per source when two expansions differ. "" when every one is owned.
 */
export function notOwnedWhy(needs: readonly Expansion[]): string {
  const sources = [...new Set(needs.filter((x) => !owns(x)).map(notOwnedSource))];
  return sources.length ? `(${sources.map((s) => WORDS[s]).join("; ")})` : "";
}
