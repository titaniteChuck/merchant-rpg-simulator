// U60: the wiki enemy page. Grade and quest size are page modifiers in the maps' modifier bar, kept in the URL
// (#/enemy/12?grade=4&size=3); every figure follows them (HP, loot amounts, cost, time, XP). The XP and time table is
// gone: Time and XP / min are columns of the stats table. A map-only enemy takes its map's cost, time and XP (its own
// map as the boss first, then the cheapest). Loot rolls sorted by chance; every drop table shares one colgroup. The
// "Fight in simulator" button shares the title's line on every page that has it.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const api = await import("../src/sim/api.ts");
api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const { G } = await import("../src/sim/data.ts");
const { Enemy } = await import("../src/sim/enemy.ts");
const { setShowAll } = await import("../src/ui/expansion-state.ts");
const { el } = await import("../src/ui/dom.ts");
const cfgMod = await import("../src/ui/wiki-config.ts");
const { enemyConfigQuery, enemyGrades, enemyRoute, enemySizes, mapEnemyStats, mapView, NO_CONFIG, parseEnemyConfig, parseHash } = cfgMod;
const en = await import("../src/ui/wiki-enemies.ts");
const { fixedAmounts, lootTable } = await import("../src/ui/wiki-loot.ts");
const { enemyDrops } = await import("../src/ui/wiki-data.ts");
const { totalCost, game } = await import("../src/ui/wiki-items.ts");
const { mapRunStats, questStats } = await import("../src/tools/quest-stats.ts");
const { expectedParcel } = await import("../src/tools/profit.ts");
setShowAll(true);

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const css = read("site/style.css");
const u60 = css.slice(css.indexOf("/* U60 */"), css.indexOf("/* end U60 */"));

const BASAMUS = 20; // party quest (2 heroes), rare variant, two loot rolls
const CORAL = 12; // solo quest
const MONARCH = 92; // map boss: boss of map 7 every run, of map 12 one run in 3
const WARLORD = 91; // map boss of maps 3 and 12
const BUSH = 99; // Treasure Bush of the level 1–10 maps
const section = (t: string, ...k: (Node | string)[]) => el("section", {}, el("h2", {}, t), ...k);
const empty = () => el("p");
const body = (id: number, cfg = cfgMod.ENEMY_DEFAULT) => el("div", {}, ...en.enemyBody(id, section, empty, cfg)) as unknown as FakeElement;
const cards = (e: FakeElement) => e.querySelectorAll(".fact-card").map((c) => [c.querySelector("dt")!.textContent, c.querySelector("dd")!.textContent]);

test("URL: grade and size parsed and built; defaults are the clean URL; values the enemy can't take dropped", () => {
  assert.equal(enemyConfigQuery({ grade: 3, size: 1 }), "");
  assert.equal(enemyConfigQuery({ grade: 4, size: 3 }), "?grade=4&size=3");
  assert.equal(enemyConfigQuery({ grade: 5, size: 1 }), "?grade=5");
  assert.equal(enemyConfigQuery({ grade: 3, size: 2 }), "?size=2");
  assert.deepEqual(parseEnemyConfig(CORAL, "?grade=4&size=3"), { grade: 4, size: 3 });
  assert.deepEqual(parseEnemyConfig(CORAL, ""), { grade: 3, size: 1 });
  assert.deepEqual(parseEnemyConfig(CORAL, "?grade=9&size=7"), { grade: 3, size: 1 });
  assert.deepEqual(parseEnemyConfig(CORAL, "?grade=x&size=2.5"), { grade: 3, size: 1 });
  assert.deepEqual(parseEnemyConfig(MONARCH, "?grade=1&size=3"), { grade: 1, size: 1 }, "a map room is ×1");
  assert.deepEqual(parseEnemyConfig(BUSH, "?grade=2"), { grade: 3, size: 1 }, "a Treasure Bush needs grade B+");
  assert.equal(enemyRoute(CORAL, { grade: 3, size: 1 }), "#/enemy/12");
  assert.equal(enemyRoute(CORAL, { grade: 2, size: 5 }), "#/enemy/12?grade=2&size=5");
  const { parts, query } = parseHash("#/enemy/12?grade=2&size=5");
  assert.deepEqual(parts, ["enemy", "12"]);
  assert.deepEqual(parseEnemyConfig(Number(parts[1]), query), { grade: 2, size: 5 });
});

