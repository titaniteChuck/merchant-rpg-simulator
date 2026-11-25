// Performance quick fixes of the accessibility and performance review (docs/tooling/roadmap/review-a11y-perf.md):
// F12 the compact profit answer, F13 data files fetched once and handed to the workers, F15 wiki timelines only on
// the routes that use them, F19 scroll restore without a layout read per frame, F21 the build's source maps (F14:
// perf-review-build.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { compactProfit, expandProfit, fromTable, toTable } from "../src/tools/profit-compact.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const gamedata = read("inventory/gamedata.json");
api.loadGameData(JSON.parse(gamedata));
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/profit-worker.js" } };
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
const { DEFAULT_REQUEST, runProfit } = await import("../src/ui/profit-worker.ts");

test("F12: the compact default answer expands to exactly the full answer, at under a third of its size", async () => {
  const res = await runProfit({ id: 0, ...DEFAULT_REQUEST });
  assert.ok(res.ok);
  const full = JSON.parse(JSON.stringify({ ...res, ms: 0 })); // what the page used to fetch
  const text = JSON.stringify(compactProfit(full));
  const back = expandProfit(JSON.parse(text));
  assert.deepStrictEqual(back, full, "every row, every value, every cost breakdown");
  // Key order too (the tables list their columns from the rows).
  assert.deepEqual(Object.keys(back.items[0]), Object.keys(full.items[0]));
  assert.deepEqual(Object.keys(back.costs), Object.keys(full.costs));
  const fullSize = JSON.stringify(full).length;
  assert.ok(text.length < fullSize / 3, `${text.length} B compact vs ${fullSize} B full`);
});

test("F12: tables by column: dictionaries, 'same as' columns, derived columns, refusals", () => {
  const rows = [
    { kind: "a", n: 1, m: 1, z: null, d: 2 },
    { kind: "b", n: 2, m: 2, z: 3, d: 4 },
    { kind: "a", n: 3, m: 9, z: null, d: 6 },
  ];
  const double = (r: Record<string, unknown>) => Number(r.n) * 2;
  const t = toTable(rows, [["d", double]]);
  assert.deepEqual(t.cols, ["kind", "n", "m", "z"], "d is computed again, not stored");
  assert.deepEqual(t.dicts[0], ["a", "b"]);
  assert.equal(t.same[2], 1, "m is mostly n");
  assert.equal(t.same[3], null, "a column with nulls of its own never uses the 'same as' null");
  assert.deepEqual(t.rows, [[0, 1, null, null], [1, 2, null, 3], [0, 3, 9, null]]);
  assert.deepStrictEqual(fromTable(JSON.parse(JSON.stringify(t)), [["d", double]]), rows);
  // A derived column that doesn't match everywhere stays stored.
  const off = [...rows, { kind: "c", n: 4, m: 4, z: 1, d: 0 }];
  assert.ok(toTable(off, [["d", double]]).cols.includes("d"));
  assert.deepStrictEqual(fromTable(toTable(off, [["d", double]]), [["d", double]]), off);
  assert.throws(() => toTable([{ a: 1 }, { b: 1 }]), /different keys/);
  assert.throws(() => expandProfit({ ok: true } as never), /not a compact profit answer/);
});

