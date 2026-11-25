// Profit page, review R3 quick fixes (F11, F12, F14–F22, F24) and the cross-cutting F37 / F38 on Profit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { LV } from "../src/ui/dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const { enchantColumns, essenceColumns, itemColumns } = await import("../src/ui/profit-tables.ts");

const html = read("site/profit.html");
const page = read("web/src/ui/profit.ts");
const tables = read("web/src/ui/profit-tables.ts");
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* r3-profit */"), css.indexOf("/* end r3-profit */"));

test("r3-profit CSS block exists", () => {
  assert.ok(block.length > 100);
});

test("F11: a muted base-game line under the tiles when no expansion is shown", () => {
  assert.match(page, /export const baseGameOnly = \(\): boolean => EXPANSION_IDS\.every\(\(x\) => isHidden\(x\)\);/);
  assert.match(page, /if \(!baseGameOnly\(\)\) return tiles;/);
  assert.match(page, /"Base game only · add your expansions in 📜 Save ▾"/);
});

test("F12: two option columns at 600 px and less, segmented fields and the chip on a full row", () => {
  assert.match(block, /@media \(max-width: 600px\) \{\s+#options\.pf-options \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(block, /#options\.pf-options > \.pf-seg, #options\.pf-options > \.pf-check \{ grid-column: 1 \/ -1; \}/);
  assert.equal((html.match(/class="pf-field pf-seg"/g) ?? []).length, 2, "Run grade and Who pays");
  // 2 × 150 px + gap no longer decides it: two equal columns fit the 313 px card.
  assert.doesNotMatch(block, /minmax\(min\(150px/);
});

test("F14 / F21: tiles at most 320 px, name at body size on one line, label No orbs", () => {
  assert.match(page, /class: "tiles pf-tiles"/);
  assert.match(page, /tile\("No orbs"/);
  assert.match(block, /\.pf-tiles \{ grid-template-columns: repeat\(2, minmax\(0, 320px\)\); \}/);
  assert.match(block, /\.pf-tiles \.tile-value \{ font-size: 1rem;/);
  assert.match(block, /text-overflow: ellipsis;/);
});

test("F14 / F15: no expansion icons in Profit tiles or tables; the asc badge only on a phone", () => {
  assert.match(block, /\.pf-tiles \.xp-badge, \.pf-table \.xp-badge \{ display: none; \}/);
  assert.match(block, /\.pf-table \.pf-asc-badge \{ display: none; \}\n@media \(max-width: 600px\) \{ \.pf-table \.pf-asc-badge \{ display: inline-grid; \} \}/);
});

test("F16: no Asc column when orbs are hidden", () => {
  assert.match(page, /const withoutAsc = \(cols: InfoColumn\[\]\): InfoColumn\[\] => \(orbsHidden\(\) \? cols\.filter\(\(c\) => c\.key !== "asc"\) : cols\);/);
  assert.match(page, /cols: withoutAsc\(itemColumns\(o\)\)/);
  assert.match(page, /const cols = withoutAsc\(enchantColumns\(\)\);/);
});

test("F17: segmented options and the chip don't wrap; they span two columns above 600 px", () => {
  assert.match(block, /#options \.seg \{ flex-wrap: nowrap; \}/);
  assert.match(block, /#options \.seg-opt \{ flex: none; white-space: nowrap; \}/);
  assert.match(block, /#options \.pf-check \.chip-toggle \{ white-space: nowrap; \}/);
  assert.match(block, /@media \(min-width: 601px\) \{\s+#options\.pf-options > \.pf-seg, #options\.pf-options > \.pf-check \{ grid-column: span 2; \}/);
});

test("F18 / F38: help through tip(), no title, tap wording", () => {
  const form = html.slice(html.indexOf('<form id="options"'), html.indexOf("</form>"));
  assert.doesNotMatch(form, /title=/);
  assert.equal((form.match(/data-tip="/g) ?? []).length, 6, "every option label has help");
  assert.match(page, /document\.querySelectorAll<HTMLElement>\("#options \[data-tip\]"\)\.forEach\(\(e\) => helpOn\(e, e\.dataset\.tip!\)\);/);
  assert.match(page, /e\.tabIndex = 0;/);
  assert.doesNotMatch(page, /title:/);
  assert.doesNotMatch(tables, /title:/);
  assert.match(page, /tip\(mods, \(\) => "Crafted maps/);
  for (const cols of [itemColumns(true), enchantColumns(), essenceColumns()]) {
    for (const c of cols) assert.doesNotMatch(c.tip ?? "", /\b(hover|click)\b/i, `${c.label}: ${c.tip}`);
  }
  assert.match(itemColumns(false).find((c) => c.key === "cost")!.tip!, /Tap a value for its breakdown\./);
  assert.match(itemColumns(false).find((c) => c.key === "name")!.tip!, /^Tap a name/);
  assert.match(block, /\.pf-tip \{ cursor: help; text-decoration: underline dotted;/);
});

test("F19: breakdown amounts on one line, aligned right on every line", () => {
  assert.match(block, /\.pf-why \.num \{ white-space: nowrap; flex: none; \}/);
  assert.match(block, /\.pf-why li > details \{ flex: 1 1 auto; min-width: 0; \}/);
});

test("F20: the empty status line takes no height", () => {
  assert.match(block, /\.pf-status:empty \{ min-height: 0; \}/);
});

test("F22: the sticky Item cell draws its own bottom line on a phone", () => {
  assert.match(block, /\.pf-table td:first-child \{ box-shadow: inset 0 -1px 0 var\(--border\); \}/);
});

test("F24: the level header is Lvl (the user, 2026-11-25)", () => {
  assert.equal(LV, "Lvl");
  assert.equal(itemColumns(false).find((c) => c.key === "level")!.label, "Lvl");
  assert.equal(enchantColumns().find((c) => c.key === "level")!.label, "Lvl");
  assert.doesNotMatch(tables, /"Lv"/);
});

test("F37: Profit tables fade at the right edge while they scroll", () => {
  assert.match(block, /\.table-wrap\.pf-table \{[^}]*mask-image: linear-gradient\(to right, #000 calc\(100% - var\(--fade-r\)\), transparent\);[^}]*animation-timeline: scroll\(self inline\);/);
});
