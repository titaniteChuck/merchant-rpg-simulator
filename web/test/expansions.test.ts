// E18: what the Frozen and Scribe expansions gate, and which ones a save proves it owns (web/src/tools/expansions.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadGameData } from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { contentExpansion, effectiveExpansions, EXPANSIONS, gatedItems, gatedQuests, inferExpansions } from "../src/tools/expansions.ts";
import { decodeSaveText, loadSaveText } from "../src/tools/save.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const example = readFileSync(new URL("../../site/data/example-save.txt", import.meta.url), "utf8");

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const needs = (...args: Parameters<typeof contentExpansion>) => contentExpansion(...args)?.needs ?? [];

test("metadata uses the game's names", () => {
  assert.equal(EXPANSIONS.Frozen.name, "Frozen Tome");
  assert.equal(EXPANSIONS.Frozen.storeTitle, "Frozen Expansion");
  assert.equal(EXPANSIONS.Scribe.storeTitle, "Scribe Expansion");
  assert.equal(EXPANSIONS.Scribe.productId, "bearface.games.merchant.expansion.scribe");
});

test("access gates: region 6, Bard, prestige 3 / level > 50, Scribe crafter, item ascension", () => {
  assert.deepEqual(contentExpansion("region", 6), { needs: ["Frozen"], gate: "access" });
  for (const r of [1, 2, 3, 4, 5]) assert.equal(contentExpansion("region", r), null);
  assert.deepEqual(contentExpansion("class", 9), { needs: ["Frozen"], gate: "access" });
  assert.equal(contentExpansion("class", 8), null);
  assert.deepEqual(needs("prestige", 3), ["Frozen"]);
  assert.equal(contentExpansion("prestige", 2), null);
  assert.equal(contentExpansion("level", 50), null);
  assert.deepEqual(needs("level", 51), ["Frozen"]);
  assert.deepEqual(contentExpansion("crafter", 8), { needs: ["Scribe"], gate: "access" });
  for (const c of [1, 5, 6, 7]) assert.equal(contentExpansion("crafter", c), null);
  assert.deepEqual(needs("itemAscension", 1), ["Scribe"]);
  assert.equal(contentExpansion("itemAscension", 0), null);
});

test("quests: region-6 board quests need Frozen, map-only quests Scribe, region-6 map bosses both", () => {
  assert.deepEqual(gatedQuests("Frozen").filter((q) => !needs("quest", q).includes("Scribe")), [72, 73, ...range(76, 90)]);
  assert.deepEqual(gatedQuests("Scribe").filter((q) => !needs("quest", q).includes("Frozen")), [91, 92, 93, 94, 99, 100, 101, 102, 103]);
  for (const q of [95, 96, 97, 98, 104]) assert.deepEqual(needs("quest", q), ["Frozen", "Scribe"], `quest ${q}`);
  for (const q of [1, 57, 70, 71, 74]) assert.equal(contentExpansion("quest", q), null, `quest ${q}`);
  assert.deepEqual(contentExpansion("enemy", 80), { needs: ["Frozen"], gate: "access" });
});

test("materials follow their sources", () => {
  const frozenOnly = gatedItems("material", "Frozen").filter((m) => !needs("material", m).includes("Scribe"));
  assert.deepEqual(frozenOnly, [...range(206, 215), ...range(217, 224), ...range(226, 233), ...range(235, 241),
    ...range(243, 250), 252, 253, 254, 260, 261, 262, 263]);
  const scribeOnly = gatedItems("material", "Scribe").filter((m) => !needs("material", m).includes("Frozen"));
  assert.deepEqual(scribeOnly, [33, 55, 84, 109, 140, 265, 266, 267, 268, 273, 274, 275, 276, 277]);
  for (const m of [255, 269, 270, 271, 272, 278]) assert.deepEqual(needs("material", m), ["Frozen", "Scribe"], `material ${m}`);
  for (const m of [1, 152, 180, 256, 257, 258, 259]) assert.equal(contentExpansion("material", m), null, `material ${m}`);
  assert.equal(contentExpansion("material", 222)?.gate, "obtain");
});

