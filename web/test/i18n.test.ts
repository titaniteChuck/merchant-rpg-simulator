// Game-content translations (src/tools/i18n.ts) on the committed inventory/i18n files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clean, coverage, type I18nFile } from "../src/tools/export-i18n.ts";
import { currentLanguage, loadedLanguages, loadLanguage, setLanguage, tr } from "../src/tools/i18n.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../inventory/i18n/${name}`, import.meta.url), "utf8"));
const en = read("en.json"), fr = read("fr.json");
const G = JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8"));

test("English until a language is set; unknown languages are refused", () => {
  assert.equal(currentLanguage(), "en");
  assert.equal(tr("equipment", 1), undefined); // no file loaded: callers keep their English
  assert.equal(setLanguage("fr"), false);
  assert.equal(currentLanguage(), "en");
  assert.throws(() => loadLanguage({ nope: 1 }));
});

test("French names and descriptions", () => {
  assert.equal(loadLanguage(fr), "fr");
  assert.equal(setLanguage("FR"), true);
  assert.equal(currentLanguage(), "fr");
  assert.equal(tr("equipment", 1), "Dague en Fer");
  assert.equal(tr("material", "1"), "Minerai de fer");
  assert.equal(tr("material", 1, "d"), "Un minerai de fer léger utilisé pour les Armes");
  assert.equal(tr("consumable", 1, "d"), "Restaure {hp} PV"); // placeholders kept for the caller to fill
  assert.equal(tr("map", 1), "Carte de Tuvale");
  assert.equal(tr("skill", "Absorb All"), "Absorption Totale");
  assert.equal(tr("skill", "Absorb All", "d"), "Soigne .5x Dmg infligés (1 Tour)");
  assert.equal(tr("passive", "Might"), "Puissance");
  assert.equal(tr("quest", 4), "Araignée des herbes");
  assert.equal(tr("quest", 4, "nb"), "Arachne");
  assert.equal(tr("quest", 61, "t"), "Boss épique");
  assert.equal(tr("class", 1), "Guerrier");
  assert.equal(tr("class", 1, "d"), "Un tank robuste avec une défense élevée");
  assert.equal(tr("prefix", 1), "Brûlant");
  assert.equal(tr("crafter", 1), "Forgeron");
  assert.equal(tr("region", 1), "Forêt de Tuvale");
  // Missing ids and fields fall back (undefined): placeholder quest 39, unknown skill, quest 4 has no normal title.
  assert.equal(tr("quest", 39), undefined);
  assert.equal(tr("skill", "No Such Skill"), undefined);
  assert.equal(tr("quest", 4, "t"), undefined);
});

test("English file matches the site's English names", () => {
  loadLanguage(en);
  assert.deepEqual(loadedLanguages().sort(), ["en", "fr"]);
  setLanguage("en");
  for (const type of ["equipment", "material", "consumable", "map"] as const) {
    for (const id of Object.keys(en.items[type])) assert.equal(tr(type, id), G.itemData[type][id].name, `${type} ${id}`);
  }
  for (const name of [...Object.keys(G.abilityData), ...Object.keys(G.passiveData).filter((p) => p !== "None")]) {
    assert.equal(tr("skill", name), name);
  }
  for (const id of Object.keys(en.quests)) assert.equal(tr("quest", id), G.questData[id].name);
  for (const id of Object.keys(G.heroList)) assert.equal(tr("class", id), G.heroList[id].name);
  for (const id of Object.keys(G.crafterData)) assert.equal(tr("crafter", id), G.crafterData[id].name);
  setLanguage("fr");
});

test("index.json: 8 languages, French fully covered", () => {
  const index = read("index.json");
  assert.deepEqual(index.languages.map((l: { code: string }) => l.code), ["en", "fr", "de", "es", "br", "ru", "it", "pl"]);
  const f = index.languages.find((l: { code: string }) => l.code === "fr");
  assert.equal(f.native, "Français");
  assert.deepEqual(f.missing, []);
  assert.ok(Object.values<number>(f.coverage).every((x) => x === 100));
  assert.deepEqual(coverage(fr as I18nFile, en as I18nFile).coverage, f.coverage);
});

test("clean(): byte escapes, BOM, whitespace", () => {
  assert.equal(clean("Volc\\195\\161n Grimhal "), "Volcán Grimhal");
  assert.equal(clean("﻿  Iron Ore\n"), "Iron Ore");
  assert.equal(clean("   "), undefined);
  assert.equal(clean(3), undefined);
});