test("ranges from the game: grades D..S (a Treasure Bush B..S), size ×1..×(2 × tier − 1), a map room ×1", () => {
  assert.deepEqual(enemyGrades(CORAL), [1, 2, 3, 4, 5]);
  assert.deepEqual(enemyGrades(MONARCH), [1, 2, 3, 4, 5]);
  assert.deepEqual(enemyGrades(BUSH), [3, 4, 5]);
  assert.deepEqual(enemySizes(CORAL), [1, 2, 3, 4, 5], "tier 3: default.enemyAmount = 3 × 2 − 1");
  assert.deepEqual(enemySizes(CORAL, 2), [1, 2, 3], "without a tier-3 hero (Frozen hidden): ×3");
  assert.deepEqual(enemySizes(BASAMUS), [1, 2, 3, 4, 5], "a party quest takes a size too");
  assert.deepEqual(enemySizes(MONARCH), [1]);
});

test("HP, cost, time and XP follow the size and grade, as the engine computes them; the rare variant stays ×1", () => {
  for (const size of [1, 3, 5]) {
    for (const grade of [1, 3, 5]) {
      const rows = en.statsRows(en.enemyContext(BASAMUS, { grade, size }));
      const [normal, rare] = rows;
      const e = new Enemy({ questID: BASAMUS, isRare: false, amount: size }) as unknown as { maxHP: number; atk: number };
      assert.equal(normal.stats.HP, e.maxHP);
      assert.equal(normal.stats.HP, size * en.statsRows(en.enemyContext(BASAMUS, { grade, size: 1 }))[0].stats.HP);
      assert.equal(normal.stats.Atk, e.atk, "only HP scales with the size");
      assert.equal(rare.stats.HP, (new Enemy({ questID: BASAMUS, isRare: true, amount: 1 }) as unknown as { maxHP: number }).maxHP);
      const s = questStats(BASAMUS, { grade, amount: size, heroes: 1 });
      assert.equal(normal.run!.seconds, s.seconds);
      assert.equal(normal.run!.xp, s.xpPerHero);
      assert.equal(normal.run!.cost, G.questData[BASAMUS].gold * size);
      assert.equal(rare.run!.cost, G.questData[BASAMUS].goldB);
      assert.equal(rare.run!.seconds, questStats(BASAMUS, { grade, amount: 1, heroes: 1, rare: true }).seconds);
    }
  }
  const t = (g: number) => en.statsRows(en.enemyContext(CORAL, { grade: g, size: 1 }))[0].run!.seconds;
  assert.ok(t(1) > t(3) && t(3) > t(5), "a better grade is quicker (gradeTime)");
});

test("loot amounts follow the size (lootService: every-win quantity × N, roll amounts N times, item odds × N)", () => {
  const [mid, lo, hi] = enemyDrops(BASAMUS, false).fixed[0];
  const mean = (m: Map<number, number>) => [...m].reduce((s, [k, p]) => s + k * p, 0);
  for (const g of [1, 3, 5]) {
    const one = fixedAmounts([mid, lo, hi], g), three = fixedAmounts([mid, lo, hi], g, 0, 3);
    assert.deepEqual([...three.keys()], [...one.keys()].map((k) => k * 3));
    assert.ok(Math.abs(mean(three) - 3 * mean(one)) < 1e-9);
  }
  // the loot roll's expected amounts against tools/profit expectedParcel (the farming / profit engine), same odds; the
  // wiki's exact weightedRandom gives one threshold in (total + 1) to the first choice, so they differ by that at most
  for (const name of enemyDrops(BASAMUS, false).rolls) {
    const p = G.parcelData[name];
    const odds = Object.values(p.itemList as Record<string, { odds: number }>).reduce((s, e) => s + e.odds, 0);
    for (const size of [1, 3]) {
      for (const g of [1, 3, 5]) {
        const t = lootTable(name, 0, size)!;
        const want = expectedParcel(game(), name, g, 0, size);
        const total = Math.max(p.nilOdds * G.gradeParcelBonus[g], 1) + odds * size;
        for (const r of t.rows) {
          const got = r.chance[g - 1] / 100 * mean(r.amounts);
          const exp = want.get(`${r.type}|${r.id}`) ?? 0;
          const top = Math.max(...r.amounts.keys());
          assert.ok(Math.abs(got - exp) <= 1.5 * top / (total + 1), `${name} ×${size} g${g} ${r.type} ${r.id}: ${got} vs ${exp}`);
        }
      }
    }
  }
  // and the page: the Every win cells of the first drop at ×3 are the ×1 ranges times 3
  const cells = (size: number) => body(BASAMUS, { grade: 3, size }).querySelectorAll("table.loot-table")[0].querySelectorAll("tr")[2].querySelectorAll("td").slice(3).map((td) => td.textContent);
  assert.notDeepEqual(cells(3), cells(1));
  assert.deepEqual(cells(3)[2], cells(1)[2].replace(/\d+/g, (d) => String(Number(d) * 3)));
});

