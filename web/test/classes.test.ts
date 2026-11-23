// Equal-gear class balance (src/tools/classes.ts). Catalog data only: no save, no local fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { Sim } from "../src/tools/engine.ts";
import { catalogCandidates, checkHeroSpec, classIds, classMatrix, searchSkills, standardHero, summarizeByClass }
  from "../src/tools/classes.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");

test("hero specs follow the game's level caps per prestige", () => {
  assert.deepEqual(classIds(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  checkHeroSpec(1, 60, 3);
  checkHeroSpec(9, 50, 1);
  assert.throws(() => checkHeroSpec(1, 60, 2), /level must be 1-50/);
  assert.throws(() => checkHeroSpec(1, 10, 4), /prestige/);
  assert.throws(() => checkHeroSpec(42, 10, 1), /unknown class/);
});

test("catalog candidates: right slot, level cap, no locked items or placeholders, best rule order", () => {
  for (const slot of [1, 2, 3, 4, 5, 6]) {
    const ids = catalogCandidates(slot, 60);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      const it = G.itemData.equipment[id];
      assert.equal(it.itemSlot, slot);
      assert.ok(it.itemLevel <= 60 && !it.locked);
    }
    for (let i = 1; i < ids.length; i++) {
      const [a, b] = [G.itemData.equipment[ids[i - 1]], G.itemData.equipment[ids[i]]];
      assert.ok(a.itemLevel > b.itemLevel || (a.itemLevel === b.itemLevel && (a.value ?? 0) >= (b.value ?? 0)));
    }
  }
  assert.ok(catalogCandidates(1, 10).every((id) => G.itemData.equipment[id].itemLevel <= 10));
  assert.ok(!catalogCandidates(1, 60).includes(498)); // "30+ Items" placeholder
  assert.ok(!catalogCandidates(1, 60).includes(774)); // Mountain Blade, locked
});

test("standardHero builds a save-like hero with catalog gear", () => {
  const war = standardHero(sim, 1, 60, 3, "best");
  assert.equal(war.class, 1);
  assert.equal(war.level, 60);
  assert.equal(war.prestigeLevel, 3);
  assert.deepEqual(war._standardGear.map((g: { id: number }) => g.id), [1, 2, 3, 4, 5, 6].map((s) => catalogCandidates(s, 60)[0]));
  assert.equal(war._standardGear[0].name, "Gungnir");
  // Default skills for its level: the class's default rotation (all Basic) and first passive.
  assert.deepEqual(sim.rotation(war), ["Basic", "Basic", "Basic", "Basic", "Basic"]);
  assert.equal(war.passiveSelect, "Might");
  assert.equal(war.questHP, war.maxHP);

  const naked = standardHero(sim, 1, 60, 3, "none");
  assert.deepEqual(naked._standardGear, []);
  assert.ok(sim.stats(war).atk > sim.stats(naked).atk);
  assert.ok(sim.stats(war).maxHP >= sim.stats(naked).maxHP);

  // Level 5: no passive yet, and only low-level gear.
  const low = standardHero(sim, 3, 5, 1, "best");
  assert.equal(low.passiveSelect, "None");
  assert.ok(low._standardGear.every((g: { itemLevel: number }) => g.itemLevel <= 5));

  // Explicit skills.
  const mage = standardHero(sim, 3, 60, 3, "none", { rotation: ["Mind Blast", 0, "Mind Blast", 0, 0], passive: "Wisdom" });
  assert.deepEqual(sim.rotation(mage), ["Mind Blast", "Basic", "Mind Blast", "Basic", "Basic"]);
  assert.equal(mage.passiveSelect, "Wisdom");
  assert.throws(() => standardHero(sim, 1, 55, 1, "best"), /level must be/);
});

test("'fit' gear follows the class's damage type", () => {
  const mageBest = sim.stats(standardHero(sim, 3, 60, 3, "best"));
  const mageFit = sim.stats(standardHero(sim, 3, 60, 3, "fit"));
  assert.ok(mageFit.matk > mageBest.matk);
  const warFit = standardHero(sim, 1, 60, 3, "fit");
  assert.ok(sim.stats(warFit).atk >= sim.stats(standardHero(sim, 1, 60, 3, "best")).atk);
  // Deterministic: same items every time.
  assert.deepEqual(standardHero(sim, 3, 60, 3, "fit")._standardGear, standardHero(sim, 3, 60, 3, "fit")._standardGear);
});

test("classMatrix: one typed row per class x quest, reproducible, progress and stop", () => {
  const calls: [number, number][] = [];
  const o = { classes: [1, 3], quests: [6, 48], level: 30, prestige: 2, gearPolicy: "best" as const, n: 5, seed0: 7 };
  const rows = classMatrix(sim, { ...o, onProgress: (d, t) => calls.push([d, t]) });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => [r.classId, r.quest]), [[1, 6], [1, 48], [3, 6], [3, 48]]);
  assert.deepEqual(calls, [[1, 4], [2, 4], [3, 4], [4, 4]]);
  for (const r of rows) {
    assert.equal(r.n, 5);
    assert.ok(r.win >= 0 && r.win <= 1);
    assert.ok(r.turns > 0 && r.dmgDealt >= 0 && r.dmgTaken >= 0);
    assert.equal(r.rotation.length, 5);
    assert.equal(r.gear.length, 6);
  }
  assert.equal(rows[0].win, 1); // Wild Boar (level 5) vs a level-30 Warrior
  assert.equal(rows[0].className, "Warrior");
  assert.equal(rows[0].questName, G.questData[6].name);
  assert.deepEqual(classMatrix(sim, o), rows); // same seeds, same rows

  let k = 0;
  const partial = classMatrix(sim, { ...o, shouldStop: () => k++ >= 2 });
  assert.ok(partial.length < 4);
  assert.deepEqual(partial, rows.slice(0, partial.length));

  assert.throws(() => classMatrix(sim, { ...o, quests: [999] }), /no enemy/);
  assert.throws(() => classMatrix(sim, { ...o, quests: [] }), /no quest/);

  const sum = summarizeByClass(rows, 0.9);
  assert.equal(sum.length, 2);
  assert.ok(sum[0].win >= sum[1].win);
});

test("searchSkills finds a rotation within the AP budget that beats all-Basic", () => {
  const h = standardHero(sim, 4, 20, 1, "best");
  const basic = classMatrix(sim, { classes: [4], quests: [20], level: 20, prestige: 1, n: 10 })[0];
  const best = searchSkills(sim, h, 20, { n: 10, top: 1 });
  assert.equal(best.rotation.length, 5);
  assert.deepEqual(sim.rotation(h), best.rotation);
  const info = sim.skillInfo(h);
  const ap = best.rotation.reduce((s, name) => s + (name === "Basic" ? 0 : G.abilityData[name].apCost), 0);
  assert.ok(ap <= info.maxAP);
  assert.ok(best.ev.score >= basic.win * 1e6 + basic.enemyHpRemoved * 1e4 - basic.turns * 10 + basic.hpLeft * 5 - 1e-6);
  const searched = classMatrix(sim, { classes: [4], quests: [20], level: 20, prestige: 1, n: 10, skills: "search", searchN: 10 });
  assert.notDeepEqual(searched[0].rotation, ["Basic", "Basic", "Basic", "Basic", "Basic"]);
});
