// Tab lists (WAI-ARIA tabs pattern): every tab list on the site has tablist / tab / tabpanel roles, aria-selected,
// aria-controls, a roving tabindex, and its keyboard (arrows, Home, End) from the shared dom.ts tabKeys.
// Covered: the Battle Simulator's and the Solver's Party / Flow tabs, the Flow tab's map room bar, the Profit tables.
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

test("Battle and Solver: the Party / Flow tabs are a full tablist, keyboard from tabKeys", () => {
  for (const page of ["site/battle.html", "site/solver.html"]) {
    const html = read(page);
    assert.match(html, /<div class="tabs b3-tabs" role="tablist" aria-label="Views">/, page);
    assert.match(html, /<button id="tab-party" type="button" role="tab" aria-selected="true" aria-controls="setup-grid" data-tab="party">/, page);
    // U58: Flow tabs over one panel (U63: Flow 2 and Flow 3, no Flow 1)
    for (const n of [2, 3]) {
      assert.match(html, new RegExp(`<button id="tab-flow${n}" type="button" role="tab" aria-selected="false" aria-controls="flow-panel" data-tab="flow${n}" tabindex="-1">`), page);
    }
    assert.match(html, /<div id="flow-panel" class="flow-panel" role="tabpanel" aria-labelledby="tab-flow2" hidden>/, page);
    assert.match(html, /<div id="setup-grid" class="setup-grid b3-grid" role="tabpanel" aria-labelledby="tab-party"/, page);
  }
  const bp = src("battle-page.ts");
  const init = bp.match(/function initTabs\(\): void \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(init, /tabKeys\(list\)/);
  assert.match(init, /querySelector<HTMLElement>\("\.b3-tabs\[role=tablist\]"\)/);
  assert.doesNotMatch(init, /keydown/, "no hand-written arrow keys any more");
  // showTab keeps aria-selected, the roving tabindex and the panels in step.
  const show = bp.match(/function showTab\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(show, /b\.setAttribute\("aria-selected", String\(on\)\);\s*b\.tabIndex = on \? 0 : -1;/);
  assert.match(show, /\$\("#flow-panel"\)\.hidden = !flow;\s*\$\("#setup-grid"\)\.hidden = tab !== "party";/);
});

test("Flow tab: the map room bar is a tablist over one room panel, keyboard from tabKeys", () => {
  const bp = src("battle-page.ts");
  assert.match(bp, /const view = el\("div", \{ class: "flow-room", id: "flow-room", role: "tabpanel" \}\);/);
  assert.match(bp, /el\("div", \{ class: "room-bar scroll-row", role: "tablist", "aria-label": "The map's battles, in order" \}\)/);
  assert.match(bp, /role: "tab", id: `room-tab-\$\{k\}`, "aria-controls": "flow-room",[^\n]*"aria-selected": "false"/);
  const draw = bp.match(/const draw = \(smooth = true\) => \{\s*bar\.querySelectorAll[\s\S]*?view\.setAttribute\("aria-labelledby", `room-tab-\$\{at\}`\);/)?.[0];
  assert.ok(draw, "draw() labels the panel by the selected room");
  assert.match(draw!, /b\.setAttribute\("aria-selected", String\(k === at\)\);\s*b\.tabIndex = k === at \? 0 : -1;/);
  assert.match(bp, /bar\.append\(b\);\s*\}\);[^\n]*\n[^\n]*\n\s*tabKeys\(bar\);\s*box\.append\(scroller\.box, view\);/);
  assert.doesNotMatch(bp, /addEventListener\("keydown"[^\n]*\n\s*if \(e\.key !== "ArrowLeft"/, "no hand-written arrow keys any more");
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
  const files: Record<string, number> = { "battle-page.ts": 1, "profit.ts": 1 };
  for (const [f, lists] of Object.entries(files)) {
    const s = src(f);
    const n = (s.match(/role: "tablist"/g) ?? []).length;
    assert.equal(n, lists, `${f}: tablists built in code`);
    assert.ok((s.match(/tabKeys\(/g) ?? []).length >= n, `${f}: each tablist calls tabKeys`);
  }
  // The static ones (battle.html, solver.html) are wired by battle-page.ts initTabs.
  for (const page of ["battle.html", "solver.html"]) assert.equal((read(`site/${page}`).match(/role="tablist"/g) ?? []).length, 1, page);
});
