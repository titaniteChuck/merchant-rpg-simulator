import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gamedata = readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8");
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/profit-worker.js" } };
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
const { runProfit } = await import("../src/ui/profit-worker.ts");
const { howText, sortRows } = await import("../src/ui/profit-tables.ts");

const BASE = { id: 1, grade: 3, luck: 0, crafterLevel: 60, enchanterLevel: 60, mapMods: true, alloc: "value" as const, essenceFrom: [] };

test("worker: plain, cloneable tables and orbs", async () => {
  const r = await runProfit(BASE);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.id, 1);
  assert.ok(r.items.length > 2000 && r.enchant.length > 1000 && r.essence.length > 50);
  const top = r.items[0];
  assert.equal(typeof top.best_profit, "number", "PyFloat cells become numbers");
  assert.ok(r.items.every((x) => Object.values(x).every((v) => v === null || ["number", "string"].includes(typeof v))), "no \"\" or objects");
  assert.ok(Number(top.best_profit) >= Number(r.items[1].best_profit), "sorted by best_profit");
  assert.deepEqual(structuredClone(r), r);
  assert.equal(r.orbs.length, 12);
  const forest = r.orbs.find((o) => o.name === "Forest Essence")!;
  assert.equal(forest.tier, 1);
  assert.equal(forest.region, 0);
  assert.ok(forest.cost! > 0 && forest.mapId !== null);

  // force another map for Water Essence (Yarsol Map, not the cheapest): it gets dearer and the chosen source moves
  const water = r.orbs.find((o) => o.name === "Water Essence")!;
  const other = r.essence.find((x) => x.essence_id === water.id && x.map === "Yarsol Map" && x.chosen !== "yes")!;
  const f = await runProfit({ ...BASE, id: 2, essenceFrom: [[water.id, Number(other.map_id), 0]] });
  assert.ok(f.ok);
  const forced = f.orbs.find((o) => o.id === water.id)!;
  assert.equal(forced.mapId, Number(other.map_id));
  assert.ok(forced.cost! > water.cost!);
  assert.equal(f.items.length, r.items.length);
});

test("route text and sorting", () => {
  assert.equal(howText("craft (Woodworker) at asc 2"), "Craft (Woodworker)");
  assert.equal(howText("ascend asc0 item (+20x Forest Essence)"), "Ascend the ascension-0 item (20 × Forest Essence)");
  assert.equal(howText("map loot Tuvale Map (valued at sell price)"), "Loot of Tuvale Map");
  const rows = [{ v: 2 }, { v: null }, { v: 5 }, { v: -1 }];
  assert.deepEqual(sortRows(rows, { key: "v", desc: true }).map((r) => r.v), [5, 2, -1, null]);
  assert.deepEqual(sortRows(rows, { key: "v", desc: false }).map((r) => r.v), [-1, 2, 5, null]);
});
