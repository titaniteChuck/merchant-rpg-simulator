// Wiki v5 (U24): regions (wiki-data.ts regionOf), Treasure Bushes in the lists, drop tables' "Nothing" row data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import {
  bushLevels, bushMaps, enemyIds, enemyLevelSort, enemyLevelText, items, mapRegionId, quest, regionOf, regionOfLevel, regionSortKey, treasureBushOf,
} from "../src/ui/wiki-data.ts";
import { lootTable } from "../src/ui/wiki-loot.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

test("enemy regions: the quest board's region field, event bosses and map bosses grouped", () => {
  for (const id of enemyIds()) {
    const q = quest(id), r = regionOf("enemy", id)!;
    assert.ok(r.id >= 1 && r.id <= 6, `${q.name}`);
    if (q.questType === 6) assert.equal(r.group, "event", q.name);
    else if (q.questType === 8 && q.title !== "Treasure Bush") assert.equal(r.group, "map", q.name);
    else {
      assert.equal(r.group, "region", q.name);
      assert.equal(r.id, q.region, `${q.name}: the region field`);
    }
  }
  // Fatalis: Grimhal's final boss sorts under Grimhal, before every Frentir enemy
  const fatalis = regionOf("enemy", 57)!;
  assert.equal(fatalis.name, "Grimhal");
  const frentir = enemyIds().filter((id) => regionOf("enemy", id)!.id === 6);
  assert.ok(frentir.every((id) => regionSortKey(regionOf("enemy", id), quest(id).levelReq) > regionSortKey(fatalis, 50)));
  // event bosses: the region the event sends you to
  assert.deepEqual([61, 62, 74].map((id) => regionOf("enemy", id)!.name), ["Yarsol", "Aldur", "Vulkrum"]);
  // map bosses: their map's region (Protector of the Forest's own field says Tuvale; it is met in a level-58 map)
  assert.equal(quest(95).region, 1);
  assert.deepEqual([91, 92, 93, 94, 95, 96, 97, 98].map((id) => regionOf("enemy", id)!.name),
    ["Tuvale", "Yarsol", "Aldur", "Grimhal", "Frentir", "Frentir", "Frentir", "Frentir"]);
});

test("Treasure Bushes are enemies, one per region, in the region of the maps they hide in", () => {
  const bushes = enemyIds().filter((id) => quest(id).title === "Treasure Bush");
  assert.deepEqual(bushes, [99, 100, 101, 102, 103, 104]);
  bushes.forEach((id, i) => assert.equal(regionOf("enemy", id)!.id, i + 1));
  for (const [, m] of items("map")) {
    const b = treasureBushOf(m.itemLevel ?? 0);
    if (b) assert.equal(Math.ceil((m.itemLevel || 1) / 10), b - 98, m.name);
  }
});

test("a Treasure Bush shows the level range of the maps it spawns in (not its quest levelReq)", () => {
  // Bush 99 (levelReq 10) is the Tuvale bush: maps of level 1-10, Tuvale Map (1) … Yarsol Map (10).
  assert.equal(quest(99).levelReq, 10);
  assert.deepEqual(bushLevels(99), { lo: 1, hi: 10 });
  assert.equal(enemyLevelText(99), "1–10");
  assert.ok(bushMaps(99).includes(1), "Tuvale Map");
  assert.deepEqual(bushMaps(99).map((id) => G.itemData.map[id].name), ["Tuvale Map", "Hard Tuvale Map", "Goblin's Feast Map", "Yarsol Map"]);
  const r = regionOf("enemy", 99)!;
  assert.equal(r.name, "Tuvale");
  assert.match(r.why, /Bush of maps lvl 1–10/); // R1 F40: neutral format; "lvl" (the user, 2026-11-25)
  // sorted by the lowest map level: the first Tuvale enemy, not after the level-9 ones
  assert.equal(enemyLevelSort(99), 1);
  assert.deepEqual([100, 101, 102, 103, 104].map(enemyLevelText), ["13–20", "23–30", "35–40", "45–50", "52–60"]);
  assert.deepEqual([100, 101, 102, 103, 104].map((id) => regionOf("enemy", id)!.name), ["Yarsol", "Aldur", "Vulkrum", "Grimhal", "Frentir"]);
  assert.deepEqual(bushMaps(2), [], "not a bush");
  assert.equal(enemyLevelText(2), String(quest(2).levelReq));
});

test("map and item regions", () => {
  // the game's map screen: min(floor(level / 10) + 1, 6)
  assert.deepEqual([1, 4, 17, 21, 27].map((id) => regionOf("map", id)!.name), ["Tuvale", "Yarsol", "Grimhal", "Frentir", "Frentir"]);
  assert.equal(mapRegionId(G.itemData.map[21]), 6);
  const mat = (name: string) => items("material").find(([, m]) => m.name === name)![0];
  const eq = (name: string) => items("equipment").find(([, m]) => m.name === name)![0];
  // tier materials at level 10, 20 … belong to the region that drops them, not the level band
  assert.equal(regionOf("material", mat("Mithril Ore"))!.name, "Yarsol");
  assert.equal(regionOf("material", mat("Mithril Ingot"))!.name, "Yarsol"); // crafted from Mithril Ore
  assert.equal(regionOf("material", mat("Glacial Ore"))!.name, "Frentir");
  assert.equal(regionOf("material", mat("Forest Essence"))!.name, "Tuvale");
  assert.equal(regionOf("equipment", eq("Warlord's Blade"))!.name, "Tuvale");
  assert.equal(regionOf("equipment", eq("Glacial Dagger"))!.name, "Frentir");
  assert.equal(regionOf("equipment", eq("Fate's Call"))!.name, "Grimhal");
  for (const t of ["equipment", "consumable", "material"] as const) for (const [id] of items(t)) assert.ok(regionOf(t, id), `${t} ${id}`);
  assert.deepEqual([0, 1, 10, 11, 50, 51, 60, 99].map(regionOfLevel), [1, 1, 1, 2, 5, 6, 6, 6]);
});

test("loot table: Nothing plus the items add up to 100 % at every grade", () => {
  const t = lootTable("Arachne")!;
  for (let g = 0; g < 5; g++) assert.ok(Math.abs(t.nothing[g] + t.rows.reduce((s, r) => s + r.chance[g], 0) - 100) < 1e-9);
});
