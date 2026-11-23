/**
 * Web worker for the levelling page (site/levelling.html): runs levellingPlan and prestigePayoff
 * (web/src/tools/levelling.ts) off the main thread. Both simulate many fights (every quest the hero may take, at
 * every level band), so progress is posted ~10 times per second and the page cancels by terminating the worker.
 */
import * as api from "../sim/api.ts";
import { type LevellingOptions, type LevellingPlan, levellingPlan, type PrestigePayoff, prestigePayoff } from "../tools/levelling.ts";
import { Sim } from "../tools/engine.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface LevelRequest {
  kind: "plan" | "prestige";
  gameMode: string;
  /** Raw save record of the hero to level, and of its companions (front row after the hero, then the back row). */
  hero: Any;
  /** Plan: `from` = start level (default the hero's own). */
  options: LevellingOptions & { from?: number };
  /** Prestige: the quest both tiers are compared on (solo, at each tier's max level). */
  refQuest?: number;
}

export type LevelResponse =
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "done"; kind: "plan"; plan: LevellingPlan; ms: number }
  | { type: "done"; kind: "prestige"; payoff: PrestigePayoff; ms: number }
  | { type: "error"; error: string };

let loaded: Promise<void> | null = null;
function loadData(): Promise<void> {
  loaded ??= fetch(new URL("../data/gamedata.json", self.location.href)).then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return loaded;
}

export async function runLevelling(req: LevelRequest, post: (m: LevelResponse) => void): Promise<void> {
  try {
    await loadData();
    const t0 = performance.now();
    const sim = new Sim(req.gameMode || "Standard");
    let last = 0;
    const ctl = {
      onProgress: (done: number, total: number, stage: string) => {
        const now = performance.now();
        if (done === 0 || done === total || now - last > 100) {
          last = now;
          post({ type: "progress", done, total, stage });
        }
      },
    };
    if (req.kind === "plan") {
      const plan = levellingPlan(sim, req.hero, req.options, ctl);
      post({ type: "done", kind: "plan", plan, ms: performance.now() - t0 });
    } else {
      if (req.refQuest === undefined) throw new Error("choose a quest to compare the tiers on");
      const payoff = prestigePayoff(sim, req.hero, { quest: req.refQuest }, req.options, ctl);
      post({ type: "done", kind: "prestige", payoff, ms: performance.now() - t0 });
    }
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

// Worker entry (skipped when imported in Node tests).
const ctx = globalThis as Any;
if (typeof ctx.WorkerGlobalScope !== "undefined" && ctx instanceof ctx.WorkerGlobalScope) {
  ctx.onmessage = (e: MessageEvent<LevelRequest>) => runLevelling(e.data, (m) => ctx.postMessage(m));
}
