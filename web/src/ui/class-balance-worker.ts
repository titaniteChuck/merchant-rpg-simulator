/**
 * Web worker for the class balance page (site/class-balance.html): runs classMatrix (web/src/tools/classes.ts) off the
 * main thread. With searched rotations and no reference quest chosen, a quick pre-pass (default rotations, a few
 * fights per cell) finds the toughest quest at least one class can win, and each class's rotation is searched there.
 * Progress ~10 times per second; the page cancels by terminating the worker.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { classMatrix, type ClassMatrixRow, type GearPolicy } from "../tools/classes.ts";
import { Sim } from "../tools/engine.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface ClassesRequest {
  quests: number[];
  level: number;
  prestige: number;
  gearPolicy: GearPolicy;
  skills: "default" | "search";
  /** Rotation search quest: a quest id, "each" (one search per quest), or "auto" (toughest quest won by a class). */
  searchQuest: number | "each" | "auto";
  /** Fights per cell, and per candidate / finalist of the rotation search. */
  n: number;
  searchN: number;
  searchNFinal: number;
}

export type ClassesResponse =
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "done"; rows: ClassMatrixRow[]; searchQuest: number | "each" | null; ms: number }
  | { type: "error"; error: string };

let loaded: Promise<void> | null = null;
function loadData(): Promise<void> {
  loaded ??= fetch(new URL("../data/gamedata.json", self.location.href)).then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return loaded;
}

/** Enemy HP x (atk + matk): how tough a quest is, as classes.ts ranks them. */
const threat = (q: number) => {
  const d = G.questData[q];
  return (d.enemyHp || 0) * ((d.enemyAtk || 0) + (d.enemyMatk || 0));
};

export async function runClasses(req: ClassesRequest, post: (m: ClassesResponse) => void): Promise<void> {
  try {
    await loadData();
    const t0 = performance.now();
    const sim = new Sim("Standard");
    let last = 0;
    const progress = (stage: string) => (done: number, total: number) => {
      const now = performance.now();
      if (done === 0 || done === total || now - last > 100) {
        last = now;
        post({ type: "progress", done, total, stage });
      }
    };
    const base = { quests: req.quests, level: req.level, prestige: req.prestige, gearPolicy: req.gearPolicy };
    let searchQuest: number | "each" | null = null;
    if (req.skills === "search") {
      if (req.searchQuest === "auto") {
        // Pre-pass: which quests does at least one class win with the default rotation?
        const pre = classMatrix(sim, { ...base, skills: "default", n: Math.min(10, req.n), onProgress: progress("finding the reference quest") });
        const won = new Set(pre.filter((r) => r.win > 0).map((r) => r.quest));
        const order = [...req.quests].sort((a, b) => threat(b) - threat(a));
        searchQuest = order.find((q) => won.has(q)) ?? order.at(-1)!;
      } else searchQuest = req.searchQuest;
    }
    const rows = classMatrix(sim, {
      ...base, skills: req.skills, n: req.n, searchN: req.searchN, searchNFinal: req.searchNFinal,
      ...(searchQuest !== null ? { searchQuest } : {}),
      onProgress: progress(req.skills === "search" ? "searching rotations and fighting" : "fighting"),
    });
    post({ type: "done", rows, searchQuest, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

// Worker entry (skipped when imported in Node tests).
const ctx = globalThis as Any;
if (typeof ctx.WorkerGlobalScope !== "undefined" && ctx instanceof ctx.WorkerGlobalScope) {
  ctx.onmessage = (e: MessageEvent<ClassesRequest>) => runClasses(e.data, (m) => ctx.postMessage(m));
}
