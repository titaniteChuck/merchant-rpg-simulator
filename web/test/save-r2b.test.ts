// R2-B (mobile review R2): the Save viewer and its hero page, and the no-save picker shared by every save page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ascOutlineText, gridStats, rotationGroups, turnLabel } from "../src/ui/save-tables.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const viewer = read("web/src/ui/save-viewer.ts");
const source = read("web/src/ui/save-source.ts");
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* r2-b */"), css.indexOf("/* end r2-b */"));

test("F15: consecutive Basic turns merge into one rotation row, other skills keep theirs", () => {
  const g = rotationGroups(["Slash", "Bash", "Basic", "Basic", "Basic"]);
  assert.deepEqual(g, [{ from: 1, to: 1, skill: "Slash" }, { from: 2, to: 2, skill: "Bash" }, { from: 3, to: 5, skill: "Basic" }]);
  assert.deepEqual(g.map(turnLabel), ["1", "2", "3–5"]);
  // Runs split by another skill stay apart; a repeated real skill is never merged (each costs its AP).
  assert.deepEqual(rotationGroups(["Basic", "Slash", "Basic", "Basic", "Slash", "Slash"]).map((x) => `${turnLabel(x)} ${x.skill}`),
    ["1 Basic", "2 Slash", "3–4 Basic", "5 Slash", "6 Slash"]);
  assert.deepEqual(rotationGroups([]), []);
});

test("F15: the stat grid is HP Atk Matk Acc / Def Mdef Crit Crit damage, extras only when they count", () => {
  const stats = { maxHP: 900, atk: 80, matk: 10, acc: 95, def: 40, mdef: 30, crit: 5, critMod: 2, eva: 0, speed: 0, maxActionPoints: 20 };
  assert.deepEqual(gridStats(stats, true), ["maxHP", "atk", "matk", "acc", "def", "mdef", "crit", "critMod"]);
  assert.deepEqual(gridStats({ ...stats, eva: 3 }, true).slice(8), ["eva"]);
  assert.deepEqual(gridStats(stats, false).slice(8), ["maxActionPoints"], "AP shows when the rotation has no budget line");
  // The radar is folded under the grid, 200 px at most on a phone; the passive is one line, not a table.
  assert.match(viewer, /el\("details", \{ class: "hero-radar" \}/);
  assert.match(block, /max-width: 760px\) \{ \.hero-detail \.radar-fig \{ max-width: 200px; \}/);
  assert.match(viewer, /passiveLine\(String\(r\.passive/);
  assert.doesNotMatch(viewer, /passiveRows|"Bonus"/);
});

test("F16: gear cards follow the theme and their tooltip names the outline", () => {
  assert.equal(ascOutlineText(0), "");
  assert.equal(ascOutlineText(1), " · Ascension 1 (silver outline)");
  assert.equal(ascOutlineText(2), " · Ascension 2 (gold outline)");
  assert.match(block, /\.hero-detail \.gear-item \{ background: var\(--card-2\); color: var\(--fg\); \}/);
  assert.match(viewer, /helpTip\(GEAR_HELP/);
});

test("F14 / F17 / F52: inventory filter on one line with its count and a ?, chips in one scrolling row", () => {
  assert.match(viewer, /class: "inv-search" \}, search, total, helpTip\(INVENTORY_HELP/);
  assert.match(block, /\.inv-kinds \.seg \{ flex-wrap: nowrap; \}/);
  assert.match(block, /\.inv-kinds \{ overflow-x: auto;/);
  assert.match(viewer, /INVENTORY_HELP = \[[^\]]*silver outline/);
  assert.doesNotMatch(viewer, /el\("p", \{ class: "muted small" \}, "Value = /, "no sentence under the table");
});

test("F18: crafter headers Lvl · Asc 1 · Asc 2, the explanation in a ? on the header row", () => {
  assert.match(viewer, /label: "Lvl", num: true/);
  assert.match(viewer, /label: "Asc 1"/);
  assert.match(viewer, /label: "Asc 2"/);
  assert.doesNotMatch(viewer, /"Level \(ascension [12]\)"/);
  assert.match(viewer, /querySelectorAll\("th"\)\[1\]\?\.append\(" ", helpTip\(CRAFTER_HELP/);
  assert.doesNotMatch(viewer, /el\("p", \{ class: "muted small" \}, "Each crafter/);
});

test("F19: the no-save picker is two buttons and a ?, on every page with a picker", () => {
  assert.match(source, /"📂 Choose save file"/);
  assert.match(source, /"🧪 Example save"/);
  assert.match(source, /exampleRow\.append\(o\.drop, exampleBtn, helpTip\(PICKER_HELP/);
  assert.match(source, /PICKER_HELP = \[\s*"Your save file is read by your browser[^"]*never uploaded\."/);
  assert.doesNotMatch(source, /No save at hand\? Use an anonymised one/);
  // The U38 rule still hides the whole row while a kept save loads.
  assert.match(source, /class: "example-save save-picker"/);
  // save.html has the final label already (no old text before the script runs).
  const html = read("site/save.html");
  assert.match(html, /<label id="drop" class="drop drop-btn">/);
  assert.doesNotMatch(html, /Drop your save file here|never uploaded/);
});

test("F54: empty sections are one muted line", () => {
  for (const s of ["No heroes in this save.", "No item matches this filter.", "No crafters in this save.", "No gear equipped.", "No maps in this save."]) {
    assert.ok(viewer.includes(`"${s}"`), s);
  }
});

test("R2-B CSS stays in its marked block", () => {
  assert.equal(css.split("/* r2-b */").length, 2);
  assert.ok(block.includes(".save-picker") && block.includes(".hero-stat-grid"));
});
