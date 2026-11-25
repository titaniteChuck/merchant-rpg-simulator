/**
 * Web worker for the farming planner (site/farming.html): runs farmingReport (web/src/tools/farming.ts) off the
 * main thread. The profit Solver that prices costs and essence takes a few seconds to solve, so it is solved once
 * per grade and kept for the next runs (the page keeps the worker between runs, F06). Progress is posted ~10 times per
 * second; the page cancels by terminating.
 */
import * as api from "../sim/api.ts";
import { type DataMessage, takeDataMessage, workerJson } from "./worker-data.ts";
import { type FarmRow, type FarmSource, farmingReport } from "../tools/farming.ts";
import { gameFromData } from "../tools/gamedata.ts";
import { Sim } from "../tools/engine.ts";
import { Solver } from "../tools/profit.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface FarmRequest {
  gameMode: string;
  /** Raw save heroes by slot (null = empty) and their edited rotations. */
  front: (Any | null)[];
  back: (Any | null)[];
  skills?: { front: ({ attackList: string[]; passive?: string } | null)[]; back: ({ attackList: string[]; passive?: string } | null)[] };
  sources: FarmSource[];
  /** Per source (F01): the slot keys that fight it ("front1"), or why the game wouldn't start it. Default: every hero. */
  fight?: (string[] | string)[];
  /** Fights per quest, runs per map. */
  n: number;
  mapRuns: number;
  /** Quest/map grade the Solver prices at (3 = neutral). */
  priceGrade?: number;
}

export type FarmResponse =
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "done"; rows: FarmRow[]; ms: number }
  | { type: "error"; error: string };

let loaded: Promise<void> | null = null;
function loadData(): Promise<void> {
  loaded ??= workerJson("gamedata.json", "game data").then((json) => api.loadGameData(json));
  return loaded;
}

const solvers = new Map<number, Solver>();

export async function runFarming(req: FarmRequest, post: (m: FarmResponse) => void): Promise<void> {
  try {
    await loadData();
    const t0 = performance.now();
    const grade = req.priceGrade ?? 3;
    if (!solvers.has(grade)) {
      post({ type: "progress", done: 0, total: 1, stage: "pricing items (once)" });
      solvers.set(grade, new Solver(gameFromData(), { grade }).solve());
    }
    const sim = new Sim(req.gameMode || "Standard");
    const build = (raws: (Any | null)[], skills?: ({ attackList: string[]; passive?: string } | null)[]) => raws.map((raw, i) => {
      if (!raw) return null;
      const h = sim.hero(raw);
      const s = skills?.[i];
      if (s) sim.setSkills(h, s.attackList, s.passive);
      return h;
    });
    const front = build(req.front, req.skills?.front), back = build(req.back, req.skills?.back);
    if (![...front, ...back].some(Boolean)) throw new Error("Put at least one hero in the party.");
    let last = 0;
    const only = (row: typeof front, name: string, keys: string[]) => row.map((h, i) => (keys.includes(`${name}${i}`) ? h : null));
    const partyFor = (_s: FarmSource, i: number) => {
      const f = req.fight?.[i];
      if (f === undefined) return { front, back };
      return typeof f === "string" ? f : { front: only(front, "front", f), back: only(back, "back", f) };
    };
    const rows = farmingReport(sim, { front, back }, req.sources, { n: req.n, mapRuns: req.mapRuns, solver: solvers.get(grade), partyFor }, {
      onProgress: (done, total, stage) => {
        const now = performance.now();
        if (done === 0 || done === total || now - last > 100) {
          last = now;
          post({ type: "progress", done, total, stage: stage === "farming" ? "simulating" : stage });
        }
      },
    });
    post({ type: "done", rows, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

// Worker entry (skipped when imported in Node tests).
const ctx = globalThis as Any;
if (typeof ctx.WorkerGlobalScope !== "undefined" && ctx instanceof ctx.WorkerGlobalScope) {
  ctx.onmessage = (e: MessageEvent<DataMessage | FarmRequest>) => {
    if (!takeDataMessage(e.data)) runFarming(e.data as FarmRequest, (m) => ctx.postMessage(m));
  };
}
