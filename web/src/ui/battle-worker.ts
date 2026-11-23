/**
 * Web worker for the battle page: runs many fights or map runs off the main
 * thread with the TypeScript engine (evaluators of web/src/tools/combat.ts,
 * seeds 1..n), so the page stays responsive and can cancel.
 */
import * as api from "../sim/api.ts";
import {
  catalogGearCandidates, evaluate, evaluateMap, type FightEval, type GearSearch, type MapEval, ownedGearCandidates,
  type PartySearch, type ScrollLoadout, searchGear, searchParty, searchScrolls, searchSkills, type SkillSearch,
} from "../tools/combat.ts";
import { optimiseFight, type OptimiseResult } from "../tools/optimise.ts";
import { type ConsumableKind, type ConsumableRanking, rankConsumables } from "../tools/consumables.ts";
import { gameFromData } from "../tools/gamedata.ts";
import { Solver } from "../tools/profit.ts";
import type { Save } from "../tools/save.ts";
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

/** A search from the battle page's search tabs (web/src/tools/combat.ts search API). */
export type SearchRequest = {
  gameMode: string;
  front: (Any | null)[];
  back: (Any | null)[];
  skills?: { front: (SkillChoice | null)[]; back: (SkillChoice | null)[] };
} & (
  | { search: "skills"; hero: { row: "front" | "back"; i: number }; quest: { id: number; rare: boolean; amount: number }; nQuick: number; nFinal: number; top: number }
  | { search: "gear"; hero: { row: "front" | "back"; i: number }; quest: { id: number; rare: boolean; amount: number }; n: number; passes: number;
    pool: "owned" | "catalog"; save?: Save; itemGrade?: number; asc?: number }
  | { search: "party"; pool: Any[]; poolSkills?: Record<number, SkillChoice>; quest?: { id: number; rare: boolean; amount: number };
    map?: { spec: MapSpec; scrolls: Scroll[] }; size: number; nQuick: number; nFinal: number }
  | { search: "optimise"; pool: Any[]; poolSkills?: Record<number, SkillChoice>; quest?: { id: number; rare: boolean; amount: number };
    map?: { spec: MapSpec; scrolls: Scroll[] }; save: Save; size: number; timeBudgetMs: number;
    steps: { party?: boolean; skills?: boolean; gear?: boolean; scrolls?: boolean } }
  | { search: "consumables"; hero: { row: "front" | "back"; i: number }; quest?: { id: number; rare: boolean; amount: number };
    map?: { spec: MapSpec; scrolls: Scroll[] }; kind: ConsumableKind; n: number; ascs: number[]; prices: boolean }
  | { search: "scrolls"; map: { spec: MapSpec }; pool: number[]; scrollAsc: number; nQuick: number; nFinal: number; top: number }
);

export type SearchResponse =
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "done"; search: "skills"; result: SkillSearch; ms: number }
  | { type: "done"; search: "gear"; result: GearSearch; ms: number }
  | { type: "done"; search: "party"; result: PartySearch; ms: number }
  | { type: "done"; search: "scrolls"; result: { ranked: ScrollLoadout[]; priceError?: string }; ms: number }
  | { type: "done"; search: "optimise"; result: OptimiseResult; ms: number }
  | { type: "done"; search: "consumables"; result: ConsumableRanking; ms: number }
  | { type: "error"; error: string };

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

/** The profit Solver prices potions and enchants (crafted cost); solved once per worker, a few seconds. */
let solver: Solver | null = null;

/**
 * Run a search, reporting progress through `post` (throttled to ~10 per second). The searches are synchronous,
 * so the page cancels by terminating the worker.
 */