test("map-only enemies: stats inside their map at the page's grade; cost, time and XP the map's; no XP and time table", () => {
  // Murlok Monarch: the boss of map 7 every run (and of map 12 one run in 3): map 7, its own map and the cheaper
  const c = en.enemyContext(MONARCH, { grade: 3, size: 1 });
  assert.deepEqual(c.run, { map: 7, role: "boss", of: 2 });
  const [row] = en.statsRows(c);
  const s = mapRunStats(7, { grade: 3, heroes: 1 });
  assert.deepEqual(row.run, { cost: totalCost("map", 7, 0), seconds: s.seconds, xp: s.xpPerHero, xpPerMin: s.xpPerMin });
  assert.equal(row.stats.HP, mapEnemyStats(MONARCH, false, mapView(7, NO_CONFIG, 3)!.stats)!.HP);
  // grade S: map grade 5 raises the map's enemy multiplier (mapGradeMod), so HP; the run's XP too
  const [s5] = en.statsRows(en.enemyContext(MONARCH, { grade: 5, size: 1 }));
  const map5 = api.makeMap({ id: 7, prestigeLevel: 0, grade: 5, seed: 1 }) as unknown as { finalMapStats: unknown };
  assert.equal(s5.stats.HP, (new Enemy({ questID: MONARCH, isRare: false, mapStats: map5.finalMapStats, amount: 1 }) as unknown as { maxHP: number }).maxHP);
  assert.ok(s5.stats.HP > row.stats.HP);
  assert.equal(s5.run!.xp, mapRunStats(7, { grade: 5, heroes: 1 }).xpPerHero);
  assert.deepEqual(en.enemyContext(WARLORD, { grade: 3, size: 1 }).run, { map: 3, role: "boss", of: 2 });
  // a Treasure Bush: the cheapest map of its band
  const bush = en.enemyContext(BUSH, { grade: 3, size: 1 }).run!;
  assert.equal(bush.role, "treasure");
  for (const m of [1, 2, 3, 4]) assert.ok(totalCost("map", bush.map, 0)! <= totalCost("map", m, 0)!);
  // the page: same cards and table as a quest, the Map card tagged, no "Fought in" or XP and time section
  const b = body(MONARCH);
  const text = b.textContent;
  assert.doesNotMatch(text, /Fought in|XP and time|XP per hero|Mainly drops/);
  const map = cards(b).find(([k]) => k === "Map")!;
  assert.match(map[1]!, /cheapest of 2/);
  const table = b.querySelector("table.stats-run")!;
  assert.deepEqual(table.querySelectorAll("th").map((th) => th.textContent), ["Variant", "Lvl", "HP", "Atk", "Matk", "Def", "Mdef", "Eva", "Cost", "Time", "XP", "XP / min"]);
});

