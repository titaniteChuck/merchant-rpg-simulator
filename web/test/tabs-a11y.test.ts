// Tab lists (WAI-ARIA tabs pattern): every tab list on the site has tablist / tab / tabpanel roles, aria-selected,
// aria-controls, a roving tabindex, and its keyboard (arrows, Home, End) from the shared dom.ts tabKeys.
// Covered: the Profit tables (U70: the Battle pages' Party / Flow tabs and the map room bar are gone).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tabKeys } from "../src/ui/dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const src = (f: string) => read(`web/src/ui/${f}`);

/** A tiny stand-in for the DOM: a list of tab buttons whose click selects the tab, as the pages do. */
function fakeTabs(n: number, selected: number) {
  const g = globalThis as Record<string, unknown>;
  const observers: (() => void)[] = [];
  g.MutationObserver = class { cb: () => void; constructor(cb: () => void) { this.cb = cb; } observe() { observers.push(this.cb); } };
  const doc = { activeElement: null as unknown };
  g.document = doc;
  const attrs: Record<string, string>[] = [];
  const tabs = Array.from({ length: n }, (_, k) => {
    attrs[k] = { role: "tab", "aria-selected": String(k === selected) };
    const t = {
      tabIndex: 0,
      getAttribute: (a: string) => attrs[k][a] ?? null,
      focus: () => (doc.activeElement = t),
      click: () => {
        attrs.forEach((a, j) => (a["aria-selected"] = String(j === k)));
        observers.forEach((cb) => cb());
      },
    };
    return t;
  });
  let onKey: ((e: unknown) => void) | null = null;
  const list = {
    querySelectorAll: (sel: string) => (sel === '[role="tab"]' ? tabs : []),
    addEventListener: (type: string, fn: (e: unknown) => void) => type === "keydown" && (onKey = fn),
  };
  const press = (key: string) => {
    let prevented = false;
    onKey!({ key, preventDefault: () => (prevented = true) });
    return prevented;
  };
  const sel = () => attrs.findIndex((a) => a["aria-selected"] === "true");
  return { list, tabs, doc, press, sel };
}

test("tabKeys: roving tabindex, arrows wrap, Home / End, other keys untouched", async () => {
  const f = fakeTabs(4, 1);
  tabKeys(f.list as unknown as HTMLElement);
  await Promise.resolve();
  assert.deepEqual(f.tabs.map((t) => t.tabIndex), [-1, 0, -1, -1], "only the selected tab is in the Tab order");
  // Keys only act when a tab of the list has the focus.
  assert.equal(f.press("ArrowRight"), false);
  f.tabs[1].focus();
  assert.ok(f.press("ArrowRight"));
  assert.equal(f.sel(), 2);
  assert.equal(f.doc.activeElement, f.tabs[2]);
  assert.deepEqual(f.tabs.map((t) => t.tabIndex), [-1, -1, 0, -1]);
  f.press("ArrowRight");
  f.press("ArrowRight");
  assert.equal(f.sel(), 0, "Right wraps to the first");
  f.press("ArrowLeft");
  assert.equal(f.sel(), 3, "Left wraps to the last");
  f.press("Home");
  assert.equal(f.sel(), 0);
  f.press("End");
  assert.equal(f.sel(), 3);
  assert.equal(f.press("Enter"), false);
  assert.equal(f.press("ArrowDown"), false);
  assert.equal(f.sel(), 3);
});

test("Battle and Solver (U70): no view tabs and no room bar any more, the Party view only", () => {
  for (const page of ["site/battle.html", "site/solver.html"]) {
    const html = read(page);
    assert.doesNotMatch(html, /b3-tabs|role="tablist"|role="tabpanel"|flow-panel|tab-flow/, page);
    assert.match(html, /<div id="setup-grid" class="setup-grid b3-grid">/, page);
  }
  const bp = src("battle-page.ts");
  assert.doesNotMatch(bp, /function (initTabs|showTab|roomScroller)\b|room-bar|flow-room/);
});

test("Profit: the result tables are a tablist over the panel, keyboard from tabKeys", () => {
  const pf = src("profit.ts");
  const render = pf.match(/function render\(\): void \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(render, /el\("div", \{ role: "tablist", class: "tabs", "aria-label": "Result tables" \}\)/);
  assert.match(render, /el\("div", \{ role: "tabpanel", class: "panel", id: "panel", "aria-labelledby": `pf-tab-\$\{state\.tab\}` \}\)/);
  assert.match(render, /role: "tab", type: "button", id: `pf-tab-\$\{name\}`, "aria-selected": String\(on\), "aria-controls": "panel",\s*tabindex: on \? "0" : "-1"/);
  assert.match(render, /b\.setAttribute\("aria-selected", String\(on\)\);\s*b\.tabIndex = on \? 0 : -1;\s*\}\);\s*panel\.setAttribute\("aria-labelledby", `pf-tab-\$\{name\}`\);/);
  assert.match(render, /tabKeys\(tabList\);\s*\$\("#result"\)\.replaceChildren\(summaryTiles\(r\), tabList, panel\);/);
});

test("Every tablist in the site's own code uses tabKeys (Balance is frozen and left out)", () => {
  // U70: battle-page.ts builds none any more (the map's room bar went with the Flows).
  const files: Record<string, number> = { "battle-page.ts": 0, "profit.ts": 1 };
  for (const [f, lists] of Object.entries(files)) {
    const s = src(f);
    const n = (s.match(/role: "tablist"/g) ?? []).length;
    assert.equal(n, lists, `${f}: tablists built in code`);
    assert.ok((s.match(/tabKeys\(/g) ?? []).length >= n, `${f}: each tablist calls tabKeys`);
  }
  // U70: no static ones either (battle.html and solver.html lost their Party / Flow tabs).
  for (const page of ["battle.html", "solver.html"]) assert.equal((read(`site/${page}`).match(/role="tablist"/g) ?? []).length, 0, page);
});
