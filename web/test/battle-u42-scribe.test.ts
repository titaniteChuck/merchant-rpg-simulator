// Battle section U42 add-on: with Scribe hidden (not owned, "Show expansion content" off), the Simulator and the Solver
// hide everything of maps: no Quest / Map toggle (quests only), no map pickers or "Include scrolls", no "– Map" enemy
// groups; a remembered map run falls back to a quest; the expansion menu's changes are followed at runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { enemyGroups, isFightable } from "../src/ui/battle-setup.ts";
import { isHidden, isVisible, noteSave, setOwned, setShowAll } from "../src/ui/expansion-state.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const fightable = () => Object.keys(G.questData).map(Number).filter(isFightable);

test("Scribe hidden is the wiki's rule: not owned and expansion content not shown", async () => {
  await noteSave(null);
  setShowAll(false);
  setOwned("Scribe", false);
  assert.equal(isHidden("Scribe"), true);
  assert.equal(isVisible("map", 1), false, "the same rule hides the maps in the wiki");
  setShowAll(true);
  assert.equal(isHidden("Scribe"), false, "Show expansion content reveals it");
  setShowAll(false);
  setOwned("Scribe", true);
  assert.equal(isHidden("Scribe"), false, "owned");
  setOwned("Scribe", false);
  assert.equal(isHidden("Scribe"), true);
});

test("enemy picker with Scribe hidden: no \"– Map\" groups, everything else unchanged", () => {
  const all = enemyGroups(fightable()), noMaps = enemyGroups(fightable(), false);
  assert.ok(all.some((g) => g.group === 2), "with maps there are Map groups");
  assert.ok(noMaps.every((g) => g.group !== 2 && !g.label.endsWith("– Map")));
  assert.deepEqual(noMaps, all.filter((g) => g.group !== 2));
});

test("both pages: the toggle, the map pickers and Include scrolls follow Scribe; a map run falls back to a quest", () => {
  // One code for both pages (battle-page.ts), and both pages have the Quest / Map switch it hides.
  for (const page of ["site/battle.html", "site/solver.html"]) {
    const html = read(page);
    assert.match(html, /id="opp-switch"/, page);
    assert.match(html, /name="opp" value="map"/, page);
  }
  const src = read("web/src/ui/battle-page.ts");
  assert.match(src, /const mapsHidden = \(\): boolean => isHidden\("Scribe"\);/);
  // No map can be picked with Scribe hidden (the save's own maps included): the Map option and the whole switch go.
  assert.match(src, /const mapsAvailable = \(\): boolean => !mapsHidden\(\) && mapOptions\(state\.sv\)/);
  const sync = src.slice(src.indexOf("function syncOppKinds"), src.indexOf("// ---------------------------------------------------------------- party"));
  assert.match(sync, /const maps = mapsAvailable\(\);/);
  assert.match(sync, /if \(!ok && r\.checked\) \{\s*r\.checked = false;/, "a checked map run is unchecked");
  assert.match(sync, /\$<HTMLInputElement>\(`input\[name=opp\]\[value=\$\{left\[0\]\}\]`\)\.checked = true;/, "the quest is checked instead");
  assert.match(sync, /\$\("#opp-switch"\)\.hidden = left\.length < 2;/, "one kind left: no toggle at all");
  // The remembered kind is put back first, then checked against Scribe (onExpansions), on the first build and on
  // every expansion menu change.
  const onX = src.slice(src.indexOf("function onExpansions"), src.indexOf("function restoreOpponent"));
  assert.ok(onX.indexOf("r.checked = true") < onX.indexOf("syncOppKinds()"));
  assert.match(src, /subscribe\(onExpansions\);/);
  // The enemy picker leaves the map groups out.
  assert.match(src, /enemyGroups\(ids, !mapsHidden\(\)\)/);
});

test("Solver with Scribe hidden: no Include scrolls option", () => {
  const search = read("web/src/ui/battle-search.ts");
  assert.match(search, /const scrollOpt = isHidden\("Scribe"\) && !isMap \? \[\] : \[scLabel\];/);
  assert.match(search, /\.\.\.capNote, \.\.\.scrollOpt,/);
  assert.doesNotMatch(search, /\.\.\.capNote, scLabel/);
});
