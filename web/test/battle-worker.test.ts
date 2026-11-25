import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gamedata = readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8");
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/battle-worker.js" } };
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
const { runBattle } = await import("../src/ui/battle-worker.ts");

// A made-up level-20 warrior in the save format.
const HERO = {
  id: 1, heroID: 1, name: "Test", class: 1, level: 20, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], passiveSelect: "Might", campaignID: -1, questListID: -1,
  heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
};

test("quest fights: deterministic, rotation override is used", async () => {
  const base = { gameMode: "Standard", front: [HERO, null, null], back: [null, null, null], n: 30, quest: { id: 1, rare: false, amount: 1 } };
  const a = await runBattle(base);
  const b = await runBattle(base);
  assert.ok(a.ok && a.kind === "quest", JSON.stringify(a));
  assert.deepEqual(b.ok && b.kind === "quest" && b.result, a.result, "same seeds, same results");
  const h = a.result.heroes.front1;
  assert.ok(h.skillUses.Basic > 0 && !h.skillUses.Slash);
  const c = await runBattle({ ...base, skills: { front: [{ attackList: ["Slash", "Basic", "Basic", "Basic", "Basic"] }, null, null], back: [null, null, null] } });
  assert.ok(c.ok && c.kind === "quest");
  assert.ok(c.result.heroes.front1.skillUses.Slash > 0, "edited rotation reaches the fight");
});

test("errors come back as messages", async () => {
  const r = await runBattle({ gameMode: "Standard", front: [HERO, null, null], back: [null, null, null], n: 5, quest: { id: 999999, rare: false, amount: 1 } });
  assert.equal(r.ok, false);
});

test("map run", async () => {
  const r = await runBattle({ gameMode: "Standard", front: [HERO, null, null], back: [null, null, null], n: 3, map: { spec: { id: 1, prestigeLevel: 0, grade: 3 }, scrolls: [] } });
  assert.ok(r.ok && r.kind === "map", JSON.stringify(r));
  assert.equal(r.result.n + r.result.errors, 3);
});
