/**
 * Farming report (web/src/tools/farming.ts) and the Solver's per-source grade/time overrides, on a made-up hero:
 * no save needed, so CI runs it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { Sim } from "../src/tools/engine.ts";
import { farmingReport, type FarmSource, sourceStatsFrom } from "../src/tools/farming.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import { k2, mixByGrade, questLoot, Solver } from "../src/tools/profit.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const g = gameFromData();
const solver = new Solver(g).solve();
const hero = sim.hero({
  id: 1, heroID: 1, name: "Test", class: 1, level: 20, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
});

test("quest loot scales with the number of enemies", () => {
  const one = questLoot(g, 2, 3, 0), three = questLoot(g, 2, 3, 0, false, 3);
  const q = G.questData[2];
  const fixed = k2("material", q.rewardA1[1]);
  assert.ok(Math.abs(three.get(fixed)! - 3 * one.get(fixed)!) < 1e-9, "fixed drops x3");
  assert.deepEqual([...one.keys()].sort(), [...three.keys()].sort());
});

test("farming report: quests and map runs, costs and per-hour figures", () => {
  const sources: FarmSource[] = [{ kind: "quest", quest: 2 }, { kind: "quest", quest: 3, amount: 2 },
    { kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 } },
    { kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 }, scrolls: [{ id: 61, prestigeLevel: 0 }] }];
  const calls: number[] = [];
  const rows = farmingReport(sim, { front: [hero], back: [] }, sources, { n: 20, mapRuns: 3, solver },
    { onProgress: (d) => void calls.push(d) });
  assert.equal(rows.length, 4);
  assert.equal(calls.at(-1), 20 + 20 + 3 + 3);
  const [q2, q3, m1, m1s] = rows;
  assert.equal(q2.cost.gold, G.questData[2].gold);
  assert.equal(q3.label.endsWith("x2"), true);
  for (const r of rows) {
    assert.ok(r.win >= 0 && r.win <= 1 && r.time_h > 0);
    assert.ok(Math.abs(r.runs_per_hour * r.time_h - 1) < 1e-9);
    assert.ok(Math.abs(r.gold_per_hour - (r.loot_value - r.cost.total) / r.time_h) < 1e-6);
    assert.ok(Math.abs(r.grades.reduce((s, [, x]) => s + x, 0) - r.win) < 1e-9, "graded runs are the won ones");
  }
  assert.ok(m1.cost.map > 0 && m1.cost.scrolls === 0);
  assert.ok(m1s.cost.scrolls > 0 && Math.abs(m1s.cost.scrolls - solver.get("consumable", 61, 0)) < 1e-9);
  // same seeds, same numbers
  assert.deepEqual(farmingReport(sim, { front: [hero], back: [] }, sources.slice(0, 1), { n: 20, solver }), [q2]);
});

test("Solver takes simulated grades and time per source", () => {
  const mixed = mixByGrade([[3, 0.5], [5, 0.5]], (gr) => questLoot(g, 2, gr, 0));
  for (const [k, v] of mixed) assert.ok(Math.abs(v - 0.5 * (questLoot(g, 2, 3, 0).get(k) ?? 0) - 0.5 * (questLoot(g, 2, 5, 0).get(k) ?? 0)) < 1e-9);
  // every quest won at S (more loot per run): some materials get cheaper
  const quest = new Map([...g.quests.keys()].map((qid) => [`${qid}`, { grades: [[5, 1]] as [number, number][] }]));
  const fast = new Solver(g, { sourceStats: { quest } }).solve();
  let cheaper = 0;
  for (const [key, c] of solver.cost) if ((fast.cost.get(key) ?? Infinity) < c - 1e-9) cheaper++;
  assert.ok(cheaper > 0);
  const rows = farmingReport(sim, { front: [hero], back: [] }, [{ kind: "quest", quest: 2 }, { kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 } }],
    { n: 5, mapRuns: 2, solver });
  const st = sourceStatsFrom(rows, [{ kind: "quest", quest: 2 }, { kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 } }]);
  assert.deepEqual([...st.quest.keys()], ["2"]);
  assert.deepEqual([...st.map.keys()], ["1|0"]);
});
