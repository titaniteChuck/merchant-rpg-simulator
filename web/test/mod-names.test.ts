// U34: names of modded items built from their parts (names.ts modItemName): "[Prefix] Item +N", each part in the
// visitor's language (the suffix symbol never translated), in the save viewer's rows, its CSV and the engine's names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { loadLanguage, setLanguage } from "../src/tools/i18n.ts";
import { parseSave } from "../src/tools/save.ts";
import { itemNameFromEnglish, modItemName, parseItemName, prefixTag } from "../src/ui/names.ts";
import { heroViews, inventoryRows, toCsv } from "../src/ui/save-tables.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
api.loadGameData(read("inventory/gamedata.json"));
loadLanguage(read("inventory/i18n/fr.json"));

const PLATEMAIL = 372, SABATONS = 126, DEFENDER = 25, TITAN = 20;

test("English: prefix in brackets (no possessive), base name, suffix symbol", () => {
  setLanguage("en");
  assert.equal(prefixTag(DEFENDER), "Defender");
  assert.equal(modItemName("equipment", PLATEMAIL, { prefix: DEFENDER, suffix: 6 }), "[Defender] Molten Platemail +6");
  assert.equal(modItemName("equipment", SABATONS, { suffix: 6 }), "Scorpion Sabatons +6");
  assert.equal(modItemName("equipment", PLATEMAIL, { prefix: DEFENDER }), "[Defender] Molten Platemail");
  assert.equal(modItemName("equipment", PLATEMAIL, { prefix: 0, suffix: 0 }), "Molten Platemail");
  assert.equal(modItemName("equipment", PLATEMAIL), "Molten Platemail");
  assert.equal(modItemName("equipment", 1, { prefix: TITAN, suffix: 1 }), "[Titan] Iron Dagger +1");
});

test("French: base name and prefix translated, the suffix symbol kept", () => {
  setLanguage("fr");
  assert.equal(modItemName("equipment", PLATEMAIL, { prefix: DEFENDER, suffix: 6 }), "[du Défenseur] Plate en Fusion +6");
  assert.equal(modItemName("equipment", SABATONS, { suffix: 6 }), "Sabatons du Scorpion +6");
  assert.equal(modItemName("equipment", PLATEMAIL, { prefix: DEFENDER }), "[du Défenseur] Plate en Fusion");
  assert.equal(modItemName("equipment", 1, { prefix: 1, suffix: 1 }), "[Brûlant] Dague en Fer +1");
  setLanguage("en");
});

test("engine names (prefix and suffix in one English string) are split back and shown part by part", () => {
  setLanguage("en");
  assert.deepEqual(parseItemName("equipment", "Defender's Molten Platemail +6"), { id: PLATEMAIL, prefix: DEFENDER, suffix: 6 });
  assert.deepEqual(parseItemName("equipment", "Scorpion Sabatons +6"), { id: SABATONS, prefix: 0, suffix: 6 });
  assert.deepEqual(parseItemName("equipment", "Scorpion Sabatons"), { id: SABATONS });
  assert.equal(parseItemName("equipment", "No Such Thing +6"), undefined);
  assert.equal(itemNameFromEnglish("equipment", "Defender's Molten Platemail +6"), "[Defender] Molten Platemail +6");
  assert.equal(itemNameFromEnglish("equipment", "Scorpion Sabatons"), "Scorpion Sabatons");
  setLanguage("fr");
  assert.equal(itemNameFromEnglish("equipment", "Defender's Molten Platemail +6"), "[du Défenseur] Plate en Fusion +6");
  assert.equal(itemNameFromEnglish("equipment", "Scorpion Sabatons +6"), "Sabatons du Scorpion +6");
  assert.equal(itemNameFromEnglish("equipment", "No Such Thing +6"), "No Such Thing +6");
  setLanguage("en");
});

// A made-up save (item ids in hex, as the game writes them): a modded platemail and sabatons in the inventory, on the counter and on the hero.
const RAW = {
  version: 1.21, gameMode: "Standard", gold: 0, mapSlotsUnlocked: 3,
  inventory: [`3|${PLATEMAIL.toString(16)}|3|3|${DEFENDER}|6|A10B2C5D1|0|A0B0C0|0`, `3|${SABATONS.toString(16)}|3|5|0|6|A10B2C5D1|0|A0B0C0|0`],
  mapInventory: [],
  sales: [`3|${PLATEMAIL.toString(16)}|3|3|${DEFENDER}|0|A10B2C5D1|0|A0B0C0|0`],
  crafter: [],
  hero: [{
    id: 1, heroID: 1, name: "Test", class: 1, level: 60, exp: 0, prestigeLevel: 1, hp: 100, questHP: 100,
    attackList: [0, 0, 0, 0, 0], passiveSelect: "Might", campaignID: -1, questListID: -1,
    heroInventory: [`3|${SABATONS.toString(16)}|3|5|0|6|A10B2C5D1|0|A0B0C0|0`],
  }],
};

test("save viewer rows: inventory, counter, gear and the CSV use the same names", () => {
  setLanguage("en");
  const sv = parseSave(structuredClone(RAW));
  const inv = inventoryRows(sv);
  assert.deepEqual(inv.map((r) => r.name), ["[Defender] Molten Platemail +6", "Scorpion Sabatons +6", "[Defender] Molten Platemail"]);
  assert.equal(inv[0].prefix, "Defender");
  assert.equal(inv[0].suffix, "+6");
  assert.equal(heroViews(sv)[0].gear[0].name, "Scorpion Sabatons +6");
  assert.match(toCsv(inv), /\n[^\n]*,\[Defender\] Molten Platemail \+6,/);
  setLanguage("fr");
  const fr = inventoryRows(sv);
  assert.deepEqual(fr.map((r) => r.name), ["[du Défenseur] Plate en Fusion +6", "Sabatons du Scorpion +6", "[du Défenseur] Plate en Fusion"]);
  assert.equal(heroViews(sv)[0].gear[0].name, "Sabatons du Scorpion +6");
  setLanguage("en");
});