test("equipment: level 51-60 needs Frozen, 764-780 Scribe", () => {
  const eq = G.itemData.equipment;
  for (const [id, e] of Object.entries<any>(eq)) {
    if (e.itemLevel > 50 && e.crafterID) assert.ok(needs("equipment", +id).includes("Frozen"), `equipment ${id}`);
  }
  assert.deepEqual(needs("equipment", 654), ["Frozen"]); // Glacial Dagger, level 50 but made from Glacial Ingot
  for (const id of range(764, 771)) assert.deepEqual(needs("equipment", id), ["Scribe"], `equipment ${id}`);
  for (const id of range(772, 780)) assert.deepEqual(needs("equipment", id), ["Frozen", "Scribe"], `equipment ${id}`);
  assert.equal(contentExpansion("equipment", 1), null);
  assert.equal(contentExpansion("equipment", 763), null); // "Gods" list header
});

test("consumables, maps and ascended items", () => {
  assert.deepEqual(gatedItems("consumable", "Frozen"), [...range(43, 54), 56]);
  assert.deepEqual(gatedItems("consumable", "Scribe"), range(60, 69));
  for (const c of [10, 11, 14, 25, 26, 32]) assert.equal(contentExpansion("consumable", c), null, `boost ${c}`); // boost.all, not an expansion
  for (const m of range(1, 20)) assert.deepEqual(needs("map", m), ["Scribe"], `map ${m}`);
  for (const m of range(21, 26)) assert.deepEqual(needs("map", m), ["Frozen", "Scribe"], `map ${m}`);
  assert.deepEqual(contentExpansion("item", 1, { type: "equipment", ascension: 1 }), { needs: ["Scribe"], gate: "obtain" });
  assert.deepEqual(needs("equipment", 1, { ascension: 2 }), ["Scribe"]);
  // A level-51+ item ascends with Glacial/Arctic Essence; a level-50 one with Fire/Inferno Essence.
  assert.deepEqual(needs("consumable", 43, { ascension: 1 }), ["Frozen", "Scribe"]);
  assert.deepEqual(needs("map", 1, { ascension: 1 }), ["Scribe"]);
});

test("the example save (unlock all) proves both expansions", () => {
  for (const save of [decodeSaveText(example), loadSaveText(example)]) {
    const r = inferExpansions(save);
    assert.deepEqual([...r.owned].sort(), ["Frozen", "Scribe"]);
    assert.ok(r.anyOwned);
    assert.ok(r.evidence.some((e) => e.expansion === "Frozen" && /Bard/.test(e.reason)));
    assert.ok(r.evidence.some((e) => e.expansion === "Scribe" && /ascension fields/.test(e.reason)));
  }
});

test("a minimal base-game save proves nothing", () => {
  const raw = {
    hero: [{ class: 1, level: 20, prestigeLevel: 1, region: 2, heroInventory: [] }],
    crafter: [{ id: 1, level: 5, exp: 0, craftStatus: 0 }],
    inventory: ["1|1|10|2"],
    mapInventory: [],
    sales: [],
    qAmounts: [3, 5],
    inventorySlotsBought: 32,
  };
  const r = inferExpansions(raw);
  assert.equal(r.owned.size, 0);
  assert.equal(r.anyOwned, false);
  assert.deepEqual(r.evidence, []);
});

test("counts: heroes and gold-bought slots", () => {
  const heroes = (n: number) => Array.from({ length: n }, () => ({ class: 1, level: 10, prestigeLevel: 1, region: 1 }));
  assert.deepEqual([...inferExpansions({ hero: heroes(13) }).owned], []);
  const fourteen = inferExpansions({ hero: heroes(14) });
  assert.deepEqual([...fourteen.owned], []);
  assert.ok(fourteen.anyOwned);
  assert.deepEqual([...inferExpansions({ hero: heroes(16) }).owned], ["Scribe"]);
  assert.deepEqual([...inferExpansions({ hero: heroes(17) }).owned].sort(), ["Frozen", "Scribe"]);
  assert.ok(inferExpansions({ inventorySlotsBought: 100 }).anyOwned);
  assert.deepEqual([...inferExpansions({ inventorySlotsBought: 128 }).owned].sort(), ["Frozen", "Scribe"]);
});

test("manual toggles override the inference", () => {
  const inferred = inferExpansions(decodeSaveText(example));
  assert.deepEqual([...effectiveExpansions(inferred, {})].sort(), ["Frozen", "Scribe"]);
  assert.deepEqual([...effectiveExpansions(inferred, { Frozen: false })], ["Scribe"]);
  assert.deepEqual([...effectiveExpansions(new Set(), { Scribe: true })], ["Scribe"]);
  assert.deepEqual([...effectiveExpansions(["Frozen"], { Scribe: null })], ["Frozen"]);
});
