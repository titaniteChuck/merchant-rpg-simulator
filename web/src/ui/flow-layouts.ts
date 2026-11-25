/**
 * U58: the Flow layouts the battle pages' tabs offer (Party · Flow 1 · Flow 2 · Flow 3), to compare them side by side.
 * Each layout lives in its own file and draws one traced fight from the same inputs, Flow 1's (timeline.ts partyPlan):
 * the enemy (quest id, rare), the party's members in action order, the traced fight (null: the rotation as planned)
 * and the edit callbacks (undefined on the Solver: read-only). It returns the diagram, or null when the enemy has no
 * timeline. Adding a layout: one entry here and one tab button in site/battle.html and site/solver.html.
 */
import type { PlanMember, TracedFight } from "./battle-plan.ts";
import { partyPlan, type PlanEdit, planNote } from "./timeline.ts";
import { flow2Note, renderFlow2 } from "./flow2.ts";
import { renderFlow3 } from "./flow3.ts";

/** A Flow layout's entry point: Flow 1's signature. */
export type FlowRender = (quest: { id: number; rare: boolean }, members: PlanMember[], trace?: TracedFight | null, edit?: PlanEdit) => HTMLElement | null;

export type FlowId = "flow1" | "flow2" | "flow3";
/** The battle pages' view tabs: the party, or a Flow layout. */
export type ViewTab = "party" | FlowId;

export interface FlowLayout {
  id: FlowId;
  /** The tab's text. */
  label: string;
  render: FlowRender;
  /** Its "?" (after the note on the run shown); `editable`: the Simulator (▾ and pickers), not the Solver. */
  help(quest: { id: number; rare: boolean }, editable: boolean): string;
}

export const FLOW_LAYOUTS: readonly FlowLayout[] = [
  { id: "flow1", label: "Flow 1", render: partyPlan, help: (q) => planNote(q) },
  { id: "flow2", label: "Flow 2", render: renderFlow2, help: (_q, editable) => flow2Note(editable) },
  { id: "flow3", label: "Flow 3", render: renderFlow3, help: () => "Flow 3: one card per action, in order; ▾ opens a calculation." },
];

export const isFlow = (t: string | null | undefined): t is FlowId => FLOW_LAYOUTS.some((l) => l.id === t);
/** The layout of a tab id (Flow 1 for anything else). */
export const flowLayout = (id: string | null | undefined): FlowLayout => FLOW_LAYOUTS.find((l) => l.id === id) ?? FLOW_LAYOUTS[0];
/** A remembered tab, read back: Party, a Flow layout; the old "flow" (before U58) is Flow 1; anything else Party. */
export const parseTab = (v: string | null | undefined): ViewTab => (v === "flow" ? "flow1" : isFlow(v) ? v : "party");
