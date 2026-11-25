// U49: wiki details pages configured by ascension, prefix and suffix (src/ui/wiki-config.ts): the hash route's query,
// what each object can carry, the save viewer's links that open a page on a saved map's or item's modifiers, and the
// engine figures that change with a modifier.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const api = await import("../src/sim/api.ts");
const { G } = await import("../src/sim/data.ts");
const {
  configHref, configQuery, configRoute, equipmentAt, mapEnemyStats, mapView, NO_CONFIG, normaliseConfig, parseConfig, parseHash, prefixEffect,
  validAscs, validPrefixes, validSuffixes, configSell, configRarity, consumableStatsAt, isConfigurable,
} = await import("../src/ui/wiki-config.ts");
const { itemLink, href } = await import("../src/ui/wiki-data.ts");
const { enemyTable } = await import("../src/ui/wiki-enemies.ts");
const { parseSave } = await import("../src/tools/save.ts");
const { inventoryRows, mapRows, savedMods } = await import("../src/ui/save-tables.ts");

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const MAP = 22; // Grimal-Frentir Map, level 52, Enemy × 2, boss 89
const TITAN = 20; // prefix: hpBns 40 on maps (× the map's tier), sell 0.3
const DAGGER = 15; // Mithril Dagger (weapon)
const TRINKET = 259; // Arachne's Ring (slot 6)
const LEVEL70 = 28; // Weekly Boss Rush Map

test("URL: build, parse and round trip; plain is the clean route", () => {
  assert.equal(configQuery({}), "");
  assert.equal(configQuery(NO_CONFIG), "");
  assert.equal(configQuery({ asc: 1, prefix: TITAN, suffix: 5 }), "?asc=1&prefix=20&suffix=5");
  assert.equal(configQuery({ suffix: 3 }), "?suffix=3");
  assert.equal(configRoute("map", MAP, NO_CONFIG), "#/map/22");
  assert.equal(configRoute("map", MAP, { asc: 1, prefix: TITAN, suffix: 5 }), "#/map/22?asc=1&prefix=20&suffix=5");
  assert.equal(configHref("equipment", DAGGER, { asc: 2, suffix: 25 }), "wiki.html#/item/equipment/15?asc=2&suffix=25");
  // the links without a configuration stay what they were
  assert.equal(href.item("map", MAP), "wiki.html#/map/22");
  assert.equal(href.item("material", 33), "wiki.html#/item/material/33");

  const { parts, query } = parseHash("#/map/22?asc=1&prefix=20&suffix=5");
  assert.deepEqual(parts, ["map", "22"]);
  assert.deepEqual(parseConfig("map", MAP, query), { asc: 1, prefix: TITAN, suffix: 5 });
  assert.deepEqual(parseHash("#/item/equipment/15").parts, ["item", "equipment", "15"]);
  assert.equal(parseHash("#/item/equipment/15").query.toString(), "");
  // an encoded "?" in a name stays in the route, it doesn't start the query
  assert.deepEqual(parseHash("#/skill/What%3F").parts, ["skill", "What?"]);
  for (const cfg of [NO_CONFIG, { asc: 1, prefix: 0, suffix: 24 }, { asc: 0, prefix: 43, suffix: 16 }]) {
    assert.deepEqual(parseConfig("map", MAP, parseHash(configRoute("map", MAP, cfg)).query), cfg);
  }
});

