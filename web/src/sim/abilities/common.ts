/** Shared by the skill files (top of data.AbilityFunc). */

// Skills get the acting combatant (Hero or Enemy) and its target (the Enemy, or the Party).
// Typed loosely so skill files do not depend on the class files' internals.
// deno-lint-ignore no-explicit-any
export type Combatant = any;
export type AbilityFn = (self: Combatant, target: Combatant) => unknown;

export const DMG_AOE = "aoe";
export const DMG_FRONT = "front";
export const DMG_BACK = "back";
export const DMG_MID = "mid";
export const DMG_MIDLINE = "midline";

/** ratioFromAttackResult: 1-based ratio [_, l1..l6] of party locations a Party attack actually hit. */
export function ratioFromAttackResult(result: unknown): number[] {
  const ratio = [0, 0, 0, 0, 0, 0, 0];
  if (!Array.isArray(result)) return ratio;
  for (const r of result) {
    if (!r.zeroRatio) ratio[r.partyLocation] = 1;
  }
  return ratio;
}
