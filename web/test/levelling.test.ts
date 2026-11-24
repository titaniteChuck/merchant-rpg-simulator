/** Levelling and prestige economics (web/src/tools/levelling.ts, farming XP) on made-up heroes: CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { D } from "../src/sim/defaults.ts";
import { Sim } from "../src/tools/engine.ts";
import { farmingReport } from "../src/tools/farming.ts";
import {
  availableQuests, boostLevel, levellingPlan, mapXpRate, maxLevel, openableQuests, planSources, prestigePayoff, questXpRate, startLevel,
  xpBetween, xpBoostAt, xpBoosts,
} from "../src/tools/levelling.ts";
import { contentExpansion } from "../src/tools/expansions.ts";
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
  const pay = prestigePayoff(sim, raw(45, 1), { quest: 2, n: 5 }, { band: 10, n: 3, to: 21, maps: "none" });
  assert.equal(pay.levelRequired, 40);
  assert.equal(pay.gold, 10000);
  assert.equal(pay.next.enchantSlots, pay.current.enchantSlots + 4);
  assert.equal(pay.next.questAmountCap, 3);
  assert.ok(pay.next.stats.maxHP > pay.current.stats.maxHP, "tier 2 grows faster per level");
  assert.ok(pay.relevel.hours > 0);
  assert.throws(() => prestigePayoff(sim, raw(60, 3), { quest: 2 }), /last tier/);
});

// ---------------------------------------------------------------- Levelling first batch (review-levelling L1)
test("start rule: the levelled hero opens quests from levelReq - 2 x (tier - 1); companions join under the join rule", () => {
  for (const tier of [1, 2, 3]) {
    for (const l of [10, 20, 45]) {
      const join = availableQuests(l, tier);
      for (const q of openableQuests(l, tier)) {
        assert.ok(l >= G.questData[q].levelReq - 2 * (tier - 1), `quest ${q} at level ${l}, tier ${tier}`);
        assert.ok(join.includes(q), "a hero that may open a quest may join it");
      }
    }
  }
  assert.equal(startLevel(14, 3), G.questData[14].levelReq - 4);
  // Joinable but not openable at a band start: the plan never takes them.
  assert.ok(availableQuests(20, 1).some((q) => !openableQuests(20, 1).includes(q)));
  const plan = levellingPlan(sim, raw(16), { to: 26, band: 5, n: 5, maps: "none" });
  assert.ok(plan.steps.length > 0);
  for (const s of plan.steps) assert.ok(s.fromLevel >= startLevel(s.source.quest, 1), `${s.source.label} from ${s.fromLevel}`);
});

test("quest gold: each launch costs gold x quest size, per step and in the plan's gold", () => {
  const h = sim.hero(raw(20, 3));
  assert.equal(questXpRate(sim, h, [h], [], 2, 5, 3).launchGold, G.questData[2].gold * 5);
  const plan = levellingPlan(sim, raw(10), { to: 16, band: 5, n: 5, maps: "none" });
  for (const s of plan.steps) {
    assert.ok(Math.abs(s.launchGold - s.runsExact * (G.questData[s.source.quest].gold ?? 0) * s.source.amount) < 1e-6);
  }
  assert.ok(plan.launchGold > 0);
  assert.ok(Math.abs(plan.gold - (plan.launchGold + plan.reviveGold + plan.potionGold + plan.mapGold)) < 1e-6);
});

test("XP Boost: by level and tier, one potion lasts 3 quests or the first 3 rooms of a map run", () => {
  const [b0, b1, b2] = xpBoosts();
  assert.deepEqual([b0, b1, b2].map((b) => [b.expMod, b.duration]), [[30, 3], [60, 3], [100, 3]]);
  assert.equal(boostLevel(b2, 1), 50);
  assert.equal(boostLevel(b2, 3), 42);
  assert.equal(xpBoostAt(41, 3, b2.id)?.id, b1.id, "XP Boost +2 from level 42 at ascension 2");
  assert.equal(xpBoostAt(42, 3, b2.id)?.id, b2.id);
  assert.equal(xpBoostAt(55, 3, b1.id)?.id, b1.id, "never stronger than the potion picked");
  assert.equal(xpBoostAt(1, 1, b1.id)?.id, b0.id);
  const solver = new Solver(gameFromData()).solve();
  const o = { to: 15, band: 5, n: 5, maps: "none" as const, quests: [2], amounts: "one" as const, solver };
  const plain = levellingPlan(sim, raw(10), o), boosted = levellingPlan(sim, raw(10), { ...o, xpBoost: b0.id });
  const [p, s] = [plain.steps[0], boosted.steps[0]];
  assert.equal(s.source.boost, b0.id);
  assert.equal(s.potions, Math.ceil(s.runsExact / 3 - 1e-9), "one potion per 3 quests");
  assert.ok(s.potionGold > 0 && boosted.potionGold === s.potionGold);
  const mod = sim.hero(raw(10)).expMod ?? 0;
  assert.ok(Math.abs(s.source.xpPerRun / p.source.xpPerRun - (1 + (mod + 30) / 100) / (1 + mod / 100)) < 1e-9);
  // A map run: the potion covers its first 3 rooms only.
  const h = sim.hero(raw(60, 3));
  const m0 = mapXpRate(sim, h, [h], [], 1, { n: 2 }), m1 = mapXpRate(sim, h, [h], [], 1, { n: 2, boost: b0 });
  if (m0.xpPerRun > 0) {
    assert.ok(m1.xpPerRun > m0.xpPerRun, "the first rooms get the bonus");
    assert.ok(m1.xpPerRun < m0.xpPerRun * 1.3 - 1e-9, "not every room");
  }
  assert.equal(h.boost, false, "the potion is gone after the runs");
});

test("next ascension: levelling back goes to the new tier's max level, whatever the page's target", () => {
  const pay = prestigePayoff(sim, raw(50, 2), { quest: 2, n: 3 }, { band: 20, n: 3, to: 21, maps: "none" });
  assert.equal(pay.relevel.from, 1);
  assert.equal(pay.relevel.to, 60);
  if (pay.relevel.stuckAt === undefined) assert.equal(pay.relevel.steps.at(-1)?.toLevel, 60);
  // A relevel plan already computed (the worker's cache) is used as is.
  const again = prestigePayoff(sim, raw(50, 2), { quest: 3, n: 3 }, {}, {}, pay.relevel);
  assert.equal(again.relevel, pay.relevel);
});

test("quest size cap: from the heroes in the fight; a solo quest ignores the companions", () => {
  const mate = raw(60, 3, 2);
  const o = { to: 41, band: 1, n: 3, maps: "none" as const, amounts: "max" as const, minWin: 0, companions: [mate] };
  const solo = levellingPlan(sim, raw(40, 1), { ...o, quests: [2] });
  assert.equal(solo.steps[0].source.amount, 1, "an ascension-0 hero alone: ×1");
  const party = levellingPlan(sim, raw(40, 1), { ...o, quests: [10] });
  assert.equal(party.steps[0].source.amount, 5, "with an ascension-2 companion on a party quest: ×5");
});

test("XP already earned: counted when the plan starts at the hero's own level", () => {
  const r = { ...raw(10), exp: 100 };
  const own = levellingPlan(sim, r, { to: 12, band: 5, n: 3, maps: "none" });
  assert.equal(own.startExp, 100);
  assert.equal(own.steps[0].xpNeeded, xpBetween(1, 10, 12) - 100);
  const fresh = levellingPlan(sim, r, { from: 9, to: 12, band: 5, n: 3, maps: "none" });
  assert.equal(fresh.startExp, 0);
  assert.equal(fresh.steps[0].xpNeeded, xpBetween(1, 9, 12));
});

test("same-named companion: the hero's XP is read from its own slot", () => {
  const h = sim.hero(raw(20, 3)), twin = sim.hero({ ...raw(20, 3, 2), name: "Test 1" });
  // Party quest: the twin stands in front 1 (found first by name before), the hero in front 2.
  const s = questXpRate(sim, h, [twin, h, null], [null, null, null], 10, 1, 5);
  const share = Math.round(G.questData[10].exp / 2) * (1 + (h.expMod ?? 0) / 100) * D.questXpMod;
  if (s.win === 1) assert.ok(Math.abs(s.xpPerRun - share) < 1e-9);
});

test("expansions: no Frentir quests without the Frozen Tome, no map runs without Scribe", () => {
  const owned = new Set<string>();
  const visible = (kind: "enemy" | "map", id: number) => (contentExpansion(kind, id, {}, G)?.needs ?? []).every((x) => owned.has(x));
  const base = planSources(visible, true);
  assert.equal(base.maps, "none");
  assert.ok(base.quests.length > 0 && base.quests.every((q) => G.questData[q].region !== 6));
  assert.ok(openableQuests(49, 2).some((q) => G.questData[q].region === 6), "an ascension-1 hero may open a Frentir quest at 49");
  const plan = levellingPlan(sim, raw(49, 2), { to: 50, band: 1, n: 3, minWin: 0, ...base });
  for (const s of plan.steps) {
    assert.equal(s.source.kind, "quest");
    assert.notEqual(G.questData[s.source.quest].region, 6);
  }
  owned.add("Frozen").add("Scribe");
  const all = planSources(visible, false);
  assert.ok(all.quests.some((q) => G.questData[q].region === 6));
  assert.ok(Array.isArray(all.maps) && all.maps.length > 0);
});
