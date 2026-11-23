import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { parseSave } from "../src/tools/save.ts";
import { crafterRows, gradeLabel, heroViews, inventoryRows, summary, toCsv } from "../src/ui/save-tables.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

// A made-up save in the game's format: one warrior with gear, a few stacks, one crafter.
const RAW = {
  version: 1.21, gameMode: "Standard", gold: 1234, mapSlotsUnlocked: 3,
  inventory: ["1|1|25|3", "3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
  mapInventory: [],
  sales: ["1|1|5|3|S99B60C1", 0],
  crafter: [{ id: 1, level: 12, ascLevel: 0, prestigeLevel: 2, isCrafting: false }],
  hero: [{
    id: 1, heroID: 1, name: "Test", class: 1, level: 10, exp: 0, prestigeLevel: 1, hp: 100, questHP: 100,
    attackList: [1, 0, 0, 0, 0], passiveSelect: "Might", campaignID: -1, questListID: -1,
    heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
  }],
};

test("grade labels", () => {
  assert.equal(gradeLabel(5), "S");
  assert.equal(gradeLabel({ B: 93, A: 100 }), "B93 A100");
});

test("save tables from a synthetic save", () => {
  const sv = parseSave(structuredClone(RAW));
  const views = heroViews(sv);
  assert.equal(views.length, 1);
  assert.equal(views[0].row.class, "Warrior");
  assert.ok(views[0].stats && views[0].stats.maxHP > 0, views[0].statsError);
  assert.equal(views[0].gear.length, 1);
  const inv = inventoryRows(sv);
  assert.deepEqual(inv.map((r) => r.where), ["inventory", "inventory", "counter"]);
  assert.equal(inv[2].sale_price, 99);
  assert.equal(inv[0].total_sell, (inv[0].unit_sell as number) * 25);
  assert.equal(crafterRows(sv)[0].crafter, "Blacksmith");
  const s = summary(sv);
  assert.equal(s.gold, 1234);
  assert.equal(s.saleSlotsUsed, 1);
});

test("CSV quoting", () => {
  assert.equal(toCsv([{ a: "x,y", b: 'say "hi"' }, { a: 1, c: null }]), 'a,b,c\n"x,y","say ""hi""",\n1,,\n');
});
