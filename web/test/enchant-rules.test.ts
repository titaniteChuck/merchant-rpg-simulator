/**
 * E7 economy rules (Reset, enchant order, modded ingredients) on catalog data: no save needed, so CI runs it.
 * Game sources: obj.Enchant (Reset keeps modifiers, re-rolls stats at a new grade), default.resetEnchant /
 * resetEnchantCost, AscendItem (keeps prefix, suffix, grade), default.prestigeItemMaterial (x (4 + mods)),
 * Player:removeItemForCrafting + default.__craftPrefixOdds / __craftSuffixOdds (ingredient boosts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { resetGrade, resetPath } from "../src/tools/enchant.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import {
  buildEnchantOrderRows, buildIngredientBoostRows, buildResetRows, craftGrade, enchantOrderStrategies, enchantStrategies,
  modifierOutcomes, Solver,
} from "../src/tools/profit.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const g = gameFromData();
const s = new Solver(g).solve();
const id = (name: string) => [...g.items.equipment].find(([, it]) => it.name === name)![0];

test("Reset grade: start grade + 0.4 per earlier reset, never more than one grade down", () => {
  // enchanter 60 on a level-58 item: start = clamp(1 + 7/4, 1, 4.5) = 2.75
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => resetGrade(60, 58, 2, i)), [3, 3, 4, 4, 4, 5]);
  assert.equal(resetGrade(60, 58, 5, 0), 4, "an S item reset once drops to A at most");
  const path = resetPath(g, (t, i) => s.get(t, i, 0), "equipment", id("Iron Longsword"), 0, 3, 60, 0, 5);
  assert.equal(path.length, 6);
  for (let i = 1; i < path.length; i++) assert.ok(path[i].cost > path[i - 1].cost && path[i].grade >= path[i - 1].grade - 1);
});

test("resets are only used when they make enchanting cheaper", () => {
  const withResets = new Solver(g, { resetBeforeEnchant: true }).solve();
  for (const name of ["Iron Longsword", "Fenrir's Shiv"]) {
    const iid = id(name);
    const sell = [0, 1, 2].map((m) => g.sellValue("equipment", iid, 0, m));
    const out = modifierOutcomes(g, "equipment", iid, 60, 3, 0);
    const a = enchantStrategies(s, "equipment", iid, 0, out, sell), b = enchantStrategies(withResets, "equipment", iid, 0, out, sell);
    for (const k of [1, 2]) assert.ok(b.get(k)![0] >= a.get(k)![0] - 1e-9, `${name} ${k} mods`);
  }
  const rows = buildResetRows(s);
  assert.ok(rows.some((r) => Number(r.prefix_resets) > 0), "some low-grade crafts gain from resetting before a prefix");
});

test("enchant before ascending: cost of the plain item + enchant there + ascension essence x (4 + mods)", () => {
  const iid = id("Iron Longsword");
  const grade = craftGrade(s.crafterLevel, g.item("equipment", iid).itemLevel, s.grade);
  const prefix = s.enchantStep("prefix", "equipment", iid, 0, grade, 0)!;
  const [eid, eamt] = g.essenceForAscension("equipment", iid, 1, true, 1);
  const total = s.get("equipment", iid, 0) + prefix.cost + eamt * s.get("material", eid);
  const strat = enchantOrderStrategies(s, "equipment", iid, 1, [0, 0, 0]).get("1|0")!;
  assert.ok(Math.abs(strat[2] - total) < 1e-6);
  const [, plainAmt] = g.essenceForAscension("equipment", iid, 1, true, 0);
  assert.ok(eamt > plainAmt * 5 / 4 - 1e-9, "a modded item takes more essence to ascend");
  const rows = buildEnchantOrderRows(s);
  assert.ok(rows.length > 0 && rows.every((r) => r.cheaper === "after" || String(r.cheaper).startsWith("before")));
});

test("modded ingredients raise the craft's modifier odds; the default assumes plain ingredients", () => {
  const iid = id("Warlord's Blade");
  const pPrefix = (o: [number, number, number][]) => o.filter(([, pf]) => pf).reduce((a, [pr]) => a + pr, 0);
  const pSuffix = (o: [number, number, number][]) => o.filter(([, , sf]) => sf).reduce((a, [pr]) => a + pr, 0);
  const plain = modifierOutcomes(g, "equipment", iid, 60, 3, 0);
  assert.deepEqual(modifierOutcomes(g, "equipment", iid, 60, 3, 0, {}), plain);
  assert.ok(pPrefix(modifierOutcomes(g, "equipment", iid, 60, 3, 0, { prefix: true })) > pPrefix(plain));
  assert.ok(pSuffix(modifierOutcomes(g, "equipment", iid, 60, 3, 0, { suffix: 2 })) > pSuffix(plain));
  const rows = buildIngredientBoostRows(s);
  assert.ok(rows.some((r) => r.name === "Warlord's Blade"));
});
