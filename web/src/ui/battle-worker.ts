/**
 * Web worker for the battle page: runs many fights or map runs off the main
 * thread with the TypeScript engine (evaluators of web/src/tools/combat.ts,
 * seeds 1..n), so the page stays responsive and can cancel.
 */
import * as api from "../sim/api.ts";
import { evaluate, evaluateMap, type FightEval, type MapEval } from "../tools/combat.ts";
import { type MapSpec, type Scroll, Sim } from "../tools/engine.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface SkillChoice {
  attackList: string[];
  passive?: string;
}

export interface BattleRequest {
  gameMode: string;
  /** Raw save entries of the heroes used, by slot: front[0..2], back[0..2] (null = empty). */
  front: (Any | null)[];
  back: (Any | null)[];
  /** Optional rotation/passive per hero, same layout as front/back. */
  skills?: { front: (SkillChoice | null)[]; back: (SkillChoice | null)[] };
  n: number;
  quest?: { id: number; rare: boolean; amount: number };
  map?: { spec: MapSpec; scrolls: Scroll[] };
}

export type BattleResponse =
  | { ok: true; kind: "quest"; result: FightEval; ms: number }
  | { ok: true; kind: "map"; result: MapEval; ms: number }
  | { ok: false; error: string };

let loaded: Promise<void> | null = null;
function loadData(): Promise<void> {
  loaded ??= fetch(new URL("../data/gamedata.json", self.location.href)).then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return loaded;
}

export async function runBattle(req: BattleRequest): Promise<BattleResponse> {
  try {
    await loadData();
    const t0 = performance.now();
    const sim = new Sim(req.gameMode || "Standard");
    const build = (raws: (Any | null)[], skills?: (SkillChoice | null)[]) => raws.map((raw, i) => {
      if (!raw) return null;
      const h = sim.hero(raw);
      const s = skills?.[i];
      if (s) sim.setSkills(h, s.attackList, s.passive);
      return h;
    });
    const front = build(req.front, req.skills?.front);
    const back = build(req.back, req.skills?.back);
    if (req.quest) {
      const result = evaluate(sim, req.quest.id, front, back, req.n, req.quest.rare, req.quest.amount);
      return { ok: true, kind: "quest", result, ms: performance.now() - t0 };
    }
    if (req.map) {
      const result = evaluateMap(sim, req.map.spec, front, back, req.n, 1, req.map.scrolls.length ? req.map.scrolls : null);
      return { ok: true, kind: "map", result, ms: performance.now() - t0 };
    }
    throw new Error("nothing to simulate");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Worker entry (skipped when imported in Node tests).
const ctx = globalThis as Any;
if (typeof ctx.WorkerGlobalScope !== "undefined" && ctx instanceof ctx.WorkerGlobalScope) {
  ctx.onmessage = async (e: MessageEvent<BattleRequest>) => ctx.postMessage(await runBattle(e.data));
}
