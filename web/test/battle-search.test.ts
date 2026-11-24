import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The battle page's search tabs (runSearch in the worker), on made-up heroes so CI can run it.
const gamedata = readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8");
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/battle-worker.js" } };
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
const { runSearch } = await import("../src/ui/battle-worker.ts");
type Msg = Parameters<Parameters<typeof runSearch>[1]>[0];

const hero = (id: number, cls: number, name: string) => ({
  id, heroID: id, name, class: cls, level: 20, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], passiveSelect: "Might", campaignID: -1, questListID: -1,
  heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
});
const WARRIOR = hero(1, 1, "Tank"), MAGE = hero(2, 3, "Caster");
const base = { gameMode: "Standard", front: [null, WARRIOR, null], back: [MAGE, null, null] };
const QUEST = { id: 10, rare: false, amount: 1 }; // a party quest (2 heroes): the game keeps front 2 filled

async function run(req: Parameters<typeof runSearch>[0]): Promise<{ done: Extract<Msg, { type: "done" }>; progress: Msg[] }> {
  const msgs: Msg[] = [];
  await runSearch(req, (m) => msgs.push(m));
  const done = msgs.find((m) => m.type === "done");
  assert.ok(done, JSON.stringify(msgs.find((m) => m.type === "error")));
  return { done: done as Extract<Msg, { type: "done" }>, progress: msgs.filter((m) => m.type === "progress") };
}

test("best rotation: ranked candidates, progress per stage", async () => {
  const { done, progress } = await run({ ...base, search: "skills", hero: { row: "front", i: 1 }, quest: QUEST, nQuick: 2, nFinal: 3, top: 2 });
  assert.equal(done.search, "skills");
  if (done.search !== "skills") return;
  assert.ok(done.result.ranked.length >= 1);
  assert.equal(done.result.ranked[0].rotation.length, 5);
  assert.ok(progress.some((p) => p.type === "progress" && p.stage === "skill sets"));
});

test("best gear from the catalog", async () => {
  const { done } = await run({ ...base, search: "gear", hero: { row: "front", i: 1 }, quest: QUEST, n: 2, passes: 1, pool: "catalog", itemGrade: 3, asc: 0 });
  assert.equal(done.search, "gear");
  if (done.search === "gear") assert.equal(done.result.gear.length, 6);
});

test("best party for a quest uses hero ids", async () => {
  const { done } = await run({ ...base, search: "party", pool: [WARRIOR, MAGE], quest: QUEST, size: 2, nQuick: 2, nFinal: 3 });
  assert.equal(done.search, "party");
  if (done.search !== "party") return;
  const ids = [...done.result.party.front, ...done.result.party.back].filter((x) => x !== null);
  assert.ok(ids.length >= 1 && ids.every((x) => x === 1 || x === 2));
});

test("U27 solver (parties): ranked setups with stages, layout and skills by hero id", async () => {
  const { done, progress } = await run({ ...base, search: "parties", pool: [WARRIOR, MAGE], quest: QUEST, minSize: 1, maxSize: 2, scrolls: false, timeBudgetMs: 60000 });
  assert.equal(done.search, "parties");
  if (done.search !== "parties") return;
  assert.ok(done.result.results.length >= 1);
  const c = done.result.results[0];
  const ids = [...c.layout.front, ...c.layout.back].filter((x) => x !== null);
  assert.equal(ids.length, c.size);
  assert.ok(ids.every((x) => x === 1 || x === 2));
  for (const id of ids) assert.equal(c.skills[id as number].rotation.length, 5);
  // E21: a party quest's setups keep front 2 filled
  for (const r of done.result.results) assert.notEqual(r.layout.front[1], null);
  assert.ok(progress.some((p) => p.type === "progress" && p.stage === "solo"));
});

test("soft stop: no XMLHttpRequest in Node, so a stop URL is ignored", async () => {
  const { stopSignal } = await import("../src/ui/battle-worker.ts");
  assert.equal(stopSignal("blob:http://localhost/x"), undefined);
  assert.equal(stopSignal(undefined), undefined);
});

test("best scrolls on a map", async () => {
  const { done } = await run({ ...base, search: "scrolls", map: { spec: { id: 1, prestigeLevel: 0, grade: 3 } }, pool: [61, 62], scrollAsc: 0, nQuick: 1, nFinal: 1, top: 2 });
  assert.equal(done.search, "scrolls");
  if (done.search === "scrolls") assert.ok(done.result.ranked.length >= 2);
});

test("errors come back as messages", async () => {
  const msgs: Msg[] = [];
  await runSearch({ ...base, search: "skills", hero: { row: "back", i: 2 }, quest: QUEST, nQuick: 1, nFinal: 1, top: 1 }, (m) => msgs.push(m));
  assert.ok(msgs.some((m) => m.type === "error"));
});
