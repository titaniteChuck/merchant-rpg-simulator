// U56: the wiki details pages. The facts are small cards, one fact each, built by one helper (wiki-data factCards;
// itemFactCards on equipment, consumables and materials; maps, enemies, skills and passives too). The sell value is one
// card at the page's ascension (U49's picker), with no "asc N" text, on equipment too (no Sell row in Stats by grade).
// Region, Rarity, Sell (ascension) and Rare variant carry their colour on the card, the value plain text inside. Recipe
// and Used in keep their section and title when empty, with one muted line inside.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const api = await import("../src/sim/api.ts");
const { configSell, NO_CONFIG } = await import("../src/ui/wiki-config.ts");
const { factCards, itemFactCards, pageSell, regionOf, item } = await import("../src/ui/wiki-data.ts");
const { rarityTip, sellTitle } = await import("../src/ui/wiki-items.ts");
const { configRarity } = await import("../src/ui/wiki-config.ts");
const { LV } = await import("../src/ui/dom.ts");
api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const DAGGER = 15; // Mithril Dagger (weapon)
const POTION = 1; // a consumable with ascensions 0–2
const MATERIAL = 33;

const cards = (e: unknown) => (e as FakeElement).querySelectorAll(".fact-card").map((c) => ({
  label: c.querySelector("dt")!.textContent, value: c.querySelector("dd")!.textContent,
}));
const card = (e: unknown, label: string) => cards(e).find((c) => c.label === label)?.value;
const cardEl = (e: unknown, label: string) => (e as FakeElement).querySelectorAll(".fact-card").find((c) => c.querySelector("dt")!.textContent === label)!;
const classes = (c: FakeElement) => c.getAttribute("class")!.split(" ");

test("fact cards: one card per fact, empty values left out", () => {
  const dl = factCards([["A", "x"], ["B", null], ["C", ""], ["D", 0], ["E", false], ["F", undefined]]) as unknown as FakeElement;
  assert.equal(dl.tagName.toLowerCase(), "dl");
  assert.ok(dl.getAttribute("class")!.split(" ").includes("fact-cards"));
  assert.deepEqual(cards(dl), [{ label: "A", value: "x" }, { label: "D", value: "0" }]);
});

test("the three item kinds share the header cards: type, Lvl, region, rarity, crafter, sell", () => {
  for (const [type, id] of [["equipment", DAGGER], ["consumable", POTION], ["material", MATERIAL]] as const) {
    const labels = cards(itemFactCards(type, id, NO_CONFIG)).map((c) => c.label);
    assert.equal(labels[0], "Type", type);
    assert.equal(labels[1], LV, `${type}: the level label is dom.ts LV`);
    assert.ok(labels.includes("Rarity"), type);
    assert.ok(labels.includes("Sell"), type);
    assert.ok(cards(itemFactCards(type, id, NO_CONFIG)).every((c) => c.value !== ""), type);
  }
});

test("sell: one value at the page's ascension, no \"asc N\" text, the card coloured by it; materials their single value", () => {
  const v = [0, 1, 2].map((a) => configSell("consumable", POTION, a, { ...NO_CONFIG, asc: a })!);
  assert.equal(new Set(v).size, 3, "the potion's price changes with the ascension");
  for (const a of [0, 1, 2]) {
    const cfg = { ...NO_CONFIG, asc: a };
    assert.equal(pageSell("consumable", POTION, cfg), v[a]);
    const facts = itemFactCards("consumable", POTION, cfg);
    const sell = card(facts, "Sell")!;
    assert.equal(sell, `${v[a]} g`);
    assert.doesNotMatch(sell, /asc/);
    const c = cardEl(facts, "Sell");
    assert.ok(classes(c).includes(`fc-asc-${a}`));
    assert.equal(classes(c).includes(`asc-${a}`), a > 0, "asc 1 and 2 take the silver / gold gradient (--asc-grad), asc 0 stays plain");
    assert.equal(c.getAttribute("title"), sellTitle("consumable", POTION, a, v[a]));
    assert.equal(c.querySelector("dd")!.children.length, 0, "the value is plain text, no box");
  }
  assert.equal(pageSell("material", MATERIAL, { ...NO_CONFIG, asc: 2 }), configSell("material", MATERIAL, 0, NO_CONFIG));
  assert.equal(sellTitle("material", MATERIAL, 0, 10).startsWith("10 g"), true);
  assert.doesNotMatch(sellTitle("material", MATERIAL, 0, 10), /Ascension/);
  assert.doesNotMatch(read("web/src/ui/wiki-items.ts"), /av-k|`asc \$\{a\}`|sell-box/);
});

