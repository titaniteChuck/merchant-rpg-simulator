/**
 * U58: Flow 3's placeholder. U59 writes the real layout in this file (same name, same signature as Flow 1's
 * timeline.ts partyPlan, see flow-layouts.ts FlowRender); until then the tab says "Coming soon".
 */
import { el } from "./dom.ts";
import type { PlanMember, TracedFight } from "./battle-plan.ts";
import type { PlanEdit } from "./timeline.ts";

export function renderFlow3(quest: { id: number; rare: boolean }, members: PlanMember[], trace: TracedFight | null = null, edit?: PlanEdit): HTMLElement | null {
  void [quest, members, trace, edit];
  return el("p", { class: "muted flow-soon" }, "Coming soon");
}
