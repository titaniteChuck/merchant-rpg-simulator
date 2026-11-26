// Battle Simulator and Solver U72: the Solver's order (win rate, then heroes dead, then life left, then the old
// tie-breakers); the opponent panel on three rows (toggle, enemy or map, modifiers) without "?"s, scroll pickers or
// map facts; a catalog map's prefix and suffix (the wiki's lists and effects) sent to the engine; no Clear all; no
// "Front row" / "Back row" / "Opponent" titles. No browser: the order as a pure comparator, the map modifiers on the
// game data, and the pages, the page code and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = await import("../src/sim/api.ts");
const { compareSolutions, solveShortlist } = await import("../src/ui/battle-setup.ts");
const { prefixEffect, suffixEffect, validPrefixes, validSuffixes } = await import("../src/ui/wiki-config.ts");
api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), search = read("web/src/ui/battle-search.ts");
const sim = read("site/battle.html"), solver = read("site/solver.html"), css = read("site/style.css");
/** Code without its comments (the comments name what is gone). */
const code = (src: string) => src.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

const MAP = 22; // Grimal-Frentir Map, level 52
const TITAN = 20; // prefix: enemy HP bonus

// ---------------------------------------------------------------- 1. the Solver's order
type Sol = { name: string; ev: { win: number; heroes: Record<string, { death_rate: number; hp_left_frac: number }> }; score: number; scrolls?: number[] | null };
/** U74: `life` is the life remaining (the standing heroes' average): each hero's HP share, a fall counting 0, is life × (1 − its death rate). */
const sol = (name: string, win: number, dead: number[], life: number, scrolls: number[] | null = null, score = 1000): Sol => ({
  name, ev: { win, heroes: Object.fromEntries(dead.map((d, k) => [String(k), { death_rate: d, hp_left_frac: life * (1 - d) }])) }, score, scrolls,
});
const names = (r: { name: string }[]) => r.map((x) => x.name);

test("compareSolutions: the win rate first (100 % first), whatever deaths, life or scrolls", () => {
  const full = sol("full", 1, [0.5, 0.5], 0.1, [1, 2, 3]), most = sol("most", 0.95, [0, 0], 1, null);
  assert.ok(compareSolutions(full, most) < 0);
  assert.ok(compareSolutions(most, full) > 0);
});

test("compareSolutions: same win rate, the fewest heroes dead on average, then the most life left", () => {
  const nobody = sol("nobody", 1, [0, 0, 0], 0.4), one = sol("one", 1, [0.5, 0.5, 0], 0.99);
  assert.ok(compareSolutions(nobody, one) < 0, "fewer dead beats more life");
  const healthy = sol("healthy", 1, [0, 0], 0.9), hurt = sol("hurt", 1, [0, 0], 0.5);
  assert.ok(compareSolutions(healthy, hurt) < 0);
  // the best run: wins every time, nobody dies, full health
  const best = sol("best", 1, [0, 0, 0], 1);
  const all = [hurt, one, sol("lose", 0.9, [0, 0], 1), healthy, best, nobody];
  assert.deepEqual(names([...all].sort(compareSolutions)), ["best", "healthy", "hurt", "nobody", "one", "lose"]);
});

test("compareSolutions: then the fewest scrolls (none first); a full tie is 0 (the solver's order holds)", () => {
  const a = sol("a", 1, [0], 1, [7]), b = sol("b", 1, [0], 1, null), c = sol("c", 1, [0], 1, [7, 8]);
  assert.deepEqual(names([a, c, b].sort(compareSolutions)), ["b", "a", "c"]);
  assert.equal(compareSolutions(sol("x", 0.8, [0.2], 0.5, [1]), sol("y", 0.8, [0.2], 0.5, [2])), 0);
  // float noise is a tie, not an order
  assert.equal(compareSolutions(sol("x", 0.1 + 0.2, [0], 1), sol("y", 0.3, [0], 1)), 0);
  // an evaluation without heroes: none dead, no life
  assert.equal(compareSolutions({ ev: { win: 1 } }, { ev: { win: 1, heroes: {} } }), 0);
});

