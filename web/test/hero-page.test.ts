import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { parseSave } from "../src/tools/save.ts";
import { bySlot, GEAR_SLOT_NAMES, GEAR_SLOTS, gearSlot } from "../src/ui/dom.ts";
import { heroViews, rotationAp } from "../src/ui/save-tables.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

/** A made-up save: warriors at a few levels, no gear (no apMod), the first two class skills in the rotation. */
const save = (levels: number[]) => parseSave(structuredClone({
  version: 1.21, gameMode: "Standard", gold: 0, inventory: [], mapInventory: [], sales: [], crafter: [],
  hero: levels.map((level, i) => ({
    id: i + 1, heroID: i + 1, name: `W${level}`, class: 1, level, exp: 0, prestigeLevel: 1, hp: 100, questHP: 100,
    attackList: [1, 2, 0, 0, 0], passiveSelect: "", campaignID: -1, questListID: -1, heroInventory: [],
  })),
}));

test("hero AP budget follows the engine rule: 5 + floor((min(level, 40) - 10) / 2) + apMod", () => {
  const levels = [10, 11, 30, 40, 60];
  const views = heroViews(save(levels));
  views.forEach((v, i) => {
    assert.ok(v.ap, v.statsError);
    const expected = 5 + Math.floor((Math.min(levels[i], 40) - 10) / 2);
    assert.equal(v.ap!.max, expected, `level ${levels[i]}`);
    assert.equal(v.ap!.max, v.stats!.maxActionPoints);
    assert.equal(v.ap!.used, rotationAp(v.rotation));
  });
  assert.equal(views[3].ap!.max, 20); // a level-40 Warrior has 20 AP
});

test("rotation AP sums the skills' apCost; Basic and unknown skills cost 0", () => {
  const [a, b] = Object.values(G.heroList[1].skillList) as string[];
  const cost = (n: string) => Number(G.abilityData[n].apCost);
  assert.equal(rotationAp([a, b, "Basic", "Basic", "Basic"]), cost(a) + cost(b));
  assert.equal(rotationAp(["Basic", "#99"]), 0);
});

test("gear slots: itemSlot numbers and names, two columns in reading order", () => {
  assert.deepEqual([...GEAR_SLOTS], ["weapon", "head", "body", "hands", "feet", "trinket"]);
  assert.deepEqual(GEAR_SLOTS.map((s) => GEAR_SLOT_NAMES[s]), ["Weapon", "Head", "Chest", "Bracers", "Feet", "Talisman"]);
  assert.equal(gearSlot(1), "weapon");
  assert.equal(gearSlot("6"), "trinket");
  assert.equal(gearSlot("hands"), "hands");
  assert.equal(gearSlot(7), undefined);
  assert.equal(gearSlot("chest"), undefined);
  const items = [{ s: 6, n: "t" }, { s: "weapon", n: "w" }, { s: 1, n: "w2" }, { s: 9, n: "x" }];
  assert.deepEqual(bySlot(items, (i) => i.s), { trinket: items[0], weapon: items[1] });
});
