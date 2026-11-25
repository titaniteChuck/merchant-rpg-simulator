// U52: every save load opens the Overview, the save viewer's width, no chip row on the wizard, the example save card.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const { EXAMPLE_CARD, saveWizard, WIZARD } = await import("../src/ui/save-wizard.ts");
const { OVERVIEW_HREF, overviewAfterLoad } = await import("../src/ui/save-source.ts");

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const viewer = read("web/src/ui/save-viewer.ts");
const source = read("web/src/ui/save-source.ts");
const css = read("site/style.css");
const u52 = css.slice(css.indexOf("/* U52 */"), css.indexOf("/* end U52 */"));
const html = (page: string) => read(`site/${page}`);

test("a load the visitor starts ends on the save viewer's Overview, from any page", () => {
  assert.equal(OVERVIEW_HREF, "save.html#overview");
  // Another page (the Solver, Profit …, also on the GitHub Pages sub-path): the save viewer's Overview.
  for (const path of ["/solver.html", "/merchant-rpg-simulator/profit.html", "/", "/battle.html", "/levelling.html"]) {
    assert.deepEqual(overviewAfterLoad(path, "#x"), { href: "save.html#overview" }, path);
  }
  // The save viewer: its hash, whatever it showed (the wizard, a hero, another tab); nothing when already there.
  for (const hash of ["", "#open", "#open=pc", "#hero=3", "#inventory", "#crafters"]) {
    assert.deepEqual(overviewAfterLoad("/merchant-rpg-simulator/save.html", hash), { hash: "#overview" }, hash);
  }
  assert.equal(overviewAfterLoad("/save.html", "#overview"), null);
  assert.equal(overviewAfterLoad("/save.html", "#Overview"), null);
  assert.deepEqual(overviewAfterLoad("/notsave.html", ""), { href: "save.html#overview" });
});

test("every load path goes through accept (then the Overview); the stored save is restored without moving", () => {
  const accept = source.slice(source.indexOf("const accept = async"), source.indexOf("/** Fetch the example save"));
  assert.match(accept, /await loaded\(file\.name, savedAt\);\s*goToOverview\(\);/);
  // The picker, a drop, the example save and Reload all call accept.
  assert.match(source, /const pickerOpts = \{ input: o\.input, drop: o\.drop, onFile: accept, onError: showError \};/);
  assert.match(source, /e\.preventDefault\(\);\s*accept\(f\);/);
  assert.match(source, /await accept\(new File\(\[text\], EXAMPLE_NAME/);
  assert.match(source, /if \(f\) await accept\(f, /);
  // The kept save: loaded on page open, no navigation.
  const restore = source.slice(source.indexOf("getSave().then("));
  assert.doesNotMatch(restore, /goToOverview|location\./);
  // No page-only hook any more: the rule is the same on every page.
  assert.doesNotMatch(source, /afterPick/);
  assert.doesNotMatch(viewer, /afterPick/);
});

test("save.html width: the page's root no longer takes the wizard section's class; every page reserves its scrollbar", () => {
  // The cause: <html class="save-wizard"> matched ".save-wizard { max-width: 640px }", the wizard section's rule.
  assert.doesNotMatch(viewer, /toggle\("save-wizard"/);
  assert.match(viewer, /document\.documentElement\.classList\.toggle\("wiz-open", wiz !== undefined\);/);
  assert.doesNotMatch(css, /html\.save-wizard/);
  const section = saveWizard(null, { pick: () => {} }) as unknown as FakeElement;
  assert.equal(section.getAttribute("class"), "save-wizard");
  // A shared rule, not a save-only width: short pages keep the scrollbar's room, like the long ones.
  assert.match(u52, /^html \{ scrollbar-gutter: stable; \}$/m);
  // save.html has the same frame as the other pages: a plain <main> right in <body>, no width class.
  const mainOf = (s: string) => /<main[^>]*>/.exec(s)?.[0];
  assert.equal(mainOf(html("save.html")), "<main>");
  for (const p of ["solver.html", "profit.html", "farming.html", "levelling.html", "battle.html"]) assert.equal(mainOf(html(p)), "<main>", p);
  assert.match(html("save.html"), /<body>\s*<header class="topbar">/);
});

test("the wizard hides the Save pages' chip row; the real Save pages keep it", () => {
  assert.match(u52, /html\.wiz-open \.subnav\[data-section="save"\] \{ display: none; \}/);
  // Beats the phone rule that shows the row (.subnav[data-section="save"] { display: flex }).
  assert.match(css, /\.subnav\[data-section="save"\] \{ display: flex; margin: -12px 0 16px; \}/);
  // Only on the wizard: the class follows the hash in route().
  assert.match(viewer, /const wiz = wizardRoute\(location\.hash\);[\s\S]*?toggle\("wiz-open", wiz !== undefined\)/);
});

test("step 1: the example save is a third card like PC and Mobile", () => {
  let examples = 0;
  const w = saveWizard(null, { pick: () => {}, example: () => examples++ }) as unknown as FakeElement;
  const grid = w.querySelector(".wiz-choices")!;
  const cards = grid.children;
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.getAttribute("class")), ["wiz-choice", "wiz-choice", "wiz-choice wiz-example"]);
  // Same layout: icon, label, sub.
  for (const c of cards) {
    assert.deepEqual(c.children.map((k) => k.getAttribute("class")), ["wiz-icon", "wiz-label", "wiz-sub"]);
  }
  const ex = cards[2];
  assert.equal(ex.tagName.toLowerCase(), "button");
  assert.equal(ex.getAttribute("type"), "button");
  assert.deepEqual(ex.children.map((k) => k.textContent), [EXAMPLE_CARD.icon, EXAMPLE_CARD.label, EXAMPLE_CARD.sub]);
  assert.deepEqual(cards.slice(0, 2).map((c) => c.querySelector(".wiz-label")!.textContent), [WIZARD.pc.label, WIZARD.mobile.label]);
  ex.dispatch("click");
  assert.equal(examples, 1);
  // Nothing else on step 1 (no separate button under the cards).
  assert.equal(w.children.length, 2);
  // Without an example action: the two platform cards only.
  assert.equal((saveWizard(null, { pick: () => {} }) as unknown as FakeElement).querySelector(".wiz-choices")!.children.length, 2);
  // CSS: the card rules are not tied to <a>; one equal column per card; the button drops its own weight.
  assert.match(css, /^\.wiz-choice \{ display: flex; flex-direction: column;/m);
  assert.match(css, /^\.wiz-choice:hover \{/m);
  assert.doesNotMatch(css, /a\.wiz-choice|\.wiz-example \{/);
  assert.match(u52, /\.wiz-choices \{ grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax\(0, 1fr\); \}/);
  assert.match(u52, /button\.wiz-choice \{ width: 100%; font-weight: inherit; line-height: inherit; \}/);
});