test("solveShortlist: the U72 order before the cut to 5; the 25 % window unchanged", () => {
  const res = [
    sol("dead", 1, [1, 0], 0.5, null, 900), sol("best", 1, [0, 0], 1, null, 800), sol("low", 0.8, [0, 0], 1, null, 950),
    sol("worn", 1, [0, 0], 0.3, null, 1000), sol("scroll", 1, [0, 0], 1, [5], 990), sol("weak", 0.5, [0, 0], 1, null, 990),
    sol("zero", 0, [], 0, null, 999),
  ];
  assert.deepEqual(names(solveShortlist(res)), ["best", "scroll", "worn", "dead", "low"]);
  assert.match(fn(search, "partiesResult"), /const shown = solveShortlist\(res\.results\);/);
  assert.match(search, /the highest win rate first, "\s*\+ `then the fewest heroes dead, then the most life left/);
});

// ---------------------------------------------------------------- 2. the opponent panel
test("the panel: three rows (toggle, enemy or map, its modifiers), no \"?\", no scrolls, no map facts", () => {
  const target = fn(page, "renderTarget");
  assert.match(target, /const mods = el\("div", \{ class: "toolbar opp-mods", role: "group", "aria-label": "Modifiers" \}\);/);
  // a quest: the size is the modifiers row
  assert.match(target, /mods\.append\(amount\);/);
  assert.match(target, /\{ class: "opp-controls" \}, q, mods, capNote\(\)\)/);
  // a map: ascension, grade, prefix, suffix; a map of the save carries its own (the row hidden)
  assert.match(target, /mods\.append\(asc, grade, shortPick\(pre\), shortPick\(suf\)\);/);
  assert.match(target, /\{ class: "opp-controls" \}, m, mods, capNote\(\)\)/);
  assert.match(target, /mods\.hidden = own;/);
  assert.doesNotMatch(code(target), /helpTip|sizeNote|amount-note|map-facts|facts|select\.scroll|class: "scroll"|opp-scrolls|SCROLL_IDS/);
  assert.doesNotMatch(code(fn(page, "syncAmount")), /helpTip|note/);
  assert.doesNotMatch(page, /select\.scroll|function roomsFact|amount-note/);
  // the toggle is the first row of the panel on both pages, #target (rows 2 and 3) after it
  for (const html of [sim, solver]) {
    const row = html.slice(html.indexOf('<div class="opp-row">'));
    assert.ok(row.indexOf('id="opp-switch"') < row.indexOf('id="target"'));
  }
  const u72 = css.slice(css.indexOf("/* U72 */"), css.indexOf("/* end U72 */"));
  assert.match(u72, /\.opp-row \{ flex-direction: column; align-items: stretch; gap: 8px; \}/);
  assert.match(u72, /\.opp-row \.opp-controls \{ flex-direction: column;/);
  assert.match(u72, /\.opp-mods > select \{ flex: 0 1 auto; min-width: 0; max-width: 100%; \}/);
  assert.ok(css.lastIndexOf("/* end U72 */") > css.lastIndexOf("/* end U70 */"));
  assert.doesNotMatch(u72.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,6}\b/i, "theme tokens only");
});

