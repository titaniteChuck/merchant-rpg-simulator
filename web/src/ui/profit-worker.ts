/**
 * Web worker for the profit page: solves the economy with profitReport (web/src/tools/profit.ts) off the
 * main thread (3-5 s), and sends back the tables as plain rows (numbers, strings, null).
 */
import { loadGameData } from "../sim/data.ts";
import { type Game, gameFromData } from "../tools/gamedata.ts";
import { profitReport, PyFloat, type Row as ProfitRow } from "../tools/profit.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface ProfitRequest {
  /** Echoed back, so the page can drop answers to settings it no longer shows. */
  id: number;
  grade: number;
  luck: number;
  crafterLevel: number;
  enchanterLevel: number;
  mapMods: boolean;
  alloc: "value" | "full";
  /** Forced orb sources: [essence id, map id, map ascension]. */
  essenceFrom: [number, number, number][];
}

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

/** An orb (essence): what it ascends, its cheapest source and that source's cost per orb. */
export interface Orb {
  id: number;
  name: string;
  /** Ascension level it is used for (1 or 2). */
  tier: number;
  /** 0-based level band of the items it ascends (0 = levels 1-10 … 5 = 51-60). */
  region: number;
  cost: number | null;
  mapId: number | null;
  mapAsc: number | null;
  label: string;
  perRun: number | null;
}

export type ProfitResponse =
  | { ok: true; id: number; ms: number; items: Row[]; enchant: Row[]; essence: Row[]; orbs: Orb[] }
  | { ok: false; id: number; error: string };

let game: Promise<Game> | null = null;
function loadGame(): Promise<Game> {
  game ??= fetch(new URL("../data/gamedata.json", self.location.href)).then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => {
    loadGameData(json);
    return gameFromData();
  });
  return game;
}

/** Plain cells: PyFloat -> number, "" (no value) -> null. */
function plain(rows: ProfitRow[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = v instanceof PyFloat ? v.v : v === "" ? null : v;
    return out;
  });
}

/** Max level of the game: level-70 items and maps (Hard / Weekly Boss Rush) are left out. */
export const MAX_LEVEL = 60;
const inLevel = (level: Cell) => level === null || Number(level) <= MAX_LEVEL;

const nameIndex = new Map<string, Map<string, number>>();
/** Id of a quest (by `nameB || name`, as the engine names it), material or map, from its English name. */
function idByName(g: Game, kind: "quest" | "material" | "map", name: string): number | null {
  if (!nameIndex.has(kind)) {
    const m = new Map<string, number>();
    const src: Map<number, Any> = kind === "quest" ? g.quests : g.items[kind];
    for (const [id, x] of src) {
      const n = kind === "quest" ? x.nameB || x.name : x.name;
      if (n && !m.has(n)) m.set(n, id);
    }
    nameIndex.set(kind, m);
  }
  return nameIndex.get(kind)!.get(name) ?? null;
}

/** The id the "how" text names (crafter, orb, quest or map), so the page can name it in the visitor's language. */
function howId(g: Game, r: Row): number | null {
  const how = String(r.how ?? "");
  let m: RegExpExecArray | null;
  if (how.startsWith("craft")) return g.item(String(r.type), Number(r.id))?.crafterID ?? null;
  if ((m = /^ascend asc\d item \(\+\d+x (.+)\)$/.exec(how))) return idByName(g, "material", m[1]);
  if ((m = /^quest (.+?)(?: \[rare\])? \([\d.]+g, /.exec(how))) return idByName(g, "quest", m[1]);
  if ((m = /^map loot (.+) \(valued at sell price\)$/.exec(how))) return idByName(g, "map", m[1]);
  return null;
}

export async function runProfit(req: ProfitRequest): Promise<ProfitResponse> {
  try {
    const g = await loadGame();
    const t0 = performance.now();
    const rep = profitReport(g, {
      grade: req.grade, luck: req.luck, crafterLevel: req.crafterLevel, enchanterLevel: req.enchanterLevel,
      mapMods: req.mapMods, alloc: req.alloc, essenceFrom: new Map(req.essenceFrom.map(([e, m, p]) => [e, [m, p]])),
    });
    const items = plain(rep.rows).filter((r) => inLevel(r.level));
    for (const r of items) {
      r.how_id = howId(g, r);
      // chance of at least one modifier
      const pp = Number(r["p_prefix%"] ?? 0), ps = Number(r["p_suffix%"] ?? 0), pb = Number(r["p_both%"] ?? 0);
      r.p_any = Math.round((pp + ps - pb) * 10) / 10;
    }
    const essence = plain(rep.essence).filter((r) => (g.items.map.get(Number(r.map_id))?.itemLevel ?? 1) <= MAX_LEVEL);
    const s = rep.solver;
    const orbs: Orb[] = [];
    for (const [tier, ids] of g.prestigeItemId) {
      ids.forEach((eid, region) => {
        const chosen = essence.find((r) => r.essence_id === eid && r.chosen === "yes");
        const cost = s.cost.get(`material|${eid}|0`);
        orbs.push({
          id: eid, name: g.name("material", eid), tier, region,
          cost: cost === undefined || !Number.isFinite(cost) ? null : cost,
          mapId: chosen ? Number(chosen.map_id) : null, mapAsc: chosen ? Number(chosen.map_asc) : null,
          label: chosen ? String(chosen.enchant) : "", perRun: chosen ? Number(chosen.essence_per_run) : null,
        });
      });
    }
    return { ok: true, id: req.id, ms: performance.now() - t0, items, enchant: plain(rep.enchant).filter((r) => inLevel(r.level)), essence, orbs };
  } catch (e) {
    return { ok: false, id: req.id, error: e instanceof Error ? e.message : String(e) };
  }
}

// Worker entry (skipped when imported in Node tests).
const ctx = globalThis as Any;
if (typeof ctx.WorkerGlobalScope !== "undefined" && ctx instanceof ctx.WorkerGlobalScope) {
  ctx.onmessage = async (e: MessageEvent<ProfitRequest>) => ctx.postMessage(await runProfit(e.data));
}
