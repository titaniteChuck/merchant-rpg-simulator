/** Merged party search (web/src/tools/parties.ts) on made-up heroes: no save file needed, so CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { type PartyConfig, searchParties } from "../src/tools/parties.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const WEAPON = "3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0";
const raw = (id: number, cls: number, level: number) => ({
  id, heroID: id, name: `Test ${id}`, class: cls, level, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [WEAPON],
});
const pool = () => new Map([[1, sim.hero(raw(1, 1, 30))], [2, sim.hero(raw(2, 5, 30))], [3, sim.hero(raw(3, 3, 10))], [4, sim.hero(raw(4, 2, 5))]]);
const cheap = { nQuick: 4, nFinal: 8, beam: 3, refine: 2, rotations: false } as const;
const ids = (c: PartyConfig) => [...c.layout.front, ...c.layout.back].filter((x): x is number => x !== null);

test("the smallest party that wins comes first; ranking: winners, then fewer heroes, then score", () => {
  // quest 2 is easy for a level-30 hero: one hero is enough
  const r = searchParties(sim, pool(), { quest: 2 }, { ...cheap, maxSize: 3, topK: 6, enough: 2 });
  assert.ok(r.results.length > 0 && r.tried > 0 && !r.stopped);
  assert.equal(r.results[0].size, 1);
  assert.ok(r.results[0].ev.win >= 0.9);
  for (let i = 1; i < r.results.length; i++) {
    const a = r.results[i - 1], b = r.results[i];
    const wa = a.ev.win >= 0.9, wb = b.ev.win >= 0.9;
    // winners: fewer heroes, then score; the others: by score (a bigger party may simply get further)
    assert.ok(wa > wb || (wa === wb && (wa ? a.size < b.size || (a.size === b.size && a.score >= b.score) : a.score >= b.score)), `order at ${i}`);
  }
  // one configuration per hero set, layouts consistent with the size
  const sets = r.results.map((c) => ids(c).sort().join());
  assert.equal(new Set(sets).size, sets.length);
  for (const c of r.results) assert.equal(ids(c).length, c.size);
  assert.ok(r.results[0].tuned, "the winning size was tuned");
  // enough = 2 winners: it stops growing as soon as a size reaches it
  assert.ok(Math.max(...r.results.map((c) => c.size)) <= 3);
});

test("top-K, lock and exclude; heroes left as they were", () => {
  const p = pool();
  const before = [...p.values()].map((h) => [sim.rotation(h).join(), h.passiveSelect]);
  const r = searchParties(sim, p, { quest: 3 }, { ...cheap, rotations: true, minSize: 2, maxSize: 2, topK: 2, lock: [4], exclude: [3] });
  assert.ok(r.results.length <= 2);
  for (const c of r.results) {
    assert.ok(ids(c).includes(4), "locked hero in every party");
    assert.ok(!ids(c).includes(3), "excluded hero never");
    assert.equal(c.size, 2);
    for (const id of ids(c)) assert.equal(c.skills[id].rotation.length, 5);
  }
  assert.deepEqual([...p.values()].map((h) => [sim.rotation(h).join(), h.passiveSelect]), before);
  assert.throws(() => searchParties(sim, p, { quest: 3 }, { lock: [9] }), /not in the pool/);
});

test("scrolls only on map runs; a stop returns what was found", () => {
  const q = searchParties(sim, pool(), { quest: 2 }, { ...cheap, maxSize: 1, scrolls: true });
  assert.ok(q.results.every((c) => c.scrolls === null), "scrolls are ignored for quests");
  const m = searchParties(sim, pool(), { map: { id: 1, prestigeLevel: 0, grade: 3 } },
    { nQuick: 1, nFinal: 2, beam: 1, refine: 1, maxSize: 1, rotations: false, scrolls: true });
  assert.ok(m.results.length === 1 && "cleared" in m.results[0].ev);
  assert.ok(m.results[0].scrolls === null || m.results[0].scrolls.length <= 3);
  let calls = 0;
  const s = searchParties(sim, pool(), { quest: 3 }, { ...cheap, maxSize: 4 }, { shouldStop: () => ++calls > 30 });
  assert.equal(s.stopped, true);
  const z = searchParties(sim, pool(), { quest: 3 }, { ...cheap, timeBudgetMs: 0 });
  assert.equal(z.stopped, true);
  assert.deepEqual(z.results, []);
});