test("quest page: the party line is a card, no Mainly drops card, no XP and time section, Time and XP / min in the stats table", () => {
  const solo = cards(body(CORAL));
  assert.deepEqual(solo.find(([k]) => k === "Party"), ["Party", "Solo · 1 hero"]);
  assert.deepEqual(cards(body(BASAMUS)).find(([k]) => k === "Party"), ["Party", "1–2 heroes"]);
  for (const id of [CORAL, BASAMUS, 1]) {
    const b = body(id);
    assert.ok(!cards(b).some(([k]) => k === "Mainly drops"), `${id}`);
    assert.doesNotMatch(b.textContent, /XP and time|XP per hero|Solo quest/);
    assert.equal(b.querySelectorAll("table.qxp-table").length, 0);
  }
  const t = body(BASAMUS, { grade: 3, size: 3 }).querySelector("table.stats-run")!;
  const rows = t.querySelectorAll("tr").slice(1).map((tr) => tr.querySelectorAll("td").map((td) => td.textContent));
  assert.equal(rows.length, 2);
  assert.match(rows[0][0]!, /×3$/);
  assert.match(rows[1][0]!, /×1$/, "the rare variant is ×1");
  const src = read("web/src/ui/wiki-enemies.ts");
  assert.doesNotMatch(src, /"Mainly drops"|questXpBlock|mapXpBlock|"Fought in: "/);
});

test("loot rolls: rows from the most likely to the least at the page's grade, Nothing included", () => {
  for (const grade of [1, 3, 5]) {
    for (const name of enemyDrops(BASAMUS, false).rolls) {
      const t = lootTable(name)!;
      const order = en.rollOrder(t, grade);
      const at = (i: number) => (i < 0 ? t.nothing : t.rows[i].chance)[grade - 1];
      assert.equal(order.length, t.rows.length + 1);
      for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) >= at(order[i]), `${name} g${grade}`);
    }
  }
  // on the page: each roll table's picked-grade column reads high to low
  const b = body(BASAMUS, { grade: 5, size: 1 });
  const rolls = b.querySelectorAll("table.loot-table").slice(1);
  assert.ok(rolls.length >= 2);
  for (const tb of rolls) {
    const col = tb.querySelectorAll("tr").slice(2).map((tr) => tr.querySelectorAll("td")[3 + 4]);
    assert.ok(col.every((td) => td.classList.contains("pick")));
    const v = col.map((td) => (td.textContent === "<0.1%" ? 0.01 : parseFloat(td.textContent!)));
    for (let i = 1; i < v.length; i++) assert.ok(v[i - 1] >= v[i], v.join(" "));
  }
});

test("drop tables share their column widths: one colgroup, fixed layout", () => {
  const b = body(BASAMUS);
  const tables = b.querySelectorAll("table.loot-table");
  assert.ok(tables.length >= 3, "Every win and two loot rolls");
  for (const t of tables) {
    assert.ok(t.classList.contains("loot-cols"));
    const cols = t.querySelectorAll("col").map((c) => c.getAttribute("class"));
    assert.deepEqual(cols, en.LOOT_COLS);
    assert.equal(t.querySelectorAll("tr")[1].querySelectorAll("th").length + 3, cols.length, "as many columns as cells");
  }
  assert.match(u60, /\.loot-table\.loot-cols \{ table-layout: fixed; width: 100%;/);
  const width = (c: string) => Number(u60.match(new RegExp(`col\\.${c} \\{ width: (\\d+)%; \\}`))![1]);
  assert.equal(width("lt-item") + width("lt-rar") + width("lt-3") + 5 * width("lt-g"), 100);
});

test("Fight in simulator shares the title's line, right-aligned, wrapping under it on a phone", () => {
  const h1 = el("h1", {}, "Coral Giant");
  const line = en.titleLine(h1, en.fightButton({ quest: CORAL })) as unknown as FakeElement;
  assert.ok(line.classList.contains("title-line"));
  assert.equal(line.children[0].tagName.toLowerCase(), "h1");
  const acts = line.children[1];
  assert.ok(acts.classList.contains("title-actions"));
  assert.equal(acts.querySelector("a.fight-btn")!.getAttribute("href"), "battle.html?quest=12");
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /titleLine\(el\("h1", \{\}, "👹 ", name/, "enemy page");
  assert.match(wiki, /const line = titleLine\(h1\);/, "configured pages (maps)");
  assert.match(wiki, /\(cfg\) => fightButton\(mapFightTarget\(id, cfg\)/);
  assert.doesNotMatch(wiki, /\.\.\.fightButton\(/, "no button left under a title");
  assert.match(u60, /#wiki \.title-line \{ display: flex; flex-wrap: wrap; align-items: center;/);
  assert.match(u60, /#wiki \.title-actions \{ margin-left: auto; \}/);
});
