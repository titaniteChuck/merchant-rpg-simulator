import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The farming planner's worker (runFarming), on a made-up hero so CI can run it.
const gamedata = readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8");
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/farming-worker.js" } };
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
const { runFarming } = await import("../src/ui/farming-worker.ts");
type Msg = Parameters<Parameters<typeof runFarming>[1]>[0];

const HERO = {
  id: 1, heroID: 1, name: "Test", class: 1, level: 20, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], passiveSelect: "Might", campaignID: -1, questListID: -1,
  heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
};

test("farming report: one row per source, in order, with hourly rates", async () => {
  const msgs: Msg[] = [];
  await runFarming({
    gameMode: "Standard", front: [HERO, null, null], back: [null, null, null], n: 3, mapRuns: 2,
    sources: [{ kind: "quest", quest: 1 }, { kind: "quest", quest: 5 }, { kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 } }],
  }, (m) => msgs.push(m));
  const done = msgs.find((m) => m.type === "done");
  assert.ok(done && done.type === "done", JSON.stringify(msgs.find((m) => m.type === "error")));
  assert.deepEqual(done.rows.map((r) => [r.kind, r.id]), [["quest", 1], ["quest", 5], ["map", 1]]);
  for (const r of done.rows) assert.ok(Number.isFinite(r.value_per_hour) && r.time_h > 0);
  assert.ok(msgs.some((m) => m.type === "progress" && m.stage === "pricing items (once)"));
});

test("an empty party is an error message", async () => {
  const msgs: Msg[] = [];
  await runFarming({ gameMode: "Standard", front: [null, null, null], back: [null, null, null], n: 1, mapRuns: 1, sources: [{ kind: "quest", quest: 1 }] }, (m) => msgs.push(m));
  assert.ok(msgs.some((m) => m.type === "error"));
});

test("F01: each source is fought by its own heroes; a source the page says can't start comes back blocked", async () => {
  const msgs: Msg[] = [];
  await runFarming({
    gameMode: "Standard", front: [HERO, null, null], back: [null, null, null], n: 2, mapRuns: 1,
    sources: [{ kind: "quest", quest: 1 }, { kind: "quest", quest: 1 }], fight: [["front0"], "Put a hero in Front 1."],
  }, (m) => msgs.push(m));
  const done = msgs.find((m) => m.type === "done");
  assert.ok(done && done.type === "done");
  assert.equal(done.rows[0].blocked, undefined);
  assert.equal(done.rows[0].n, 2);
  assert.equal(done.rows[1].blocked, "Put a hero in Front 1.");
  assert.equal(done.rows[1].n, 0);
});
