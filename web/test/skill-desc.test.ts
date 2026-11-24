// abilityData.desc (inventory/wikidata.json skills) is outdated for six skills: the wiki shows the corrected English
// (SKILL_DESC_FIX in wiki-data.ts), the game's TextData where it agrees with the combat code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import { SKILL_DESC_FIX, skillDesc } from "../src/ui/wiki-data.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const wiki = JSON.parse(readFileSync(new URL("../../inventory/wikidata.json", import.meta.url), "utf8"));
const en = JSON.parse(readFileSync(new URL("../../inventory/i18n/en.json", import.meta.url), "utf8"));
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

test("the six skills with an outdated abilityData.desc render the corrected text", () => {
  const want: Record<string, RegExp> = {
    "Absorb Atk": /Atk Dmg↓75%.*heal \.75x/,
    "Absorb Matk": /Matk Dmg↓75%.*heal \.75x/,
    "Demon Slash": /1\.8x Atk & 1\.2x Matk/,
    "Disharmony": /Matk↑50%.*Mdef↓60% \(3 turns\)/,
    "Siphon Soul": /1\.5x Matk \(AOE\) Lifesteal 100%/,
    "Sunder": /1\.5x\(Atk\+Acc\).*Def↓40% for 2 Turns/,
  };
  assert.deepEqual(Object.keys(SKILL_DESC_FIX).sort(), Object.keys(want).sort());
  for (const [name, re] of Object.entries(want)) {
    assert.match(skillDesc(name), re, name);
    assert.notEqual(norm(skillDesc(name)), norm(wiki.skills[name] ?? ""), `${name}: not the outdated abilityData text`);
  }
  // where TextData says the same as the code, it is the game's own words
  for (const name of ["Demon Slash", "Disharmony", "Siphon Soul", "Sunder"]) assert.equal(skillDesc(name), norm(en.skills[name].d), name);
});
