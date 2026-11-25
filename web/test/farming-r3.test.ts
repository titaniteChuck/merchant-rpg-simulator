/**
 * Farming, review R3 (docs/tooling/roadmap/review-r3.md): "value/h" and its gold and essence parts (F27), loss colour
 * (F29), Levelling's hero labels (F30), short scroll option (F32), help by tip() instead of `title` (F33, F38), the
 * source's second line (F34, F35), "–" for no essence (F36), the table's edge fade on a phone (F37).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  costTip, essenceText, GOLD_HELP, gradeTip, NO_SCROLL, sourceSub, toneOf, valueHelp, valueSplit, valueText,
} from "../src/ui/farming-view.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("F27: the ranking figure says value/h, its parts say gold and essence", () => {
  assert.equal(valueText(3544.2), "3,544 value/h");
  assert.equal(valueSplit(-1283, 79.2), "-1,283 g + 79.2\u00a0essence\u00a0/h");
  assert.equal(valueSplit(1250, 0), "1,250 g/h");
  assert.equal(valueSplit(1250, 0.01), "1,250 g/h");
  assert.match(valueHelp(), /Gold \/ h plus the essence/);
  assert.match(valueHelp(), /lose gold and still rank high/);
  assert.match(GOLD_HELP, /^Gold only/);
  assert.match(GOLD_HELP, /Essence isn't counted/);
});

test("F29: losses red, zero muted", () => {
  assert.equal(toneOf(-1), "pf-loss");
  assert.equal(toneOf(0), "muted");
  assert.equal(toneOf(5), "");
});

test("F33: cost and grade tips", () => {
  assert.equal(costTip({ gold: 1000, map: 0, scrolls: 250, revive: 12.4 }), "Quest gold 1,000 g · Scrolls 250 g · Revives 12 g");
  assert.equal(costTip({ gold: 0, map: 0, scrolls: 0, revive: 0 }), "Free");
  assert.equal(gradeTip(4.62), "Average grade 4.6");
});

test("F34, F35: a quest's level, a map's own grade on the source's second line", () => {
  assert.equal(sourceSub({ kind: "quest", level: 51 }), "Lvl 51");
  assert.equal(sourceSub({ kind: "quest", level: undefined }), "Lvl ?");
  assert.equal(sourceSub({ kind: "map", grade: "S" }), "Map grade S");
});

test("F36: no essence reads –", () => {
  assert.equal(essenceText(0), "–");
  assert.equal(essenceText(0.02), "–");
  assert.equal(essenceText(79.24), "79.2");
});

test("F26, F30, F32, F33, F38: the page names its tiles, reuses Levelling's hero labels, has no title help", () => {
  const ts = read("web/src/ui/farming.ts");
  assert.match(ts, /import \{ heroLabels \} from "\.\/levelling-view\.ts"/);
  assert.match(ts, /heroLabels\(sv\.raw\.hero/);
  assert.doesNotMatch(ts, /\btitle:/, "no title attribute for help");
  assert.doesNotMatch(ts, /🥇/, "tiles use #1, not medals");
  assert.match(ts, /icon: `#\$\{k \+ 1\}`/);
  assert.equal(NO_SCROLL, "None");
  const html = read("site/farming.html");
  assert.doesNotMatch(html.slice(html.indexOf("<main")), /<h2 title=/);
  assert.match(html, /id="party-label"/);
});

test("F31, F37: party grid and the table's edge fade in the r3-farming block", () => {
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* r3-farming */"), css.indexOf("/* end r3-farming */"));
  assert.ok(block.length > 0);
  assert.match(block, /\.farm-party-row \{ display: grid; grid-template-columns: 5\.5em repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(block, /\.farm-table \{[^}]*mask-image: linear-gradient[^}]*animation-timeline: scroll\(self inline\)/);
});
