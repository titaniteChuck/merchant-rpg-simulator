// Game names in the visitor's language (U29): src/ui/names.ts on the committed inventory/i18n files, the wiki helpers
// that use it, and the picker's language list (site/theme.js) against inventory/i18n/index.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import { loadLanguage, setLanguage } from "../src/tools/i18n.ts";
import {
  className, compareNames, crafterName, enemyName, itemName, itemNameFromEnglish, modName, passiveName, prefixName, questTitle, searchText, skillName,
  suffixName,
} from "../src/ui/names.ts";
import { enemyKind, href, itemText, regionOf, regionText, skillDesc, skillNames } from "../src/ui/wiki-data.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
loadGameData(read("inventory/gamedata.json"));
const index = read("inventory/i18n/index.json");
for (const l of index.languages) if (l.code !== "en") loadLanguage(read(`inventory/i18n/${l.file}`));

test("English by default: the game data's own names", () => {
  setLanguage("en");
  assert.equal(itemName("equipment", 1), "Iron Dagger");
  assert.equal(enemyName(20), "Basamus");
  assert.equal(enemyName(20, true), "Basamus Prime");
  assert.equal(questTitle(20), "Party Boss");
  assert.equal(className(1), "Warrior");
  assert.equal(skillName("Absorb All"), "Absorb All");
  assert.equal(itemNameFromEnglish("equipment", "Iron Dagger"), "Iron Dagger");
  assert.equal(searchText("Iron Dagger", "Iron Dagger"), "Iron Dagger");
});

test("French: names, rare names, titles, prefixes, crafters; suffix symbols and Basic stay", () => {
  setLanguage("fr");
  assert.equal(itemName("equipment", 1), "Dague en Fer");
  assert.equal(itemName("map", 1), "Carte de Tuvale");
  assert.equal(questTitle(20), "Boss de groupe");
  assert.equal(enemyKind(20), "Boss de groupe");
  assert.equal(className(1), "Guerrier");
  assert.equal(skillName("Absorb All"), "Absorption Totale");
  assert.equal(skillName("Basic"), "Basic");
  assert.equal(passiveName("Wisdom"), "Sagesse");
  assert.equal(prefixName(1), "Brûlant");
  assert.equal(suffixName(1), "+1");
  assert.equal(crafterName(1), "Forgeron");
  assert.equal(modName("equipment", 1, 1, 1), "Brûlant Dague en Fer +1");
  assert.equal(itemNameFromEnglish("equipment", "Iron Dagger"), "Dague en Fer");
  // search matches both: the shown name and the English one
  assert.match(searchText(itemName("equipment", 1), "Iron Dagger"), /Dague en Fer/);
  assert.match(searchText(itemName("equipment", 1), "Iron Dagger"), /Iron Dagger/);
  setLanguage("en");
});

test("descriptions follow the language, {placeholders} still filled; English keeps the wiki's text", () => {
  setLanguage("fr");
  assert.match(itemText("consumable", 1), /^Restaure \d+ PV$/);
  assert.equal(skillDesc("Absorb All"), "Soigne .5x Dmg infligés (1 Tour)");
  setLanguage("en");
  assert.equal(skillDesc("Absorb All"), ""); // English comes from wikidata.json (not loaded in this test), never TextData
});

test("skill routes stay English; lists sort by the translated name", () => {
  setLanguage("fr");
  assert.equal(href.skill("Absorb All"), "wiki.html#/skill/Absorb%20All");
  const shown = skillNames().map(skillName);
  assert.deepEqual(shown, [...shown].sort(compareNames));
  setLanguage("en");
});

test("Russian (non-Latin script) and regions", () => {
  setLanguage("ru");
  assert.match(itemName("equipment", 1) ?? "", /[Ѐ-ӿ]/);
  const r = regionOf("enemy", 1)!;
  assert.equal(r.full, "Лес Тувале");
  assert.match(regionText(r), /Tuvale/); // the English short name still matches a search
  setLanguage("en");
  assert.equal(regionOf("enemy", 1)!.name, "Tuvale");
});

test("the picker's language codes (site/theme.js LANGS) are index.json's", () => {
  const js = readFileSync(new URL("../../site/theme.js", import.meta.url), "utf8");
  const m = /const LANGS = (\[[^\]]*\])/.exec(js);
  assert.ok(m, "LANGS in theme.js");
  assert.deepEqual(JSON.parse(m[1]), index.languages.map((l: { code: string }) => l.code));
});