test("URL: values the object can't take are dropped (never a broken page)", () => {
  assert.deepEqual(parseConfig("map", MAP, "asc=2&prefix=999&suffix=-1"), NO_CONFIG); // maps stop at asc 1
  assert.deepEqual(parseConfig("map", MAP, "suffix=17"), NO_CONFIG); // *1 needs an asc-1 map
  assert.deepEqual(parseConfig("map", MAP, "asc=1&suffix=17"), { asc: 1, prefix: 0, suffix: 17 });
  assert.deepEqual(parseConfig("map", MAP, "asc=x&prefix=1.5"), NO_CONFIG);
  assert.deepEqual(parseConfig("equipment", TRINKET, "prefix=1&suffix=1"), { asc: 0, prefix: 1, suffix: 0 }); // no suffix on a trinket
  assert.deepEqual(parseConfig("material", 33, "asc=1"), NO_CONFIG);
  assert.deepEqual(normaliseConfig("consumable", 1, { asc: 2, prefix: 3, suffix: 3 }), { asc: 2, prefix: 0, suffix: 0 });
  assert.equal(configHref("map", LEVEL70, { prefix: 1, suffix: 1 }), "wiki.html#/map/28");
});

test("valid modifier lists per object", () => {
  assert.deepEqual(validAscs("map", MAP), [0, 1]);
  assert.deepEqual(validAscs("equipment", DAGGER), [0, 1, 2]);
  assert.deepEqual(validAscs("material", 33), [0]);
  // every prefix on an enchantable map or item (the Enchanter's pool depends on its level, not the item's)
  const allPrefixes = Object.keys(G.prefixList).map(Number).filter((n) => n > 0);
  assert.equal(allPrefixes.length, 43);
  assert.deepEqual(validPrefixes("map", MAP), allPrefixes.sort((a, b) => a - b));
  assert.equal(validPrefixes("equipment", DAGGER).length, 43);
  assert.deepEqual(validPrefixes("consumable", 1), []);
  assert.deepEqual(validPrefixes("map", LEVEL70), []); // level 70: no gem, no rune, not craftable
  // suffixes: +1 … +16, then *1 … *8 at asc 1, **1 … **8 at asc 2
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  assert.deepEqual(validSuffixes("map", MAP, 0), range(1, 16));
  assert.deepEqual(validSuffixes("map", MAP, 1), range(1, 24));
  assert.deepEqual(validSuffixes("map", MAP, 2), []); // no asc-2 map
  assert.deepEqual(validSuffixes("equipment", DAGGER, 2), range(1, 32));
  assert.deepEqual(validSuffixes("equipment", TRINKET, 0), []);
  assert.deepEqual(validSuffixes("map", LEVEL70, 0), []);
  assert.ok(isConfigurable("map", MAP) && isConfigurable("consumable", 1) && !isConfigurable("material", 33));
});

test("a save map's link carries its ascension, prefix and suffix", () => {
  const sv = parseSave({
    version: 1.21, gameMode: "Standard", gold: 0, mapSlotsUnlocked: 3, sales: [], crafter: [], hero: [],
    inventory: ["3|F|3|1|1|5|A10B2C5D1|0|A0B0C0|2"],
    // map 0x16 = 22, seed 1, grade 3, prefix 20 (Titan's), suffix 5 (+5), enchant attempts, asc 1
    mapInventory: ["4|16|1|3|20|5|A0B0C0|1", "4|16|1|3|0|0|A0B0C0|0"],
  });
  const [modded, plain] = mapRows(sv);
  assert.deepEqual(savedMods(modded), { asc: 1, prefix: TITAN, suffix: 5 });
  // the link the save viewer builds (save-viewer itemCell: itemLink with the row's saved modifiers)
  const a = itemLink("map", MAP, String(modded.name), modded.rarity, modded.asc, { always: true, config: savedMods(modded) }) as unknown as FakeElement;
  assert.equal(a.getAttribute("href"), "wiki.html#/map/22?asc=1&prefix=20&suffix=5");
  const b = itemLink("map", MAP, String(plain.name), plain.rarity, plain.asc, { always: true, config: savedMods(plain) }) as unknown as FakeElement;
  assert.equal(b.getAttribute("href"), "wiki.html#/map/22");
  // an equipment stack of the inventory: its page opens on its asc 2, prefix and suffix
  const [eq] = inventoryRows(sv);
  assert.equal(configHref("equipment", Number(eq.id), savedMods(eq)), "wiki.html#/item/equipment/15?asc=2&prefix=1&suffix=5");
});

