// A page scroll keeps the tooltip of the element that has keyboard focus (Tab to an off-screen term scrolls the
// page to it; hiding on that scroll made focus tooltips never show). Hover tooltips still hide on scroll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/ui/tooltip.ts", import.meta.url), "utf8");

test("scroll keeps a focused element's tooltip and hides the others", () => {
  assert.doesNotMatch(src, /addEventListener\("scroll", hideTip/);
  assert.match(src, /owner === document\.activeElement\) place\(owner\)/);
  assert.match(src, /else hideTip\(\)/);
});

test("only the owning element hides the tooltip on pointerleave or blur", () => {
  assert.match(src, /const hideOwn = \(\) => \{ if \(owner === el\) hideTip\(\); \}/);
  assert.match(src, /addEventListener\("pointerleave", hideOwn\)/);
  assert.match(src, /addEventListener\("blur", hideOwn\)/);
});

test("wiki help popover survives the scroll Tab causes", () => {
  const help = readFileSync(new URL("../src/ui/wiki-help.ts", import.meta.url), "utf8");
  assert.doesNotMatch(help, /addEventListener\("scroll", close/);
  assert.match(help, /a === o\.btn \|\| o\.pop\.contains\(a\)/);
});
