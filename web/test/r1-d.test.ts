// R1-D (follow-up of R1-C): the wiki and battle pages on the shared helpers: one duration format (seconds kept under
// 10 minutes), one set of slot names, one segmented control, the single save help, the Treasure Bush wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { duration, GEAR_SLOT_NAMES, GEAR_SLOTS, slotName } from "../src/ui/dom.ts";
import { ITEM_TYPE_PLURALS, itemTypeText } from "../src/ui/names.ts";
import { items, itemSummary } from "../src/ui/wiki-data.ts";
import { bushDropText } from "../src/ui/wiki-enemies.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const idOf = (type: string, name: string) => items(type).find(([, it]) => it.name === name)![0];

test("duration(): seconds stay between 1 and 10 minutes, whole minutes from there", () => {
  assert.deepEqual([15, 60, 90, 599, 600, 765, 7200, 6300, 90000].map((s) => duration(s)),
    ["15 s", "1 min", "1 min 30 s", "9 min 59 s", "10 min", "13 min", "2 h", "1 h 45 min", "1 d 1 h"]);
});

test("one set of slot names, the game's own (weapon, head, body, hands, feet, trinket)", () => {
  assert.deepEqual(GEAR_SLOTS.map((s) => GEAR_SLOT_NAMES[s]), ["Weapon", "Head", "Body", "Hands", "Feet", "Trinket"]);
  assert.equal(slotName(3), "Body");
  assert.equal(slotName("hands"), "Hands");
  assert.equal(slotName(0), undefined);
  // The type line: slot then kind, the kind once when it is the slot's own name.
  assert.equal(itemTypeText("equipment", "Bracers", slotName(4)), "Hands · Bracers");
  assert.equal(itemTypeText("equipment", "Trinket", slotName(6)), "Trinket");
  assert.equal(itemTypeText("equipment", "Ring", slotName(6)), "Trinket · Ring");
  // Tooltips (itemSummary) use the same names and the shared type labels.
  assert.match(itemSummary("equipment", idOf("equipment", "Worn Trinket")), /^Equipment · Trinket\b/);
  assert.match(itemSummary("equipment", idOf("equipment", "Iron Bracers")), /^Equipment · Hands · level \d+/);
  assert.match(itemSummary("material", idOf("material", "Forest Essence")), /^Material · Essence\b/);
  assert.equal(ITEM_TYPE_PLURALS.consumable, "Consumables");
  // No page code names the slots any other way.
  for (const f of ["dom.ts", "wiki.ts", "wiki-data.ts", "wiki-stats.ts", "save-viewer.ts", "battle.ts"]) {
    assert.doesNotMatch(read(`web/src/ui/${f}`), /: "(Chest|Bracers|Talisman)"|\b(chest|talismans?)\b/i, f);
  }
});

test("Treasure Bushes drop crystals and gems (the game's material types)", () => {
  for (const id of [99, 100, 101, 102, 103, 104]) assert.equal(bushDropText(id), "crystals and gems", `treasure bush ${id}`);
  assert.equal(bushDropText(1), "herbs");
});

test("the wiki and battle pages use the shared helpers, and the replaced markup and styles are gone", () => {
  const ui = (f: string) => read(`web/src/ui/${f}`);
  const css = read("site/style.css");
  // gold() and duration(), no hand-made "N g" or "N min"
  for (const f of ["wiki.ts", "battle.ts", "recipe-chain.ts", "wiki-items.ts", "wiki-enemies.ts"]) {
    assert.doesNotMatch(ui(f), /\$\{fmt\.format\([^`]*\)\} g`|\/ 60\)\} min`/, f);
  }
  // segmented(): no ad-hoc toggle groups left on the wiki and battle pages
  for (const f of ["wiki.ts", "wiki-classes.ts", "wiki-enemies.ts", "battle.ts"]) assert.doesNotMatch(ui(f), /qxp-toggle|mode-switch/, f);
  assert.doesNotMatch(read("site/battle.html"), /mode-switch/);
  assert.doesNotMatch(css, /\.qxp-toggle|\.ref-kind-tag|\.xp-switch|\.cls-asc legend/);
  // the single save help: no data-save-help left
  for (const f of ["site/save.html", "site/battle.html", "web/src/ui/save-source.ts"]) assert.doesNotMatch(read(f), /data-save-help/, f);
  // the Expansions page points to the menu instead of repeating its switches
  assert.doesNotMatch(ui("wiki-expansions.ts"), /type: "checkbox"/);
  // the plan's first column is wide enough for its "Turn" header
  assert.match(css, /\.pg-row \{[^}]*grid-template-columns: 36px /);
});
