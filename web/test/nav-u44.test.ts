// U44: one Save dropdown (the save's actions and the Save pages together, no "Save ▾" in the main menu or the drawer);
// "All" first in the CSV export list; Battle's main-menu entry only opens its dropdown, like More; no second row on
// the Battle pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentNav, itemsOf, NAV } from "../src/ui/nav.ts";
import { savePages } from "../src/ui/save-menu.ts";
import { ALL_TABLES_FILE, allTablesRows, type CsvTable, toCsv, withAllTables } from "../src/ui/save-tables.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const src = (f: string) => read(`web/src/ui/${f}`);

test("Save: its pages live in the Save dropdown, not in the main menu nor the drawer", () => {
  const save = NAV.find((s) => s.id === "save")!;
  assert.equal(save.inSaveMenu, true);
  assert.equal(NAV.filter((s) => s.inSaveMenu).length, 1);
  const nav = src("nav.ts");
  // Both builders skip it.
  assert.equal(nav.match(/if \(s\.inSaveMenu\) continue;/g)?.length, 2);
  assert.match(nav, /function buildMenuBar[\s\S]*?if \(s\.inSaveMenu\) continue;/);
  assert.match(nav, /function buildDrawer[\s\S]*?if \(s\.inSaveMenu\) continue;/);
  // The Save pages group is the save viewer's sections, from the same list.
  assert.deepEqual(savePages().map((i) => i.href), itemsOf(save).map((i) => i.href));
  assert.deepEqual(savePages().map((i) => i.label), ["Overview", "Heroes", "Inventory", "Maps", "Crafters"]);
});

test("Save: one dropdown on every page, in its three forms, each with the Save pages", () => {
  // Every page: nav.ts puts the plain one; a page's own replaces it (placeChip removes it).
  assert.match(src("nav.ts"), /mountNavSaveChip\(\);/);
  const menu = src("save-menu.ts");
  assert.match(menu, /export function placeChip[\s\S]*?removeNavSaveChip\(\);/);
  assert.match(menu, /export function mountNavSaveChip[\s\S]*?savePagesGroup\(close\)/);
  assert.match(menu, /if \(!bar \|\| bar\.querySelector\("\.save-chip"\)\) return;/);
  // A save loaded: the file's actions, the page's exports, the Save pages, then the expansions, in that order.
  const source = src("save-source.ts");
  assert.match(source, /fileGroup, extrasSep, extras, menuSep\(\), savePagesGroup\(close\), menuSep\(\), expansionMenuSection\(\)\);/);
  assert.match(source, /if \(!placeChip\(chip\)\)/);
  // No save: open your save / the example save as its file actions, then the Save pages and the expansions.
  assert.match(source, /mountExpansionChip\(noSaveActions\(\)\)/);
  assert.match(source, /"📂 Open your save"[\s\S]*?"🧪 Try the example save"/);
  const xp = src("expansion-menu.ts");
  assert.match(xp, /savePagesGroup\(close\), menuSep\(\), expansionMenuSection\(\)\);/);
  assert.match(xp, /saveChipButton\("Save"/);
  assert.match(xp, /placeChip\(chip\);/);
  // nav.js bundles save-menu.ts: it must not pull a page's modules (their state would be duplicated).
  for (const m of menu.matchAll(/from "\.\/([\w-]+)\.ts"/g)) assert.equal(m[1], "nav-data", m[0]);
  assert.doesNotMatch(src("nav-data.ts"), /^import /m); // no imports at all
});

test("Save: the dropdown's Save pages are marked like the main menu's links (data-nav, aria-current)", () => {
  const menu = src("save-menu.ts");
  assert.match(menu, /"data-nav": i\.href/);
  assert.match(menu, /"data-section": "save"/);
  assert.match(menu, /if \(i\.href === href\) a\.setAttribute\("aria-current", "page"\)/);
});

test("CSV export: All first, every table in one file with a table column", () => {
  const tables: CsvTable[] = [
    { label: "Heroes", file: "heroes", rows: () => [{ name: "Ann", level: 3 }] },
    { label: "Maps", file: "maps", rows: () => [{ map: "Woods", tier: 1 }, { map: "Cave", tier: 2 }] },
  ];
  const list = withAllTables(tables);
  assert.deepEqual(list.map((t) => t.label), ["All", "Heroes", "Maps"]);
  assert.equal(list[0].file, ALL_TABLES_FILE);
  assert.deepEqual(allTablesRows(tables), [
    { table: "heroes", name: "Ann", level: 3 }, { table: "maps", map: "Woods", tier: 1 }, { table: "maps", map: "Cave", tier: 2 },
  ]);
  assert.equal(toCsv(list[0].rows()), "table,name,level,map,tier\nheroes,Ann,3,,\nmaps,,,Woods,1\nmaps,,,Cave,2\n");
  // The save viewer builds its export list with it.
  const viewer = src("save-viewer.ts");
  assert.match(viewer, /return withAllTables\(tables\)\.map/);
  for (const t of ["heroes", "hero_gear", "inventory", "maps", "crafters"]) assert.match(viewer, new RegExp(`file: "${t}"`));
});

test("Battle: the main-menu entry only opens its dropdown, the same way as More", () => {
  const battle = NAV.find((s) => s.id === "battle")!, more = NAV.find((s) => s.id === "more")!;
  assert.equal(battle.href, undefined);
  assert.equal(more.href, undefined);
  assert.ok(battle.groups && more.groups);
  // No href: a ▾ button with the label (menu-only), wired by the same code as More's (keys, aria-expanded, hover).
  const nav = src("nav.ts");
  assert.match(nav, /if \(s\.href\) li\.append\(link\(/);
  assert.match(nav, /class: s\.href \? "menu-caret" : "menu-top menu-caret menu-only", "aria-expanded": "false", "aria-controls": pop\.id/);
  assert.match(nav, /class: s\.href \? "drawer-caret" : "drawer-top drawer-caret drawer-only"/);
  // Its two pages still mark the section and their own entry.
  assert.deepEqual(currentNav("/battle.html", ""), { section: "battle", href: "battle.html" });
  assert.deepEqual(currentNav("/solver.html", ""), { section: "battle", href: "solver.html" });
});

test("Battle: no second row of sub-page chips on the Simulator and the Solver", () => {
  // The second row is only for a current section with a page of its own and sub-pages (Save, Wiki).
  assert.match(src("nav.ts"), /if \(cur\?\.href && cur\.groups\) bar\.after\(buildSubnav\(cur\)\)/);
  const withRow = NAV.filter((s) => s.href && s.groups).map((s) => s.id);
  assert.deepEqual(withRow, ["save", "wiki"]);
  for (const page of ["battle.html", "solver.html"]) {
    assert.equal(currentNav(`/${page}`, "").section, "battle");
    assert.doesNotMatch(read(`site/${page}`), /subnav/);
  }
});
