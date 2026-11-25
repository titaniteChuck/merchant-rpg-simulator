/**
 * The battle page's party edits (U39), shared by its two views: the Party tab (hero cards) and the Flow tab (the
 * 10-turn flow diagram). Both change the one party state through these functions, so an edit in either view is the
 * same edit; the page then saves the state, redraws both views and simulates again. Pure (no DOM): Node tests check it.
 */

export interface SkillChoice {
  attackList: string[];
  passive?: string;
}

/** The page's party: hero (save index) per slot key ("front0" … "back2"), edited rotations by save index, locks, left-outs. */
export interface PartyState {
  slots: Record<string, number | null>;
  skills: Record<number, SkillChoice>;
  locked: Record<string, boolean>;
  excluded: Record<string, boolean>;
}

/** The slot key of a party location (back 1 = 1, front 1 = 2, back 2 = 3 …). */
export const slotKeyOfLoc = (loc: number): string => (loc % 2 ? `back${(loc - 1) / 2}` : `front${loc / 2 - 1}`);

/**
 * Put a hero (save index, null = empty the slot) in a slot. A hero stands in one slot only: it leaves any other.
 * The slot's hero fights (its left-out tick is cleared). `picks` (the modes that choose the party): picking a hero by
 * hand locks it; emptying a slot unlocks it.
 */
export function assignHero(s: PartyState, key: string, idx: number | null, picks = false): void {
  if (idx !== null) {
    for (const k of Object.keys(s.slots)) {
      if (s.slots[k] === idx && k !== key) {
        s.slots[k] = null;
        delete s.locked[k];
        delete s.excluded[k];
      }
    }
  }
  s.slots[key] = idx;
  delete s.excluded[key];
  if (idx === null) delete s.locked[key];
  else if (picks) s.locked[key] = true;
}

/**
 * Set slot k (0-4) of a hero's rotation. `current`: the rotation and passive it plays now (its edited one, else its
 * save's), kept for the other slots.
 */
export function setRotationSkill(s: PartyState, idx: number, k: number, skill: string, current: SkillChoice): void {
  const attackList = [...current.attackList];
  while (attackList.length < 5) attackList.push("Basic");
  attackList[k] = skill;
  s.skills[idx] = { attackList, ...(current.passive !== undefined ? { passive: current.passive } : {}) };
}

/** U40: a hero's action-point budget: what each skill costs it (Basic is free), and its limit. */
export interface ApBudget {
  cost(skill: string): number;
  max: number;
}
/** The action points a rotation uses. */
export const apUsed = (attackList: string[], b: ApBudget): number =>
  attackList.reduce((a, s) => a + (s && s !== "Basic" ? b.cost(s) || 0 : 0), 0);

/**
 * U40: set slot k of a hero's rotation, unless that puts it over its AP limit (the game would then play its default
 * rotation): refused, the state unchanged. An edit that lowers the AP of a rotation already over (an old saved party)
 * is allowed, so it can be brought back under. Both views go through it.
 */
export function editRotationSkill(s: PartyState, idx: number, k: number, skill: string, current: SkillChoice, b: ApBudget):
  { ok: boolean; used: number; max: number } {
  const next = [...current.attackList];
  while (next.length < 5) next.push("Basic");
  next[k] = skill;
  const used = apUsed(next, b);
  if (used > b.max && used > apUsed(current.attackList, b)) return { ok: false, used, max: b.max };
  setRotationSkill(s, idx, k, skill, current);
  return { ok: true, used, max: b.max };
}

/**
 * U40: put a hero in a slot unless its rotation (its edited one) is over its AP limit: refused, the state unchanged.
 * `over`: the hero's AP use and limit when over, else null.
 */
export function assignHeroChecked(s: PartyState, key: string, idx: number | null, picks: boolean, over: { used: number; max: number } | null):
  { ok: boolean; used?: number; max?: number } {
  if (idx !== null && over) return { ok: false, ...over };
  assignHero(s, key, idx, picks);
  return { ok: true };
}

/** U40: the AP refusal's words ("Paladin: 23 / 20 AP. Change refused."). */
export const apRefusal = (name: string, used: number, max: number): string => `${name}: ${used} / ${max} AP. Change refused.`;

// ---------------------------------------------------------------- U48: drag and drop, read-only views
/** U48: the slot rules a move must keep: the slots never emptied (Front 2 on a party quest), a solo quest. */
export interface MoveRules {
  required: string[];
  solo?: boolean;
}
export type MoveResult = { ok: true; swapped: boolean } | { ok: false; reason: "same" | "empty" | "required" | "solo" };

/**
 * U48: a hero card dropped on another slot. On a filled slot the two heroes swap; on an empty one the hero moves there.
 * Each hero keeps its own lock and left-out tick (they follow it). Refused, the state unchanged: an empty slot as the
 * source, the slot itself as the target, a move that would empty a required slot, or a move out of Front 1 on a solo
 * quest. The party's size never changes, so its cap holds; which heroes the cap leaves out follows the slot order.
 */
export function moveHero(s: PartyState, from: string, to: string, r: MoveRules): MoveResult {
  const at = (k: string) => s.slots[k] ?? null;
  if (from === to) return { ok: false, reason: "same" };
  const a = at(from), b = at(to);
  if (a === null) return { ok: false, reason: "empty" };
  const swapped = b !== null;
  if (!swapped && r.required.includes(from)) return { ok: false, reason: "required" };
  if (!swapped && r.solo && !r.required.includes(to)) return { ok: false, reason: "solo" };
  s.slots[to] = a;
  s.slots[from] = b;
  for (const flags of [s.locked, s.excluded]) {
    const fa = flags[from], fb = flags[to];
    delete flags[from];
    delete flags[to];
    if (fa) flags[to] = true;
    if (fb && swapped) flags[from] = true;
  }
  return { ok: true, swapped };
}

/** U48: the words of a refused move (`slot`: the required slot, "Front 2"). */
export const moveRefusal = (reason: "required" | "solo", slot: string): string =>
  reason === "required" ? `${slot} can't be left empty on this quest.` : "Solo quest: one hero, in Front 1.";

/**
 * U48: what each page lets the visitor change. The Simulator edits its party (pickers, ⇄, include ticks, Clear all,
 * the flow's ▾ and its enemy picker) and moves cards by drag and drop. The Solver's party and flow are read-only (its
 * "Open in Simulator" hands the party over for editing); only its 🔒, an input of the next solve, stays.
 */
export interface PageControls {
  edit: boolean;
  drag: boolean;
  lock: boolean;
}
export const pageControls = (kind: "simulate" | "solve"): PageControls =>
  kind === "simulate" ? { edit: true, drag: true, lock: false } : { edit: false, drag: false, lock: true };
