// The site's expansion state (src/ui/expansion-state.ts, U28): owned = the save's guess + manual toggles, show-all,
// isVisible, subscribe. In Node there is no localStorage: every write is skipped, the state lives in the module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import {
  inferredState, isVisible, needsOf, noteSave, overrideOf, ownedExpansions, setOverride, setOwned, setShowAll, showAll, subscribe,
} from "../src/ui/expansion-state.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const example = readFileSync(new URL("../../site/data/example-save.txt", import.meta.url), "utf8");

test("no save: nothing owned, expansion content hidden, base content visible", async () => {
  await noteSave(null);
  assert.deepEqual([...ownedExpansions()], []);
  assert.equal(showAll(), false);
  assert.ok(isVisible("enemy", 2), "Moss Golem (base game)");
  assert.ok(!isVisible("quest", 80), "a Frentir quest needs the Frozen Tome");
  assert.ok(!isVisible("class", 9), "the Bard");
  assert.ok(!isVisible("map", 1), "maps are Scribe recipes");
  assert.ok(!isVisible("consumable", 60), "scrolls are Scribe recipes");
  assert.ok(!isVisible("prestige", 3) && isVisible("prestige", 2), "hero tier 3");
  assert.ok(!isVisible("itemAscension", 1) && isVisible("itemAscension", 0));
  assert.deepEqual(needsOf("map", 21), ["Frozen", "Scribe"]);
});

test("the example save proves both; Forget goes back to nothing", async () => {
  await noteSave(example, "Example save");
  assert.deepEqual([...ownedExpansions()].sort(), ["Frozen", "Scribe"]);
  assert.equal(inferredState().source, "Example save");
  assert.ok(isVisible("quest", 80) && isVisible("map", 21) && isVisible("class", 9));
  await noteSave(null);
  assert.deepEqual([...ownedExpansions()], []);
});

test("manual toggles override the guess; back to the guess clears them; show-all reveals everything", async () => {
  await noteSave(null);
  let calls = 0;
  const off = subscribe(() => calls++);
  setOwned("Frozen", true);
  assert.equal(overrideOf("Frozen"), true);
  assert.ok(isVisible("quest", 80) && isVisible("class", 9));
  assert.ok(!isVisible("map", 21), "map 21 also needs Scribe");
  setOwned("Frozen", false); // same as the guess (not owned): the override goes
  assert.equal(overrideOf("Frozen"), null);
  await noteSave(example, "Example save");
  setOwned("Scribe", false); // the save proves it, the visitor says no
  assert.equal(overrideOf("Scribe"), false);
  assert.ok(!isVisible("map", 1) && isVisible("quest", 80));
  setShowAll(true);
  assert.ok(isVisible("map", 1) && isVisible("map", 21));
  setShowAll(false);
  setOverride("Scribe", null);
  assert.ok(isVisible("map", 1));
  assert.ok(calls >= 5, `subscribers told of every change (${calls})`);
  off();
  await noteSave(null);
});
