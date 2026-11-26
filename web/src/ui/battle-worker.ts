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
import { type PartiesMemo, type PartiesResult, searchParties } from "../tools/parties.ts";
import { loadTimelines } from "../tools/schedule.ts";
import { loadWarmStart, WARMSTART_VERSION } from "../tools/warmstart.ts";
import { type ConsumableKind, type ConsumableRanking, rankConsumables } from "../tools/consumables.ts";
import { gameFromData } from "../tools/gamedata.ts";
import { Solver } from "../tools/profit.ts";
import type { Save } from "../tools/save.ts";
import { type MapSpec, type Scroll, Sim } from "../tools/engine.ts";
import { contentExpansion, type Expansion } from "../tools/expansions.ts";
import { traceWorst, type WorstRuns } from "../tools/worst-run.ts";
import { G } from "../sim/data.ts";
import { type DataMessage, takeDataMessage, workerJson } from "./worker-data.ts";

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
  /** U70: trace the n runs and answer with every run's outcome and (U74) the first, worst and best run's traces (kind "worst"). */
  worst?: boolean;
  /** U70: echoed in the answer, so the page can tell a stale answer. */
  id?: number;
}

/** A search from the battle page's search tabs (web/src/tools/combat.ts search API). */
export type SearchRequest = {
  gameMode: string;
  /**
   * U27: a blob: URL the page revokes to stop the search softly (Cancel keeps what was found). The search is
   * synchronous, so the worker can't get a message: `shouldStop` reads the URL (synchronous request, at most every
   * 250 ms), and a revoked URL fails. Without it (or without XMLHttpRequest, in Node) the search runs to its end.
   */
  stopUrl?: string;
  front: (Any | null)[];
  back: (Any | null)[];
  skills?: { front: (SkillChoice | null)[]; back: (SkillChoice | null)[] };
} & (
  | { search: "skills"; hero: { row: "front" | "back"; i: number }; quest: { id: number; rare: boolean; amount: number }; nQuick: number; nFinal: number; top: number }
  | { search: "gear"; hero: { row: "front" | "back"; i: number }; quest: { id: number; rare: boolean; amount: number }; n: number; passes: number;
    pool: "owned" | "catalog"; save?: Save; itemGrade?: number; asc?: number;
    /** Catalog items allowed (U28): "all", or the owned expansions (items of the others are left out). Default "all". */
    expansions?: Expansion[] | "all" }
  | { search: "party"; pool: Any[]; lock?: number[]; poolSkills?: Record<number, SkillChoice>; quest?: { id: number; rare: boolean; amount: number };
    map?: { spec: MapSpec; scrolls: Scroll[] }; size: number; nQuick: number; nFinal: number }
  | { search: "parties"; pool: Any[]; lock?: number[]; poolSkills?: Record<number, SkillChoice>; quest?: { id: number; rare: boolean; amount: number };
    map?: { spec: MapSpec; scrolls: Scroll[] }; minSize: number; maxSize: number; scrolls: boolean; timeBudgetMs: number; topK?: number;
    /** U75: an earlier search's findings with the same inputs (the Solver's cache) and the round to run. */
    prior?: PartiesMemo; round?: number }
  | { search: "optimise"; pool: Any[]; lock?: number[]; startParty?: { front: (number | null)[]; back: (number | null)[] };
    poolSkills?: Record<number, SkillChoice>; quest?: { id: number; rare: boolean; amount: number };
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
  | { type: "done"; search: "parties"; result: PartiesResult; ms: number }
  | { type: "done"; search: "scrolls"; result: { ranked: ScrollLoadout[]; priceError?: string }; ms: number }
  | { type: "done"; search: "optimise"; result: OptimiseResult; ms: number }
  | { type: "done"; search: "consumables"; result: ConsumableRanking; ms: number }
  | { type: "error"; error: string };

export type BattleResponse =
  | { ok: true; kind: "quest"; result: FightEval; ms: number }
  | { ok: true; kind: "map"; result: MapEval; ms: number }
  | { ok: true; kind: "worst"; runs: WorstRuns; ms: number; id?: number }
  | { ok: false; error: string; id?: number };

let loaded: Promise<void> | null = null;
/** The game data, for fights and searches (from the page's copy, data-files.ts dataWorker, else fetched). */
function loadData(): Promise<void> {
  loaded ??= workerJson("gamedata.json", "game data").then((json) => api.loadGameData(json));
  return loaded;
}

let searchLoaded: Promise<void> | null = null;
/** Review F16: the files only searches use, loaded on the first search (a plain fight never needs them). */
function loadSearchData(): Promise<void> {
  searchLoaded ??= Promise.all([
    loadData(),
    // Enemy timelines: with them, searchSkills / optimiseFight pre-filter rotations by their schedule score (E14b,
    // 10-19x faster); without them the searches still run, in full.
    workerJson<Any>("timelines.json").then((json) => json && loadTimelines(json)).catch(() => {}),
    // Offline warm start (E15): searchSkills / optimiseFight try its rotation for the class, tier and enemy first;
    // without the file they start from scratch.
    workerJson<Any>("warmstart.json")
      // Only a table of this version (a stale or foreign file is ignored, like a missing one).
      .then((json) => json?.version === WARMSTART_VERSION && json.entries && loadWarmStart(json)).catch(() => {}),
  ]).then(() => {});
  return searchLoaded;
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
    if (req.worst) {
      const runs = traceWorst(sim, { quest: req.quest, map: req.map }, front, back, req.n);
      return { ok: true, kind: "worst", runs, ms: performance.now() - t0, ...(req.id !== undefined ? { id: req.id } : {}) };
    }
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
    return { ok: false, error: e instanceof Error ? e.message : String(e), ...(req.id !== undefined ? { id: req.id } : {}) };
  }
}

/** shouldStop for a soft stop (SearchRequest.stopUrl): true once the page revoked the URL. */
export function stopSignal(url: string | undefined): (() => boolean) | undefined {
  if (!url || typeof XMLHttpRequest === "undefined") return undefined;
  let last = 0, stop = false;
  return () => {
    if (stop) return true;
    const now = performance.now();
    if (now - last < 250) return false;
    last = now;
    try {
      const x = new XMLHttpRequest();
      x.open("GET", url, false);
      x.send();
      if (x.status !== 200 && x.status !== 0) stop = true;
    } catch {
      stop = true;
    }
    return stop;
  };
}

/** The profit Solver prices potions and enchants (crafted cost); solved once per worker, a few seconds. */
let solver: Solver | null = null;

/**
 * Run a search, reporting progress through `post` (throttled to ~10 per second). The searches are synchronous,
 * so the page cancels by terminating the worker, or (with `stopUrl`, U27) by revoking the URL: the search then ends
 * at its next check and its partial result comes back as usual.
 */
export async function runSearch(req: SearchRequest, post: (m: SearchResponse) => void): Promise<void> {
  try {
    await loadSearchData();
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
      shouldStop: stopSignal(req.stopUrl),
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
        const allowed = req.expansions;
        if (req.pool === "catalog" && Array.isArray(allowed)) {
          // Catalog items behind an expansion the visitor hides (level 51+ gear, the Scribe-locked recipes) are dropped.
          for (const [slot, list] of cands) {
            cands.set(slot, list.filter(([, it]) => {
              const g = typeof it === "object" && it ? contentExpansion("equipment", Number(it.id), { ascension: req.asc ?? 0 }, G) : null;
              return !g || g.needs.every((x) => allowed.includes(x));
            }));
          }
        }
        const result = searchGear(sim, hero, front, back, quest(req.quest), cands, { n: req.n, passes: req.passes }, ctl);
        return post({ type: "done", search: "gear", result, ms: ms() });
      }
      case "party": {
        const pool = poolOf(req.pool, req.poolSkills);
        const target = req.quest ? quest(req.quest) : { map: req.map!.spec, scrolls: req.map!.scrolls.length ? req.map!.scrolls : null };
        const result = searchParty(sim, pool, target, { size: req.size, nQuick: req.nQuick, nFinal: req.nFinal, lock: req.lock }, ctl);
        return post({ type: "done", search: "party", result, ms: ms() });
      }
      case "parties": {
        const pool = poolOf(req.pool, req.poolSkills);
        // With "Include scrolls" the search picks them; without, the runs keep the scrolls chosen in step 3.
        const target = req.quest ? quest(req.quest)
          : { map: req.map!.spec, scrolls: !req.scrolls && req.map!.scrolls.length ? req.map!.scrolls : null };
        const result = searchParties(sim, pool, target, { minSize: req.minSize, maxSize: req.maxSize, scrolls: Boolean(req.map && req.scrolls),
          lock: req.lock, timeBudgetMs: req.timeBudgetMs, topK: req.topK ?? 10, prior: req.prior, round: req.round }, ctl);
        return post({ type: "done", search: "parties", result, ms: ms() });
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
        const result = optimiseFight(sim, pool, target, { save: req.save, size: req.size, timeBudgetMs: req.timeBudgetMs, steps: req.steps,
          startParty: req.startParty, lock: req.lock }, ctl);
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
  ctx.onmessage = async (e: MessageEvent<DataMessage | BattleRequest | SearchRequest>) => {
    if (takeDataMessage(e.data)) return;
    if ("search" in e.data) await runSearch(e.data, (m) => ctx.postMessage(m));
    else ctx.postMessage(await runBattle(e.data as BattleRequest));
  };
}