test("equipment: the Sell card, as consumables and materials, following the picked ascension and modifiers", () => {
  for (const cfg of [{ ...NO_CONFIG, asc: 0 }, { ...NO_CONFIG, asc: 1 }, { ...NO_CONFIG, asc: 2 }, { asc: 0, prefix: 20, suffix: 3 }]) {
    const facts = itemFactCards("equipment", DAGGER, cfg);
    const sell = card(facts, "Sell")!;
    assert.equal(sell, `${configSell("equipment", DAGGER, cfg.asc, cfg)} g`);
    assert.doesNotMatch(sell, /asc/);
    assert.ok(classes(cardEl(facts, "Sell")).includes(`fc-asc-${cfg.asc}`));
  }
  const plain = pageSell("equipment", DAGGER, NO_CONFIG)!;
  assert.ok(pageSell("equipment", DAGGER, { asc: 0, prefix: 20, suffix: 3 })! > plain, "a prefix and suffix raise the rarity, so the price");
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /itemFactCards\(type, id, cfg, \[/);
  assert.doesNotMatch(wiki, /sellFoot|pricedInTable|tfoot|factStrip|sellBoxes/);
  assert.doesNotMatch(read("web/src/ui/wiki-data.ts"), /sellFoot|sell-row|sell\?: boolean/);
  const css = read("site/style.css");
  assert.doesNotMatch(css.slice(css.indexOf("/* U56 */"), css.indexOf("/* end U56 */")), /sell-row|tfoot/);
});

test("rarity and region: the colour on the card, plain text inside, the tooltips kept", () => {
  for (const [type, id] of [["equipment", DAGGER], ["consumable", POTION], ["material", MATERIAL]] as const) {
    const facts = itemFactCards(type, id, NO_CONFIG);
    const r = configRarity(type, id, NO_CONFIG) ?? item(type, id).rarity;
    const rar = cardEl(facts, "Rarity");
    assert.ok(classes(rar).includes(`fc-rar-${r}`), type);
    assert.equal(rar.getAttribute("title"), rarityTip(r));
    assert.equal(rar.querySelector("dd")!.children.length, 0, `${type}: no rarity chip`);
    const region = regionOf(type, id)!;
    const reg = cardEl(facts, "Region");
    assert.ok(classes(reg).includes(`fc-reg-${region.id}`), type);
    assert.match(reg.getAttribute("title")!, new RegExp(`^${region.full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · `));
    assert.equal((facts as unknown as FakeElement).querySelectorAll(".rar-chip").length, 0);
    assert.equal((facts as unknown as FakeElement).querySelectorAll(".region-chip").length, 0);
  }
  // an epic dagger with a prefix: the card follows the configuration's rarity
  const mod = { asc: 0, prefix: 20, suffix: 3 };
  assert.ok(classes(cardEl(itemFactCards("equipment", DAGGER, mod), "Rarity")).includes(`fc-rar-${configRarity("equipment", DAGGER, mod)}`));
  const dl = factCards([["Long", "text", { class: "fc-wide", title: "t" }]]) as unknown as FakeElement;
  assert.deepEqual(classes(dl.querySelectorAll(".fact-card")[0]), ["fact-card", "fc-wide"]);
  assert.equal(dl.querySelectorAll(".fact-card")[0].getAttribute("title"), "t");
});

test("every wiki details page builds its facts with the shared cards; coloured facts on the card", () => {
  const wiki = read("web/src/ui/wiki.ts"), en = read("web/src/ui/wiki-enemies.ts");
  assert.doesNotMatch(wiki, /\bcompactFacts\b|\bfacts\(\[|type FactPair/);
  assert.equal((wiki.match(/factCards\(\[/g) ?? []).length, 3, "skill, passive and map pages");
  assert.match(wiki, /\["Region", \.\.\.regionCard\(regionOf\("map", id\)\)\], \["Rarity", \.\.\.rarityCard\(view\?\.rarity \?\? m\.rarity\)\]/);
  assert.match(wiki, /\[statLink\("sell", "Sell value"\), sell !== null \? gold\(sell\) : undefined, sell !== null \? \{ class: ascCard\(cfg\.asc\)/);
  assert.doesNotMatch(wiki, /enemyLead/, "the enemy lead line is gone: Kind, Level and Region are cards");
  assert.match(en, /factCards\(\[\["Kind", enemyKind\(id\)\]/);
  assert.match(en, /\["Region", \.\.\.regionCard\(region, \{ why: region\?\.group === "map", tag: false \}\)\]/);
  assert.match(en, /\{ class: "fc-rare", title: /);
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* U56 */"), css.indexOf("/* end U56 */"));
  assert.match(block, /#wiki \.fact-card\.fc-wide \{ grid-column: 1 \/ -1; \}/);
  assert.match(block, /#wiki \.fc-rar-4, #wiki \.fc-rar-11 \{ --fc: var\(--rarc-4\); \}/);
  assert.match(block, /#wiki \.fc-reg-1 \{ --fc: var\(--reg-1\); \}/);
  assert.match(block, /var\(--asc-grad\) border-box/);
  assert.doesNotMatch(css, /#wiki \.facts\.compact/);
});

test("Recipe and Used in: the same section and title, empty or not", () => {
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /section\("Recipe", emptyState\("Not craftable\."\)\)/);
  assert.match(wiki, /section\("Used in", used\.list \?\? emptyState\(used\.empty\)/);
  assert.doesNotMatch(wiki, /empty\.push\(\["Recipe"|empty\.push\(\["Used in"/);
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* U56 */"), css.indexOf("/* end U56 */"));
  assert.match(block, /#wiki \.fact-cards \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(100px, 1fr\)\);/);
  assert.match(block, /#wiki \.wiki-empty-state/);
  assert.doesNotMatch(block, /text-transform: uppercase/, "the labels keep their case (Lvl)");
});
