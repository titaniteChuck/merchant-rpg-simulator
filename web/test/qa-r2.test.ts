// Browser QA round 2 fixes that need no DOM: the wiki list state in sessionStorage (F4), the drawer's arrow keys, and
// the wiring the fake-DOM tests (qa-r2-dom.test.ts) can't reach: CSS (F2, F5) and the pages' calls (F1, F3, F4, F6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadListState, saveListState } from "../src/ui/list-state.ts";
import { drawerStep } from "../src/ui/nav.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const css = read("site/style.css");

test("F1: the tooltip hides when its owner is disconnected, and on hashchange / popstate", () => {
  const src = read("web/src/ui/tooltip.ts");
  assert.match(src, /const hideOrphan = \(\) => \{ if \(owner && !owner\.isConnected\) hideTip\(\); \}/);
  assert.match(src, /addEventListener\("pointerover", hideOrphan, \{ passive: true, capture: true \}\)/);
  assert.match(src, /addEventListener\("pointermove", hideOrphan, \{ passive: true, capture: true \}\)/);
  assert.match(src, /addEventListener\("focusin", hideOrphan, true\)/);
  assert.match(src, /window\.addEventListener\("hashchange", hideTip\)/);
  assert.match(src, /window\.addEventListener\("popstate", hideTip\)/);
  assert.match(src, /const hideOwn = \(\) => \{ if \(owner === el\) hideTip\(\); \}/); // the owner-only rule stays
});

test("F2: the inventory filter column doesn't wrap, and its chip row scrolls inside it", () => {
  assert.match(css, /\.inv-filter \{ flex-direction: column; flex-wrap: nowrap; align-items: stretch;[^}]*min-width: 0;/);
  assert.match(css, /\.inv-filter > \* \{ min-width: 0; max-width: 100%; \}/);
  assert.match(css, /\.inv-kinds \{ overflow-x: auto;[^}]*min-width: 0; \}/);
});

test("F3: Profit restores the focus by a stable key, and Show more moves it on", () => {
  const page = read("web/src/ui/profit.ts"), tables = read("web/src/ui/profit-tables.ts");
  assert.match(page, /focusKeyOf\(active\)/);
  assert.match(page, /const again = findFocusKey\(panel, key\)/);
  assert.doesNotMatch(page, /\[aria-label="\$\{focusLabel\}"\]/);
  assert.match(page, /b\.setAttribute\("data-focus-key", `chip:\$\{label\}`\)/);
  assert.match(page, /"data-focus-key": "q"/);
  assert.match(page, /"data-focus-key": "orb"/);
  assert.match(tables, /btn\.setAttribute\("data-focus-key", `sort:\$\{c\.key\}`\)/);
  assert.match(tables, /"data-focus-key": "more"/);
  assert.match(page, /renderPanel\(true, shown\)/);
  assert.match(page, /const more = findFocusKey\(panel, \{ key: "more" \}\);\s+const row = more \? null : addedRow\(panel, moreFrom\);/);
});

test("F4: the wiki list keeps its sort across filter keystrokes and its state per route", () => {
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /const st = loadListState\(route\);/);
  assert.match(wiki, /table\(shown, cols, rowClass, \{ sort: st\.sort, onSort: \(s\) => \{/);
  assert.match(wiki, /filterBox\(`Filter \$\{title\.toLowerCase\(\)\}`, filter, st\.q\)/);
});

test("F4: list state round-trips through sessionStorage, and storage that throws is ignored", () => {
  const g = globalThis as { sessionStorage?: unknown };
  const store = new Map<string, string>();
  g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.deepEqual(loadListState("#/enemies"), { q: "" });
  saveListState("#/enemies", { q: "Slime", sort: { key: "level", asc: false } });
  assert.deepEqual(loadListState("#/enemies"), { q: "Slime", sort: { key: "level", asc: false } });
  assert.deepEqual(loadListState("#/maps"), { q: "" }); // per route
  store.set("merchant.wiki.list:#/maps", "{not json");
  assert.deepEqual(loadListState("#/maps"), { q: "" });
  store.set("merchant.wiki.list:#/maps", JSON.stringify({ q: 3, sort: { key: "x" } }));
  assert.deepEqual(loadListState("#/maps"), { q: "" }); // malformed fields dropped
  g.sessionStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(loadListState("#/enemies"), { q: "" });
  assert.doesNotThrow(() => saveListState("#/enemies", { q: "x" }));
  delete g.sessionStorage;
  assert.deepEqual(loadListState("#/enemies"), { q: "" }); // no storage at all
});

test("F5: the Levelling compare headers wrap on a phone, the ascension under After", () => {
  const page = read("web/src/ui/levelling.ts");
  assert.match(page, /el\("th", \{ class: "num" \}, "After", el\("span", \{ class: "lv-th-asc" \}, ` \(\$\{ascText\(nxt\.tier - 1\)\}\)`\)\)/);
  assert.match(css, /#prestige-out \.lv-payoff th, #prestige-out \.lv-payoff td:first-child \{ white-space: normal; \}/);
  assert.match(css, /#prestige-out \.lv-th-asc \{ display: block;/);
});

test("F6: Save menu actions give the focus back to the Save button", () => {
  const source = read("web/src/ui/save-source.ts"), xp = read("web/src/ui/expansion-menu.ts");
  assert.match(source, /close\(\);\s+refocusSaveChip\(f\(\)\);/);
  assert.match(source, /run: \(\) => useExample\(\) \}/); // the promise, so the refocus waits for it
  assert.match(xp, /close\(\);\s+refocusSaveChip\(x\.run\(\)\);/);
});

test("drawer: arrow keys, Home and End step through the links, wrapping", () => {
  assert.equal(drawerStep(4, 0, "ArrowDown"), 1);
  assert.equal(drawerStep(4, 3, "ArrowDown"), 0);
  assert.equal(drawerStep(4, 0, "ArrowUp"), 3);
  assert.equal(drawerStep(4, -1, "ArrowDown"), 0);
  assert.equal(drawerStep(4, -1, "ArrowUp"), 3);
  assert.equal(drawerStep(4, 2, "Home"), 0);
  assert.equal(drawerStep(4, 1, "End"), 3);
  assert.equal(drawerStep(4, 1, "Tab"), null);
  assert.equal(drawerStep(0, -1, "ArrowDown"), null);
  assert.match(read("web/src/ui/nav.ts"), /const j = drawerStep\(links\.length, links\.indexOf\(document\.activeElement as HTMLElement\), e\.key\);/);
});