test("F12: the build writes the compact form and the page expands it", () => {
  assert.match(read("web/src/tools/export-profit-default.ts"), /JSON\.stringify\(compactProfit\(/);
  assert.match(read("web/src/ui/profit.ts"), /\.then\(expandProfit\)/);
});

test("F13: the page fetches a data file once; a worker gets a copy of its bytes before any request", async () => {
  const urls: string[] = [];
  const bodies: Record<string, unknown> = { "data/gamedata.json": { a: 1 }, "data/timelines.json": { t: 2 } };
  globalThis.fetch = (async (u: string) => {
    urls.push(String(u));
    const body = bodies[String(u)];
    return body === undefined ? { ok: false, status: 404 }
      : { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer };
  }) as unknown as typeof fetch;
  const posted: [unknown, Transferable[] | undefined][] = [];
  class FakeWorker {
    url: string;
    constructor(url: URL) {
      this.url = String(url);
    }
    postMessage(msg: unknown, transfer?: Transferable[]) {
      posted.push([msg, transfer]);
    }
  }
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
  (globalThis as Record<string, unknown>).document = { baseURI: "http://localhost/battle.html" };
  const { dataJson, dataWorker } = await import("../src/ui/data-files.ts");
  const [a, b] = await Promise.all([dataJson("gamedata.json", "game data"), dataJson("gamedata.json")]);
  assert.deepEqual(a, { a: 1 });
  assert.equal(a, b, "parsed once");
  assert.deepEqual(urls, ["data/gamedata.json"], "fetched once");
  await assert.rejects(dataJson("missing.json", "missing data"), /missing data: HTTP 404/);

  const w = dataWorker("battle-worker.js", ["gamedata.json", "timelines.json", "missing.json"]) as unknown as FakeWorker;
  assert.equal(w.url, "http://localhost/js/battle-worker.js");
  w.postMessage({ run: 1 });
  w.postMessage({ run: 2 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(posted.length, 3);
  const [first, transfer] = posted[0] as [{ dataFiles: Record<string, ArrayBuffer> }, ArrayBuffer[]];
  assert.deepEqual(Object.keys(first.dataFiles), ["gamedata.json", "timelines.json"], "a file the page can't load is left out");
  assert.deepEqual(transfer, Object.values(first.dataFiles), "the bytes are transferred, not cloned");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(first.dataFiles["timelines.json"])), { t: 2 });
  assert.deepEqual(posted.slice(1).map(([m]) => m), [{ run: 1 }, { run: 2 }], "requests after the data, in order");
  assert.equal(urls.filter((u) => u === "data/gamedata.json").length, 1, "the worker's copy reuses the page's fetch");
  // The page keeps its own bytes: a second worker gets another copy.
  dataWorker("farming-worker.js", ["gamedata.json"]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((posted[3][0] as { dataFiles: Record<string, ArrayBuffer> }).dataFiles["gamedata.json"].byteLength, 7);
});

test("F13: the worker side reads the page's bytes, else fetches next to its script", async () => {
  const { takeDataMessage, workerJson } = await import("../src/ui/worker-data.ts");
  const urls: string[] = [];
  globalThis.fetch = (async (u: URL) => {
    urls.push(String(u));
    return { ok: true, json: async () => ({ fetched: true }) };
  }) as unknown as typeof fetch;
  assert.equal(takeDataMessage({ search: "skills" }), false);
  assert.equal(takeDataMessage(null), false);
  assert.ok(takeDataMessage({ dataFiles: { "gamedata.json": new TextEncoder().encode('{"given":1}').buffer } }));
  assert.deepEqual(await workerJson("gamedata.json"), { given: 1 });
  assert.deepEqual(urls, []);
  assert.deepEqual(await workerJson("gamedata.json"), { fetched: true }, "the bytes are used once");
  assert.deepEqual(urls, ["http://localhost/data/gamedata.json"]);
});

test("F13/F16: the pages start their workers through dataWorker; warm start only for searches", () => {
  assert.match(read("web/src/ui/battle-page.ts"), /dataWorker\("battle-worker\.js", \["gamedata\.json"\]\)/);
  assert.match(read("web/src/ui/battle-search.ts"), /dataWorker\("battle-worker\.js", \["gamedata\.json", "timelines\.json", "warmstart\.json"\]\)/);
  assert.match(read("web/src/ui/levelling.ts"), /dataWorker\("levelling-worker\.js", \["gamedata\.json"\]\)/);
  assert.match(read("web/src/ui/farming.ts"), /dataWorker\("farming-worker\.js", \["gamedata\.json"\]\)/);
  for (const f of ["battle-page", "battle-search", "levelling", "farming", "timeline"]) {
    assert.doesNotMatch(read(`web/src/ui/${f}.ts`), /new Worker\(|fetch\("data\/(gamedata|timelines)\.json"\)/, f);
  }
  for (const f of ["battle-worker", "levelling-worker", "farming-worker"]) {
    const src = read(`web/src/ui/${f}.ts`);
    assert.match(src, /if \(takeDataMessage\(e\.data\)\)|if \(!takeDataMessage\(e\.data\)\)/, f);
    assert.doesNotMatch(src, /fetch\(/, f);
  }
});

test("F15: the wiki loads the timelines only on the enemy and skill routes", () => {
  const wiki = read("web/src/ui/wiki.ts");
  const ready = wiki.slice(wiki.indexOf("const ready = Promise.all(["), wiki.indexOf("]);", wiki.indexOf("const ready = Promise.all([")));
  assert.doesNotMatch(ready, /loadTimelineData/);
  assert.match(wiki, /if \(needsTimelines\(\)\) await loadTimelineData\(\)\.catch\(\(\) => \{\}\);\n\s*paint\(top\);/);
  assert.match(wiki, /return first === "enemy" \|\| first === "skill";/);
});

test("F19: watchGrowth checks on resize only, stops when done, times out", async () => {
  const { watchGrowth } = await import("../src/ui/scroll-memory.ts");
  const observers: { cb: () => void; target: unknown; off: boolean }[] = [];
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    o: { cb: () => void; target: unknown; off: boolean };
    constructor(cb: () => void) {
      this.o = { cb, target: null, off: false };
      observers.push(this.o);
    }
    observe(t: unknown) {
      this.o.target = t;
      queueMicrotask(() => this.o.cb()); // like the browser: a first callback after observe
    }
    disconnect() {
      this.o.off = true;
    }
  };
  let height = 100, checks = 0;
  const body = {} as Element;
  watchGrowth(body, () => (checks++, height >= 500), 10_000);
  await Promise.resolve();
  assert.equal(checks, 1, "first check right after observing");
  assert.equal(observers[0].target, body);
  height = 600;
  observers[0].cb();
  assert.equal(checks, 2);
  assert.ok(observers[0].off, "done: observer disconnected");

  let timedOut = false;
  const stop = watchGrowth(body, () => false, 20, () => (timedOut = true));
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(timedOut && observers[1].off);
  stop(); // harmless after the end

  let ended = false;
  const stop2 = watchGrowth(body, () => false, 20, () => (ended = true));
  stop2();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!ended && observers[2].off, "stopped by the visitor: no timeout callback");
  delete (globalThis as Record<string, unknown>).ResizeObserver;

  const src = read("web/src/ui/scroll-memory.ts");
  assert.match(src, /watchGrowth\(document\.body, reached, RESTORE_TIMEOUT/);
  assert.doesNotMatch(src, /requestAnimationFrame\(step\)/);
});

test("F21: no source maps unless asked", () => {
  const sh = read("web/scripts/assemble-site.sh");
  assert.match(sh, /if \[\[ "\$\{SOURCEMAP:-\}" == 1 \]\]; then MAPS=\(--sourcemap\); fi/);
  assert.doesNotMatch(sh.replace(/^#.*$/gm, ""), /--sourcemap(?!\))/);
});
