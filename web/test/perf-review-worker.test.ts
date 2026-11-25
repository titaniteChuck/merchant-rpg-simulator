// Review F16 (docs/tooling/roadmap/review-a11y-perf.md): the battle worker loads the timelines and the warm start on
// its first search only; a plain fight needs the game data alone, and the page's bytes are used when it sent them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gamedata = readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8");
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/battle-worker.js" } };
const urls: string[] = [];
globalThis.fetch = (async (u: URL) => {
  urls.push(new URL(String(u)).pathname);
  return String(u).endsWith("gamedata.json") ? { ok: true, json: async () => JSON.parse(gamedata) } : { ok: false, status: 404 };
}) as unknown as typeof fetch;
const { runBattle, runSearch } = await import("../src/ui/battle-worker.ts");
const { takeDataMessage } = await import("../src/ui/worker-data.ts");

const HERO = {
  id: 1, heroID: 1, name: "Test", class: 1, level: 20, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], passiveSelect: "Might", campaignID: -1, questListID: -1,
  heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
};

test("F13/F16: a fight uses the page's game data and fetches nothing; a search then loads its own files", async () => {
  // What dataWorker posts first (the page's copy of gamedata.json).
  assert.ok(takeDataMessage({ dataFiles: { "gamedata.json": new TextEncoder().encode(gamedata).buffer } }));
  const r = await runBattle({ gameMode: "Standard", front: [HERO, null, null], back: [null, null, null], n: 3, quest: { id: 1, rare: false, amount: 1 } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(urls, [], "no fetch at all for a fight");

  const msgs: { type: string }[] = [];
  await runSearch({ gameMode: "Standard", front: [HERO, null, null], back: [null, null, null], search: "skills", hero: { row: "front", i: 0 },
    quest: { id: 1, rare: false, amount: 1 }, nQuick: 1, nFinal: 1, top: 1 }, (m) => msgs.push(m));
  assert.ok(msgs.some((m) => m.type === "done"), JSON.stringify(msgs.find((m) => m.type === "error")));
  assert.deepEqual(urls.sort(), ["/data/timelines.json", "/data/warmstart.json"], "the search files, not the game data again");
});
