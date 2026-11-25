// U53: a speed prefix cuts a map's base time on its wiki page (Quick +4, Swift +8: the run's walks × (1 − speed / 100),
// obj.combat.Campaign / questService.determineMapWalkTime), and "Fight in simulator" on the map and enemy pages opens
// the Simulator on that opponent (battle-links simulatorHref / linkedOpponent, taken by battle-page as its remembered
// opponent), hidden for what the visitor's expansions hide and for map runs without Scribe.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const api = await import("../src/sim/api.ts");
const { G } = await import("../src/sim/data.ts");
const { mapBaseTime, mapView, NO_CONFIG } = await import("../src/ui/wiki-config.ts");
const { linkedOpponent, simulatorHref, withoutOpponentQuery } = await import("../src/ui/battle-links.ts");
const { enemyFightTarget, fightButton, mapFightTarget } = await import("../src/ui/wiki-enemies.ts");
const { needsOf, noteSave, setOwned, setShowAll } = await import("../src/ui/expansion-state.ts");
const { isTreasureBush, regionOf } = await import("../src/ui/wiki-data.ts");
api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const QUICK = 33, SWIFT = 34; // data.PrefixData: mapStats speed 4 and 8
const MAP = 22; // Grimal-Frentir Map, baseMapTime 6300 s (105 min)

test("speed prefix: the base time is the walk time × (1 − speed / 100), not scaled by the map's tier", () => {
  assert.equal(G.prefixList[QUICK].mapStats.speed, 4);
  assert.equal(G.prefixList[SWIFT].mapStats.speed, 8);
  assert.equal(G.itemData.map[MAP].baseMapTime, 6300);
  assert.equal(mapView(MAP, NO_CONFIG)!.baseTime, 6300, "plain: the data's time");
  const swift = mapView(MAP, { asc: 0, prefix: SWIFT, suffix: 0 })!;
  assert.equal(swift.prefixStats.speed, 8);
  assert.equal(swift.baseTime, 5796); // 6300 × 0.92
  assert.equal(mapView(MAP, { asc: 1, prefix: QUICK, suffix: 5 })!.baseTime, 6048); // 6300 × 0.96: asc and suffix change nothing
  assert.equal(mapView(1, { asc: 0, prefix: QUICK, suffix: 0 })!.baseTime, 864); // 900 × 0.96
  // the game's cap: 75 % at most
  assert.equal(mapBaseTime(1000, 90), 250);
  assert.equal(mapBaseTime(0, 8), null);
  // a prefix without speed keeps the time
  assert.equal(mapView(MAP, { asc: 0, prefix: 20, suffix: 0 })!.baseTime, 6300);
});

