// Wiki cross-references (src/ui/wiki-data.ts): which quests count as enemies, and where enemies appear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import {
  dropSources, enemiesWith, enemyDrops, enemyIds, enemyMapRoles, enemyNamesWith, hasRare, isEnemy, isGathering, PLACEHOLDER_QUEST_IDS, parcelRoll,
  enemyKind,
} from "../src/ui/wiki-data.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

test("PLACEHOLDER_QUEST_IDS: placeholders out; quest bushes (gathering) and real fights in", () => {
  for (const id of [39, 58, 75, 76]) assert.ok(PLACEHOLDER_QUEST_IDS.has(id) && !isEnemy(id), `placeholder ${id}`);
  // the quest bushes: the first battle of each region's board
  for (const id of [1, 11, 21, 30, 42, 77]) {
    assert.ok(isEnemy(id) && isGathering(id), `quest bush ${id}`);
    assert.equal(enemyKind(id), "Quest bush");
  }
  // Moss Golem, Grass Spider (has a rare), Maexna, Leviathan (epic boss), Goblin Warlord (map boss), Treasure Bush
  for (const id of [2, 4, 10, 61, 91, 99]) assert.ok(!PLACEHOLDER_QUEST_IDS.has(id) && isEnemy(id), `enemy ${id}`);
  assert.deepEqual([2, 61, 91, 99].map(enemyKind), ["Quest", "Event boss", "Map boss", "Map treasure bush"]);
  assert.equal(G.questData[1].name, "Forest Gathering");
});

test("PLACEHOLDER_QUEST_IDS matches the data: every 'MissNo' quest, nothing else", () => {
  const derived = Object.entries<any>(G.questData).filter(([, q]) => q.nickname === "MissNo").map(([id]) => Number(id));
  assert.deepEqual([...PLACEHOLDER_QUEST_IDS].sort((a, b) => a - b), derived.sort((a, b) => a - b));
  assert.equal(enemyIds().length, Object.keys(G.questData).length - PLACEHOLDER_QUEST_IDS.size);
});

test("skill users and maps leave quests out", () => {
  const basic = enemyNamesWith("Basic").map((e) => e.name);
  // quest bushes are battles (they attack with Basic, for 0); placeholders are not
  assert.ok(basic.includes("Forest Gathering") && !basic.includes("Region 5") && basic.includes("Moss Golem"));
  assert.ok(enemiesWith("Basic").every((e) => isEnemy(e.id)));
  assert.deepEqual(enemyMapRoles(1), []);
  for (const id of Object.keys(G.questData).map(Number)) {
    for (const r of enemyMapRoles(id)) assert.ok(isEnemy(id) && (r.room || r.boss || r.treasure));
  }
});

test("enemy maps, rare variants and drops", () => {
  // Maexna: boss of Tuvale Map (1) and Hard Tuvale Map (2), a room enemy in the random maps
  const maexna = enemyMapRoles(10);
  assert.deepEqual(maexna.slice(0, 2).map((r) => [r.map, r.boss]), [[1, true], [2, true]]);
  assert.ok(hasRare(4) && !hasRare(2));
  // Treasure Bush 99 hides in maps of level 1-10
  assert.ok(enemyMapRoles(99).length > 0 && enemyMapRoles(99).every((r) => r.treasure && G.itemData.map[r.map].itemLevel <= 10));
  const spider = enemyDrops(4, true);
  assert.deepEqual(spider.rolls, ["Arachne", "Region1Rare"]);
  const arachne = parcelRoll("Arachne")!;
  assert.ok(arachne.entries.some((e) => e.type === "equipment" && e.id === 259));
  assert.ok(Math.abs(arachne.nilPct + arachne.entries.reduce((s, e) => s + e.pct, 0) - 100) < 1e-9);
  assert.ok(dropSources(259, "equipment").some((s) => s.id === 4 && s.rare));
});
