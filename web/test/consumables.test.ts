/** Potions and hero enchants in combat (web/src/tools/consumables.ts) on made-up heroes: CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { applyConsumable, consumableMatrix, consumableOptions, rankConsumables } from "../src/tools/consumables.ts";
import { Sim } from "../src/tools/engine.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const hero = (level: number, prestige = 1) => sim.hero({
  id: 1, heroID: 1, name: "Test", class: 1, level, exp: 0, prestigeLevel: prestige, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
});
const idOf = (name: string) => Number(Object.entries(G.itemData.consumable).find(([, c]: [string, unknown]) => (c as { name: string }).name === name)![0]);

test("options follow the game: potion level requirement, enchant slots, ascended stats", () => {
  const low = consumableOptions(hero(10), "boost", [0]).map((o) => o.name);
  assert.ok(low.includes("Atk Boost") && !low.includes("Atk Boost +1"), "Atk Boost +1 (item level 52) needs level 47");
  assert.ok(consumableOptions(hero(47), "boost", [0]).some((o) => o.name === "Atk Boost +1"));
  const asc2 = consumableOptions(hero(60, 3), "boost", [2]).find((o) => o.name === "Atk Boost +1")!;
  assert.equal(asc2.stats.atk, 360, "x3 at asc 2");
  const h = hero(20);
  h.enchantList = Array.from({ length: h.maxEnchants }, () => ({ id: 16, prestigeLevel: 0, stat: { atk: 3 } }));
  assert.deepEqual(consumableOptions(h, "enchant"), [], "no free enchant slot");
});

test("applying a potion or an enchant changes the stats; undo puts them back", () => {
  const h = hero(30);
  const hp = sim.stats(h).maxHP, atk = sim.stats(h).atk;
  const potion = consumableOptions(h, "boost", [0]).find((o) => o.name === "Def Boost +1")!;
  const undo = applyConsumable(h, potion);
  assert.ok(sim.stats(h).def > 0 && h.boost && h._keepBoost);
  const res = sim.fight(1, [h], [], { seed: 1 });
  assert.ok(res.heroes.length === 1 && h.boost, "the potion survives the fight when a tool applied it");
  undo();
  assert.equal(sim.stats(h).maxHP, hp);
  const ench = consumableOptions(h, "enchant", [0]).find((o) => o.id === idOf("Atk Enchant"))!;
  const undoE = applyConsumable(h, ench);
  assert.ok(Math.abs(sim.stats(h).atk - (atk / 1.1 + 3) * 1.1) < 1e-9, "+3 atk before the passive's +10 % (Might)");
  undoE();
  assert.equal(sim.stats(h).atk, atk);
});

test("ranking: best gain first, same seeds, hero restored; enchant fill gain", () => {
  const h = hero(30);
  const before = sim.stats(h);
  const r = rankConsumables(sim, h, [h], [], { quest: 3 }, { kind: "boost", n: 10, ascs: [0] });
  assert.ok(r.ranked.length > 5);
  for (let i = 1; i < r.ranked.length; i++) assert.ok(r.ranked[i - 1].gain >= r.ranked[i].gain);
  assert.deepEqual(sim.stats(h), before);
  const e = rankConsumables(sim, h, [h], [], { quest: 3 }, { kind: "enchant", n: 10, ascs: [0] });
  assert.equal(e.freeSlots, h.maxEnchants);
  assert.equal(typeof e.fillGain, "number");
  assert.equal(h.enchantList.length, 0);
});

test("class matrix: one row per class with its best options", () => {
  const rows = consumableMatrix(sim, { quest: 3 }, { classes: [1, 3], level: 20, prestige: 1, n: 5, ascs: [0], top: 2 });
  assert.deepEqual(rows.map((r) => r.className), ["Warrior", "Mage"]);
  assert.ok(rows.every((r) => r.best.length === 2));
});
