// R2-D (mobile review R2, the wiki): compact home tiles and agreeing counts (F37 / F38), the price "?" on the list
// headers (F41), the item page's strip and merged grade rows (F42), the XP block and drops (F44 / F45), muted rarity
// chips at AA contrast (F46), the class page without stat cards (F47), Expansions (F48), Stats › Hero stats (F49),
// sentences into "?" and empty states (F52 / F54) and the section titles (F55), all in one r2-d CSS block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { skillNames } from "../src/ui/wiki-data.ts";
import { mergeGradeRows } from "../src/ui/wiki-items.ts";
import { isUnusedSkill, listedSkillNames } from "../src/ui/wiki-skills.ts";
import { STATS_SECTIONS } from "../src/ui/wiki-stats.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const ui = (f: string) => read(`web/src/ui/${f}`);
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* r2-d */"), css.indexOf("/* end r2-d */"));

test("one r2-d block in style.css", () => {
  assert.equal(css.split("/* r2-d */").length, 2);
  assert.equal(css.split("/* end r2-d */").length, 2);
  assert.ok(block.length > 1000);
});

test("F38: the home counts the skills the Skills list shows (the unused ones are folded under it)", () => {
  const listed = listedSkillNames();
  assert.ok(listed.length > 100 && listed.length < skillNames().length, `${listed.length} of ${skillNames().length}`);
  assert.equal(listed.length + skillNames().filter(isUnusedSkill).length, skillNames().length);
  assert.ok(listed.every((n) => !isUnusedSkill(n)));
  const wiki = ui("wiki.ts");
  assert.match(wiki, /label: "Skills", count: \(\) => listedSkillNames\(\)\.length/);
  assert.match(wiki, /listPage\("Skills", listedSkillNames\(\)\.map\(toRow\)/);
});

test("F37 / F39: compact tiles with the description as tooltip; tiles hidden while searching; kind as a chip", () => {
  const wiki = ui("wiki.ts");
  assert.match(wiki, /class: "wiki-tiles"/);
  assert.match(wiki, /el\("a", \{ href: c\.href, title: c\.about \}/);
  assert.doesNotMatch(wiki, /wiki-cat-about|cards wiki-cats/);
  assert.match(wiki, /tiles\.hidden = !!q/);
  assert.match(wiki, /class: "kind-chip"/);
  // the definitions moved to the list pages' "?" (beside the filter)
  assert.match(wiki, /more: \["Bonus stats: the item's own range/);
  assert.match(wiki, /const help = o\.href \? listHelp\(o\.href, title\) : null/);
  assert.match(block, /#wiki ul\.wiki-tiles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test("F41: no legend paragraph above the priced lists; the key and definitions are the Cost / Sell value headers' \"?\"", () => {
  const wiki = ui("wiki.ts");
  assert.doesNotMatch(wiki, /el\("p", \{ class: "muted small asc-legend" \}/);
  assert.match(wiki, /"Cost": \(\) => helpTip\(\[ascLegend\(levels\)/);
  assert.match(wiki, /"Sell value": \(\) => helpTip\(\[ascLegend\(levels\)/);
  assert.equal([...wiki.matchAll(/heads: priceHeads\(priceLevels\(/g)].length, 2, "items and maps");
});

test("F42: identical grades merge into one row, runs into a range", () => {
  const g = (grade: string, atk: number, b = "3") => ({ grade, atk, b_str: b });
  assert.deepEqual(mergeGradeRows(["D", "C", "B", "A", "S"].map((x) => g(x, 11))), [g("D–S", 11)]);
  assert.deepEqual(mergeGradeRows([g("D", 9), g("C", 10), g("B", 10), g("A", 10), g("S", 12)]), [g("D", 9), g("C–A", 10), g("S", 12)]);
  const all = ["D", "C", "B", "A", "S"].map((x, i) => g(x, i));
  assert.deepEqual(mergeGradeRows(all), all);
  // a missing stat on one grade is a difference
  assert.equal(mergeGradeRows([{ grade: "D", atk: 1 }, { grade: "C" }]).length, 2);
});

test("F54: an empty Drops is one muted line (U56: the fact strip, sell labels and empty Recipe / Used in changed, wiki-u56.test.ts)", () => {
  const wiki = ui("wiki.ts");
  assert.doesNotMatch(wiki, /none\("Not craftable\."\)|none\(hidden \? "Not used/);
  assert.match(wiki, /empty\.push\(\["Drops", /);
  assert.match(wiki, /if \(empty\.length\) kids\.push\(emptyLine\(\.\.\.empty\)\)/);
});

test("F43 / F44 / F45: compact facts; the XP pickers on one row and Left out closed; drops out of the timeline card", () => {
  const wiki = ui("wiki.ts"), en = ui("wiki-enemies.ts");
  // U56: the compact facts became the shared fact cards (wiki-data factCards, three to a row at 375 px)
  assert.match(wiki, /factCards\(\[isCraftableMap\(id\) \? \["Level", m\.itemLevel\] : /); // U55: a level-70 map's level is marked
  // U60: the body takes the page's grade and size; the XP block (its pickers and "Left out") is gone
  assert.match(wiki, /enemyBody\(id, section, emptyLine, cfg\)/);
  assert.doesNotMatch(en, /qxp-left|qxp-controls/);
  assert.doesNotMatch(block, /qxp-/, "U60: the XP block's rules are gone with it");
  assert.doesNotMatch(en, /Timeline and drops|function variantCard|enemy-variant/);
  assert.match(en, /section\("Timeline", variantCols\(/);
  assert.match(en, /section\("Drops", variantCols\(id, \(r\) => dropsBlock\(c, r\)\)\)/);
});

/** WCAG contrast of two #rrggbb colours. */
const contrast = (a: string, b: string) => {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: string, b: string, p: number) => `#${[1, 3, 5].map((i) =>
  Math.round(parseInt(a.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, "0")).join("")}`;

test("F46: rarity chips meet AA (4.5:1) in both themes, text on its own tint over the fixed base", () => {
  const bases = { dark: "#2b231d", light: "#f7f0de" }; // --bg (dark) and --card (light), the --rarc-base of each theme
  for (const [theme, sel] of [["dark", ':root, :root[data-theme="dark"] {'], ["light", ':root[data-theme="light"] {']] as const) {
    const rule = block.slice(block.indexOf(`${sel} --rarc-base`));
    const body = rule.slice(0, rule.indexOf("}"));
    const tokens = [...body.matchAll(/--rarc-(\d+): (#[0-9a-f]{6})/g)];
    assert.equal(tokens.length, 7, `${theme}: rarities 0, 1, 2, 3, 4, 5, 7`);
    for (const [, r, hex] of tokens) {
      const c = contrast(hex, mix(hex, bases[theme], 0.14));
      assert.ok(c >= 4.5, `${theme} rarity ${r} ${hex}: ${c.toFixed(2)}`);
    }
  }
  assert.match(block, /background: color-mix\(in srgb, var\(--rc, var\(--rarc-1\)\) 14%, var\(--rarc-base\)\)/);
  assert.doesNotMatch(ui("wiki-items.ts"), /--rar-game/);
});

test("F47: no stat cards on the class page (U54: the growth charts gave way to a stat table, wiki-u54.test.ts)", () => {
  const cls = ui("wiki-classes.ts"), wiki = ui("wiki.ts");
  assert.doesNotMatch(cls, /cls-cards|hover to read a level/);
  assert.doesNotMatch(wiki, /\bcards,\n/);
  assert.match(wiki, /RADAR_HELP, \[statLink\("hero-stats"\)\]/);
  assert.doesNotMatch(cls, /figcaption/);
});

test("F48: Expansions' In detail closed, one-line status, one column at 600 px", () => {
  const xp = ui("wiki-expansions.ts");
  assert.match(xp, /el\("details", \{ class: "xp-detail" \}/);
  assert.doesNotMatch(xp, /Change it under/);
  assert.match(block, /@media \(max-width: 600px\) \{\n {2}#wiki \.xp-cards > div \{ flex-basis: 100%; \}/);
});

test("F49: Stats › Hero stats puts the formula first and the steps in a closed details", () => {
  assert.ok(G.heroList);
  const html = STATS_SECTIONS.find((s) => s.id === "hero-stats")!.html();
  const f = html.indexOf('class="formula"'), d = html.indexOf('<details class="ref-steps-box">'), steps = html.indexOf('<ol class="ref-steps">');
  assert.ok(f >= 0 && d > f && steps > d, "formula, then the details holding the steps");
  assert.ok(html.indexOf("</details>") > steps);
});

test("F50 / F55: the wiki's sub-navigation on one line; section titles as text over a rule", () => {
  // The second row (the wiki's sub-navigation among them) is R2-A's shared one-line `.scroll-row`.
  assert.match(ui("nav.ts"), /class: "subnav scroll-row"/);
  const h2 = block.match(/#wiki \.wiki-banner \{[^}]*\}/)?.[0] ?? "";
  assert.match(h2, /background: none;/);
  assert.match(h2, /border-bottom: 1px solid var\(--border\);/);
  assert.match(block, /#wiki \.wiki-banner\.sub \{[^}]*text-transform: uppercase;/);
});

test("F52 / F54: sentences of the Skills and class pages moved into \"?\", empty sections as one line", () => {
  const wiki = ui("wiki.ts");
  assert.doesNotMatch(wiki, /el\("p", \{ class: "muted small" \}, "In the game's data, but no hero class/);
  assert.match(wiki, /emptyLine\(\["Good against"/);
  assert.match(wiki, /emptyLine\(\["Recipe", "Not craftable\."\]\)/); // U55: no Boss line, the bosses are rows of the one Enemies table
  assert.match(ui("wiki-enemies.ts"), /empty\(\["Maps", "None: met only as a quest\."\]\)/);
});
