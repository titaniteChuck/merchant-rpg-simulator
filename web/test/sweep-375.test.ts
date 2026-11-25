// 375 px sweep fixes: no "·" left dangling at the start or end of a wiki fact line, and no tile alone on a phone row
// (Levelling's plan tiles, Farming's top three, the wiki home's categories). Code and CSS are read as text; no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasOrphan } from "../src/ui/battle-results.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const ui = (f: string) => read(`web/src/ui/${f}`);
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* sweep-375"), css.indexOf("/* end sweep-375 */"));

test("one sweep-375 block in style.css", () => {
  assert.equal(css.split("/* sweep-375").length, 2);
  assert.equal(css.split("/* end sweep-375 */").length, 2);
});

test("wiki fact lines: the separators belong to the parts and a line's first one is clipped", () => {
  const wiki = ui("wiki.ts");
  // The item strip and the empty-sections line no longer join with a bare " · " between parts.
  const strip = wiki.slice(wiki.indexOf("const factStrip"), wiki.indexOf("const section = "));
  assert.doesNotMatch(strip, /" · "/);
  assert.match(strip, /sepRow\(parts\.filter\(/);
  assert.match(strip, /el\("span", \{ class: "sep", "aria-hidden": "true" \}, "·"\)/);
  const empty = wiki.slice(wiki.indexOf("const emptyLine"), wiki.indexOf("function joinNodes"));
  assert.match(empty, /sepRow\(parts\.map\(/);
  assert.doesNotMatch(empty, /" · "/);
  // The row sits one separator to the left in a clipped box: the separator width and the shift agree.
  assert.match(css, /#wiki \.fact-strip, #wiki \.wiki-empty-line \{ overflow-x: clip; \}/);
  assert.match(css, /#wiki \.sep-row \{ display: flex; flex-wrap: wrap; align-items: baseline; margin-left: -1em; \}/);
  assert.match(css, /#wiki \.sep \{ display: inline-block; width: 1em; text-align: center; \}/);
});

test("no lone tile on a phone row: Levelling, Farming and the wiki home span an odd last tile", () => {
  assert.match(ui("levelling.ts"), /el\("div", \{ class: "tiles span-last" \},\s*tile\("Time"/);
  assert.match(ui("farming.ts"), /el\("div", \{ class: "tiles span-last" \}, \.\.\.live\.slice\(0, 3\)/);
  assert.match(block, /@media \(max-width: 600px\)/);
  assert.match(block, /\.tiles\.span-last > \.tile:last-child:nth-child\(odd\)/);
  assert.match(block, /#wiki ul\.wiki-tiles > li:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
  // The wiki home is two columns on a phone (as is the plain tile grid there); with these counts the last tile would
  // be alone without the span.
  assert.match(css, /@media \(max-width: 600px\) \{\s*#wiki ul\.wiki-tiles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  const wiki = ui("wiki.ts");
  const at = wiki.indexOf("const CATEGORIES");
  const n = wiki.slice(at, wiki.indexOf("\n];", at)).match(/\{ href: "#\//g)?.length ?? 0;
  assert.ok(hasOrphan(n, 2), `${n} wiki home tiles`);
  assert.ok(hasOrphan(3, 2));
});
