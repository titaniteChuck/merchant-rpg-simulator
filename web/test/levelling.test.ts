/** Levelling and prestige economics (web/src/tools/levelling.ts, farming XP) on made-up heroes: CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { Sim } from "../src/tools/engine.ts";
import { farmingReport } from "../src/tools/farming.ts";
import { availableQuests, levellingPlan, maxLevel, prestigePayoff, questXpRate, xpBetween } from "../src/tools/levelling.ts";
import { Solver } from "../src/tools/profit.ts";
import { gameFromData } from "../src/tools/gamedata.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const raw = (level: number, prestige = 1, id = 1) => ({
  id, heroID: id, name: `Test ${id}`, class: 1, level, exp: 0, prestigeLevel: prestige, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
});

test("level curve and quest access follow the game tables", () => {
  assert.deepEqual([1, 2, 3].map(maxLevel), [50, 50, 60]);
  assert.equal(xpBetween(1, 1, 3), G.heroLevelRequirement[1][2] + G.heroLevelRequirement[1][3]);
  const q = availableQuests(20, 1);
  for (const id of q) {
    const d = G.questData[id];
    assert.ok(20 > Math.min(d.levelReq - 5, d.levelReq * 0.75), `quest ${id} level ${d.levelReq}`);
  }
  assert.ok(availableQuests(40, 1).length > q.length);
});

test("quest XP: round(exp / heroes) x amount per living hero of a won quest, nothing at max level", () => {
  const h = sim.hero(raw(20, 2)), mate = sim.hero(raw(20, 2, 2));
  const solo = questXpRate(sim, h, [h], [], 2, 1, 10);
  const duo = questXpRate(sim, h, [h, mate], [], 2, 1, 10);
  const exp = G.questData[2].exp;
  if (solo.win === 1) assert.ok(Math.abs(solo.xpPerRun - exp * (1 + h.expMod / 100)) < 1e-9);
  if (duo.win === 1) assert.ok(Math.abs(duo.xpPerRun - Math.round(exp / 2) * (1 + h.expMod / 100)) < 1e-9);
  const three = questXpRate(sim, h, [h], [], 2, 3, 10);
  if (three.win === 1) assert.ok(Math.abs(three.xpPerRun - 3 * solo.xpPerRun) < 1e-9, "amount x3");
  const capped = sim.hero(raw(50, 1));
  assert.equal(questXpRate(sim, capped, [capped], [], 2, 1, 5).xpPerRun, 0);
});

test("farming report: XP per hour for quests and map runs", () => {
  const h = sim.hero(raw(20));
  const solver = new Solver(gameFromData()).solve();
  const [q, m] = farmingReport(sim, { front: [h], back: [] },
    [{ kind: "quest", quest: 2 }, { kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 } }], { n: 10, mapRuns: 3, solver });
  assert.ok(q.xp_per_run > 0 && Math.abs(q.xp_per_hour - q.xp_per_run / q.time_h) < 1e-6);
  if (m.win > 0) assert.ok(m.xp_per_run > 0, "map rooms won give XP");
  assert.ok(m.revive_gold >= 0 && q.revive_gold >= 0);
});

test("levelling plan: best source per band, hours add up", () => {
  const plan = levellingPlan(sim, raw(1), { to: 11, band: 5, n: 5 });
  assert.equal(plan.steps.length, 2);
  assert.ok(plan.hours > 0 && Math.abs(plan.hours - plan.steps.reduce((a, s) => a + s.hours, 0)) < 1e-9);
  for (const s of plan.steps) assert.ok(s.source.win >= 0.5 && s.runs * s.source.xpPerRun >= s.xpNeeded);
});

test("prestige payoff: next tier's growth and caps against gold and relevel hours", () => {
  const pay = prestigePayoff(sim, raw(45, 1), { quest: 2, n: 5 }, { band: 10, n: 3, to: 21 });
  assert.equal(pay.levelRequired, 40);
  assert.equal(pay.gold, 10000);
  assert.equal(pay.next.enchantSlots, pay.current.enchantSlots + 4);
  assert.equal(pay.next.questAmountCap, 3);
  assert.ok(pay.next.stats.maxHP > pay.current.stats.maxHP, "tier 2 grows faster per level");
  assert.ok(pay.relevel.hours > 0);
  assert.throws(() => prestigePayoff(sim, raw(60, 3), { quest: 2 }), /last tier/);
});
