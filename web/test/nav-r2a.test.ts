// R2-A (mobile presentation review R2, batch A): Home (F01–F05), menus (F07–F12), formats (F56), footer (F57) and the
// shared sideways row (F58).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOOTER_LINE, footerNote, NAV, saveLabel } from "../src/ui/nav.ts";
import { chipSlot, openedAt, parseKeptSave, SAVE_NAME_KEY } from "../src/ui/save-menu.ts";
import { LV, lv, lvStart, pct, sentenceCase } from "../src/ui/dom.ts";
import { OLDER_TOOLS_NOTE } from "../src/ui/home.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const src = (f: string) => read(`web/src/ui/${f}`);

test("F01–F04: home tools as compact rows in the current order, the Solver in, no visible Tools heading", () => {
  const html = read("site/index.html");
  const main = html.slice(html.indexOf('<section class="home-tools"'), html.indexOf("</section>"));
  const links = [...main.matchAll(/<h3><a href="([^"]+)" title="([^"]+)">([^<]+)<\/a><\/h3>\s*<p>([^<]+)<\/p>/g)];
  assert.deepEqual(links.map((m) => m[1]), ["save.html", "battle.html", "solver.html", "wiki.html"]);
  for (const [, , title, , line] of links) {
    assert.ok(title.length > line.length, "the full description is the link's tooltip");
    assert.ok(line.length <= 40, `one short line: ${line}`);
    assert.doesNotMatch(line, /\.$/, "no sentence");
  }
  assert.match(main, /<h2 id="tools-h" class="visually-hidden">Tools<\/h2>/);
  // F04: the lead lists the current tools in menu order, not the frozen ones first.
  const lead = html.match(/<p class="lead">([\s\S]*?)<\/p>/)![1];
  assert.match(lead, /save viewer, battle simulator and solver, wiki/);
  assert.doesNotMatch(lead, /profit|essence/i);
  // F03: the older tools in a <details> without `open` (home.ts opens it on wide screens), the note as its "?".
  assert.match(html, /<details class="tools-other">\s*<summary><h2>Older tools \(4\)<\/h2><\/summary>/);
  assert.doesNotMatch(html, /Older tools, kept as they are/);
  assert.match(OLDER_TOOLS_NOTE, /^Older tools, kept as they are/);
  const home = src("home.ts");
  assert.match(home, /older\.open = !matchMedia\(PHONE\)\.matches;/);
  assert.match(home, /helpTip\(OLDER_TOOLS_NOTE/);
  assert.match(src("nav.ts"), /mountHome\(\);/);
});

test("F05: with a save kept, one line of quick links (Heroes · Inventory · Simulator · Solver) named after the save", () => {
  const html = read("site/index.html");
  const quick = html.match(/<nav class="home-quick"[\s\S]*?<\/nav>/)![0];
  assert.deepEqual([...quick.matchAll(/href="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]),
    [["save.html#heroes", "Heroes"], ["save.html#inventory", "Inventory"], ["battle.html", "Simulator"], ["solver.html", "Solver"]]);
  const css = read("site/style.css");
  assert.match(css, /^\.home-quick \{ display: none; \}/m);
  assert.match(css, /^:root\.has-save \.home-quick \{ display: flex;/m);
  assert.match(src("home.ts"), /\.home-save-name/);
});

test("F07: one top-bar order (the Save dropdown first of the right-side controls) and one chip format", () => {
  const seen: string[] = [];
  const bar = { querySelector: (s: string) => (seen.push(s), null) } as unknown as Element;
  assert.equal(chipSlot(bar), null);
  assert.deepEqual(seen, [":scope > .theme-btn, :scope > .lang-pick, :scope > .gh"]);
  const menu = src("save-menu.ts");
  assert.equal(menu.match(/bar\.insertBefore\(chip, chipSlot\(bar\)\)/g)?.length, 2); // placeChip and mountNavSaveChip
  assert.doesNotMatch(menu, /insertBefore\(chip, bar\.querySelector\("\.gh"\)\)/);
  // One button format, no expansion icons on it.
  assert.match(menu, /export function saveChipButton\(name: string, title: string\): HTMLButtonElement/);
  assert.doesNotMatch(src("expansion-menu.ts"), /xp-chip-icons|xp-chip-btn/);
  assert.doesNotMatch(read("site/style.css"), /xp-chip-icons|xp-chip-btn/);
  assert.match(read("web/scripts/check-site.ts"), /"top bar: the Save dropdown is not the first right-side control"/);
});

test("F09 / F10: one-line head, expansions folded, the same head and Open label on every plain dropdown", () => {
  const menu = src("save-menu.ts"), xp = src("expansion-menu.ts"), source = src("save-source.ts");
  assert.match(menu, /export function menuHead[\s\S]*?class: "muted small save-menu-head", title: tooltip/);
  assert.doesNotMatch(source, /el\("br"\)/);
  assert.match(source, /menuHead\(name, savedAt,/);
  // Expansions and exports as folded submenus.
  assert.match(xp, /export function expansionsFold[\s\S]*?foldGroup\("Expansions", menu, expansionMenuSection\(\{ title: false \}\)\)/);
  assert.match(source, /foldGroup\(x\.title, menu,/);
  // The plain forms share their head and link.
  assert.match(menu, /export function mountNavSaveChip[\s\S]*?plainHead\(\)[\s\S]*?openSaveLink\(\)/);
  assert.match(xp, /const head = kept \? plainHead\(\)/);
  assert.match(xp, /actions\.map\(action\) : \[openSaveLink\(\)\]/);
  assert.doesNotMatch(xp, /"📂 Open a save"/);
  assert.equal(read("site/style.css").match(/\.save-menu \.save-menu-head \{ white-space: nowrap;/g)?.length, 1);
});

test("F10 / F11: the kept save's name is stored and read back safely", () => {
  assert.equal(SAVE_NAME_KEY, "merchant:save-name");
  assert.deepEqual(parseKeptSave(JSON.stringify({ name: "PlayerData.txt", savedAt: 5 })), { name: "PlayerData.txt", savedAt: 5 });
  assert.deepEqual(parseKeptSave(JSON.stringify({ name: "Slot2Data.txt" })), { name: "Slot2Data.txt", savedAt: 0 });
  for (const bad of [null, undefined, "", "{", "null", "42", JSON.stringify({ name: "" }), JSON.stringify({ name: 3 })]) assert.equal(parseKeptSave(bad), null, String(bad));
  const source = src("save-source.ts");
  assert.match(source, /rememberSaveName\(\{ name, savedAt \}\)/);
  assert.match(source, /if \(!loaded\) \{\s*rememberSaveName\(null\);/);
  // Today: the time only; another day: the date too.
  const now = new Date(2026, 10, 24, 23, 50), t = new Date(2026, 10, 24, 23, 45).getTime();
  assert.doesNotMatch(openedAt(t, now), /2026/);
  assert.notEqual(openedAt(new Date(2026, 10, 20, 9, 0).getTime(), now), openedAt(new Date(2026, 10, 24, 9, 0).getTime(), now));
});

test("F08 / F11: the drawer has a Save group labelled with the save's file name; the Save row shows on phones", () => {
  const save = NAV.find((s) => s.inSaveMenu)!;
  assert.equal(saveLabel(save.label, null), "📜 Save");
  assert.equal(saveLabel(save.label, { name: "PlayerData.txt", savedAt: 0 }), "📜 PlayerData.txt");
  const nav = src("nav.ts");
  assert.match(nav, /function buildDrawer[\s\S]*?drawer-save[\s\S]*?saveLabel\(s\.label\)/);
  assert.doesNotMatch(nav.slice(nav.indexOf("function buildDrawer")), /if \(s\.inSaveMenu\) continue;/);
  assert.match(nav, /addEventListener\(SAVE_NAME_EVENT, syncSaveLabel\)/);
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* r2-a */"), css.indexOf("/* end r2-a */"));
  assert.match(block, /@media \(max-width: 760px\) \{\s*\.subnav\[data-section="save"\] \{ display: flex;/);
  // Still hidden with no save loaded (the earlier rule is more specific).
  assert.match(css, /:root:not\(\[data-save-loaded\]\) \.subnav\[data-section="save"\] \{ display: none; \}/);
});

test("F12: check-site's phone probe uses the CSS breakpoints (matchMedia), not clientWidth", () => {
  const cs = read("web/scripts/check-site.ts");
  assert.match(cs, /const phone = matchMedia\("\(max-width: 760px\)"\)\.matches, narrow = matchMedia\("\(max-width: 600px\)"\)\.matches;/);
  assert.match(cs, /else if \(!phone\) \{/);
  assert.match(cs, /const wrapped = !narrow \? \[\] :/);
  assert.doesNotMatch(cs, /cw > (600|760)/);
});

test("F56: one percent formatter, one level abbreviation, sentence case", () => {
  assert.equal(pct(0.425), "42.5%");
  assert.equal(pct(0.9, 0), "90%");
  assert.equal(pct(1, 0), "100%");
  assert.equal(pct(0.12345, 2), "12.35%");
  assert.equal(pct(Number.NaN), "—");
  assert.doesNotMatch(pct(0.5, 0), / %/);
  // The user, 2026-11-25: "lvl", not "lv"; "Lvl" in headers and at the start of a cell or line.
  assert.equal(LV, "Lvl");
  assert.equal(lv(49), "lvl 49");
  assert.equal(lv(undefined), "lvl ?");
  assert.equal(lvStart(49), "Lvl 49");
  assert.equal(lvStart(null), "Lvl ?");
  assert.equal(sentenceCase("time budget (s)"), "Time budget (s)");
  assert.equal(sentenceCase(""), "");
});

test("F57: the footer is one line, the page's small print in its \"?\"", () => {
  assert.equal(FOOTER_LINE, "Fan project · not affiliated");
  assert.equal(footerNote("Fan project, not affiliated with the developers of Merchant. No game files are hosted here."),
    "Not affiliated with the developers of Merchant. No game files are hosted here.");
  assert.equal(footerNote(`Fights use a re-implementation of the game's combat rules.
      Fan project, not affiliated with the developers of Merchant.`),
  "Not affiliated with the developers of Merchant. Fights use a re-implementation of the game's combat rules.");
  assert.equal(footerNote(""), "Not affiliated with the developers of Merchant.");
  const nav = src("nav.ts");
  assert.match(nav, /export function mountFooter[\s\S]*?helpTip\(note, "this site"\)/);
  assert.match(nav, /mountFooter\(\);/);
  assert.match(read("site/index.html"), /<footer data-note="No game files are hosted here\.">/);
});

test("F58: one shared sideways row style with edge fades, used by the second row", () => {
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* r2-a */"), css.indexOf("/* end r2-a */"));
  assert.ok(block.length > 100, "one marked r2-a block");
  const row = block.match(/^\.scroll-row \{([^}]*)\}/m)?.[1] ?? "";
  for (const p of [/flex-wrap: nowrap/, /overflow-x: auto/, /scrollbar-width: none/, /mask-image: linear-gradient/, /animation-timeline: scroll\(self inline\)/]) assert.match(row, p);
  assert.match(src("nav.ts"), /class: "subnav scroll-row"/);
});
