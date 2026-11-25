/**
 * U41: the Battle section's two pages, Simulator (battle.html) and Solver (solver.html), and what passes between them.
 * No DOM, so Node tests can check it.
 *
 * - solverRedirect(): the Simulator page's old links to its Solve mode (until U41 one page held both: a `mode` query,
 *   or a hash naming the solver) go to the Solver page.
 * - simulatorPartyFrom(): the Solver's "Open in Simulator": the party shown in the Solver replaces the Simulator's
 *   remembered party for this save; the Simulator's edited rotations of other heroes stay.
 */
import type { SkillChoice } from "./battle-worker.ts";

export const SIMULATOR_PAGE = "battle.html";
export const SOLVER_PAGE = "solver.html";

/** What a link to the old Solve mode said: Solve (U36), or its earlier names (Best party, the solver). */
const SOLVE_NAMES = new Set(["solve", "solver", "party", "best-party", "parties"]);

/**
 * The Solver page's address when the Simulator page was opened with a link to its old Solve mode (`?mode=solve`,
 * `?solve`, `#solve`, `#solver`, `#mode=solve` …), else null.
 */
export function solverRedirect(search: string, hash: string): string | null {
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const named = (v: string | null) => v !== null && SOLVE_NAMES.has(v.trim().toLowerCase());
  if (named(q.get("mode")) || q.has("solve") || q.has("solver")) return SOLVER_PAGE;
  const h = hash.replace(/^#\/?/, "");
  const hq = new URLSearchParams(h);
  if (named(h) || named(hq.get("mode"))) return SOLVER_PAGE;
  return null;
}

/**
 * A party as the battle pages remember it (localStorage `battle-party:<save>`). U50: no `locked` any more (an old one
 * becomes the Solver's Must include, solver-heroes.ts).
 */
export interface StoredParty {
  slots: Record<string, number | null>;
  skills: Record<number, SkillChoice>;
  excluded: Record<string, boolean>;
}

/**
 * The Simulator's party after "Open in Simulator": the Solver's slots, its heroes left out and its rotations; the
 * Simulator's own edited rotations of the other heroes kept.
 */
export function simulatorPartyFrom(solver: StoredParty, simulator: Partial<StoredParty> | null): StoredParty {
  return {
    slots: { ...solver.slots },
    skills: { ...(simulator?.skills ?? {}), ...solver.skills },
    excluded: { ...solver.excluded },
  };
}
