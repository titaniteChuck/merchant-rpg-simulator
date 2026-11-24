// U37: wiki tables. Crafting cost, total cost (the whole recipe tree, raw materials and bars included) and sell value
// per ascension variant; maps with two variants; no Description column, "Origin" for "Made by"; no sell ranges in
// the tables; the enemy table's Region column alone and no Maps column; base and rare enemies on one line by region.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { sellValue } from "../src/tools/engine.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import { enemiesWith, enemyLines, items, regionOf } from "../src/ui/wiki-data.ts";
import { enemyListColumns } from "../src/ui/wiki-enemies.ts";
import { craftCost, itemAscLevels, recipeOf, recipeTree, sellAt, totalCost, unitPrice } from "../src/ui/wiki-items.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const idOf = (type: string, name: string) => items(type).find(([, it]) => it.name === name)![0];

test("total cost of a bar: its gold plus the ore at its average sell value per unit", () => {
  const ingot = idOf("material", "Iron Ingot"), ore = idOf("material", "Iron Ore");
  assert.deepEqual(recipeOf("material", ingot), [["material", ore, 2]]);
  assert.equal(unitPrice("material", ore), 3); // the data's 2–4, averaged
  assert.equal(craftCost("material", ingot), 5);
  assert.equal(totalCost("material", ingot), 5 + 2 * 3);
  // materials have no ascension: one value, the other slots empty
  assert.deepEqual(itemAscLevels("material", ingot), [0]);
  assert.equal(craftCost("material", ingot, 1), null);
  assert.equal(sellAt("material", ingot, 1), null);
  assert.equal(totalCost("material", ore), null, "not crafted: no cost");
});

test("total cost walks the whole tree: bars and raw materials included, the same in the crafting chain", () => {
  // Adaman Sword: 2 Adaman Ingot (crafted from ore) + 1 raw material; the chain draws no box for the ingots
  const sword = idOf("equipment", "Adaman Sword");
  const expect = (type: string, id: number): number => {
    let sum = G.itemData[type][id].cost ?? 0;
    for (const [t, mid, amt] of recipeOf(type, id)) sum += amt * (recipeOf(t, mid).length ? expect(t, mid) : sellValue(t, mid, 0)!);
    return sum;
  };
  const total = totalCost("equipment", sword)!;
  assert.equal(total, expect("equipment", sword));
  const raw = recipeOf("equipment", sword).filter(([t, mid]) => !recipeOf(t, mid).length);
  assert.ok(raw.length > 0 && total > G.itemData.equipment[sword].cost, "raw materials add to the craft gold");
  const tree = recipeTree("equipment", sword)!;
  assert.equal(tree.kids.length, 0);
  assert.equal(tree.totalCost, total);
  assert.ok(tree.rawCost > 0);
  // the deepest chain: every node's total matches the table's
  const spear = recipeTree("equipment", 495)!;
  const walk = (n: typeof spear): void => {
    assert.equal(n.totalCost, totalCost(n.type, n.id, 0), n.name);
    n.kids.forEach(walk);
  };
  walk(spear);
});

test("ascended costs: the same gold plus the orbs, ingredients at the same ascension", () => {
  const g = gameFromData();
  const sword = idOf("equipment", "Adaman Sword");
  assert.deepEqual(itemAscLevels("equipment", sword), [0, 1, 2]);
  for (const a of [1, 2]) {
    const [eid, amount] = g.essenceForAscension("equipment", sword, a, false);
    assert.equal(craftCost("equipment", sword, a), G.itemData.equipment[sword].cost + amount * sellValue("material", eid, 0)!);
    assert.equal(sellAt("equipment", sword, a), sellValue("equipment", sword, a));
  }
  // Hard Tuvale Map takes a Tuvale Map: at asc 1 that map is an asc-1 one too
  const hard = idOf("map", "Hard Tuvale Map"), tuvale = idOf("map", "Tuvale Map");
  const fromTuvale = (a: number) => recipeOf("map", hard).reduce((s, [t, mid, amt]) =>
    s + amt * (t === "map" ? totalCost(t, mid, a)! : recipeOf(t, mid).length ? totalCost(t, mid, 0)! : sellValue(t, mid, 0)!), 0);
  assert.equal(totalCost("map", hard, 1), craftCost("map", hard, 1)! + fromTuvale(1));
  assert.ok(totalCost("map", tuvale, 1)! > totalCost("map", tuvale, 0)!);
});

test("maps have two variants (asc 0 and 1), equipment and consumables three", () => {
  const tuvale = idOf("map", "Tuvale Map");
  assert.deepEqual(itemAscLevels("map", tuvale), [0, 1]);
  assert.equal(sellAt("map", tuvale, 2), null);
  assert.equal(craftCost("map", tuvale, 2), null);
  assert.deepEqual(itemAscLevels("consumable", idOf("consumable", "Minor Potion")), [0, 1, 2]);
  // every crafted item has a total for each of its variants
  for (const type of ["equipment", "consumable", "material", "map"]) {
    for (const [id] of items(type)) {
      if (!recipeOf(type, id).length) continue;
      for (const a of itemAscLevels(type, id)) assert.ok(Number.isFinite(totalCost(type, id, a)), `${type} ${id} asc ${a}`);
    }
  }
});

test("item and map tables: Cost, Total cost and Sell value columns; Origin; no Description; no sell ranges", () => {
  const wiki = read("web/src/ui/wiki.ts");
  for (const label of ['label: "Cost"', 'label: "Total cost"', 'label: "Sell value"', 'label: "Origin"']) assert.ok(wiki.includes(label), label);
  assert.ok(!wiki.includes('label: "Description"'));
  assert.ok(!wiki.includes('label: "Made by"'));
  assert.match(wiki, /priceColumns\("map", ids\)/);
  // the cells: plain numbers in tier-coloured boxes, no "g" (dom.ts ascValues)
  const dom = read("web/src/ui/dom.ts");
  assert.match(dom, /export function ascValues/);
  assert.match(dom, /class: `av tier-\$\{ascLevel\(a\)\}`[^)]*\}, goldNumber\(v\)\)/);
  // the data's min–max pair stays in the detail pages' tooltip only
  assert.ok(!read("web/src/ui/wiki-items.ts").includes("sell-range"));
  assert.ok(!read("site/style.css").includes(".sell-range"));
});

test("enemy table: the Region column is the region alone, and there is no Maps column", () => {
  const keys = enemyListColumns.map((c) => c.key);
  assert.ok(!keys.includes("maps"));
  assert.ok(keys.includes("region") && keys.includes("kind"));
  assert.match(read("web/src/ui/wiki-enemies.ts"), /regionChip\(regionOf\("enemy", Number\(r\.id\)\), false, \{ tag: false \}\)/);
});

test("enemies with a skill: base and rare on one line, in region order", () => {
  const list = enemiesWith("Basic");
  const lines = enemyLines(list);
  const ids = new Set(list.map((e) => e.id));
  assert.equal(lines.length, ids.size, "one line per enemy");
  const both = lines.filter((l) => l.base && l.rare);
  assert.ok(both.length > 0, "some base enemies and their rare variant share a line");
  const order = lines.map((l) => regionOf("enemy", l.id)?.order ?? 99);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // a rare variant alone (its base doesn't play the skill) keeps its own line
  const rareOnly = enemyLines([{ id: both[0].id, name: both[0].rare!, rare: true }]);
  assert.deepEqual(rareOnly, [{ id: both[0].id, rare: both[0].rare }]);
});
