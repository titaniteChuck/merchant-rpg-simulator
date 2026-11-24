/**
 * Map-only enemies vs quest-board quests (E20): quest-stats.ts helpers, and that the profit, farming and levelling
 * tools never treat a map boss or a Treasure Bush as a standalone quest. Committed game data only: CI runs it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { Sim } from "../src/tools/engine.ts";
import { farmingReport, mapSourceFor } from "../src/tools/farming.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import { availableMaps, availableQuests, type LevelStep, levellingPlan, mergeSteps, questXpRate } from "../src/tools/levelling.ts";
import { mapEssence, mapLoot, Solver } from "../src/tools/profit.ts";
import {
  craftSeconds, isBoardQuest, isMapOnlyQuest, mapCraftSeconds, mapRunStats, mapsWithQuest, questStats,
} from "../src/tools/quest-stats.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const g = gameFromData();
const sim = new Sim("Standard");
const raw = (level: number, prestige = 1, id = 1) => ({
  id, heroID: id, name: `Test ${id}`, class: 1, level, exp: 0, prestigeLevel: prestige, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
});
const MAP_ONLY = Object.keys(G.questData).map(Number).filter((q) => G.questData[q].questType === 8);

test("quest board: questType 8 (map bosses 91-98, Treasure Bushes 99-104) is never a standalone quest", () => {
  assert.deepEqual(MAP_ONLY, [91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104]);
  for (const q of MAP_ONLY) assert.ok(isMapOnlyQuest(q) && !isBoardQuest(q), `quest ${q}`);
  assert.ok(isBoardQuest(80) && isBoardQuest(1) && isBoardQuest(61), "regional quests and event bosses are on the board");
  for (const l of [20, 40, 60]) for (const t of [1, 3]) for (const q of availableQuests(l, t)) assert.ok(!isMapOnlyQuest(q));
  assert.throws(() => questXpRate(sim, sim.hero(raw(30)), [sim.hero(raw(30))], [], 92, 1, 1), /not on the quest board/);
});

test("mapsWithQuest: where a map-only enemy is fought, and how often per run", () => {
  const monarch = mapsWithQuest(92);
  assert.deepEqual(monarch.map((x) => [x.map, x.role]), [[7, "boss"], [12, "boss"]]);
  assert.equal(monarch[0].perRun, 1);
  assert.ok(Math.abs(monarch[1].perRun - 1 / 3) < 1e-12, "Goons of Evil: one of 3 bosses");
  assert.deepEqual(mapSourceFor(92), { map: 7, perRun: 1 });
  assert.equal(mapSourceFor(80), undefined);
  // a Treasure Bush: treasure rooms of the tier's maps, none at grade <= 2
  assert.ok(mapsWithQuest(100, 5).every((x) => x.role === "treasure" && x.perRun > 0));
  assert.deepEqual(mapsWithQuest(100, 2), []);
  // level-70 maps can't be crafted
  assert.deepEqual(mapsWithQuest(98), []);
});

test("craft time: ceil(floor(runTime x craftGradeSpeed[grade]) x amount x craftTimeMod), lower maps included", () => {
  const rt = (id: number) => G.itemData.map[id].runTime;
  assert.equal(craftSeconds("map", 7, 3), Math.floor(rt(7) * 0.9));
  assert.equal(craftSeconds("map", 7, 1), Math.floor(rt(7) * 1.1));
  assert.equal(craftSeconds("map", 7, 3, { mode: "Quick" }), Math.ceil(Math.floor(rt(7) * 0.9) * 0.25));
  // Murlok Madness Map = Yarsol Map + ...; Hard Tuvale Map = Tuvale Map + ...
  assert.equal(mapCraftSeconds(7, 3), craftSeconds("map", 7, 3) + craftSeconds("map", 4, 3));
  assert.equal(mapCraftSeconds(12, 3), craftSeconds("map", 12, 3) + mapCraftSeconds(3, 3) + mapCraftSeconds(7, 3) + mapCraftSeconds(11, 3));
  assert.equal(mapCraftSeconds(1, 3), craftSeconds("map", 1, 3));
});

test("questStats: XP per hero by party size, quest time x amount x gradeTime, XP per minute", () => {
  const q = G.questData[80];
  const one = questStats(80, { grade: 3, amount: 1, heroes: 1 });
  assert.equal(one.xpPerHero, q.exp);
  assert.equal(one.seconds, q.time * G.gradeTime[3]);
  assert.ok(Math.abs(one.xpPerMin - q.exp / (q.time / 60)) < 1e-9);
  const three = questStats(80, { grade: 5, size: 3, heroes: 3, battleSeconds: 100 });
  assert.equal(three.xpPerHero, Math.round(q.exp / 3) * 3);
  assert.equal(three.seconds, 100 + q.time * 3 * G.gradeTime[5]);
  assert.equal(questStats(80, { rare: true, amount: 5 }).amount, 1);
  assert.equal(questStats(92).onBoard, false);
});

test("mapRunStats: room XP = round(exp x mapEnemyMod x 0.2 / heroes), craft + run time", () => {
  const s = mapRunStats(7, { grade: 3, heroes: 1 });
  assert.equal(s.enemyMod, G.itemData.map[7].enemyMod + G.default.mapGradeMod[3]);
  assert.equal(s.rooms, G.itemData.map[7].baseEnemyAmount);
  const boss = Math.round(G.questData[92].exp * s.enemyMod * 0.2);
  assert.ok(s.xpPerHero > boss, "every room adds XP, the boss included");
  assert.equal(s.craftSeconds, mapCraftSeconds(7, 3));
  assert.equal(s.runSeconds, G.itemData.map[7].baseMapTime);
  assert.equal(s.seconds, s.craftSeconds + s.runSeconds);
  assert.ok(Math.abs(s.xpPerMin - s.xpPerHero / (s.seconds / 60)) < 1e-9);
  assert.equal(mapRunStats(7, { asc: 1 }).enemyMod, G.itemData.map[7].enemyMod * 2 + G.default.mapGradeMod[3]);
  assert.ok(mapRunStats(7, { heroes: 3 }).xpPerHero < s.xpPerHero);
});

test("profit: map-only loot costs a whole run / drops per run; no quest source is map-only; luck raises essence", () => {
  const s = new Solver(g).solve();
  for (const how of s.how.values()) for (const q of MAP_ONLY) assert.ok(!how.startsWith(`quest ${G.questData[q].name} (`), how);
  // Khan's Horn (Gnoll Khan's trophy): Gnoll Vendetta Map (boss 93) or Goons of Evil (1 in 3)
  const horn = s.get("material", 267);
  const runCost = s.get("map", 11, 0), drops = mapLoot(g, 11, 3, 0).get("material|267")!;
  assert.ok(drops > 0 && Math.abs(horn - runCost / drops) < 1e-6, `${horn} vs ${runCost} / ${drops}`);
  assert.match(s.how.get("material|267|0")!, /^map run Gnoll Vendetta Map/);
  assert.ok(s.hoursPerUnit.get("material|267|0")! > (G.itemData.map[11].baseMapTime / 3600) / drops, "craft time included");
  assert.ok(s.hoursPerUnit.get("material|33|0")! > 0, "essences carry craft + run hours too");
  // data.Default.lua:757: x (1 + partyLuck / 100)
  const e0 = mapEssence(g, 1, 0, 3), e50 = mapEssence(g, 1, 0, 3, undefined, 50);
  assert.equal(e50.get("material|33"), Math.floor(g.gradeBonus.get(3)! * 50 * 1.5 + 0.5));
  assert.ok(e50.get("material|33")! > e0.get("material|33")!);
});

test("farming: a map-only quest source is farmed as the map that holds it", () => {
  const h = sim.hero(raw(30, 2));
  const solver = new Solver(g).solve();
  const [row] = farmingReport(sim, { front: [h], back: [] }, [{ kind: "quest", quest: 92 }], { mapRuns: 2, solver });
  assert.equal(row.kind, "map");
  assert.equal(row.id, 7);
  assert.match(row.note ?? "", /Murlok Monarch: only in map runs/);
  assert.ok(row.craft_h > 0 && Math.abs(row.time_h - row.run_h - row.craft_h) < 1e-12);
  assert.ok(Math.abs(row.runs_per_hour * row.time_h - 1) < 1e-9);
  if (row.map_only["Tidal Hilt"]) assert.ok(Math.abs(row.map_only_unit_cost["Tidal Hilt"] * row.map_only["Tidal Hilt"] - row.cost.total) < 1e-6);
});

test("levelling: map runs are candidates from level 10, the same source in consecutive bands is one step", () => {
  assert.deepEqual(availableMaps(9), []);
  assert.ok(availableMaps(10).includes(1) && !availableMaps(10).includes(27));
  const src = { kind: "quest" as const, quest: 2, label: "x", amount: 1, win: 1, xpPerRun: 10, hoursPerRun: 1, reviveGold: 0, xpPerHour: 10 };
  const step = (a: number, b: number, s = src): LevelStep => ({ fromLevel: a, toLevel: b, source: s, xpNeeded: 100, runs: 10, hours: 10,
    reviveGold: 1, mapGold: 0, bands: 1, runsExact: 10, win: 1, xpPerRun: 10, xpPerHour: 10, launchGold: 0, potions: 0, potionGold: 0 });
  const merged = mergeSteps([step(1, 6), step(6, 11), step(11, 16, { ...src, amount: 3 }), step(16, 21, { ...src, amount: 3 })]);
  assert.deepEqual(merged.map((s) => [s.fromLevel, s.toLevel, s.runs, s.bands]), [[1, 11, 20, 2], [11, 21, 20, 2]]);
  const plan = levellingPlan(sim, raw(10), { to: 12, band: 1, n: 3, maps: [1], mapRuns: 2, amounts: "one" });
  for (const s of plan.steps) {
    assert.ok(!isMapOnlyQuest(s.source.quest) || s.source.kind === "map");
    if (s.source.kind === "map") assert.ok(s.source.craftHours! > 0 && s.mapGold > 0);
  }
  for (let i = 1; i < plan.steps.length; i++) assert.notEqual(JSON.stringify(plan.steps[i].source), JSON.stringify(plan.steps[i - 1].source));
});
