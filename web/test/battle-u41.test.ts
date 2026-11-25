// Battle section U41: two pages, the Simulator (battle.html) and the Solver (solver.html), one code (battle-page.ts).
// The menu's sub-entries, the old Solve links sent to the Solver, the Solver's Party and Flow tabs hidden until a
// result's Show, and "Open in Simulator".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentNav, itemsOf, NAV } from "../src/ui/nav.ts";
import { simulatorPartyFrom, solverRedirect, SOLVER_PAGE } from "../src/ui/battle-links.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const head = (html: string) => html.slice(0, html.indexOf("</head>"));

test("menu: Battle has two sub-entries, Simulator and Solver, for the dropdown and the drawer", () => {
  const battle = NAV.find((s) => s.id === "battle")!;
  assert.equal(battle.label, "Battle");
  // U44: no page of its own (its entry only opens the dropdown, like More), so no second row either (nav-u44.test.ts).
  assert.equal(battle.href, undefined);
  assert.deepEqual(itemsOf(battle).map((i) => [i.label, i.href]), [["Simulator", "battle.html"], ["Solver", "solver.html"]]);
  const nav = read("web/src/ui/nav.ts");
  assert.match(nav, /if \(cur\?\.href && cur\.groups\) bar\.after\(buildSubnav\(cur\)\)/);
  for (const s of NAV.filter((x) => x.id === "save" || x.id === "wiki")) assert.ok(s.href && s.groups, s.id);
});

test("menu: each Battle page marks its own sub-entry", () => {
  assert.deepEqual(currentNav("/battle.html", ""), { section: "battle", href: "battle.html" });
  assert.deepEqual(currentNav("/merchant-rpg-simulator/solver.html", ""), { section: "battle", href: "solver.html" });
  assert.deepEqual(currentNav("/battle.html", "#anything"), { section: "battle", href: "battle.html" });
  // The section's own top entry is marked as the section, not as a second current page.
  assert.match(read("web/src/ui/nav.ts"), /if \(top && sec === section && subs\) a\.setAttribute\("aria-current", "true"\)/);
});

test("old links to the Simulator's Solve mode go to the Solver page", () => {
  for (const [search, hash] of [["?mode=solve", ""], ["?mode=party", ""], ["?mode=Solver", ""], ["?solve", ""], ["?solver=1", ""],
    ["", "#solve"], ["", "#solver"], ["", "#/solve"], ["", "#mode=solve"], ["?x=1&mode=solve", "#top"]]) {
    assert.equal(solverRedirect(search, hash), SOLVER_PAGE, `${search}${hash}`);
  }
  for (const [search, hash] of [["", ""], ["?mode=simulate", ""], ["?x=1", "#top"], ["", "#simulate"], ["", "#solved-it"]]) {
    assert.equal(solverRedirect(search, hash), null, `${search}${hash}`);
  }
  // The Simulator's entry redirects before it builds anything.
  const entry = read("web/src/ui/battle.ts");
  assert.match(entry, /const solver = solverRedirect\(location\.search, location\.hash\);\s*if \(solver\) location\.replace\(solver\);\s*else initBattlePage\("simulate"\);/);
});

test("two pages, one code: each its own entry bundle, theme.js in the head, the Simulator without Solve", () => {
  const sim = read("site/battle.html"), solver = read("site/solver.html");
  assert.match(head(sim), /<script type="module" src="js\/battle\.js"><\/script>/);
  assert.match(head(solver), /<script type="module" src="js\/solver\.js"><\/script>/);
  for (const html of [sim, solver]) assert.match(head(html), /<script src="theme\.js"><\/script>/);
  assert.match(read("web/scripts/assemble-site.sh"), /src\/ui\/battle\.ts src\/ui\/solver\.ts/);
  assert.match(read("web/src/ui/solver.ts"), /initBattlePage\("solve"\)/);
  // No "What do you want to do?" chooser, no solver panel on the Simulator.
  assert.doesNotMatch(sim, /What do you want to do|id="modes"|id="search-panel"|id="search-results"/);
  assert.match(sim, /id="run"/);
  assert.doesNotMatch(solver, /id="run"|id="runs"/);
});

