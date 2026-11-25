/**
 * Review F12: the compact form of the profit page's precomputed answer (data/profit-default.json). The full answer
 * (profit-worker.ts profitResponse) repeats every key on each of its ~6,700 rows; here each table is stored by
 * column, lossless:
 * - `cols`: the key names once; `rows`: one array of values per row, in `cols` order.
 * - A string column keeps its distinct values once (`dicts[c]`) and each row holds an index into them.
 * - A column mostly equal to an earlier one (`ev_profit` = `profit` when an item rolls no modifier) holds null for
 *   "same as column `same[c]`" (only for a column that has no null of its own).
 * - Values the page derives exactly are left out and computed again on expand (`p_any` from the three chances).
 * - The cost breakdowns (an object keyed "type|id|asc") become a table too; an optional field missing is a null, and
 *   each one's parts are one flat list of numbers (the part's type as an index into `partTypes`).
 * expandProfit(compactProfit(x)) deep-equals x (test/profit-compact.test.ts, on the real default answer).
 * Pure, Node and browser.
 */
import type { CostPart, ProfitResponse, Row } from "../ui/profit-worker.ts";

type Full = Extract<ProfitResponse, { ok: true }>;
type Cell = Row[string];
type Value = unknown;

export const COMPACT_VERSION = 1;

export interface Table {
  cols: string[];
  /** Per column: the distinct strings a row's index points into, or null (the values are stored as they are). */
  dicts: (string[] | null)[];
  /** Per column: the earlier column a null stands for, or null. */
  same: (number | null)[];
  rows: Value[][];
}

export interface CompactProfit {
  compact: typeof COMPACT_VERSION;
  ok: true;
  id: number;
  ms: number;
  items: Table;
  enchant: Table;
  essence: Table;
  orbs: Full["orbs"];
  costs: Table;
  /** The item types a cost's `parts` name: each part is stored flat as [type index, id, asc, amount]. */
  partTypes: string[];
}

/** Columns computed again on expand, per table: [column, from the row so far]. */
const DERIVED: Record<string, [string, (r: Row) => Cell][]> = {
  // profit-worker.ts profitResponse: chance of at least one modifier.
  items: [["p_any", (r) => Math.round((Number(r["p_prefix%"] ?? 0) + Number(r["p_suffix%"] ?? 0) - Number(r["p_both%"] ?? 0)) * 10) / 10]],
};

/** Stores `rows` (all with the same keys, in the same order) by column. */
export function toTable(rows: Record<string, Value>[], derived: [string, (r: Row) => Cell][] = []): Table {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  for (const r of rows) {
    const keys = Object.keys(r);
    if (keys.length !== cols.length || keys.some((k, i) => k !== cols[i])) throw new Error(`rows with different keys: ${keys.join(",")}`);
  }
  // A derived column is dropped only where computing it gives back exactly the stored value.
  const drop = new Set(derived.filter(([c, f]) => cols.includes(c) && rows.every((r) => Object.is(f(r as Row), r[c]))).map(([c]) => c));
  const kept = cols.filter((c) => !drop.has(c));
  const values = kept.map((c) => rows.map((r) => r[c]));
  const dicts = values.map((vals) => {
    const strings = vals.filter((v) => v !== null);
    if (!strings.length || !strings.every((v) => typeof v === "string")) return null;
    const distinct = [...new Set(strings as string[])];
    return distinct.length < strings.length ? distinct : null;
  });
  const same = values.map((vals, c) => {
    if (dicts[c] || vals.some((v) => v === null || typeof v === "object")) return null;
    let best: number | null = null, bestHits = 0;
    for (let b = 0; b < c; b++) {
      if (dicts[b]) continue;
      const hits = vals.reduce<number>((n, v, i) => n + (Object.is(v, values[b][i]) ? 1 : 0), 0);
      if (hits > bestHits) [best, bestHits] = [b, hits];
    }
    return bestHits >= vals.length / 5 ? best : null;
  });
  const index = dicts.map((d) => (d ? new Map(d.map((s, i) => [s, i])) : null));
  const out = rows.map((_, i) => values.map((vals, c) => {
    const v = vals[i];
    if (index[c]) return v === null ? null : index[c]!.get(v as string);
    const b = same[c];
    return b !== null && Object.is(v, values[b][i]) ? null : v;
  }));
  return { cols: kept, dicts, same, rows: out };
}

/** The rows of a table, with the `derived` columns put back at the end. */
export function fromTable(t: Table, derived: [string, (r: Row) => Cell][] = []): Record<string, Value>[] {
  return t.rows.map((vals) => {
    const r: Record<string, Value> = {};
    const plain: Value[] = [];
    t.cols.forEach((c, i) => {
      const v = vals[i];
      const d = t.dicts[i], b = t.same[i];
      plain[i] = d ? (v === null ? null : d[v as number]) : b !== null && v === null ? plain[b] : v;
      r[c] = plain[i];
    });
    for (const [c, f] of derived) if (!(c in r)) r[c] = f(r as Row);
    return r;
  });
}

const COST_COLS = ["type", "id", "asc", "cost", "how", "ref", "gold", "parts"] as const;

/** The compact form of a profit answer (written by export-profit-default.ts). */
export function compactProfit(full: Full): CompactProfit {
  const partTypes: string[] = [];
  const typeIndex = (t: string) => (partTypes.includes(t) ? partTypes.indexOf(t) : partTypes.push(t) - 1);
  const costRows = Object.entries(full.costs).map(([key, e]) => {
    const [type, id, asc] = key.split("|");
    if (`${type}|${Number(id)}|${Number(asc)}` !== key) throw new Error(`cost key ${key}`);
    const extra = Object.keys(e).filter((k) => !(COST_COLS as readonly string[]).includes(k));
    if (extra.length || e.gold === null || e.parts === null) throw new Error(`cost ${key}: unexpected fields`);
    return { type, id: Number(id), asc: Number(asc), cost: e.cost, how: e.how, ref: e.ref, gold: e.gold ?? null,
      parts: e.parts ? e.parts.flatMap(([t, i, a, n]) => [typeIndex(t), i, a, n]) : null };
  });
  return {
    compact: COMPACT_VERSION, ok: true, id: full.id, ms: full.ms,
    items: toTable(full.items, DERIVED.items), enchant: toTable(full.enchant), essence: toTable(full.essence),
    orbs: full.orbs, costs: toTable(costRows), partTypes,
  };
}

/** The full answer back from its compact form; throws on anything else (the page then solves in the worker). */
export function expandProfit(c: CompactProfit): Full {
  if (c?.compact !== COMPACT_VERSION) throw new Error("not a compact profit answer of this version");
  const costs: Record<string, CostPart> = {};
  for (const r of fromTable(c.costs)) {
    const e: CostPart = { cost: r.cost as number, how: r.how as string, ref: r.ref as number | null };
    if (r.gold !== null) e.gold = r.gold as number;
    if (r.parts !== null) {
      const flat = r.parts as number[];
      e.parts = [];
      for (let i = 0; i < flat.length; i += 4) e.parts.push([c.partTypes[flat[i]], flat[i + 1], flat[i + 2], flat[i + 3]]);
    }
    costs[`${r.type}|${r.id}|${r.asc}`] = e;
  }
  return {
    ok: true, id: c.id, ms: c.ms,
    items: fromTable(c.items, DERIVED.items) as Row[], enchant: fromTable(c.enchant) as Row[], essence: fromTable(c.essence) as Row[],
    orbs: c.orbs, costs,
  };
}
