/**
 * U58: the Flow layouts the battle pages' tabs offer, to compare them side by side. U63: Party · Flow 2 · Flow 3
 * (Flow 1, timeline.ts partyPlan, is gone; the labels stay as they were). Each layout lives in its own file and draws
 * one traced fight from the same inputs: the enemy (quest id, rare), the party's members in action order, the traced
 * fight (null: the rotation as planned, flow-planned.ts) and the edit callbacks (undefined on the Solver: read-only).
 * It returns the diagram, or null when the enemy has no timeline. Adding a layout: one entry here and one tab button
 * in site/battle.html and site/solver.html.
 */
import type { PlanMember, TracedFight } from "./battle-plan.ts";
import type { PlanEdit } from "./flow-parts.ts";
import { PLANNED_NOTE } from "./flow-planned.ts";
import { flow2Note, renderFlow2 } from "./flow2.ts";
import { renderFlow3 } from "./flow3.ts";

/** A Flow layout's entry point. */
export type FlowRender = (quest: { id: number; rare: boolean }, members: PlanMember[], trace?: TracedFight | null, edit?: PlanEdit) => HTMLElement | null;

export type FlowId = "flow2" | "flow3";
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
  { id: "flow2", label: "Flow 2", render: renderFlow2, help: (_q, editable) => flow2Note(editable) },
  { id: "flow3", label: "Flow 3", render: renderFlow3, help: () => `One card per action, in order; ▾ opens a calculation. ${PLANNED_NOTE}` },
];

export const isFlow = (t: string | null | undefined): t is FlowId => FLOW_LAYOUTS.some((l) => l.id === t);
/** The layout of a tab id (Flow 2 for anything else). */
export const flowLayout = (id: string | null | undefined): FlowLayout => FLOW_LAYOUTS.find((l) => l.id === id) ?? FLOW_LAYOUTS[0];
/**
 * A remembered tab, read back: Party or a Flow layout. The old "flow" (before U58) and "flow1" (Flow 1, removed in
 * U63) open Flow 2; anything else Party.
 */
export const parseTab = (v: string | null | undefined): ViewTab => (v === "flow" || v === "flow1" ? "flow2" : isFlow(v) ? v : "party");