test("map page: the Base time fact shows the time with the speed, no \"base\" tag when the engine built the map", () => {
  const src = read("web/src/ui/wiki.ts");
  assert.match(src, /\["Base time", m\.baseMapTime \? baseTimeFact\(m\.baseMapTime, speed, view\?\.baseTime \?\? null\)/);
  assert.doesNotMatch(src, /Before the prefix's speed \+\$\{speed\}, which shortens/);
});

test("simulator links: build and parse", () => {
  assert.equal(simulatorHref({ quest: 12 }), "battle.html?quest=12");
  assert.equal(simulatorHref({ quest: 12, rare: true }), "battle.html?quest=12&rare=1");
  assert.equal(simulatorHref({ map: 22 }), "battle.html?map=22");
  assert.equal(simulatorHref({ map: 22, asc: 1 }), "battle.html?map=22&asc=1");
  assert.deepEqual(linkedOpponent("?quest=12"), { kind: "quest", quest: "12", rare: false });
  assert.deepEqual(linkedOpponent("quest=12&rare=1"), { kind: "quest", quest: "12", rare: true });
  // a map run: the catalog option at the ascension, grade C (the wiki's figures)
  assert.deepEqual(linkedOpponent("?map=22&asc=1"), { kind: "map", map: "cat:22", asc: "1", grade: "3" });
  assert.deepEqual(linkedOpponent("?map=22"), { kind: "map", map: "cat:22", asc: "0", grade: "3" });
  assert.deepEqual(linkedOpponent("?map=22&asc=7"), { kind: "map", map: "cat:22", asc: "0", grade: "3" });
  for (const bad of ["", "?x=1", "?quest=abc", "?quest=0", "?quest=-3", "?map=1.5"]) assert.equal(linkedOpponent(bad), null, bad);
  // round trip
  for (const t of [{ quest: 7 }, { quest: 7, rare: true }, { map: 3 }, { map: 3, asc: 1 }] as const) {
    const o = linkedOpponent(simulatorHref(t).split("?")[1])!;
    if ("quest" in t) assert.deepEqual([o.kind, o.quest, o.rare], ["quest", String(t.quest), !!t.rare]);
    else assert.deepEqual([o.kind, o.map, o.asc], ["map", `cat:${t.map}`, String(t.asc ?? 0)]);
  }
  assert.equal(withoutOpponentQuery("/battle.html", "?map=22&asc=1", ""), "/battle.html");
  assert.equal(withoutOpponentQuery("/battle.html", "?quest=5&rare=1&x=2", "#flow"), "/battle.html?x=2#flow");
});

test("Simulator intake: the link's opponent becomes the remembered one before the page builds, Simulator only", () => {
  const src = read("web/src/ui/battle-page.ts");
  assert.match(src, /if \(kind === "simulate"\) takeLinkedOpponent\(\);/);
  const fn = src.slice(src.indexOf("function takeLinkedOpponent"), src.indexOf("/** Set while the page redraws"));
  assert.match(fn, /linkedOpponent\(location\.search\)/);
  assert.match(fn, /\{ \.\.\.storedOpponent\(OPP_KEY\), \.\.\.linked \}/, "the other fields (scrolls, quest size) stay");
  assert.match(fn, /localStorage\.setItem\(OPP_KEY/);
  assert.match(fn, /history\.replaceState/);
  assert.doesNotMatch(fn, /battle-party/, "the party is not touched");
  // the battle page restores what the link's fields name: the option values it builds
  assert.match(src, /\[`cat:\$\{id\}`, `Lvl/);
  assert.match(src, /put\("#quest", was\.quest\)/);
  assert.match(src, /put\("#map-asc", was\.asc\)/);
});

test("Fight in simulator: shown for what the Simulator offers, hidden by the visitor's expansions and without Scribe", async () => {
  await noteSave(null);
  // a map-only boss (the picker's "– Map" group)
  const boss = Object.keys(G.questData).map(Number).find((id) => regionOf("enemy", id)?.group === "map" && G.questData[id].enemyHp && !isTreasureBush(id))!;
  const plainEnemy = 1;
  setShowAll(true);
  assert.deepEqual(enemyFightTarget(plainEnemy), { quest: plainEnemy });
  assert.deepEqual(enemyFightTarget(boss), { quest: boss });
  assert.deepEqual(mapFightTarget(MAP, { asc: 1 }), { map: MAP, asc: 1 });
  assert.deepEqual(mapFightTarget(1, { asc: 0 }), { map: 1 });
  assert.equal(enemyFightTarget(99999), null, "unknown");
  setShowAll(false);
  setOwned("Scribe", false);
  assert.equal(mapFightTarget(1, { asc: 0 }), null, "no map runs without Scribe");
  assert.equal(enemyFightTarget(boss), null, "a map boss is fought only through maps");
  assert.deepEqual(enemyFightTarget(plainEnemy), { quest: plainEnemy }, "a base-game quest enemy stays");
  setOwned("Frozen", false);
  const frozen = Object.keys(G.questData).map(Number).find((id) => G.questData[id].enemyHp && needsOf("enemy", id).includes("Frozen") && !needsOf("enemy", id).includes("Scribe"));
  assert.ok(frozen, "a Frozen enemy");
  assert.equal(enemyFightTarget(frozen!), null, "an enemy the visitor's expansions hide");
  setOwned("Frozen", true);
  assert.deepEqual(enemyFightTarget(frozen!), { quest: frozen });
  setOwned("Scribe", true);
  assert.deepEqual(mapFightTarget(1, { asc: 0 }), { map: 1 });
  setShowAll(true);

  const [p] = fightButton({ map: MAP, asc: 1 }, "why") as unknown as FakeElement[];
  const a = p.querySelector("a.fight-btn")!;
  assert.equal(a.getAttribute("href"), "battle.html?map=22&asc=1");
  assert.equal(a.getAttribute("title"), "why");
  assert.match(a.textContent ?? "", /Fight in simulator/);
  assert.deepEqual(fightButton(null), []);
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /fightButton\(enemyFightTarget\(id\)\)/);
  assert.match(wiki, /fightButton\(mapFightTarget\(id, cfg\)/);
  assert.match(read("site/style.css"), /\/\* U53 \*\/[\s\S]*\.fight-btn[\s\S]*\/\* end U53 \*\//);
});