test("computed values change with a modifier (engine figures)", () => {
  const plain = mapView(MAP, NO_CONFIG)!;
  assert.equal(plain.enemyMod, 2);
  assert.equal(plain.rarity, 1);
  assert.deepEqual(plain.essence, [[140, 100], [255, 50]]); // the data's base reward at grade C
  // the boss inside the map: HP × 1.5 × (2 − 1) / 2 = 55,000 × 0.75
  assert.equal(mapEnemyStats(89, false, plain.stats)!.HP, 41250);

  // suffix +5 (atk 0.3): essence and Enemy × × 1.3, one rarity step, a higher price
  const s5 = mapView(MAP, { asc: 0, prefix: 0, suffix: 5 })!;
  assert.equal(s5.enemyMod, 2.6);
  assert.deepEqual(s5.essence, [[140, 130], [255, 65]]);
  assert.equal(s5.rarity, 2);
  assert.ok(s5.sell! > plain.sell!);
  assert.equal(mapEnemyStats(89, false, s5.stats)!.HP, 66000);

  // Titan's prefix: essence × 1.3, enemy HP +40 × tier 6 = +240 before the multiplier
  const titan = mapView(MAP, { asc: 0, prefix: TITAN, suffix: 0 })!;
  assert.equal(titan.prefixStats.hpBns, 240);
  assert.equal(mapEnemyStats(89, false, titan.stats)!.HP, (55000 + 240) * 0.75);
  assert.match(prefixEffect("map", MAP, TITAN), /essence ×1\.3, enemy HP \+240/);
  // Skilled's essence modifier counts on top of its sell (essenceBase 1.25 × 1.25)
  assert.deepEqual(mapView(MAP, { asc: 0, prefix: 35, suffix: 0 })!.essence, [[140, 156], [255, 78]]);

  // asc 1: Enemy × doubled, the essence becomes the asc-2 tier
  const a1 = mapView(MAP, { asc: 1, prefix: 0, suffix: 0 })!;
  assert.equal(a1.enemyMod, 4);
  assert.deepEqual(a1.essence.map(([id]) => id), [277, 278]);

  // a level-70 map still gets its figures (its room draw can crash on some seeds)
  assert.ok(mapView(LEVEL70, NO_CONFIG));

  // the map page's boss table draws the engine's in-map stats, and follows the suffix
  const text = (stats: unknown) => (enemyTable([89], stats) as unknown as FakeElement).textContent;
  assert.match(text(plain.stats), /41,250/);
  assert.match(text(s5.stats), /66,000/);
  assert.match(text(null), /base/); // no engine stats: the quest's own, tagged

  // equipment: the same base roll, the suffix scales the base stats, the prefix adds its bonus
  const base = equipmentAt(DAGGER, 3, NO_CONFIG)!, modded = equipmentAt(DAGGER, 3, { asc: 0, prefix: 1, suffix: 5 })!;
  assert.equal(modded.atk, Math.ceil(base.atk * 1.3));
  assert.equal(modded.atkBns ?? 0, (base.atkBns ?? 0) + 2);
  assert.equal(configRarity("equipment", DAGGER, { asc: 0, prefix: 1, suffix: 5 }), (G.itemData.equipment[DAGGER].rarity ?? 1) + 2);
  assert.ok(configSell("equipment", DAGGER, 0, { asc: 0, prefix: 1, suffix: 5 })! > configSell("equipment", DAGGER, 0, NO_CONFIG)!);
  // consumable: the effect scales with the ascension (Minor Potion +40 HP → +120 at asc 2)
  assert.deepEqual(consumableStatsAt(1, 0), { hp: 40 });
  assert.deepEqual(consumableStatsAt(1, 2), { hp: 120 });
});