export async function runSearch(req: SearchRequest, post: (m: SearchResponse) => void): Promise<void> {
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
    const ms = () => performance.now() - t0;
    const quest = (q: { id: number; rare: boolean; amount: number }) => ({ quest: q.id, rare: q.rare, amount: q.amount });
    /** All candidate heroes by id, with the rotations edited on the page. */
    const poolOf = (raws: Any[], skills?: Record<number, SkillChoice>) => new Map<number, Any>(raws.map((raw) => {
      const h = sim.hero(raw);
      const s = skills?.[raw.id];
      if (s) sim.setSkills(h, s.attackList, s.passive);
      return [raw.id, h];
    }));
    switch (req.search) {
      case "skills": {
        const hero = (req.hero.row === "front" ? front : back)[req.hero.i];
        if (!hero) throw new Error("pick a hero of the party");
        const result = searchSkills(sim, hero, front, back, quest(req.quest), { nQuick: req.nQuick, nFinal: req.nFinal, top: req.top }, ctl);
        return post({ type: "done", search: "skills", result, ms: ms() });
      }
      case "gear": {
        const hero = (req.hero.row === "front" ? front : back)[req.hero.i];
        const raw = (req.hero.row === "front" ? req.front : req.back)[req.hero.i];
        if (!hero) throw new Error("pick a hero of the party");
        const cands = req.pool === "owned" && req.save ? ownedGearCandidates(req.save, raw.id)
          : catalogGearCandidates(sim, hero, { itemGrade: req.itemGrade, asc: req.asc });
        const result = searchGear(sim, hero, front, back, quest(req.quest), cands, { n: req.n, passes: req.passes }, ctl);
        return post({ type: "done", search: "gear", result, ms: ms() });
      }
      case "party": {
        const pool = poolOf(req.pool, req.poolSkills);
        const target = req.quest ? quest(req.quest) : { map: req.map!.spec, scrolls: req.map!.scrolls.length ? req.map!.scrolls : null };
        const result = searchParty(sim, pool, target, { size: req.size, nQuick: req.nQuick, nFinal: req.nFinal }, ctl);
        return post({ type: "done", search: "party", result, ms: ms() });
      }
      case "consumables": {
        const hero = (req.hero.row === "front" ? front : back)[req.hero.i];
        if (!hero) throw new Error("pick a hero of the party");
        if (req.prices && !solver) {
          post({ type: "progress", done: 0, total: 1, stage: "pricing (once)" });
          solver = new Solver(gameFromData(), { grade: 3 }).solve();
        }
        const target = req.quest ? quest(req.quest) : { map: req.map!.spec, scrolls: req.map!.scrolls.length ? req.map!.scrolls : null };
        const result = rankConsumables(sim, hero, front, back, target,
          { kind: req.kind, n: req.n, ascs: req.ascs, solver: req.prices ? solver! : undefined }, ctl);
        return post({ type: "done", search: "consumables", result, ms: ms() });
      }
      case "optimise": {
        const pool = poolOf(req.pool, req.poolSkills);
        const target = req.quest ? quest(req.quest) : { map: req.map!.spec, scrolls: req.map!.scrolls.length ? req.map!.scrolls : null };
        const result = optimiseFight(sim, pool, target, { save: req.save, size: req.size, timeBudgetMs: req.timeBudgetMs, steps: req.steps }, ctl);
        return post({ type: "done", search: "optimise", result, ms: ms() });
      }
      case "scrolls": {
        const result = searchScrolls(sim, req.map.spec, front, back,
          { pool: req.pool, scrollAsc: req.scrollAsc, nQuick: req.nQuick, nFinal: req.nFinal, top: req.top }, ctl);
        return post({ type: "done", search: "scrolls", result, ms: ms() });
      }
    }
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

// Worker entry (skipped when imported in Node tests): plain requests simulate, `search` requests search.
const ctx = globalThis as Any;
if (typeof ctx.WorkerGlobalScope !== "undefined" && ctx instanceof ctx.WorkerGlobalScope) {
  ctx.onmessage = async (e: MessageEvent<BattleRequest | SearchRequest>) => {
    if ("search" in e.data) await runSearch(e.data, (m) => ctx.postMessage(m));
    else ctx.postMessage(await runBattle(e.data));
  };
}
