// R1-B2 (live-site review R1): craft times under a minute, sell values against the game's rule, rarity 10 / 11 chips,
// unused skills, bush drops on the Battle page, the Scribe badge, hidden-page wording per source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { sellValue } from "../src/tools/engine.ts";
import { notOwnedSource, notOwnedWhy } from "../src/ui/expansion-why.ts";
import { setOverride } from "../src/ui/expansion-state.ts";
import { BATTLE_SECTIONS } from "../src/ui/wiki-battle.ts";
import { duration } from "../src/ui/dom.ts";
import { enemyDrops, items } from "../src/ui/wiki-data.ts";
import { RARITY_COLOURS, RARITY_SAME_COLOUR, rarityTip, sellRange, sellTip } from "../src/ui/wiki-items.ts";
import { isHeroOnlySkill, isUnusedSkill } from "../src/ui/wiki-skills.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const idOf = (type: string, name: string) => items(type).find(([, it]) => it.name === name)![0];

test("F07: durations under a minute are in seconds, never 0 min", () => {
  assert.equal(duration(15), "15 s");
  assert.equal(duration(0.4), "0 s");
  assert.equal(duration(60), "1 min");
  assert.equal(duration(90), "1 min 30 s");
  assert.equal(duration(599), "9 min 59 s");
  assert.equal(duration(720), "12 min");
  assert.equal(duration(3599), "1 h");
  assert.equal(duration(7020), "1 h 57 min");
  assert.equal(duration(90000), "1 d 1 h");
  const potion = G.itemData.consumable[idOf("consumable", "Minor Potion")];
  assert.equal(duration(potion.runTime), "15 s");
});

test("F43: a stackable sells at its data pair's rounded average, × 2 × ascension (obj.Item getSellValue)", () => {
  const id = idOf("consumable", "Minor Potion");
  assert.deepEqual(sellRange("consumable", id), [15, 20]);
  assert.deepEqual(sellRange("consumable", id, 1), [30, 40]);
  assert.deepEqual(sellRange("consumable", id, 2), [60, 80]);
  assert.deepEqual([0, 1, 2].map((a) => sellValue("consumable", id, a)), [18, 35, 70]);
  assert.match(sellTip("consumable", id), /^15–20 g in the game's data/);
  assert.equal(sellRange("equipment", 1), null, "equipment has one value, no pair");
  // every stackable's shown value is the rounded average of its pair (Lua round: floor(x + 0.5))
  for (const t of ["material", "consumable"]) {
    for (const [iid, it] of items(t)) {
      const r = sellRange(t, iid);
      if (!r || !it.sell) continue;
      assert.equal(sellValue(t, iid, 0), Math.floor((r[0] + r[1]) / 2 + 0.5), `${t} ${it.name}`);
    }
  }
});

test("F39: rarity 10 and 11 say they use the colour of rarity 3 and 4", () => {
  for (const [r, same] of Object.entries(RARITY_SAME_COLOUR)) assert.equal(RARITY_COLOURS[Number(r)], RARITY_COLOURS[same]);
  const essence = G.itemData.material[idOf("material", "Forest Essence")];
  assert.equal(essence.rarity, 10);
  assert.match(rarityTip(10), /Rarity 10: the game draws it in the colour of Rare \(rarity 3\)/);
  assert.doesNotMatch(rarityTip(3), /colour of rarity/);
});

test("F33: unused skills are the ones no class learns and no enemy plays", () => {
  assert.ok(isUnusedSkill("Absorb All"));
  assert.ok(!isUnusedSkill("Slash"));
  assert.ok(!isUnusedSkill("Hellfire"), "an enemy skill");
  assert.ok(isHeroOnlySkill("Taunt"));
  assert.ok(!isHeroOnlySkill("Hellfire"));
  const unused = Object.keys(G.abilityData).filter(isUnusedSkill);
  assert.ok(unused.length > 20 && unused.length < 80, `${unused.length} unused`);
});

test("F44, F25: the Battle page names the bushes' real drops and uses the Scribe badge", () => {
  const html = BATTLE_SECTIONS[0].html();
  assert.doesNotMatch(html, /<b>leaves|<b>stones|ref-kind-tag/);
  assert.ok(html.includes("<b>herbs</b> (a moss and a root every win)"));
  assert.ok(html.includes("<b>crystals and gems</b> (plus runes from their loot rolls)"));
  assert.match(html, /data-xp-badge="Scribe"/);
  // the data agrees: a gathering quest's every-win drops are herbs, a Treasure Bush's a crystal and a gem
  const sub = (id: number) => G.itemData.material[id]?.subType;
  assert.deepEqual(enemyDrops(1, false).fixed.map(([m]) => sub(m)), ["herb", "herb"]);
  assert.deepEqual(enemyDrops(99, false).fixed.map(([m]) => sub(m)).sort(), ["crystal", "gem"]);
});

test("F31: why an expansion counts as not owned, per source", () => {
  setOverride("Scribe", null);
  assert.equal(notOwnedSource("Scribe"), "no-save");
  assert.equal(notOwnedWhy(["Scribe"]), "(no save loaded)");
  setOverride("Scribe", false);
  assert.equal(notOwnedWhy(["Scribe"]), "(you set it to not owned)");
  setOverride("Frozen", null);
  assert.equal(notOwnedWhy(["Frozen", "Scribe"]), "(no save loaded; you set it to not owned)");
  setOverride("Scribe", null);
});
