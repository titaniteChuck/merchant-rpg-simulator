import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/data.ts";
import { addPrefix, addSuffix, band, maxSuffixFor, PREFIX_GEM, suffixClimb } from "../src/tools/enchant.ts";
import { gameFromData, pyRound, toPy } from "../src/tools/gamedata.ts";
import {
  ascLevels, craftGrade, expectedFixedDrop, modifierOutcomes, profitReport, PyFloat, pyFloatStr, questLoot, rollChance,
  sortRows, toCsv,
} from "../src/tools/profit.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const g = gameFromData();

test("Python number formatting", () => {
  assert.equal(pyRound(2.675, 2), 2.67); // binary value below the tie
  assert.equal(pyRound(0.125, 2), 0.12); // exact tie -> even
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(-2.5), -2);
  assert.ok(Object.is(pyRound(-0.004, 1), -0));
  assert.equal(pyFloatStr(12), "12.0");
  assert.equal(pyFloatStr(-0), "-0.0");
  assert.equal(pyFloatStr(Infinity), "inf");
  assert.equal(pyFloatStr(0.00005), "5e-05");
  assert.equal(pyFloatStr(1.5e16), "1.5e+16");
  assert.equal(toCsv([{ a: new PyFloat(3), b: 3, c: "x,y" }]), 'a,b,c\r\n3.0,3,"x,y"\r\n');
});

test("Lua tables convert like luadata.to_py", () => {
  assert.deepEqual(toPy({ 1: "a", 2: { 1: 3 } }), ["a", [3]]);
  assert.deepEqual(toPy({}), []);
  assert.deepEqual(toPy({ 2: "b" }), { 2: "b" });
  assert.deepEqual(toPy({ name: "x", n: 1 }), { name: "x", n: 1 });
});

test("game data model", () => {
  assert.deepEqual(ascLevels("map"), [0, 1]);
  assert.deepEqual(ascLevels("equipment"), [0, 1, 2]);
  assert.deepEqual(ascLevels("material"), [0]);
  assert.equal(g.sellValue("material", 1), 3); // Iron Ore: sell {2, 4}
  assert.equal(g.sellValue("equipment", 5, 2), 280); // 70 * 2 * 2
  assert.equal(g.crafters.get(1).name, "Blacksmith");
  assert.equal(g.name("material", 999999), "material#999999?");
  assert.throws(() => g.sellValue("material", 999999));
  assert.deepEqual(g.recipe("equipment", 5), [["material", 2, 2], ["material", 1, 1]]);
});

test("loot and modifier rolls", () => {
  assert.equal(rollChance(25), 0.24);
  assert.equal(rollChance(-5), 0);
  assert.equal(craftGrade(60, 60, 3), 2); // start grade 1, ingredients 3.25 -> round(2.125)
  assert.equal(craftGrade(60, 20, 3), 4);
  // x in 10..20, round(x / 10): five 1s, six 2s (Python: 1.5454...)
  assert.equal(expectedFixedDrop([5, 1, 2], 1, 0), 17 / 11);
  const loot = questLoot(g, 3, 3, 0);
  assert.ok(loot.get("material|5")! > 0);
  const outs = modifierOutcomes(g, "equipment", 5, 60, 3);
  assert.ok(Math.abs(outs.reduce((s, o) => s + o[0], 0) - 1) < 1e-12);
  assert.deepEqual(modifierOutcomes(g, "consumable", 61, 60, 3), [[1, 0, 0]]);
});

test("enchanter model", () => {
  assert.equal(band(PREFIX_GEM, 35), 126);
  assert.equal(band(PREFIX_GEM, 61), undefined);
  const free = () => 0;
  const pre = addPrefix(g, free, "equipment", 5, 0, 3, 60, 0)!;
  assert.equal(pre["chance%"], 79); // clamp((60 - 4) * 2 + 6, 10, 80) = 80 -> 79 %
  assert.ok(Math.abs(pre.attempts - 1 / 0.79) < 1e-9);
  assert.equal(addSuffix(g, free, "equipment", 780, 0, 3, 60, 0), null); // trinket (slot 6): no suffix
  assert.equal(addSuffix(g, free, "equipment", 5, 0, 3, 60, 0)!["chance%"], 94); // as profit.py
  assert.ok(maxSuffixFor(g, 1) >= maxSuffixFor(g, 0));
  const climb = suffixClimb(g, "map", 1, 0, 3, 60, 2)!;
  assert.ok(climb.attempts >= 2 && climb.runes >= climb.attempts);
});

test("full report runs and ranks", () => {
  const r = profitReport(g, { grade: 3, top: 5 });
  assert.equal(r.tag, "g3_value");
  assert.ok(r.rows.length > 2000);
  assert.ok(r.essence.some((e) => e.chosen === "yes"));
  const best = r.rows.map((x) => Number(x.best_profit));
  assert.deepEqual(best.slice(0, 50), [...best.slice(0, 50)].sort((a, b) => b - a));
  assert.ok(r.lines[0].startsWith("grade 3, luck 0, alloc value"));
  assert.deepEqual(sortRows([{ k: "" }, { k: 1 }, { k: new PyFloat(2) }], "k").map((x) => String(x.k)), ["2.0", "1", ""]);
});
