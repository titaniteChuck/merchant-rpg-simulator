// U56: the item details pages (equipment, consumables, materials). The header facts are small cards, one fact each,
// built by one helper (wiki-data itemFactCards); the sell value is one box at the page's ascension (U49's picker), with
// no "asc N" text; an equipment's price is the Sell row closing Stats by grade; Recipe and Used in keep their section
// and title when empty, with one muted line inside.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const api = await import("../src/sim/api.ts");
const { configSell, NO_CONFIG } = await import("../src/ui/wiki-config.ts");
const { factCards, itemFactCards, pageSell, sellFoot } = await import("../src/ui/wiki-data.ts");
const { sellBox } = await import("../src/ui/wiki-items.ts");
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
  assert.ok(!cards(itemFactCards("equipment", DAGGER, NO_CONFIG, { sell: false })).some((c) => c.label === "Sell"));
});

test("sell: one value at the page's ascension, no \"asc N\" text; materials their single value", () => {
  const v = [0, 1, 2].map((a) => configSell("consumable", POTION, a, { ...NO_CONFIG, asc: a })!);
  assert.equal(new Set(v).size, 3, "the potion's price changes with the ascension");
  for (const a of [0, 1, 2]) {
    const cfg = { ...NO_CONFIG, asc: a };
    assert.equal(pageSell("consumable", POTION, cfg), v[a]);
    const sell = card(itemFactCards("consumable", POTION, cfg), "Sell")!;
    assert.equal(sell, `${v[a]} g`);
    assert.doesNotMatch(sell, /asc/);
    const box = (itemFactCards("consumable", POTION, cfg) as unknown as FakeElement).querySelectorAll(".sell-box");
    assert.equal(box.length, 1);
    assert.ok(box[0].getAttribute("class")!.includes(`tier-${a}`));
  }
  assert.equal(pageSell("material", MATERIAL, { ...NO_CONFIG, asc: 2 }), configSell("material", MATERIAL, 0, NO_CONFIG));
  const mat = sellBox("material", MATERIAL, 0, 10) as unknown as FakeElement;
  assert.equal(mat.textContent, "10 g");
  assert.doesNotMatch(mat.getAttribute("title")!, /Ascension/);
  assert.doesNotMatch(read("web/src/ui/wiki-items.ts"), /av-k|`asc \$\{a\}`/);
});

test("equipment: the price is the Sell row of Stats by grade, following the picked ascension and modifiers", () => {
  for (const a of [0, 1, 2]) {
    const cfg = { ...NO_CONFIG, asc: a };
    const foot = sellFoot("equipment", DAGGER, cfg, 4) as unknown as FakeElement;
    assert.equal(foot.tagName.toLowerCase(), "tfoot");
    assert.equal(foot.querySelector("th")!.textContent, "Sell");
    assert.equal(foot.querySelector("td")!.getAttribute("colspan"), "4");
    assert.equal(foot.querySelector("td")!.textContent, `${configSell("equipment", DAGGER, a, cfg)} g`);
  }
  const plain = pageSell("equipment", DAGGER, NO_CONFIG)!;
  assert.ok(pageSell("equipment", DAGGER, { asc: 0, prefix: 20, suffix: 3 })! > plain, "a prefix and suffix raise the rarity, so the price");
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /const foot = sellFoot\("equipment", id, cfg, keys\.length \+ bonusKeys\.length\);/);
  assert.match(wiki, /itemFactCards\(type, id, cfg, \{ sell: !pricedInTable \}\)/);
  assert.doesNotMatch(wiki, /factStrip|sellBoxes/);
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
