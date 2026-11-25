// Browser QA fixes after R3: a map run that Scribe hidden pushed back to a quest comes back when Scribe shows again;
// the Profit table's scroll stops clear of its sticky Item column. U70: the Flow's calculation terms and its "planned,
// not reached" rows went with the Flow, and their tests with them.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("Scribe back on: the map run it pushed back to a quest is restored, the fallback itself unchanged", () => {
  const src = read("web/src/ui/battle-page.ts");
  // remembered apart from the current and the stored opponent
  assert.match(src, /let scribeFallback: OppChoice \| null = null;/);
  const onX = src.slice(src.indexOf("function onExpansions"), src.indexOf("function restoreOpponent"));
  const sync = onX.indexOf("syncOppKinds()");
  // remembered only when syncOppKinds really pushed a map run back because Scribe is hidden
  const remember = onX.indexOf("scribeFallback = { kind: \"map\"");
  assert.ok(remember > sync);
  assert.match(onX, /if \(wasMap && oppKind\(\) !== "map" && mapsHidden\(\)\) \{/);
  // put back before syncOppKinds, once Scribe shows again, only when still valid, and used once
  const restore = onX.indexOf("if (scribeFallback && !mapsHidden())");
  assert.ok(restore >= 0 && restore < sync);
  assert.match(onX, /scribeFallback = null;/);
  assert.match(onX, /oppKind\(\) === "quest" && mapRunValid\(back\)/);
  assert.match(onX, /was = \{ \.\.\.was, \.\.\.back, kind: "map" \};/);
  assert.match(src, /function mapRunValid\(o: OppChoice\): boolean \{\s*return mapsAvailable\(\) && o\.map !== undefined && mapOptions\(state\.sv\)/);
  // the fallback itself is as before
  const syncFn = src.slice(src.indexOf("function syncOppKinds"), src.indexOf("// ---------------------------------------------------------------- party"));
  assert.doesNotMatch(syncFn, /scribeFallback/);
  assert.doesNotMatch(src.slice(src.indexOf("function saveOpponent"), src.indexOf("function storedOpponent")), /scribeFallback/);
});

test("Profit: the table's scroll padding is the sticky Item column's width", async () => {
  const css = read("site/style.css");
  assert.match(css, /\.table-wrap\.pf-table \{ scroll-padding-left: var\(--pf-sticky, 0px\); \}/);
  const { stickyPad } = await import("../src/ui/profit-tables.ts");
  const seen: { observe?: () => void } = {};
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    constructor(f: () => void) {
      seen.observe = f;
    }
    observe() {}
  };
  const doc = (globalThis as unknown as { document: { createElement(t: string): FakeElement } }).document;
  const wrap = doc.createElement("div"), table = doc.createElement("table"), thead = doc.createElement("thead"), tr = doc.createElement("tr");
  const th = doc.createElement("th");
  th.offsetWidth = 132;
  tr.append(th, doc.createElement("th"));
  thead.append(tr);
  table.append(thead);
  wrap.append(table);
  stickyPad(wrap as unknown as HTMLElement);
  assert.ok(seen.observe, "watches the Item column");
  seen.observe!();
  assert.equal(wrap.style["--pf-sticky"], "132px");
  delete (globalThis as Record<string, unknown>).ResizeObserver;
  // both kinds of Profit table get it
  assert.match(read("web/src/ui/profit.ts"), /const best = \(tier: number\) => stickyPad\(el\("div", \{ class: "table-wrap pf-table" \}/);
  assert.match(read("web/src/ui/profit-tables.ts"), /stickyPad\(wrap\);\n  if \(sorted\.length <= shown\.length\) return wrap;/);
});
