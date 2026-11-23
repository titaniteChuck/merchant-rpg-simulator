// Wiki v3 (U19): equipment bonus stats (no NaN), placeholder rows, rarity colours, recipe chains, class level caps
// and the "good against" rules of hero skills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { loadTimelines } from "../src/tools/schedule.ts";
import { clampSelection, tierMaxLevel, unlockLevel } from "../src/ui/wiki-classes.ts";
import { itemSummary, items, statText } from "../src/ui/wiki-data.ts";
import { bonusLines, bonusRange, bonusText, isPlaceholder, RARITY_COLOURS, recipeOf, recipeTree } from "../src/ui/wiki-items.ts";
import { goodAgainst } from "../src/ui/wiki-skills.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
loadTimelines(JSON.parse(readFileSync(new URL("../../inventory/timelines.json", import.meta.url), "utf8")));

const ARCHANOS = 776;

test("equipment bonus stats are ranges: no NaN (Archanos)", () => {
  const it = G.itemData.equipment[ARCHANOS];
  assert.equal(it.name, "Archanos");
  // the data stores { 1: min, 2: max }; statText used to do arithmetic on the object and print "+NaN Str"
  assert.equal(statText("str", it.bonusStat.str), "+20–25 Str");
  assert.deepEqual(bonusLines(it), ["+20–25 Str", "+20–25 Int", "+15–25 Crit"]);
  for (const [id] of items("equipment")) {
    const s = itemSummary("equipment", id);
    assert.ok(!s.includes("NaN"), `${id}: ${s}`);
    for (const line of bonusLines(G.itemData.equipment[id], 5, 2, 10)) assert.ok(!line.includes("NaN"), `${id}: ${line}`);
  }
  // fractions show in %, negatives keep their sign, mixed ranges read "to"
  assert.equal(bonusText("atkPct", { 1: 0.05, 2: 0.15 }), "+5–15% Atk");
  assert.equal(bonusText("accBns", { 1: -7, 2: 7 }), "−7 to +7 Acc");
  // grade S (×1.25 / ×1.5) and ascension 2 (str × 2.5): ceil(20 × 1.25 × 2.5), ceil(25 × 1.5 × 2.5)
  assert.deepEqual(bonusRange("str", it.bonusStat.str, 5, 2), { lo: 63, hi: 94, pct: false });
});

test("equipment list: placeholders out, every item has a slot, a kind and stats", () => {
  const all = Object.keys(G.itemData.equipment).length;
  const real = items("equipment");
  assert.ok(real.length > 600 && real.length < all, `${real.length} of ${all}`);
  for (const [id, it] of real) {
    assert.ok(it.itemSlot >= 1 && it.itemSlot <= 6, `${id} slot`);
    assert.ok(it.subType && it.subType !== "None", `${id} kind`);
    assert.ok(!/^(Region \d|Extra Item|Event Item|New Item|Break$|\d+\+ Items)/.test(it.name), `${id} ${it.name}`);
    // base stats from the game's item formula (trinkets: bonus stats only)
    const made: Record<string, number> = api.makeItem(id, 3, 0, 60, 1) as never;
    const base = ["atk", "matk", "acc", "def", "mdef"].some((k) => made[k]);
    assert.ok(base || it.itemSlot === 6, `${id} ${it.name} has no stats`);
  }
  for (const id of [311, 482, 498, 517, 549, 666, 763]) assert.ok(isPlaceholder("equipment", G.itemData.equipment[id]), `placeholder ${id}`);
  assert.ok(!items("material").some(([, m]) => !m.subType));
  assert.ok(!items("consumable").some(([, c]) => c.name === "Extra Potion"));
});

test("rarity colours are the game's (10 and 11 reuse 3 and 4)", () => {
  assert.equal(RARITY_COLOURS[2], "#80ff80");
  assert.equal(RARITY_COLOURS[10], RARITY_COLOURS[3]);
  assert.equal(RARITY_COLOURS[11], RARITY_COLOURS[4]);
  assert.equal(RARITY_COLOURS[7], "#ff0000");
});

test("recipe chain: equipment boxes only, crafted materials hidden but counted in the totals", () => {
  const t = recipeTree("equipment", 495)!; // Orous Spear: the deepest equipment chain
  assert.equal(t.name, "Orous Spear");
  assert.equal(t.depth, 5); // Adaman Ingot / Oak Lumber (crafted materials) are no longer boxes
  const sum = (n: typeof t): void => {
    const parts = [...n.kids.map((k) => [k.amount, k.totalTime, k.totalCost]), ...n.hidden.map((h) => [h.amount, h.time, h.cost])];
    assert.equal(n.totalTime, n.time + parts.reduce((s, [a, tm]) => s + a * tm, 0));
    assert.equal(n.totalCost, n.cost + parts.reduce((s, [a, , c]) => s + a * c, 0));
    for (const k of n.kids) assert.ok(k.type === "equipment" && recipeOf(k.type, k.id).length > 0, `${k.name} is crafted equipment`);
    for (const [rt, rid] of n.raw) assert.ok(rt !== "equipment" || recipeOf(rt, rid).length === 0, `${rid} should be a box`);
    for (const h of n.hidden) assert.ok(h.type !== "equipment" && recipeOf(h.type, h.id).length > 0);
    n.kids.forEach(sum);
  };
  sum(t);
  // Adaman Sword: its crafted ingredient is an ingot, so one box whose total includes the ingots' crafting
  const sword = recipeTree("equipment", 32)!;
  assert.equal(sword.kids.length, 0);
  assert.ok(sword.hidden.length > 0 && sword.totalTime > sword.time);
  assert.equal(recipeTree("material", 1)!.kids.length, 0);
});

test("class level caps and ascension unlocks follow data.Default", () => {
  assert.deepEqual([1, 2, 3].map(tierMaxLevel), [50, 50, 60]);
  // canHeroPrestige reads heroPrestigeLevelRequirement[prestigeLevel + 1]
  assert.deepEqual([1, 2, 3].map(unlockLevel), [40, 50, null]);
  assert.deepEqual(clampSelection([1, 2, 3], { level: 45, asc: 1 }), { level: 45, asc: 1 });
  assert.deepEqual(clampSelection([1, 2, 3], { level: 55, asc: 0 }), { level: 55, asc: 2 });
  assert.deepEqual(clampSelection([1, 2, 3], { level: 99, asc: 5 }), { level: 60, asc: 2 });
});

test("good against: rules on timelines", () => {
  assert.deepEqual(goodAgainst("Hellfire"), []); // an enemy skill
  const silence = goodAgainst("Silence");
  const archon = silence.find((m) => m.name === "Archon");
  assert.ok(archon && archon.reason.includes("Unleashed Power"), JSON.stringify(archon));
  const cleanse = goodAgainst("Cleanse");
  assert.ok(cleanse.length >= 10 && cleanse.every((m) => m.reason.startsWith("cleanses")));
  assert.ok(goodAgainst("Taunt").every((m) => m.reason.startsWith("draws")));
  assert.ok(goodAgainst("Greater Heal").slice(0, 5).every((m) => m.reason.includes("hits everyone")));
  // sorted best first
  for (const list of [silence, cleanse]) for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].score >= list[i].score);
});
