/**
 * Exact drop chances of one win against an enemy (U21), by battle grade, from obj.combat.lootService:
 *
 * - "Every win" rewards (`rewardX1/2` = { materialId, min, max }): quantity = clamp(round((math.random(min × gb × 10,
 *   max × gb × 10) + partyLuck) / 10), 0, 5), gb = gradeBonus[grade] (D..S: 0.6, 0.75, 1, 1.25, 1.5). A quantity of 0
 *   gives nothing (only rewards with min 0 can roll it).
 * - Loot rolls (`rewardX3/4` = a parcel name): one Utilities.weightedRandom over { [0] = nothing, [n] = item n }, with
 *   odds[0] = max(nilOdds × gradeParcelBonus[grade] − partyLuck, 1) (D..S: ×1.25, ×1.1, ×1, ×0.9, ×0.75) and
 *   odds[n] = item odds × enemyAmount. Materials with several amounts roll their amount the same way.
 *
 * weightedRandom draws threshold = math.random(0, total) (total + 1 equally likely integers) and walks the table in
 * pairs() order, taking the first choice whose running total reaches the threshold: the first choice in that order
 * also wins threshold 0, so it gets one extra chance in (total + 1). Computed exactly here with the engine's Lua 5.1
 * table emulation (sim/lua-table.ts) for the pairs() order. Party luck 0 and one enemy (a map room) unless given.
 */
import { G } from "../sim/data.ts";
import { clamp, round, seq } from "../sim/lua.ts";
import { LuaTable } from "../sim/lua-table.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** Battle grades 1..5 = D, C, B, A, S (B is the base: ×1 on both tables). */
export const LOOT_GRADES = [1, 2, 3, 4, 5] as const;
export const BASE_GRADE = 3;

/** Probability of each choice of Utilities.weightedRandom over `t` (keys in pairs() order). */
export function weightedOdds(t: LuaTable): Map<number | string, number> {
  const entries = t.entries() as [number | string, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const top = Math.trunc(total); // math.random(0, total): integers 0..top
  const upTo = (c: number) => (c < 0 ? 0 : Math.min(Math.floor(c), top) + 1); // thresholds t ≤ c
  const out = new Map<number | string, number>();
  let cum = 0, taken = 0;
  for (const [k, w] of entries) {
    cum += w;
    const n = upTo(cum) - taken;
    taken += n;
    out.set(k, (out.get(k) ?? 0) + n / (top + 1));
  }
  return out;
}

/**
 * Amount → probability of one "every win" reward { id, min, max } at a grade (quantity 0 = nothing). U60: `enemyAmount`
 * (the quest size ×N) multiplies the rolled quantity, after the clamp to 5 (lootService.generateNormalItem).
 */
export function fixedAmounts(reward: number[], grade: number, luck = 0, enemyAmount = 1): Map<number, number> {
  const gb = G.gradeBonus[grade];
  const lo = Math.trunc(reward[1] * gb * 10), hi = Math.trunc(reward[2] * gb * 10); // math.random truncates
  const out = new Map<number, number>();
  for (let x = lo; x <= hi; x++) {
    const q = clamp(round((x + luck) / 10), 0, 5) * enemyAmount;
    out.set(q, (out.get(q) ?? 0) + 1 / (hi - lo + 1));
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** One row of a loot roll: the item, its amount odds (amount → probability, for one enemy) and its chance per grade. */
export interface LootRow {
  type: string;
  id: number;
  amounts: Map<number, number>;
  /** Chance of this item, in %, at grade D..S (index 0..4). */
  chance: number[];
}
export interface LootTable { name: string; nothing: number[]; rows: LootRow[] }

/** A parcel's chances at every grade: the "nothing" share and each item, in % (they add up to 100 per grade). */
export function lootTable(name: string, luck = 0, enemyAmount = 1): LootTable | null {
  const p = name ? G.parcelData?.[name] : null;
  if (!p) return null;
  const list = seq<Any>(p.itemList ?? {});
  const nothing: number[] = [];
  const rows: LootRow[] = list.map((e) => {
    const ids = seq<Any>(e.id ?? {});
    const amt = seq<number>(e.amount ?? {});
    let amounts: Map<number, number>;
    if (ids.length > 1) amounts = new Map([[1, 1]]); // { type, id }: one item
    else if (amt.length > 1) {
      const t = new LuaTable();
      for (let i = 0; i + 1 < amt.length; i += 2) t.set(amt[i], amt[i + 1]);
      const one = new Map([...weightedOdds(t)].map(([k, v]) => [Number(k), v] as [number, number]));
      // U60: at ×N the game rolls the amount N times and adds them up (lootService.generateParcelItem)
      amounts = one;
      for (let n = 1; n < enemyAmount; n++) amounts = sumOdds(amounts, one);
      amounts = new Map([...amounts].sort((a, b) => a[0] - b[0]));
    } else amounts = new Map([[(amt[0] ?? 1) * enemyAmount, 1]]);
    return { type: ids.length > 1 ? String(ids[0]) : "material", id: Number(ids.length > 1 ? ids[1] : ids[0]), amounts, chance: [] };
  });
  for (const g of LOOT_GRADES) {
    const t = new LuaTable();
    t.set(0, Math.max((p.nilOdds ?? 0) * G.gradeParcelBonus[g] - luck, 1));
    list.forEach((e, i) => t.set(i + 1, (e.odds ?? 0) * enemyAmount));
    const odds = weightedOdds(t);
    nothing.push(100 * (odds.get(0) ?? 0));
    rows.forEach((r, i) => r.chance.push(100 * (odds.get(i + 1) ?? 0)));
  }
  return { name, nothing, rows };
}

/** The odds of the sum of two independent amounts. */
function sumOdds(a: Map<number, number>, b: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [x, p] of a) for (const [y, q] of b) out.set(x + y, (out.get(x + y) ?? 0) + p * q);
  return out;
}

/** "1", "1–3" from an amount → probability map. */
export function amountRange(a: Map<number, number>): string {
  const ks = [...a.keys()].filter((k) => (a.get(k) ?? 0) > 0);
  const lo = Math.min(...ks), hi = Math.max(...ks);
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

/** "1: 31% · 2: 50% · 3: 20%" (whole percents, for tooltips). */
export function amountOddsText(a: Map<number, number>): string {
  return [...a].filter(([, p]) => p > 0).map(([k, p]) => `${k === 0 ? "none" : k}: ${pctText(100 * p)}`).join(" · ");
}

/** A percentage with one decimal ("2.5%", "48.0%"), "100%" and "0%" whole, "<0.1%" for tiny non-zero shares. */
export function pctText(x: number): string {
  if (x > 0 && x < 0.05) return "<0.1%";
  if (x >= 99.95 || x === 0) return `${Math.round(x)}%`;
  return `${x.toFixed(1)}%`;
}