test("the Simulator: no Clear all and no \"?\"s in the Simulate panel; the Solver keeps its party \"?\"", () => {
  const panel = sim.slice(sim.indexOf('<div class="run-box"'), sim.indexOf('id="sim-stats"'));
  assert.doesNotMatch(code(panel), /party-tools|party-help|sim-help|sim-bar|Clear all/);
  assert.doesNotMatch(page, /Clear all"|clear-all|function clearAll|clearUndo|SIMULATE_HELP/);
  assert.match(solver, /<h2 id="setup-title">Party<\/h2>[\s\S]*?<span id="party-help"><\/span>/);
});

test("no \"Front row\", \"Back row\" or \"Opponent\" titles; the columns keep their names for screen readers", () => {
  const party = fn(page, "renderParty");
  assert.doesNotMatch(party, /el\("h3"|🛡️ Front row|🏹 Back row/);
  assert.match(party, /el\("div", \{ class: "party-row", role: "group", "aria-label": row === "front" \? "Front row" : "Back row" \}/);
  for (const html of [sim, solver]) {
    assert.doesNotMatch(html, /col-title|👹 Opponent/);
    assert.match(html, /<div id="opp-col" class="opp-col" role="group" aria-label="Opponent">\s*<div id="target-card"><\/div>/);
  }
});

// ---------------------------------------------------------------- 3. a catalog map's prefix and suffix
test("prefix and suffix pickers: the wiki's lists and effects, the suffixes following the ascension", () => {
  assert.match(fn(page, "mapPrefixOptions"), /\["0", "No prefix"\], \.\.\.validPrefixes\("map", id\)\.map\([^)]*\): ModOption => \[String\(p\), `\[\$\{prefixTag\(p\)\}\] · \$\{prefixEffect\("map", id, p\)\}`, prefixTag\(p\)\]\)/);
  assert.match(fn(page, "mapSuffixOptions"), /\["0", "No suffix"\], \.\.\.validSuffixes\("map", id, asc\)/);
  assert.match(fn(page, "mapSuffixOptions"), /suffixEffect\("map", x\)/);
  // a choice the new list doesn't hold goes back to none; nothing to pick, no picker
  const fill = fn(page, "fillMods");
  assert.match(fill, /s\.value = opts\.some\(\(\[v\]\) => v === was\) \? was : "0";/);
  assert.match(fill, /s\.hidden = opts\.length < 2;/);
  // the lists themselves (the wiki's): every prefix on a level-52 map; suffixes grow with the ascension
  assert.ok(validPrefixes("map", MAP).includes(TITAN));
  assert.ok(validSuffixes("map", MAP, 1).length > validSuffixes("map", MAP, 0).length);
  assert.match(prefixEffect("map", MAP, TITAN), /enemy HP \+240/);
  assert.match(suffixEffect("map", 5), /essence and Enemy × ×1\.3/);
  // the picker ids, remembered with the opponent and put back after the ascension
  assert.match(fn(page, "currentOpponent"), /prefix: v\("#map-prefix"\), suffix: v\("#map-suffix"\)/);
  const restore = fn(page, "restoreOpponent");
  assert.ok(restore.indexOf('put("#map-asc"') < restore.indexOf('put("#map-prefix"') && restore.indexOf('put("#map-prefix"') < restore.indexOf('put("#map-suffix"'));
  assert.doesNotMatch(restore, /scroll/);
  // a wiki link's map (no prefix or suffix in it) starts plain, not with an earlier visit's modifiers
  assert.match(fn(page, "takeLinkedOpponent"), /if \(linked\.kind === "map"\) \{\s*delete o\.prefix;\s*delete o\.suffix;\s*\}/);
});

test("the run gets the prefix and suffix: targetOf's MapSpec, which the engine applies", () => {
  const target = fn(page, "targetOf");
  assert.match(target, /prefix: modOf\("#map-prefix"\), suffix: modOf\("#map-suffix"\) \};/);
  assert.match(page, /const modOf = \(sel: string\): number \| undefined => Number\(document\.querySelector<HTMLSelectElement>\(sel\)\?\.value\) \|\| undefined;/);
  // the Simulator's runs use no scrolls; the Solver's, its shown result's (applyScrolls)
  assert.match(target, /const scrolls = shownScrolls\.map\(\(id\) => \(\{ id, prestigeLevel: 0 \}\)\);/);
  assert.match(page, /applyScrolls: \(ids\) => \{\s*shownScrolls = \[\.\.\.ids\];\s*renderPlan\(\);/);
  // the engine: the suffix raises the enemy multiplier, the prefix adds its map stats (Titan: enemy HP), the speed
  // prefixes the walk; the same seed otherwise
  const plain = api.makeMap({ id: MAP, prestigeLevel: 0, grade: 3 }, 7);
  const suffixed = api.makeMap({ id: MAP, prestigeLevel: 0, grade: 3, suffix: 5 }, 7);
  const titan = api.makeMap({ id: MAP, prestigeLevel: 0, grade: 3, prefix: TITAN }, 7);
  assert.ok(suffixed.enemyMod > plain.enemyMod, "suffix: Enemy ×");
  assert.ok((titan.mapStats.hpBns ?? 0) > (plain.mapStats.hpBns ?? 0), "Titan: enemy HP bonus");
  assert.equal(titan.enemyMod, plain.enemyMod);
});

test("Farming keeps its own scroll pickers (not shared with the battle pages)", () => {
  const farming = read("web/src/ui/farming.ts");
  assert.match(farming, /const SCROLL_IDS = \[60, 61, 62, 63, 64, 65, 66, 67, 68, 69\];/);
  assert.match(farming, /farm-scrolls/);
  assert.doesNotMatch(farming, /battle-page/);
});
