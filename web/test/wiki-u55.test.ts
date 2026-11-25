// U55: a map page's bosses, room enemies and Treasure Bush in one table (bush first, bosses last, tagged and tinted),
// still on the U49 configuration's in-map stats with its "base" tags; the level-70 maps (no base time in the data, no
// way to get one in game 3.18) marked "not craftable" on the Maps list and their page, as on the enemy pages.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const api = await import("../src/sim/api.ts");
const { G } = await import("../src/sim/data.ts");
const { mapView, NO_CONFIG } = await import("../src/ui/wiki-config.ts");
const { mapEnemyTable, uncraftableTag } = await import("../src/ui/wiki-enemies.ts");
const { mapEnemies, treasureBushOf } = await import("../src/ui/wiki-data.ts");
const { isCraftableMap } = await import("../src/tools/quest-stats.ts");
const { seq } = await import("../src/sim/lua.ts");
api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const MAP = 22; // Grimal-Frentir Map: boss 89, bush 104
const VANQUISHERS = 16; // bosses 63, 64, 67, also drawn for the rooms

function tableOf(id: number, stats: unknown) {
  const m = G.itemData.map[id];
  const t = mapEnemyTable(treasureBushOf(m.itemLevel), mapEnemies(m), seq<number>(m.bossList), stats) as unknown as FakeElement;
  const rows = t.querySelectorAll("tr").filter((r) => r.querySelector("td"));
  return { t, rows, cls: rows.map((r) => r.getAttribute("class") ?? ""), names: rows.map((r) => r.querySelector("td")!.textContent) };
}

test("one table: the Treasure Bush row first, the room enemies, the boss rows last", () => {
  const { t, rows, cls } = tableOf(MAP, mapView(MAP, NO_CONFIG)!.stats);
  assert.ok(t.classList.contains("map-enemies"));
  assert.deepEqual(t.querySelectorAll("th").map((h) => h.textContent), ["Enemy", "Level", "HP", "Atk", "Matk", "Def", "Mdef", "Eva", "Skills"]);
  assert.equal(cls[0], "me-treasure");
  assert.match(rows[0].querySelector("td")!.textContent, /treasure/);
  const firstBoss = cls.indexOf("me-boss");
  assert.ok(firstBoss > 1, "room enemies between the bush and the boss");
  assert.ok(cls.slice(firstBoss).every((c) => c === "me-boss"), "the bosses are the last rows");
  assert.ok(cls.slice(1, firstBoss).every((c) => c === ""), "a room enemy has no tag");
  // the boss: normal and rare variant, both tagged
  assert.equal(cls.length - firstBoss, G.questData[89].enemyHpB ? 2 : 1);
  assert.match(rows[firstBoss].querySelector("td")!.textContent, /boss/);
  // in-map stats (U49): the boss's grade-C HP of the plain map, no "base" tag
  assert.match(rows[firstBoss].textContent, /41,250/);
  assert.doesNotMatch(t.textContent, /base/);
});

test("the table follows the configuration and keeps the base tags", () => {
  const s5 = tableOf(MAP, mapView(MAP, { asc: 0, prefix: 0, suffix: 5 })!.stats);
  assert.match(s5.rows[s5.cls.indexOf("me-boss")].textContent, /66,000/);
  const none = tableOf(MAP, null);
  assert.ok(none.rows.every((r) => /base/.test(r.querySelector("td")!.textContent)), "no engine stats: every row tagged");
});

test("a boss the rooms also draw is one row, tagged boss and room", () => {
  const { cls, names } = tableOf(VANQUISHERS, mapView(VANQUISHERS, NO_CONFIG)!.stats);
  const bosses = names.filter((_, i) => cls[i] === "me-boss");
  assert.ok(bosses.length >= 3);
  assert.ok(bosses.every((n) => /boss room/.test(n.replace(/\s+/g, " "))));
  assert.equal(new Set(names).size, names.length, "no duplicate row");
});

test("the map page: one Enemies section, no Boss / Room enemies / Treasure sections", () => {
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /section\("Enemies", mapEnemyTable\(bush, mapEnemies\(m\), bosses, view\?\.stats \?\? null\)\)/);
  assert.doesNotMatch(wiki, /section\("Room enemies"|section\("Treasure"|section\(`Boss/);
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* U55 */"), css.indexOf("/* end U55 */"));
  assert.match(block, /@media \(max-width: 600px\)/);
  assert.match(block, /\.map-enemies td:first-child, \.map-enemies th:first-child \{ position: sticky; left: 0;/);
});

test("maps without a base time: the six level-70 maps, none obtainable, marked not craftable", () => {
  const noTime = Object.entries<{ baseMapTime?: number; itemLevel: number }>(G.itemData.map).filter(([, m]) => !m.baseMapTime).map(([id]) => Number(id));
  assert.deepEqual(noTime, [27, 28, 29, 30, 31, 32]);
  for (const id of noTime) {
    assert.equal(G.itemData.map[id].itemLevel, 70);
    assert.equal(isCraftableMap(id), false);
  }
  // every map a crafter can make has its base time
  assert.ok(Object.keys(G.itemData.map).map(Number).filter((id) => isCraftableMap(id)).every((id) => G.itemData.map[id].baseMapTime > 0));
  assert.equal((uncraftableTag() as unknown as FakeElement).textContent, "not craftable");
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /isCraftableMap\(Number\(r\.id\)\) \? itemLink\("map", Number\(r\.id\)\)/, "Maps list");
  assert.match(wiki, /isCraftableMap\(id\) \? \["Level", m\.itemLevel\] : \["Level", el\("span", \{ class: "fact-compact" \}, String\(m\.itemLevel\), " ", uncraftableTag\(\)\)/, "map page (U56: a fact card)");
  assert.match(wiki, /isCraftableMap\(id\) \? recipeList\("map", id\) : null/, "no recipe for a level-70 map");
});
