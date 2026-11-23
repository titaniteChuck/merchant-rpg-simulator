import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/data.ts";
import { fx, parseIds, parseScrolls, pf, rotations, score, toCsv, uniquePermutations } from "../src/tools/combat.ts";
import { sellValue } from "../src/tools/engine.ts";
import { baseDecode, decodeSaveText, parseItem, parseSave } from "../src/tools/save.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const GAME_B64 = "ABva12+rsKghixL6EueCl78fV5OPQmnopzTUyWXYZwb/RHIJqcdD0FG9MN34Sjkt";
const STD_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const gameEncode = (s: string) =>
  [...Buffer.from(s, "utf8").toString("base64")].map((c) => (c === "=" ? c : GAME_B64[STD_B64.indexOf(c)])).join("");

test("save text decodes from the game's base64 alphabet", () => {
  const raw = { gold: 12, hero: [{ id: 1, name: "Zoé", heroInventory: ["3|5|5|1|0|0|A35B6C32D1|0|A0B0C0|0"] }], inventory: ["1|2|7|3"] };
  const enc = gameEncode(JSON.stringify(raw));
  assert.deepEqual(decodeSaveText(enc), raw);
  assert.deepEqual(decodeSaveText(JSON.stringify(raw)), raw); // mobile saves: plain JSON
  assert.deepEqual(new TextDecoder().decode(baseDecode(`${enc.slice(0, 10)}\n${enc.slice(10)}`)), JSON.stringify(raw));
  const sv = parseSave(raw);
  assert.equal(sv.heroes[0].heroInventory[0].atk, 35);
  assert.equal(sv.inventory[0].amount, 7);
});

test("compact items parse like savegame.parse_item", () => {
  assert.deepEqual(parseItem("3|5|5|1|0|0|A35B6C32D1|0|A0B0C0|0"), {
    compact: "3|5|5|1|0|0|A35B6C32D1|0|A0B0C0|0", itemType: "equipment", id: 5, grade: 5, itemSlot: 1,
    prefix: 0, suffix: 0, atk: 35, matk: 6, acc: 32, crit: 1, enchantAttempt: [0, 0, 0], prestigeLevel: 0,
  });
  const armour = parseItem("3|c8|4|3|2|9|A11B35|AlB2.5|A1|1");
  assert.equal(armour.id, 200);
  assert.equal(armour.def, 11);
  assert.equal(armour.mdef, 35);
  assert.equal(armour.atkBns, undefined); // 'l' is not an uppercase bonus letter
  assert.equal(armour.matkBns, 2.5);
  assert.deepEqual(parseItem("1|1f|B93A100"), { compact: "1|1f|B93A100", itemType: "material", id: 31, amount: "B93A100" });
  assert.deepEqual(parseItem("2|3d|1|3|0||S500B60C1700000000"), {
    compact: "2|3d|1|3|0||S500B60C1700000000", itemType: "consumable", id: 61, amount: 1, grade: 3, prestigeLevel: 0,
    sellPrice: 500, sellTime: 60, startTime: 1700000000,
  });
});

test("rotations enumerate multisets in itertools order within the AP budget", () => {
  const all = [...rotations(["A", "B"], [3, 5], 100)];
  assert.equal(all.length, 21); // C(3 + 5 - 1, 5)
  assert.deepEqual(all[0], ["Basic", "Basic", "Basic", "Basic", "Basic"]);
  assert.deepEqual(all[1], ["Basic", "Basic", "Basic", "Basic", "A"]);
  assert.deepEqual(all.at(-1), ["B", "B", "B", "B", "B"]);
  const budget = [...rotations(["A", "B"], [3, 5], 8)];
  assert.ok(budget.every((c) => c.reduce((s, x) => s + ({ Basic: 0, A: 3, B: 5 } as Record<string, number>)[x], 0) <= 8));
  assert.equal(budget.length, 5); // only Basic, A, 2xA, B, A+B
});

test("unique permutations", () => {
  assert.equal(uniquePermutations(["a", "a", "b", "b", "c"]).length, 30);
  assert.deepEqual(uniquePermutations([1, 2]), [[1, 2], [2, 1]]);
});

test("argument parsers", () => {
  assert.deepEqual(parseIds("1-3,7"), [1, 2, 3, 7]);
  assert.deepEqual(parseIds("1-5", (i) => i % 2 === 1), [1, 3, 5]);
  assert.deepEqual(parseScrolls("61, 63,69@1"), [{ id: 61, prestigeLevel: 0 }, { id: 63, prestigeLevel: 0 }, { id: 69, prestigeLevel: 1 }]);
  assert.equal(parseScrolls(""), null);
  assert.throws(() => parseScrolls("60,61,62,63"), /at most 3/);
});

test("report formatting follows Python", () => {
  assert.equal(fx(698.5, 5), "  698"); // ties to even
  assert.equal(fx(699.5, 5), "  700");
  assert.equal(fx(12.345, 0, 1), "12.3");
  assert.equal(pf(100), "100.0");
  assert.equal(pf(97.3), "97.3");
  assert.equal(toCsv([{ a: 1, b: "x,y", c: 100 }], ["c"]), 'a,b,c\r\n1,"x,y",100.0\r\n');
  assert.equal(score({ win: 1, enemy_dmg: 1, turns: 10, hp_left: 0.5 }), 1e6 + 1e4 - 100 + 2.5);
});

test("sell values follow gamedata.sell_value", () => {
  assert.equal(sellValue("material", 1), 3); // Iron Ore: sell {2, 4}
  assert.equal(sellValue("material", 1, 1), 6);
  assert.equal(sellValue("equipment", 5), 70); // Iron Longsword: value 70, rarity 1
  assert.equal(sellValue("material", 999999), undefined);
});
