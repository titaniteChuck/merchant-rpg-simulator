// R1 site-wide fixes: shared gold / duration formats in the visitor's language (F28), item type labels (F30),
// the skip link (F34) and the grade badge contrast (F05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { loadLanguage, setLanguage } from "../src/tools/i18n.ts";
import { duration, fmt, gold } from "../src/ui/dom.ts";
import { itemTypeText, subtypeLabel } from "../src/ui/names.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
loadLanguage(JSON.parse(read("inventory/i18n/fr.json")));

test("gold(): whole gold with its g, one decimal on demand, a dash when unknown", () => {
  setLanguage("en");
  assert.equal(gold(171946), "171,946 g");
  assert.equal(gold(2004759), "2,004,759 g");
  assert.equal(gold(12.46, 1), "12.5 g");
  assert.equal(gold(null), "—");
  assert.equal(gold(Number.NaN), "—");
});

test("duration(): seconds under a minute, then minutes, hours and minutes, days and hours", () => {
  assert.equal(duration(15), "15 s");
  assert.equal(duration(0), "0 s");
  assert.equal(duration(59.4), "59 s");
  assert.equal(duration(240), "4 min");
  assert.equal(duration(90 * 60), "1 h 30 min");
  assert.equal(duration(126 * 60), "2 h 6 min");
  assert.equal(duration(3 * 3600), "3 h");
  assert.equal(duration(27 * 3600), "1 d 3 h");
  assert.equal(duration(undefined), "?");
});

test("digits follow the picked language (fmt and gold)", () => {
  setLanguage("fr");
  try {
    const n = fmt.format(171946);
    assert.match(n, /^171\s946$/u, n); // a (narrow) no-break space in French
    assert.match(gold(171946), /^171\s946 g$/u);
  } finally {
    setLanguage("en");
  }
  assert.equal(fmt.format(171946), "171,946");
});

test("item type labels: a capital first letter for every subtype, none for the game's empty rows", () => {
  assert.equal(subtypeLabel("essence"), "Essence");
  assert.equal(subtypeLabel("ore"), "Ore");
  assert.equal(subtypeLabel("Great Helm"), "Great Helm");
  assert.equal(subtypeLabel("None"), "");
  assert.equal(subtypeLabel(""), "");
  assert.equal(itemTypeText("material", "herb"), "Herb");
  assert.equal(itemTypeText("consumable", "Health"), "Health");
  assert.equal(itemTypeText("equipment", "Hood", "Head"), "Head · Hood");
  assert.equal(itemTypeText("consumable", ""), "Consumable");
  assert.equal(itemTypeText("map", "Map"), "Map");
});

test("every page has a <main> for the skip link to jump to (nav.ts mountSkipLink)", () => {
  for (const page of ["index", "save", "battle", "wiki", "profit", "farming", "levelling", "class-balance"]) {
    assert.match(read(`site/${page}.html`), /<main[\s>]/, `${page}.html has no <main>`);
  }
});

/** WCAG relative luminance and contrast. */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("grade badges: white text at WCAG AA (4.5:1) on every grade colour (the last rule of style.css wins)", () => {
  const css = read("site/style.css");
  for (const g of ["D", "C", "B", "A"]) {
    const all = [...css.matchAll(new RegExp(`\\.grade-${g} \\{ background: (#[0-9a-f]{6}); \\}`, "g"))];
    const hex = all.at(-1)?.[1];
    assert.ok(hex, `no colour for grade ${g}`);
    assert.ok(contrast("#ffffff", hex) >= 4.5, `grade ${g} ${hex}: ${contrast("#ffffff", hex).toFixed(2)}`);
  }
  const s = [...css.matchAll(/\.grade-S \{ background: linear-gradient\(135deg, (#[0-9a-f]{6}), (#[0-9a-f]{6})\); \}/g)].at(-1);
  assert.ok(s, "no gradient for grade S");
  for (const hex of [s[1], s[2]]) assert.ok(contrast("#ffffff", hex) >= 4.5, `grade S ${hex}: ${contrast("#ffffff", hex).toFixed(2)}`);
});
