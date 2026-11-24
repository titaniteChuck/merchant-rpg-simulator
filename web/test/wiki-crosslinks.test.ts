// U30: the wiki pages link to the Stats and Battle reference sections (statLink / battleLink, sl / bl in section
// bodies). Every link in the sources must name a topic that exists (the anchors of wiki-ref.ts), and the pages the
// roadmap names must keep their links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { BATTLE_TOPICS, STAT_TOPICS } from "../src/ui/wiki-ref.ts";

const UI = new URL("../src/ui/", import.meta.url);
const sources = readdirSync(UI).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(new URL(f, UI), "utf8")] as const);

/** [file, page, topic] of every statLink("…") / sl("…") / battleLink("…") / bl("…") call with a literal topic. */
function links(): [string, "stats" | "battle", string][] {
  const out: [string, "stats" | "battle", string][] = [];
  for (const [f, src] of sources) {
    for (const [, fn, topic] of src.matchAll(/\b(statLink|sl|battleLink|bl)\(\s*"([^"]+)"/g)) {
      out.push([f, fn === "statLink" || fn === "sl" ? "stats" : "battle", topic]);
    }
    // a topic map such as CARD_TOPIC = { hp: "max-hp" }: its values are statLink targets too
    for (const [, body] of src.matchAll(/Record<string, StatTopic> = \{([^}]*)\}/g)) {
      for (const [, topic] of body.matchAll(/:\s*"([^"]+)"/g)) out.push([f, "stats", topic]);
    }
  }
  return out;
}

test("every statLink / battleLink target is a real section", () => {
  const all = links();
  assert.ok(all.length > 40, `found ${all.length} links`);
  for (const [f, page, topic] of all) {
    assert.ok(topic in (page === "stats" ? STAT_TOPICS : BATTLE_TOPICS), `${f} links to missing ${page}/${topic}`);
  }
});

test("the wiki pages link the rules they use (U30)", () => {
  const by = (file: string) => new Set(links().filter(([f]) => f === file).map(([, p, t]) => `${p}/${t}`));
  const expect: Record<string, string[]> = {
    "wiki-enemies.ts": ["stats/hit-chance", "stats/defence", "stats/quest-size", "battle/turn-order", "battle/rotation", "stats/grade", "stats/luck", "stats/map-essence"],
    "wiki.ts": ["stats/item-stats", "stats/sell", "stats/essence", "stats/craft", "stats/map-essence", "stats/ap", "battle/rotation", "battle/effects", "battle/buffs-debuffs", "stats/hero-stats"],
    "wiki-classes.ts": ["stats/hero-stats", "stats/max-hp", "stats/crit"],
  };
  for (const [file, want] of Object.entries(expect)) {
    const got = by(file);
    for (const w of want) assert.ok(got.has(w), `${file} links to ${w}`);
  }
});

test("pages outside the reference pages cite no game code in their help text", () => {
  for (const [f, src] of sources.filter(([f]) => /^wiki-(enemies|classes|skills|help)\.ts$|^wiki\.ts$/.test(f))) {
    // the "?" texts and home lines: string literals handed to the page (comments may name the game code)
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const [lit] of code.matchAll(/"[^"\n]*"|`[^`]*`/g)) assert.doesNotMatch(lit, /\.lua\b|\bobj\.[A-Z]\w*/, `${f}: ${lit}`);
  }
});
