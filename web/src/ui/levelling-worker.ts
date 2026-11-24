/**
 * Web worker for the levelling page (site/levelling.html): runs levellingPlan and prestigePayoff
 * (web/src/tools/levelling.ts) off the main thread. The page keeps it alive between runs (the game data is parsed
 * once) and cancels by terminating it. Progress is posted ~10 times per second, per candidate source.
 * Kept between runs: the price Solver (potions and maps) and the relevel plans by hero, tier and options, so a new
 * reference quest on Compare only re-runs the two reference fights.
 */
import * as api from "../sim/api.ts";
import {
  type LevellingOptions, type LevellingPlan, levellingPlan, type PrestigePayoff, prestigePayoff, relevelInput,
} from "../tools/levelling.ts";
import { Sim } from "../tools/engine.ts";
import { gameFromData } from "../tools/gamedata.ts";
import { Solver } from "../tools/profit.ts";

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

let solver: Solver | null = null;
const relevels = new Map<string, LevellingPlan>();

/** A plan already computed for the same hero, tier, options and game mode (kept for this worker's life). */
function relevelKey(mode: string, raw: Any, o: LevellingOptions): string {
  const [r, opts] = relevelInput(raw, o);
  return JSON.stringify([mode, r, opts]);
}

export async function runLevelling(req: LevelRequest, post: (m: LevelResponse) => void): Promise<void> {
  try {
    await loadData();
    const t0 = performance.now();
    const mode = req.gameMode || "Standard";
    api.setMode(mode);
    const sim = new Sim(mode);
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
    // Prices of the potions and maps a plan uses: solved once, on first need.
    const withSolver = (o: LevellingOptions): LevellingOptions => ({ ...o, solver: () => (solver ??= new Solver(gameFromData()).solve()) });
    if (req.kind === "plan") {
      const plan = levellingPlan(sim, req.hero, withSolver(req.options), ctl);
      post({ type: "done", kind: "plan", plan, ms: performance.now() - t0 });
    } else {
      if (req.refQuest === undefined) throw new Error("choose a quest to compare the tiers on");
      const o = withSolver(req.options);
      const key = relevelKey(mode, req.hero, req.options);
      const payoff = prestigePayoff(sim, req.hero, { quest: req.refQuest }, o, ctl, relevels.get(key));
      relevels.set(key, payoff.relevel);
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
