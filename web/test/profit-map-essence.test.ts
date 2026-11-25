// Profit's map essence (src/tools/profit.ts mapEssence / mapEssenceMultiplier) counts a prefix's essence modifier
// (data.PrefixData.lua mapStats.essenceMod: Skilled x1.25, Expert's x1.5) on top of its sell bonus and the suffix's
// atk, rounded once as the game does (default.finalMapMod folds it into essenceBase before mapEssenceReward).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { mapEssenceReward } from "../src/sim/defaults.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import { k2, mapEssence, mapEssenceMultiplier } from "../src/tools/profit.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const g = gameFromData();

const MAP = 22; // Grimal-Frentir Map: base reward 100 / 50
const TITAN = 20, SKILLED = 35, EXPERT = 36;
const C = 3;

const profit = (id: number, asc: number, grade: number, prefix: number, suffix: number, luck = 0) =>
  [...mapEssence(g, id, asc, grade, [[1.0, prefix, suffix]], luck)].map(([k, v]) => [k, v] as [string, number]);

test("map 22 at grade C: 100/50 plain, 130/65 Titan's, 195/98 Expert's", () => {
  assert.deepEqual(profit(MAP, 0, C, 0, 0).map(([, v]) => v), [100, 50]);
  assert.deepEqual(profit(MAP, 0, C, TITAN, 0).map(([, v]) => v), [130, 65]);
  assert.deepEqual(profit(MAP, 0, C, EXPERT, 0).map(([, v]) => v), [195, 98]);
  assert.equal(mapEssenceMultiplier(g, EXPERT, 0), 1.3 * 1.5);
  // the modifier comes from the game data, not a table in profit.ts
  assert.equal(g.prefixes.get(SKILLED).mapStats.essenceMod, 1.25);
  assert.equal(g.prefixes.get(EXPERT).mapStats.essenceMod, 1.5);
});

test("Profit's map essence matches the engine's for prefix and suffix combinations", () => {
  const cases: [number, number, number, number][] = [ // [map, asc, prefix, suffix]
    [MAP, 0, 0, 0], [MAP, 0, TITAN, 0], [MAP, 0, SKILLED, 0], [MAP, 0, EXPERT, 0], [MAP, 0, 0, 5],
    [MAP, 0, SKILLED, 5], [MAP, 0, EXPERT, 5], [MAP, 0, EXPERT, 12], [MAP, 1, EXPERT, 17], [1, 0, SKILLED, 3], [7, 0, EXPERT, 8],
  ];
  let checked = 0;
  for (const [id, asc, prefix, suffix] of cases) {
    const map = api.makeMap({ id, prestigeLevel: asc, grade: C, prefix: prefix || undefined, suffix: suffix || undefined, seed: 1 });
    // the engine took the modifiers (a prefix or suffix out of the map's level range is still applied when forced)
    assert.equal(map.prefix ?? 0, prefix, `map ${id} prefix`);
    for (const grade of [1, 3, 5]) for (const luck of [0, 37]) {
      const engine = mapEssenceReward(id, asc, grade, map.finalMapStats, luck).map((e: { id: number; amount: number }) =>
        [k2("material", e.id), e.amount]);
      assert.deepEqual(profit(id, asc, grade, prefix, suffix, luck), engine, `map ${id} asc ${asc} ${prefix}/${suffix} grade ${grade} luck ${luck}`);
      checked++;
    }
  }
  assert.equal(checked, cases.length * 6);
});
