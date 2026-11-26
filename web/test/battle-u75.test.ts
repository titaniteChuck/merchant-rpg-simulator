/** U75: the Solver's kept findings (web/src/ui/solver-cache.ts) and the resumable search (tools/parties.ts prior / round). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { configSet, MAX_ROUND, type PartiesMemo, type PartyConfig, searchParties } from "../src/tools/parties.ts";
import {
  CACHE_INDEX, CACHE_PREFIX, cacheLabel, canonical, entryResult, LIMITS, mergeEntry, mergeMemo, nextRound, parseIndex,
  SOLVER_CACHE_VERSION, SolveCache, type SolveCacheEntry, type SolveInput, solveKey, touchIndex, trimMemo,
} from "../src/ui/solver-cache.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const WEAPON = "3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0";
const raw = (id: number, cls: number, level: number) => ({
  id, heroID: id, name: `Test ${id}`, class: cls, level, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [WEAPON],
});
const RAWS = [raw(1, 1, 30), raw(2, 5, 30), raw(3, 3, 10), raw(4, 2, 5)];
const pool = () => new Map(RAWS.map((r) => [r.id, sim.hero(r)]));
const cheap = { nQuick: 4, nFinal: 8, beam: 2, refine: 1, rotations: false, maxSize: 3, topK: 6 } as const;
// A quest none of these heroes wins easily, so the search grows to the largest size.
const HARD = { quest: 10, amount: 1 } as const;

/** A fake localStorage (a Map); `quota`: the characters it holds at most (setItem throws over it). */
class FakeStorage {
  map = new Map<string, string>();
  quota: number;
  constructor(quota = Infinity) {
    this.quota = quota;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    const used = [...this.map].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0);
    if (used + v.length > this.quota) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const INPUT: SolveInput = { gameMode: "Standard", pool: RAWS, lock: [], quest: { id: 10, rare: false, amount: 1 }, minSize: 1, maxSize: 3, scrolls: false };

test("solveKey: the same setup gives the same key, whatever the order; every input changes it", () => {
  const k = solveKey(INPUT);
  assert.match(k, /^[0-9a-f]{28}$/);
  assert.equal(solveKey({ ...INPUT, pool: [...RAWS].reverse().map((r) => Object.fromEntries(Object.entries(r).reverse()) as typeof r) }), k);
  assert.equal(solveKey({ ...INPUT, lock: [] }), k);
  const others: SolveInput[] = [
    { ...INPUT, gameMode: "Hardcore" },
    { ...INPUT, pool: RAWS.slice(1) },
    { ...INPUT, pool: [{ ...RAWS[0], level: 31 }, ...RAWS.slice(1)] },
    { ...INPUT, pool: [{ ...RAWS[0], heroInventory: [] }, ...RAWS.slice(1)] },
    { ...INPUT, lock: [2] },
    { ...INPUT, quest: { id: 10, rare: true, amount: 1 } },
    { ...INPUT, quest: { id: 10, rare: false, amount: 2 } },
    { ...INPUT, quest: { id: 11, rare: false, amount: 1 } },
    { ...INPUT, quest: undefined, map: { id: 1, prestigeLevel: 0, grade: 1 } },
    { ...INPUT, minSize: 2 },
    { ...INPUT, maxSize: 2 },
    { ...INPUT, scrolls: true },
  ];
  const keys = new Set([k, ...others.map(solveKey)]);
  assert.equal(keys.size, others.length + 1);
  // A map's modifiers are in it.
  const map: SolveInput = { ...INPUT, quest: undefined, map: { id: 1, prestigeLevel: 1, grade: 2 } };
  assert.notEqual(solveKey(map), solveKey({ ...map, map: { id: 1, prestigeLevel: 1, grade: 2, prefix: 3 } }));
  assert.notEqual(solveKey({ ...map, map: { id: 1, prestigeLevel: 1, grade: 2, prefix: 3 } }), solveKey({ ...map, map: { id: 1, prestigeLevel: 1, grade: 2, suffix: 3 } }));
  // undefined fields are left out (a map without a prefix is the same as one with prefix: undefined)
  assert.equal(solveKey({ ...map, map: { id: 1, prestigeLevel: 1, grade: 2, prefix: undefined } }), solveKey(map));
  assert.equal(canonical({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
});

test("the cache key holds the cache version (bump it and every older entry misses)", () => {
  const src = readFileSync(new URL("../src/ui/solver-cache.ts", import.meta.url), "utf8");
  assert.match(src, /v: SOLVER_CACHE_VERSION, mode:/);
  assert.equal(typeof SOLVER_CACHE_VERSION, "number");
});

test("a fresh search is deterministic and returns its memo", () => {
  const a = searchParties(sim, pool(), HARD, cheap), b = searchParties(sim, pool(), HARD, cheap);
  assert.deepEqual(a.results, b.results);
  assert.equal(a.tried, b.tried);
  assert.deepEqual(a.memo, b.memo);
  assert.equal(a.memo.round, 0);
  assert.equal(a.memo.complete, true);
  assert.equal(a.memo.solo.length, 4);
  assert.ok(a.memo.screened.length >= a.memo.configs.length);
  for (const c of a.results) assert.ok(a.memo.configs.some((m) => configSet(m) === configSet(c)));
});

test("resume: the same round with its own memo evaluates nothing and finds the same; a wider round adds to it", () => {
  const first = searchParties(sim, pool(), HARD, cheap);
  const again = searchParties(sim, pool(), HARD, { ...cheap, prior: first.memo });
  assert.equal(again.tried, 0, "nothing evaluated again");
  assert.deepEqual(again.results, first.results);
  const wider = searchParties(sim, pool(), HARD, { ...cheap, prior: first.memo, round: 1 });
  assert.equal(wider.memo.round, 1);
  assert.ok(wider.tried > 0);
  // every earlier finding is still there (a tuned one stays tuned), and the new ones are added
  for (const [set] of first.memo.screened) assert.ok(wider.memo.screened.some(([s]) => s === set), set);
  for (const c of first.memo.configs) {
    const now = wider.memo.configs.find((m) => configSet(m) === configSet(c));
    assert.ok(now, configSet(c));
    if (c.tuned) assert.deepEqual(now, c);
  }
  assert.ok(wider.memo.screened.length >= first.memo.screened.length);
  // a wider round from scratch finds the same as the resumed one (reused evaluations are the same numbers)
  const scratch = searchParties(sim, pool(), HARD, { ...cheap, round: 1 });
  assert.deepEqual(wider.results.map(configSet).sort(), scratch.results.map(configSet).sort());
  for (const c of scratch.results) assert.equal(wider.results.find((w) => configSet(w) === configSet(c))!.ev.win, c.ev.win);
});

test("resume: a stopped search keeps what it evaluated and the next solve finishes the same round", () => {
  let calls = 0;
  const stopped = searchParties(sim, pool(), HARD, cheap, { shouldStop: () => ++calls > 6 });
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.memo.complete, false);
  assert.equal(nextRound(stopped.memo), 0);
  const done = searchParties(sim, pool(), HARD, { ...cheap, prior: stopped.memo, round: nextRound(stopped.memo) });
  const fresh = searchParties(sim, pool(), HARD, cheap);
  assert.deepEqual(done.results, fresh.results);
  assert.ok(done.tried < fresh.tried, `${done.tried} < ${fresh.tried}`);
  assert.equal(nextRound(done.memo), 1);
  assert.equal(nextRound(undefined), 0);
  assert.equal(nextRound({ ...done.memo, round: MAX_ROUND }), MAX_ROUND);
});

test("resume: a prior's heroes no longer in the pool are left out", () => {
  const first = searchParties(sim, pool(), HARD, cheap);
  const smaller = new Map([...pool()].filter(([id]) => id !== 1));
  const r = searchParties(sim, smaller, HARD, { ...cheap, prior: first.memo });
  for (const c of r.results) assert.ok(!configSet(c).split(",").includes("1"));
  assert.ok(!r.memo.solo.some(([id]) => id === 1));
});

const cfg = (ids: number[], tuned: boolean, score: number): PartyConfig => ({
  size: ids.length, layout: { front: [ids[0] ?? null, ids[1] ?? null, null], back: [ids[2] ?? null, null, null] }, skills: {}, scrolls: null,
  ev: { win: score } as PartyConfig["ev"], score, tuned,
});
const memo = (configs: PartyConfig[], screened: [string, number, number][] = [], extra: Partial<PartiesMemo> = {}): PartiesMemo =>
  ({ solo: [[1, 1]], screened, configs, round: 0, complete: true, ...extra });

test("mergeMemo: every screen and configuration of both; a tuned one beats a screened one, else the later", () => {
  const a = memo([cfg([1, 2], true, 5), cfg([1, 3], false, 1), cfg([2, 3], false, 2)], [["1,2", 1, 0.5], ["1,3", 1, 0.2]]);
  const b = memo([cfg([1, 2], false, 9), cfg([1, 3], true, 3), cfg([2, 3], false, 4), cfg([1], true, 7)], [["1,3", 2, 0.3], ["1", 1, 1]],
    { solo: [[2, 2]], round: 2, complete: false });
  const m = mergeMemo(a, b);
  const by = new Map(m.configs.map((c) => [configSet(c), c]));
  assert.equal(by.get("1,2")!.score, 5, "tuned kept over a later screened");
  assert.equal(by.get("1,3")!.score, 3, "later tuned");
  assert.equal(by.get("2,3")!.score, 4, "later screened");
  assert.equal(by.get("1")!.score, 7);
  assert.deepEqual(new Map(m.screened.map((s) => [s[0], s])), new Map([["1,2", ["1,2", 1, 0.5]], ["1,3", ["1,3", 2, 0.3]], ["1", ["1", 1, 1]]]));
  assert.deepEqual(m.solo, [[1, 1], [2, 2]]);
  assert.equal(m.round, 2);
  assert.equal(m.complete, false);
  assert.equal(mergeMemo(undefined, b), b);
});

test("trimMemo: the shown results first, then tuned, then by score; the latest screens", () => {
  const cs = [cfg([1], false, 1), cfg([2], true, 2), cfg([3], false, 9), cfg([4], true, 8), cfg([5], false, 0)];
  const t = trimMemo(memo(cs, [["1", 0, 0], ["2", 0, 0], ["3", 0, 0]]), ["5", "1"], { configs: 3, screened: 2 });
  assert.deepEqual(t.configs.map(configSet), ["5", "1", "4"]);
  assert.deepEqual(t.screened.map((s) => s[0]), ["2", "3"]);
  const small = memo(cs);
  assert.equal(trimMemo(small, [], { configs: 10, screened: 10 }).configs, small.configs);
});

test("mergeEntry / entryResult: solves add up, the last one's results in their order", () => {
  const r1 = { results: [cfg([1, 2], true, 5), cfg([3], false, 1)], tried: 30, stopped: true, memo: memo([cfg([1, 2], true, 5), cfg([3], false, 1)], [["1,2", 5, 1], ["3", 1, 0]]) };
  const e1 = mergeEntry(null, "k", r1, { ms: 1000, budgetMs: 5000, cancelled: false }, 10);
  assert.equal(e1.runs, 1);
  assert.equal(e1.tried, 30);
  assert.deepEqual(e1.results, ["1,2", "3"]);
  assert.equal(cacheLabel(e1), "2 parties · 1 solve");
  const r2 = { results: [cfg([3], true, 9), cfg([1, 2], true, 5)], tried: 12, stopped: false, memo: memo([cfg([3], true, 9), cfg([1, 2], true, 5)], [["4", 1, 0]]) };
  const e2 = mergeEntry(e1, "k", r2, { ms: 500, budgetMs: 5000, cancelled: true }, 20);
  assert.equal(e2.runs, 2);
  assert.equal(e2.tried, 42);
  assert.equal(e2.ms, 1500);
  assert.deepEqual(e2.last, { ms: 500, budgetMs: 5000, stopped: false, cancelled: true });
  assert.equal(cacheLabel(e2), "3 parties · 2 solves");
  const shown = entryResult(e2);
  assert.deepEqual(shown.results.map((c) => [configSet(c), c.score]), [["3", 9], ["1,2", 5]]);
  assert.equal(shown.tried, 42);
  // another key's or another version's entry is not merged in
  assert.equal(mergeEntry(e1, "other", r2, { ms: 1, budgetMs: 1, cancelled: false }, 1).runs, 1);
  assert.equal(mergeEntry({ ...e1, v: SOLVER_CACHE_VERSION + 1 }, "k", r2, { ms: 1, budgetMs: 1, cancelled: false }, 1).runs, 1);
});

test("touchIndex: most recent first, the least recently used beyond the limits and other versions dropped", () => {
  const idx: [string, number, number, number][] = [["a", SOLVER_CACHE_VERSION, 10, 1], ["b", SOLVER_CACHE_VERSION, 10, 3], ["old", SOLVER_CACHE_VERSION - 1, 1, 9],
    ["c", SOLVER_CACHE_VERSION, 10, 2]];
  const t = touchIndex(idx, "d", 10, 5, { entries: 3, total: 1000 });
  assert.deepEqual(t.index.map((r) => r[0]), ["d", "b", "c"]);
  assert.deepEqual(t.evict.sort(), ["a", "old"]);
  // a read keeps its size and moves it first
  const r = touchIndex(idx, "a", null, 6, { entries: 9, total: 1000 });
  assert.deepEqual(r.index[0], ["a", SOLVER_CACHE_VERSION, 10, 6]);
  // the characters: oldest out first
  const c = touchIndex(idx, "d", 15, 5, { entries: 9, total: 30 });
  assert.deepEqual(c.index.map((x) => x[0]), ["d", "b"]);
  assert.deepEqual(parseIndex("nope"), []);
  assert.deepEqual(parseIndex('[["a",1,2,3],["bad"]]'), [["a", 1, 2, 3]]);
});

const entry = (key: string, at = 1, pad = 0): SolveCacheEntry => ({
  v: SOLVER_CACHE_VERSION, key, at, runs: 1, tried: 5, ms: 10, last: { ms: 10, budgetMs: 1000, stopped: false, cancelled: false },
  memo: memo([cfg([1], true, 1)], [["1", 1, 1]], { solo: [[1, pad]] , ...(pad ? { screened: [["x".repeat(pad), 0, 0]] } : {}) }), results: ["1"],
});

test("SolveCache: put / get / remove over a storage, LRU over the setups", () => {
  const store = new FakeStorage();
  let now = 0;
  const cache = new SolveCache(store, { ...LIMITS, entries: 3 }, () => ++now);
  for (const k of ["a", "b", "c"]) assert.equal(cache.put(entry(k)), true);
  assert.deepEqual(cache.get("a")?.results, ["1"]); // "a" used: now the most recent
  cache.put(entry("d"));
  assert.equal(cache.get("b"), null, "the least recently used went");
  assert.ok(cache.get("a") && cache.get("c") && cache.get("d"));
  assert.ok(!store.map.has(CACHE_PREFIX + "b"));
  assert.deepEqual(parseIndex(store.getItem(CACHE_INDEX)).map((r) => r[0]).sort(), ["a", "c", "d"]);
  cache.remove("c");
  assert.equal(cache.get("c"), null);
  assert.ok(!store.map.has(CACHE_PREFIX + "c"));
  assert.deepEqual(parseIndex(store.getItem(CACHE_INDEX)).map((r) => r[0]).sort(), ["a", "d"]);
});

test("SolveCache: another version, another key or broken JSON is ignored (and dropped)", () => {
  const store = new FakeStorage();
  const cache = new SolveCache(store);
  store.setItem(CACHE_PREFIX + "old", JSON.stringify({ ...entry("old"), v: SOLVER_CACHE_VERSION - 1 }));
  store.setItem(CACHE_PREFIX + "moved", JSON.stringify(entry("elsewhere")));
  store.setItem(CACHE_PREFIX + "bad", "{nope");
  for (const k of ["old", "moved", "bad"]) {
    assert.equal(cache.get(k), null, k);
    assert.ok(!store.map.has(CACHE_PREFIX + k), k);
  }
});

test("SolveCache: storage full drops the oldest setups; blocked or too small keeps it for the page view", () => {
  const one = JSON.stringify(entry("a", 1, 400)).length;
  const store = new FakeStorage(one * 2 + 300);
  let now = 0;
  const cache = new SolveCache(store, LIMITS, () => ++now);
  assert.equal(cache.put(entry("a", 1, 400)), true);
  assert.equal(cache.put(entry("b", 1, 400)), true);
  assert.equal(cache.put(entry("c", 1, 400)), true, "fits once the oldest is dropped");
  assert.ok(!store.map.has(CACHE_PREFIX + "a"));
  assert.ok(cache.get("c"));
  // larger than the whole storage: memory only
  const big = entry("big", 1, one * 3);
  assert.equal(cache.put(big), false);
  assert.equal(cache.get("big"), big);
  // storage that throws on every call
  const blocked = new SolveCache({ getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } });
  assert.equal(blocked.put(entry("k")), false);
  assert.deepEqual(blocked.get("k")?.results, ["1"]);
  blocked.remove("k");
  assert.equal(blocked.get("k"), null);
  const none = new SolveCache(null);
  none.put(entry("k"));
  assert.ok(none.get("k"));
});

test("the Solver page: kept findings on every setup change, resume, Reset beside Solve", () => {
  const src = readFileSync(new URL("../src/ui/battle-search.ts", import.meta.url), "utf8");
  assert.match(src, /const cache = pageCache\(\);/);
  // the setup's findings at once: the panel's build, the sizes, Include scrolls and the hero table
  assert.match(src, /lookupNow = lookup;\n {4}lookup\(\);/);
  assert.match(src, /prefs\.min = intOf\(minN, 1, cap\)\), lookup\(\)/);
  assert.match(src, /prefs\.max = intOf\(maxN, 1, cap\)\), lookup\(\)/);
  assert.match(src, /prefs\.scrolls = sc\.checked\), lookup\(\)/);
  assert.match(src, /heroTable\(sv, ctx\.saveName\(\), \(\) => lookup\(\)\)/);
  // a running solve is left alone; the solve resumes one round wider and is merged in
  assert.match(src, /function lookup\(\): void \{\n {6}if \(worker\) return;/);
  assert.match(src, /\.\.\.\(prior \? \{ prior: prior\.memo \} : \{\}\), round: nextRound\(prior\?\.memo\)/);
  assert.match(src, /entry = mergeEntry\(prior, key, r\.result,/);
  assert.match(src, /"Reset"\);/);
  assert.match(src, /cache\.remove\(inp\.key\);/);
  const worker = readFileSync(new URL("../src/ui/battle-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /prior: req\.prior, round: req\.round \}/);
});

test("CSS: the U75 block, after U74: the kept findings and Reset on one line, hidden with nothing kept", () => {
  const css = readFileSync(new URL("../../site/style.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("/* U75 */"), css.indexOf("/* end U75 */"));
  assert.ok(css.lastIndexOf("/* end U75 */") > css.lastIndexOf("/* end U74 */"));
  assert.match(block, /\.solve-cache \{ display: inline-flex;[^}]*white-space: nowrap; \}/);
  assert.match(block, /\.solve-cache\[hidden\] \{ display: none; \}/);
});
