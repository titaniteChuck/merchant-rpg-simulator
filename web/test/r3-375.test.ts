/**
 * Layout leftovers of the 375 px check after the R3 fixes: Profit's cost breakdown kept out of the table's right fade,
 * Farming's podium figure and unit on one line with a red gold loss in the subline, Farming's Scrolls row as label then
 * three equal selects on a phone, Levelling's Time tile on one line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toneOf, valueParts, valueSplit, valueSplitParts, valueText } from "../src/ui/farming-view.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const css = read("site/style.css");
const block = (name: string) => css.slice(css.indexOf(`/* ${name} */`), css.indexOf(`/* end ${name} */`));
/** The body of the block's `@media (max-width: 600px)` rules, joined. */
const phone = (b: string) => b.split("@media (max-width: 600px) {").slice(1).join("\n");

test("Profit: the breakdown panel is capped at the wrapper's visible width less the right fade", () => {
  const p = phone(block("r3-profit"));
  assert.match(p, /\.table-wrap\.pf-table \{ container-type: inline-size; \}/);
  assert.match(p, /\.pf-table \.pf-why-row \.pf-why \{ max-width: calc\(100cqw - 12px - 22px - 6px\); \}/);
  // the panel is still sticky at the left of the scroll area
  assert.match(css, /\.pf-why \{ position: sticky; left: 0;/);
});

test("Farming: the podium figure splits into number and unit, kept on one line", () => {
  assert.deepEqual(valueParts(3544.2), ["3,544", "value/h"]);
  assert.equal(valueText(3544.2), "3,544 value/h");
  const b = block("r3-farming");
  assert.match(b, /#farm-results \.tiles \.tile-value \{ white-space: nowrap; \}/);
  assert.match(b, /\.farm-unit \{ font-size: 0\.55em;/);
  assert.match(phone(b), /#farm-results \.tiles \.tile-value \{ font-size: 1\.25rem; \}/);
  const ts = read("web/src/ui/farming.ts");
  assert.match(ts, /el\("span", \{ class: "farm-unit" \}, unit\)/);
});

test("Farming: the podium subline colours a gold loss like the table", () => {
  assert.deepEqual(valueSplitParts(-1283, 79.2), ["-1,283 g", " + 79.2 essence /h"]);
  assert.deepEqual(valueSplitParts(1250, 0), ["1,250 g", "/h"]);
  assert.equal(valueSplit(-1283, 79.2), valueSplitParts(-1283, 79.2).join(""));
  assert.equal(toneOf(-1283), "pf-loss");
  const ts = read("web/src/ui/farming.ts");
  assert.match(ts, /\.tile-hint"\)\?\.replaceChildren\(el\("span", \{ class: toneOf\(r\.gold_per_hour\) \}, g\), rest\)/);
  assert.match(css, /\.pf-loss \{ color: var\(--bad\); \}/);
});

test("Farming: on a phone the Scrolls label is on its own line, then three equal selects", () => {
  const p = phone(block("r3-farming"));
  assert.match(p, /\.farm-scrolls \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(p, /\.farm-scrolls > span \{ grid-column: 1 \/ -1; \}/);
  assert.match(p, /\.farm-scrolls select \{ width: 100%; min-width: 0; \}/);
});

test("Levelling: the tile values don't wrap on a phone and are a little smaller", () => {
  const p = phone(block("r3-levelling"));
  assert.match(p, /\.lv-tiles \.tile-value \{ font-size: min\(0\.92rem, 3\.9vw\); line-height: 1\.25; white-space: nowrap; \}/);
});
