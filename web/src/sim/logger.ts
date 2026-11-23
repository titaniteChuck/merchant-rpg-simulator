/**
 * obj.combat.CombatantLogger: writes the in-game combat log only (no effect on the fight).
 * Every method is a no-op; skill code may call any logger method.
 */
// deno-lint-ignore no-explicit-any
export const noopLogger: any = new Proxy({}, { get: () => () => undefined });
