// U44 fix: the top-bar dropdowns stay 8 px inside the window at every width (the Save dropdown ran past a phone's left
// edge), and on the Save pages the top-bar Save button is the current section (aria-current), as they have no entry
// in the main menu nor in the drawer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentNav } from "../src/ui/nav.ts";
import { MENU_MARGIN, shiftIntoView } from "../src/ui/save-menu.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const src = (f: string) => read(`web/src/ui/${f}`);

test("shiftIntoView: a menu is moved inside [8, width - 8], its left edge first", () => {
  assert.equal(MENU_MARGIN, 8);
  // Already inside: unmoved.
  assert.equal(shiftIntoView(20, 300, 375), 0);
  assert.equal(shiftIntoView(8, 367, 375), 0);
  // The phone bug: a 250 px menu right-aligned to a button ending at 212 px starts at -38: moved 46 px right.
  assert.equal(shiftIntoView(-38, 212, 375), 46);
  // Past the right edge: moved left.
  assert.equal(shiftIntoView(900, 1300, 1280), -28);
  // Wider than the window less the margins: the left edge wins.
  assert.equal(shiftIntoView(-50, 400, 375), 58);
  assert.equal(shiftIntoView(100, 500, 375), -92);
  for (const [l, r, w] of [[-38, 212, 375], [900, 1300, 1280], [0, 359, 375], [-200, -10, 320]]) {
    const dx = shiftIntoView(l, r, w);
    assert.ok(l + dx >= 8, `left ${l} + ${dx}`);
    if (r - l <= w - 16) assert.ok(r + dx <= w - 8, `right ${r} + ${dx}`);
  }
});

test("Every top-bar dropdown is kept on screen by the same rule", () => {
  const menu = src("save-menu.ts");
  // fitMenu (every Save dropdown form) clamps sideways too.
  assert.match(menu, /export function fitMenu\(menu: HTMLElement\): void \{\s*keepInView\(menu\);/);
  // The main menu's dropdowns (Battle, Wiki, More) use the shared helper, not their own right-edge-only shift.
  const nav = src("nav.ts");
  assert.match(nav, /keepInView\(pop\);/);
  assert.doesNotMatch(nav, /pop\.style\.left/);
  // The language menu (site/theme.js, not bundled) applies the same margins.
  assert.match(read("site/theme.js"), /menu\.style\.translate = ""[\s\S]*?vw - 8 - r\.right[\s\S]*?8 - r\.left/);
  // CSS: no wider than the window less both margins.
  const css = read("site/style.css");
  for (const sel of [".save-menu", ".lang-menu", ".menu-pop"]) {
    const rule = css.match(new RegExp(`^\\${sel} \\{[^}]*\\}`, "m"))?.[0] ?? "";
    assert.match(rule, /max-width: calc\(100vw - 16px\)/, sel);
  }
});

test("Save pages: the top-bar Save button is the current section", () => {
  for (const hash of ["", "#heroes", "#hero=1"]) assert.equal(currentNav("/save.html", hash).section, "save");
  assert.notEqual(currentNav("/battle.html", "").section, "save");
  const menu = src("save-menu.ts");
  assert.match(menu, /export const onSavePage = \(\): boolean => currentNav\(location\.pathname, location\.hash\)\.section === "save";/);
  // Marked when built (the pages' own dropdowns come after nav.ts) and at every mark() (hashchange).
  assert.match(menu, /export function saveChipButton[\s\S]*?if \(onSavePage\(\)\) b\.setAttribute\("aria-current", "true"\);/);
  assert.match(menu, /export function markSaveChip[\s\S]*?\.save-chip-btn[\s\S]*?b\.removeAttribute\("aria-current"\)/);
  assert.match(src("nav.ts"), /export function mark\(\)[\s\S]*?markSaveChip\(\);[^\n]*\n\}/);
  // Styled like a current main-menu entry.
  const css = read("site/style.css");
  const cur = css.match(/^\.menu-item\.is-current \{([^}]*)\}/m)?.[1].trim();
  const btn = css.match(/^\.topbar \.save-chip-btn\[aria-current\] \{([^}]*)\}/m)?.[1].trim();
  assert.ok(cur && btn);
  assert.equal(btn, cur);
});

test("check-site accepts the Save button and dropdown as the current marker, and checks the Save dropdown's margins", () => {
  const cs = read("web/scripts/check-site.ts");
  assert.match(cs, /saveCurrent = \(\) => !!document\.querySelector\('\.topbar \.save-chip-btn\[aria-current\], \.topbar \.save-menu \[aria-current="page"\]'\)/);
  assert.match(cs, /"no current section in the main menu"/);
  assert.match(cs, /&& !saveCurrent\(\)\) nav\.push\("no current section in the main menu"\)/);
  assert.match(cs, /&& !saveCurrent\(\)\) nav\.push\("no current page in the drawer"\)/);
  assert.match(cs, /inMargins\(menu, "the Save dropdown"\)/);
  assert.match(cs, /"Save page: the top-bar Save button is not marked current"/);
});
