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
