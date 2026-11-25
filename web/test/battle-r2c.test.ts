// Battle Simulator and Solver, mobile presentation review R2 (batch R2-C): F20, F23–F26, F28–F36. Explanation
// sentences become "?" tooltips, the Results wait for the first run, compact result tiles with no lone tile, a plain
// per-hero table, the Solver's one-row sizes, Show first, folded empty slots, one status line and a "rough" that says
// what it means; light-mode class badges at AA contrast. Page markup and code are read as text; no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasOrphan, tileColumns } from "../src/ui/battle-results.ts";
import { ROUGH_HELP, sizeHelp, solveStatus, type SolveRun } from "../src/ui/battle-setup.ts";
import { rulesText } from "../src/ui/battle-rules.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const sim = read("site/battle.html"), solver = read("site/solver.html");
const page = read("web/src/ui/battle-page.ts"), search = read("web/src/ui/battle-search.ts"), css = read("site/style.css");
const r2c = css.slice(css.indexOf("/* r2-c */"), css.indexOf("/* end r2-c */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

test("one marked r2-c block of CSS", () => {
  assert.equal(css.split("/* r2-c */").length, 2);
  assert.equal(css.split("/* end r2-c */").length, 2);
  assert.ok(r2c.length > 200);
});

test("F20: the Simulate sentence is a \"?\", and the Results wait for the first run", () => {
  assert.doesNotMatch(sim, /run-hint|Set them up in step 3/);
  assert.match(sim, /<h2><span class="step" aria-hidden="true"><\/span> Simulate <span id="sim-help"><\/span><\/h2>/);
  assert.match(sim, /<section id="results-box" class="b3-results" hidden>/);
  assert.doesNotMatch(sim, /results-empty|No run yet/);
  // The steps are numbered by CSS: a hidden section takes no number (no "1, 3").
  assert.doesNotMatch(sim, /class="step"[^>]*>\d/);
  assert.match(r2c, /#setup\.b3-steps > section:not\(\[hidden\]\) > h2 > \.step::before \{ counter-increment: b3-step; content: counter\(b3-step\); \}/);
  for (const html of [sim, solver]) assert.match(html, /<div id="setup" class="b3-steps" hidden>/);
  assert.match(page, /helpTip\(SIMULATE_HELP, "Simulate"\)/);
  // Shown when a run starts (before its checks, so an error shows too); hidden again for a new or forgotten save.
  const run = fn(page, "run(): void");
  assert.ok(run.indexOf("showResultsBox(true)") >= 0 && run.indexOf("showResultsBox(true)") < run.indexOf("req = request()"));
  assert.equal(page.match(/showResultsBox\(false\);/g)?.length, 2);
});

test("F20: Levelling and Farming write their own step numbers, so the CSS counter leaves them alone", () => {
  for (const name of ["levelling", "farming"]) {
    const html = read(`site/${name}.html`);
    assert.match(html, /<div id="setup" hidden>/, name);
    assert.doesNotMatch(html, /b3-steps/, name);
    assert.match(html, /<span class="step">\d<\/span>/, name);
  }
  // Every rule that writes a counter into a step badge is scoped to .b3-steps.
  for (const rule of css.match(/[^{}]*\.step::before\s*\{[^}]*counter\([^}]*\}/g) ?? []) assert.match(rule, /#setup\.b3-steps /, rule);
  assert.doesNotMatch(css, /(^|[\s,}])#setup \{ counter-reset/);
});

test("F23 / F36: no inner Party heading; the rule and the Solver's sentence are the \"?\" beside the tabs", () => {
  for (const html of [sim, solver]) {
    assert.doesNotMatch(html, /<h3 class="col-title">👥 Party<\/h3>/);
    const row = html.slice(html.indexOf('<div class="b3-tab-row">'), html.indexOf('<div id="flow-panel"'));
    assert.match(row, /role="tablist"/);
    assert.match(row, /<span id="party-help"><\/span>/);
  }
  assert.doesNotMatch(page, /party-note|party-rules/);
  const help = fn(page, "partyHelp");
  assert.match(help, /The setup you showed\. Edit it freely; 🔒 keeps a hero in the next solve\./);
  assert.match(help, /rulesText\(rules\)/);
  // Front 2 stays required on a party quest: the rule is still said, in the "?".
  assert.match(rulesText({ kind: "party", maxSize: 5, required: [{ row: "front", i: 1 }] }), /Front 2 always filled, at most 5 heroes/);
});

test("F24: compact tiles: no sublines, no \"How these are counted\" line, no time in the run line", () => {
  assert.doesNotMatch(page, /How these are counted|qxp-refs|xpRow/);
  // Every results tile is a resultTile (its explanation in the "?") or a plain tile with no hint (the win rate).
  const results = page.slice(page.indexOf("function questXpTiles"), page.indexOf("// ---------------------------------------------------------------- page"));
  for (const m of results.matchAll(/\btile\("([^"]+)", [^,]+, ([^,]+),/g)) assert.equal(m[2].trim(), "undefined", m[1]);
  assert.match(results, /resultTile\("XP per hero"[\s\S]*?\[statLink\("xp", "XP"\)\]\)/, "the Stats link in the \"?\"");
  // The run line: "200 fights", the milliseconds in its tooltip.
  assert.match(page, /title: `Simulated in \$\{fmt\.format\(ms\)\} ms\./);
  assert.doesNotMatch(page, /fights · \$\{fmt\.format\(ms\)\} ms/);
});

test("F24: the details grids leave no tile alone on a row (phone and wide)", () => {
  // The grids: the summary (2), quest details (3 without XP, 6), map details (6 without XP, 9).
  for (const n of [2, 3, 6, 9]) {
    const c = tileColumns(n);
    assert.ok(!hasOrphan(n, c.phone), `${n} on a phone`);
    assert.ok(!hasOrphan(n, c.wide), `${n} wide`);
    assert.ok(c.phone <= 3, `${n}: at most 3 columns on a phone`);
  }
  assert.deepEqual(tileColumns(9), { phone: 3, wide: 3 });
  assert.deepEqual(tileColumns(6), { phone: 3, wide: 6 });
  assert.equal(hasOrphan(7, 3), true);
  assert.equal(hasOrphan(3, 3), false);
  assert.match(r2c, /#results \.tiles\.result-tiles \{ grid-template-columns: repeat\(var\(--cols-wide, 3\)/);
  assert.match(r2c, /@media \(max-width: 600px\) \{\s*#results \.tiles\.result-tiles \{ grid-template-columns: repeat\(var\(--cols-phone, 3\)/);
  // One grid per result: the quest's XP tiles and the map's essence join the outcome tiles.
  assert.equal(page.match(/tiles\(\{ class: "result-tiles" \}/g)?.length, 2);
  assert.match(page, /\.\.\.questXpTiles\(ev, ctx\),\s*\),/);
});

test("F25 / F26: the per-hero table: no Slot column, a plain name with its slot under it and a class bar", () => {
  const table = fn(page, "heroTable");
  assert.doesNotMatch(table, /key: "slot", label: "Slot"/);
  assert.doesNotMatch(table, /pill\(String\(r\.name\)\)/);
  assert.match(table, /class: `hero-cell cls-\$\{r\.cls\}`/);
  assert.match(table, /el\("span", \{ class: "hero-cell-sub" \}, String\(r\.slot\)\)/);
  assert.match(r2c, /\.hero-cell \{[^}]*border-left: 3px solid var\(--c/);
});

test("F28: the flow's note is in its \"?\"; no heading repeating the tab", () => {
  for (const html of [sim, solver]) {
    assert.doesNotMatch(html, /The fight, turn by turn/);
    assert.match(html, /<div class="flow-head"><div id="flow-opp" class="flow-opp"><\/div><span id="plan-help"><\/span><\/div>/);
  }
  assert.doesNotMatch(page, /flow-note/);
  assert.match(page, /helpTip\(\[\.\.\.\(trace \? \[FLOW_NOTE\] : \[\]\), planNote\(t\)\], "the flow"\)/);
  assert.match(page, /helpTip\(\[MAP_FLOW_NOTE, planNote\(/);
});

test("F29: the room bar is a scroll row with edge fades", () => {
  assert.match(page, /class: "room-bar scroll-row"/);
  assert.match(page, /edgeFades\(bar\);/);
  const fades = fn(page, "edgeFades");
  assert.match(fades, /classList\.toggle\("fade-start"/);
  assert.match(fades, /classList\.toggle\("fade-end"/);
  assert.match(r2c, /\.room-bar\.fade-end \{[^}]*mask-image/);
  assert.match(r2c, /\.room-bar\.fade-start\.fade-end \{/);
});

test("F30: light-mode class badges reach AA (4.5:1) on the card", () => {
  const light = css.slice(css.indexOf(':root[data-theme="light"] {'), css.indexOf("}", css.indexOf(':root[data-theme="light"] {')));
  const token = (name: string) => light.match(new RegExp(`--${name}: ([^;]+);`))![1].trim();
  // a11y review F04: the light ink moved from the hero card and solver pills to every pill (`a11y` block, --pill-ink)
  const a11y = css.slice(css.indexOf("/* a11y */"), css.indexOf("/* end a11y */"));
  const ink = Number(a11y.match(/:root\[data-theme="light"\] \{ --pill-ink: (\d+)%; --pill-base: var\(--card\); \}/)![1]) / 100;
  const tint = parseFloat(token("tint")) / 100;
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a: number[], b: number[], p: number) => a.map((x, i) => x * p + b[i] * (1 - p));
  const lin = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const classes = [...css.matchAll(/^\.cls-(\d) \{ --c: (#[0-9a-f]{6}); \}/gm)];
  assert.equal(classes.length, 9);
  // Every class colour, and the orange of "required" / "rough", as text (ink) on its tint over the card.
  for (const [, n, c] of [...classes, ["orange", "orange", css.match(/\.t-orange \{ --c: (#[0-9a-f]{6}); \}/)![1]]]) {
    for (const card of [token("card"), token("card-2")]) {
      const r = ratio(mix(hex(c), hex(token("fg")), ink), mix(hex(c), hex(card), tint));
      assert.ok(r >= 4.5, `class ${n} on ${card}: ${r.toFixed(2)}`);
    }
  }
});

test("F31: Solver sizes on one row, the limit in their \"?\", scrolls only for a map run, sentence-case labels", () => {
  assert.doesNotMatch(search, /field\("smallest party"|field\("largest party"|time budget \(s\)|map runs only|capNote/);
  assert.match(search, /el\("span", \{ class: "muted small" \}, "Party"\), minN, el\("span", \{ class: "muted", "aria-hidden": "true" \}, "–"\), maxN,/);
  assert.match(search, /helpTip\(sizeHelp\(cap\), "the party size"\)/);
  assert.equal(sizeHelp(6).length, 1);
  assert.match(sizeHelp(5)[1], /^This quest takes at most 5 heroes\.$/);
  assert.match(sizeHelp(1)[1], /solo quest: one hero/i);
});

test("F32: Show is the first column (and a row tap); no Heroes, # or Lowest enemy HP columns", () => {
  assert.match(search, /const head = \["", "Party", \.\.\.\(isMap \? \["Scrolls"\] : \[\]\), "Win", isMap \? "Grade" : "Turns", \.\.\.\(isMap \? \["Progress"\] : \[\]\)\];/);
  assert.doesNotMatch(search, /"Heroes"|"Lowest enemy HP"|"#"/);
  assert.match(search, /el\("td", \{ class: "solver-show" \}, b\), el\("td", \{\}, partyCell\(c\)\)/);
  assert.match(search, /if \(!\(e\.target as Element\)\.closest\("a, button, summary"\)\) b\.click\(\);/);
  // The lowest enemy HP: in the win cell's tooltip, and under the rate when the setup can lose.
  assert.match(search, /title: `Lowest enemy HP: \$\{pct\(low\)\} on average/);
  assert.match(search, /low !== null && ev\.win < 1 \? \[el\("span", \{ class: "solver-sub" \}/);
});

test("F33: after a Show the empty slots fold into one line, and every Show scrolls to the party", () => {
  assert.match(page, /`\$\{n\} empty \$\{row\} slot\$\{n === 1 \? "" : "s"\}`/);
  const party = fn(page, "renderParty");
  // Solver only (`picks`), never the required slot (Front 2 on a party quest stays a card).
  assert.match(party, /const empty = picks \? \[0, 1, 2\]\.filter\(\(i\) => isEmptySlot\(row, i\) && !rules\.required\.some/);
  const reveal = fn(page, "revealParty");
  assert.doesNotMatch(reveal, /if \(!was\) return;/);
  assert.match(reveal, /box\.scrollIntoView\(/);
});

const run = (o: Partial<SolveRun> = {}): SolveRun => ({ wins: 3, listed: 5, found: 8, tried: 292, ms: 5000, budgetMs: 30000, stopped: false, cancelled: false, map: false, ...o });

test("F34: one status line; a spent time budget is not a failure, a Cancel says so", () => {
  const done = solveStatus(run());
  assert.match(done.line, /^3 setups ≥ 90 % · 5[.,]0 s$/);
  assert.match(done.help.join(" "), /complete after 5[.,]0 s/);
  assert.match(done.help.join(" "), /292 evaluations; 3 weaker setups not listed/);
  const budget = solveStatus(run({ stopped: true, ms: 30000 }));
  assert.match(budget.line, /^3 setups ≥ 90 % · 30[.,]0 s$/);
  assert.doesNotMatch(budget.line + budget.help.join(" "), /stopped|early|cancel|fail/i);
  assert.match(budget.help.join(" "), /used its whole time budget \(30 s\)/);
  const cancel = solveStatus(run({ stopped: true, cancelled: true, ms: 3200, wins: 0 }));
  assert.match(cancel.line, /^No setup ≥ 90 % yet · cancelled at 3[.,]2 s$/);
  assert.match(cancel.help[0], /closest ones are listed/);
  assert.equal(solveStatus(run({ wins: 1 })).line.startsWith("1 setup ≥"), true);
  assert.match(solveStatus(run({ map: true })).help[0], /of the runs/);
  // The page: one line with its "?", no separate stopped / evaluations / searched-in lines.
  assert.doesNotMatch(search, /Stopped early|Searched in|is shown in the Party and Flow tabs below/);
  assert.match(search, /el\("p", \{ class: "small solve-summary", role: "status" \}, s\.line, " ", helpTip\(s\.help, "these results"\)\)/);
});

test("F35: the row icon is inline with its first chip; \"rough\" has a \"?\" that says what it means", () => {
  assert.match(search, /el\("span", \{ class: "solver-lead" \},\s*el\("span", \{ class: "row-ico", title: what/);
  assert.match(search, /helpTip\(ROUGH_HELP, "rough setups"\)/);
  assert.match(ROUGH_HELP, /not tuned/);
  assert.match(ROUGH_HELP, /sturdiest heroes in front/);
  assert.match(ROUGH_HELP, /time ran out/);
  assert.match(r2c, /\.solver-lead \{[^}]*white-space: nowrap/);
});

test("kept: the E25 order, the AP limit toast and the Scribe hiding", () => {
  assert.match(search, /const shown = solveShortlist\(res\.results\);/);
  assert.match(page, /toast\(apRefusal\(/);
  assert.match(page, /const mapsHidden = \(\): boolean => isHidden\("Scribe"\);/);
});
