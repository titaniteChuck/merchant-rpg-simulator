// R1-B1 (live-site review R1): wiki enemies, maps, bushes and XP. Map lead text, level-70 maps, bush drop types,
// the Maps card, neutral formats in other languages, and the XP block's picks kept across a re-render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { loadLanguage, setLanguage } from "../src/tools/i18n.ts";
import { setShowAll } from "../src/ui/expansion-state.ts";
import { mapXpRows, uncraftableMapsWith } from "../src/ui/quest-xp.ts";
import { enemyIds, enemyMapRoles, loadWikiText, mapFlavour, regionOf } from "../src/ui/wiki-data.ts";
import { bushDropKinds, mapsFact, xpPicksOf } from "../src/ui/wiki-enemies.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const wikiText = JSON.parse(readFileSync(new URL("../../inventory/wikidata.json", import.meta.url), "utf8"));
const lang = (code: string) => JSON.parse(readFileSync(new URL(`../../inventory/i18n/${code}.json`, import.meta.url), "utf8"));
setShowAll(true);

test("F17: a map's lead is its flavour sentence, without the game's Boss / Mod tail, in every language", async () => {
  globalThis.fetch = (async () => ({ ok: true, json: async () => wikiText })) as never;
  await loadWikiText();
  setLanguage("en");
  assert.equal(mapFlavour(3), "Goblins are sick of you");
  assert.equal(mapFlavour(12), "Goblin, Murlok, Gnoll,Oh my!");
  for (const code of ["fr", "de", "es", "ru", "pl", "it", "br", "en"]) {
    if (code !== "en") loadLanguage(lang(code));
    setLanguage(code);
    for (const id of Object.keys(G.itemData.map).map(Number)) {
      const f = mapFlavour(id);
      assert.ok(f.length > 2, `${code} map ${id}: "${f}"`);
      assert.doesNotMatch(f, /:\s|\d+\s*x$/, `${code} map ${id}: "${f}"`);
    }
  }
  setLanguage("fr");
  assert.equal(mapFlavour(1), "Donjon forestier simple");
  setLanguage("en");
});

test("F42: the level-70 maps are named as left out of the XP rows, and the Maps card counts the craftable ones", () => {
  // Archon (97): boss of Archon's Reality Map (60) and of the five level-70 maps no crafter can make
  assert.deepEqual(uncraftableMapsWith(97), [27, 28, 29, 30, 31]);
  const { rows, uncraftable } = mapXpRows(97);
  assert.deepEqual([...new Set(rows.map((r) => r.map))], [26]);
  assert.deepEqual(uncraftable, [27, 28, 29, 30, 31]);
  assert.equal(enemyMapRoles(97).length, rows.length + uncraftable.length, "XP rows + left out = the Maps section");
  assert.equal(mapsFact(6, 6, 1), "6 · 1 craftable");
  // The Mighty Bush: only the level-70 map 32
  assert.deepEqual(mapXpRows(98).uncraftable, [32]);
  assert.deepEqual(uncraftableMapsWith(92), []);
  assert.equal(mapsFact(2, 2, 2), "2", "a map boss: no \"boss in N\" when it is the boss of every map");
  assert.equal(mapsFact(5, 1, 5), "5 · boss in 1");
});

test("F44: bush drops use the game's material types", () => {
  for (const id of [1, 11, 21, 30, 42, 77]) assert.deepEqual(bushDropKinds(id), ["herbs"], `quest bush ${id}`);
  for (const id of [99, 100, 101, 102, 103, 104]) assert.deepEqual(bushDropKinds(id), ["crystals", "gems"], `treasure bush ${id}`);
});

test("F40: neutral formats around translated names (no English glue)", () => {
  loadLanguage(lang("fr"));
  setLanguage("fr");
  try {
    for (const id of enemyIds()) {
      const why = regionOf("enemy", id)!.why;
      assert.doesNotMatch(why, /\bon\b|\bsends you to\b|'s\b|\bfirst in\b|\blevel\b/, `${id}: ${why}`);
    }
    assert.match(regionOf("enemy", 2)!.why, /^Board: /);
  } finally {
    setLanguage("en");
  }
});

test("F03: the XP block's picks are kept per enemy across a re-render", () => {
  const p = xpPicksOf(20, 1);
  p.grade = 5;
  p.heroes = 3;
  assert.deepEqual(xpPicksOf(20, 1), { grade: 5, heroes: 3, asc: 0 });
  assert.equal(xpPicksOf(21, 1).grade, 3, "another enemy starts at grade B");
});

test("F11 / F08 / F15 / F16 / F19 / F41 in the page code", () => {
  const src = (f: string) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8");
  const wiki = src("wiki.ts"), enemies = src("wiki-enemies.ts");
  assert.doesNotMatch(wiki, /Gathering and placeholder quests are left out/, "F08");
  assert.doesNotMatch(wiki, /"Enemy \(rare\)"/, "F11: the search shows the rare pill, not a kind");
  assert.match(enemies, /key: "rareName"[^\n]*nameCell\(/, "F11: the Rare variant column uses the name + pill cell");
  assert.match(wiki, /emptyList\(title, hidden\)/, "F15");
  assert.match(wiki, /class: "ess-fact"/, "F16");
  assert.doesNotMatch(enemies, /On the quest board of|Only in maps \(Scribe expansion\)/, "F19: no long bush paragraphs");
  assert.match(enemies, /isMapOnlyQuest\(id\) \? undefined/, "F41: no party fact on a map room");
  assert.match(enemies, /\{ tag: false \}/, "F41: no \"map boss\" region tag next to the Kind");
});
