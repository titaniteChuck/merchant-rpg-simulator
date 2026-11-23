/** obj.combat.statsService */
// deno-lint-ignore no-explicit-any
type Any = any;

const pctStats = ["atkPct", "matkPct", "defPct", "mdefPct", "accPct", "hpPct", "evaPct"];
const pctEffect = ["atk", "matk", "def", "mdef", "acc", "maxHP", "eva"];
const pctMinValue = [-0.9, -0.9, -1, -1, -1, -0.9, -1];

export function calculatePercentStats(target: Any): void {
  for (let n = 0; n < pctStats.length; n++) {
    const key = pctStats[n];
    const v = target[key];
    if (v !== undefined && v !== null && v !== false && v !== 0) {
      target[pctEffect[n]] = target[pctEffect[n]] * (1 + Math.max(pctMinValue[n], v));
    }
  }
}

export function calculateReduction(def: number, penetration?: number): number {
  if (penetration && penetration > 0) def = def * 0.01 * (100 - penetration);
  if (def < 0) def = 0;
  return 100 / (100 + def);
}
