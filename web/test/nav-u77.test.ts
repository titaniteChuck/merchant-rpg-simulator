// U77: Save is a main-menu entry again (its link and a ▾ with its pages, as Wiki), on every page, desktop and phone
// drawer, the current section on the Save pages (the top-bar Save button no longer is); the Save and Wiki second rows
// as they were. Save > Inventory: no "Maps" or "On the counter" filter.
// nav.ts is imported before the fake DOM, so its own mounting doesn't run; the menu is then built in the fake DOM.
import { buildMenuBar, currentNav, itemsOf, NAV } from "../src/ui/nav.ts";
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INVENTORY_KINDS, inventoryKindMatch } from "../src/ui/save-tables.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const nav = read("web/src/ui/nav.ts"), viewer = read("web/src/ui/save-viewer.ts");

test("the main menu: Home, Save ▾, Battle ▾, Wiki ▾, More ▾; Save a link to the viewer and a ▾ with its five pages", () => {
  const bar = buildMenuBar() as unknown as FakeElement;
  const items = bar.querySelectorAll("li.menu-item");
  assert.deepEqual(items.map((li) => li.getAttribute("data-section")), ["home", "save", "battle", "wiki", "more"]);
  const save = items[1];
  const top = save.querySelector("a.menu-top")!;
  assert.equal(top.getAttribute("href"), "save.html");
  assert.equal(top.textContent, "Save");
  const caret = save.querySelector("button.menu-caret")!;
  assert.equal(caret.getAttribute("aria-controls"), "menu-save");
  assert.equal(caret.getAttribute("aria-label"), "Save pages");
  assert.ok(!caret.classList.contains("menu-only"), "a page of its own, as Wiki");
  assert.deepEqual(save.querySelector(".menu-pop")!.querySelectorAll("a").map((a) => a.textContent), ["Overview", "Heroes", "Inventory", "Maps", "Crafters"]);
  assert.deepEqual(save.querySelector(".menu-pop")!.querySelectorAll("a").map((a) => a.getAttribute("data-nav")), itemsOf(NAV[1]).map((i) => i.href));
});

test("every page: the menu and the drawer both hold Save; marked current on the Save pages only, the top-bar button never", () => {
  assert.doesNotMatch(nav, /if \(s\.inSaveMenu\) continue;/);
  assert.match(nav, /function buildDrawer[\s\S]*?drawer-save[\s\S]*?saveLabel\(s\.label\)/, "the drawer's Save group as R2-A made it");
  for (const hash of ["", "#overview", "#heroes", "#hero=3", "#inventory", "#maps", "#crafters"]) {
    assert.equal(currentNav("/merchant/save.html", hash).section, "save", hash);
  }
  for (const page of ["index.html", "battle.html", "solver.html", "wiki.html", "profit.html"]) assert.notEqual(currentNav(`/merchant/${page}`, "").section, "save");
  // mark(): the section's entry .is-current (and its link aria-current="true") from the same rule as Wiki's
  assert.match(nav, /x\.classList\.toggle\("is-current", x\.dataset\.section === section\)/);
  assert.doesNotMatch(nav + read("web/src/ui/save-menu.ts"), /markSaveChip/);
  // the second rows as they were: Save and Wiki (a page of their own and sub-pages)
  assert.match(nav, /if \(cur\?\.href && cur\.groups\) bar\.after\(buildSubnav\(cur\)\);/);
});

test("Save > Inventory: the filters are All, Equipment, Consumables, Materials (no Maps, no On the counter)", () => {
  assert.deepEqual([...INVENTORY_KINDS], ["equipment", "consumable", "material"]);
  assert.match(viewer, /\.\.\.INVENTORY_KINDS\.map\(\(t\) => \(\{ value: t, label: ITEM_TYPE_PLURALS\[t\] \}\)\)/);
  assert.doesNotMatch(viewer, /"On the counter"|value: "counter"|"map"\]\.map/);
  assert.match(viewer, /all\.filter\(\(r\) => inventoryKindMatch\(r, kind\.value\)/);
  // a kind keeps its stacks on the counter (their row says so)
  const sword = { type: "equipment", where: "inventory" }, onSale = { type: "equipment", where: "counter" }, herb = { type: "material", where: "inventory" };
  assert.deepEqual([sword, onSale, herb].filter((r) => inventoryKindMatch(r, "equipment")), [sword, onSale]);
  assert.deepEqual([sword, onSale, herb].filter((r) => inventoryKindMatch(r, "all")), [sword, onSale, herb]);
  assert.deepEqual([sword, onSale, herb].filter((r) => inventoryKindMatch(r, "material")), [herb]);
  assert.match(read("site/style.css"), /tr\.counter td:first-child::after \{ content: "on the counter";/);
});