test("Solver: the spoiler guard first, then the opponent and the options, Results, and no party panel until Show", () => {
  const html = read("site/solver.html");
  const at = (s: string) => html.indexOf(s);
  assert.ok(at('id="search-panel"') > 0 && at('id="search-panel"') < at('id="target"') && at('id="target"') < at('id="search-form"'));
  assert.ok(at('id="search-form"') < at('id="search-results"') && at('id="search-results"') < at('id="party-box"'));
  // Step 3 is hidden in the HTML and holds both tabs and the party: nothing of it shows before a Show.
  assert.match(html, /<section id="party-box" hidden>/);
  const box = html.slice(at('id="party-box"'));
  for (const id of ["tab-party", "tab-flow2", "tab-flow3", "flow-panel", "setup-grid", "party", "open-sim"]) assert.ok(box.includes(`id="${id}"`), id);
  assert.equal(html.split('id="party"').length, 2, "one party panel, inside step 3");
  // Only a result's Show reveals it (onShow → revealParty); a new save or Forget hides it again.
  const page = read("web/src/ui/battle-page.ts");
  assert.deepEqual(page.match(/revealParty\b/g)?.length, 3, "declared, documented once, wired once");
  assert.match(page, /onShow: revealParty,/);
  assert.equal(page.match(/box\.hidden = false/g)?.length, 1);
  assert.match(page, /if \(solving\(\)\) hideParty\(\);/);
  // The results' button is "Show" (was "Load"), and it calls onShow after the party is applied.
  const search = read("web/src/ui/battle-search.ts");
  assert.match(search, /"✓ Shown" : "Show"/);
  assert.doesNotMatch(search, /"✓ Loaded"|: "Load"\)|`Load setup/);
  const show = search.slice(search.indexOf("const showSetup"), search.indexOf("const paint"));
  assert.ok(show.indexOf("ctx.applyParty") < show.indexOf("ctx.onShow?.()"));
  // The spoiler guard hides the opponent and options too, not only the later steps (U42: they are a section of their own).
  assert.match(read("site/style.css"), /#setup\.solve-guarded > section:not\(:first-child\) \{ display: none; \}/);
});

test("Solver: its party is its own; Open in Simulator copies the shown party over", () => {
  const page = read("web/src/ui/battle-page.ts");
  // Not remembered: the Simulator's saved party is never written by the Solver's edits.
  assert.match(page, /function persistParty\(\): void \{\n {2}if \(solving\(\)\) return;/);
  assert.match(page, /function restoreParty\(heroes: number\): boolean \{\n {2}if \(solving\(\)\) return false;/);
  const solver = { slots: { front0: 2, front1: null, back0: 5 }, skills: { 2: { attackList: ["Basic", "Basic", "Basic", "Basic", "Basic"], passive: "None" } },
    excluded: { back0: true } };
  const before = { slots: { front0: 1 }, skills: { 1: { attackList: ["A", "B", "C", "D", "E"], passive: "P" }, 2: { attackList: ["X", "X", "X", "X", "X"], passive: "Q" } },
    excluded: {} };
  const out = simulatorPartyFrom(solver, before);
  assert.deepEqual(out.slots, solver.slots);
  assert.deepEqual(out.excluded, { back0: true });
  assert.equal("locked" in out, false, "U50: no locks");
  assert.deepEqual(out.skills[1], before.skills[1], "the Simulator's other edited rotations stay");
  assert.deepEqual(out.skills[2], solver.skills[2], "the shown heroes' rotations win");
  assert.deepEqual(simulatorPartyFrom(solver, null).skills, solver.skills);
  // The copy is not shared state: changing the result changes neither input.
  out.slots.front0 = 9;
  assert.equal(solver.slots.front0, 2);
});
