// U54 (the user, 2026-11-25): the class page's stat table (per lvl, lvl 1, picked lvl, tier max) instead of the growth
// charts; the shape radar (lvl 50, ascension 0, rims = the best class, no values; the fixed Crit / Acc rims stay on
// every other radar); each skill's unlock level, the lvl-51 skills marked as Frozen Tome content.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { radar } from "../src/ui/radar.ts";
import { classStats, shapeAxes, shapeRadar, statRows, statTable } from "../src/ui/wiki-classes.ts";
import { skillUnlockLevels, unlockCell } from "../src/ui/wiki-skills.ts";
import { isVisible, needsOf, setShowAll } from "../src/ui/expansion-state.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* U54 */"), css.indexOf("/* end U54 */"));
const fake = (e: unknown) => e as FakeElement;
/** Descendant selectors ("thead th") on the fake DOM, which matches one compound selector at a time. */
const qq = (e: FakeElement, sel: string): FakeElement[] =>
  sel.split(" ").reduce<FakeElement[]>((acc, s) => [...new Set(acc.flatMap((x) => x.querySelectorAll(s)))], [e]);
const WARRIOR = 1;

test("the Warrior's stat table: per lvl, lvl 1, the picked lvl and the tier's max, from base + growth × lvl", () => {
  const rows = statRows(G.heroList[WARRIOR], 1, 37);
  const by = Object.fromEntries(rows.map((r) => [r.label, [r.perLevel, r.first, r.at, r.max]]));
  assert.deepEqual(Object.keys(by), ["HP", "Atk", "Matk", "Acc", "Def", "Mdef", "Crit"]);
  // HP 100 + 10 × lvl, Def 14 + 1.2 × lvl; ascension 0 caps at lvl 50
  assert.deepEqual(by.HP, [10, 110, 470, 600]);
  assert.deepEqual(by.Atk.map((x) => Math.round(x * 100) / 100), [0.4, 5.4, 19.8, 25]);
  assert.deepEqual(by.Def.map((x) => Math.round(x * 100) / 100), [1.2, 15.2, 58.4, 74]);
  assert.deepEqual(by.Crit, [0, 1, 1, 1]);
  // ascension 2 (prestige 3): growth 20 HP / lvl, max lvl 60
  assert.deepEqual(statRows(G.heroList[WARRIOR], 3, 55).find((r) => r.label === "HP"), { base: "hp", label: "HP", perLevel: 20, first: 120, at: 1200, max: 1300 });
});

test("the table's headers read Per lvl, Lvl 1, Lvl <picked>, Lvl <max>; lvl 60 carries the Frozen Tome badge", () => {
  const t = fake(statTable(G.heroList[WARRIOR], 1, 37));
  const heads = qq(t, "thead th").map((th) => th.textContent);
  assert.deepEqual(heads, ["Stat", "Per lvl", "Lvl 1", "Lvl 37", "Lvl 50"]);
  assert.equal(qq(t, "tbody tr").length, 7);
  assert.equal(qq(t, "tbody tr")[0].querySelectorAll("td").map((td) => td.textContent).join("|"), "10|110|470|600");
  assert.equal(t.querySelectorAll(".xp-badge").length, 0, "lvl 1-50: base game");
  const t3 = fake(statTable(G.heroList[WARRIOR], 3, 55));
  const h3 = qq(t3, "thead th");
  assert.ok(h3[3].querySelector(".xp-frozen") && h3[4].querySelector(".xp-frozen"), "lvl 55 and 60 need the Frozen Tome");
  assert.ok(!h3[2].querySelector(".xp-badge"));
});

test("the page's level control drives the table (no line chart left)", () => {
  setShowAll(true);
  const { block: b } = classStats(WARRIOR, { level: 20, asc: 0 });
  const blk = fake(b);
  assert.equal(blk.querySelectorAll("table.cls-stat-table").length, 1);
  assert.equal(blk.querySelectorAll("svg.line-chart").length, 0);
  assert.deepEqual(qq(blk, "table.cls-stat-table thead th").map((th) => th.textContent).slice(2), ["Lvl 1", "Lvl 20", "Lvl 50"]);
  const slider = blk.querySelector('input[type="range"]')!;
  slider.value = "33";
  slider.dispatch("input");
  assert.equal(qq(blk, "table.cls-stat-table thead th")[3].textContent, "Lvl 33");
  assert.equal(existsSync(new URL("web/src/ui/line-chart.ts", root)), false, "line-chart.ts removed");
  assert.doesNotMatch(css, /\.lc-|\.line-chart|\.cls-growth|\.cls-stat-pick/);
  setShowAll(false);
});

test("the class radar: lvl 50 ascension 0, each rim the best class's stat, no value anywhere", () => {
  const axes = shapeAxes(WARRIOR);
  assert.deepEqual(axes.map((a) => a.label), ["HP", "Atk", "Matk", "Acc", "Def", "Mdef"]);
  const at50 = (id: number, k: string) => G.heroList[id][k] + G.heroList[id][`${k}Plv`][1] * 50;
  for (const [a, k] of axes.map((a, i) => [a, ["hp", "atk", "matk", "acc", "def", "mdef"][i]] as const)) {
    assert.equal(a.value, at50(WARRIOR, k));
    assert.equal(a.max, Math.max(...Object.keys(G.heroList).map((id) => at50(Number(id), k))), `${a.label}'s rim`);
  }
  // Acc's rim is the best class (Cleric / Assassin: 2 + 0.6 × 50 = 32), not the fixed 250
  assert.equal(axes.find((a) => a.label === "Acc")!.max, 32);
  const fig = fake(shapeRadar(WARRIOR));
  assert.equal(fig.querySelectorAll("text.radar-value").length, 0);
  assert.equal(fig.querySelectorAll("circle.radar-hit").length, 0, "no tooltips");
  assert.deepEqual(fig.querySelectorAll("text.radar-label").map((t) => t.textContent), ["HP", "Atk", "Matk", "Acc", "Def", "Mdef"]);
  const label = fig.querySelector("svg")!.getAttribute("aria-label")!;
  assert.doesNotMatch(label, /\d/, `no value in the accessible name: ${label}`);
  // the Acc dot sits at 17 / 32 of the rim (size 260: centre 130, rim radius 76; axis 3 of 6 points straight down)
  const acc = fig.querySelectorAll("circle.radar-dot")[3];
  assert.ok(Math.abs(Number(acc.getAttribute("cy")) - (130 + 76 * (17 / 32))) < 1e-9);
});

test("every other radar keeps the fixed Crit 100 / Acc 250 rims and its values", () => {
  const axes = [{ label: "Acc", value: 125, max: 32 }, { label: "Crit", value: 50, max: 10 }];
  const dots = (opts: object) => fake(radar(axes, { title: "T", ...opts })).querySelectorAll("circle.radar-dot").map((d) => Number(d.getAttribute("cy")));
  // size 280: centre 140, rim radius 86; axis 0 up, axis 1 down
  const [acc, crit] = dots({});
  assert.ok(Math.abs(acc - (140 - 86 * 0.5)) < 1e-9, "Acc 125 of 250");
  assert.ok(Math.abs(crit - (140 + 86 * 0.5)) < 1e-9, "Crit 50 of 100");
  const [acc2] = dots({ fixedRims: false });
  assert.ok(Math.abs(acc2 - (140 - 86)) < 1e-9, "opted out: the caller's rim (125 of 32 sits on the rim)");
  const fig = fake(radar(axes, { title: "T" }));
  assert.deepEqual(fig.querySelectorAll("text.radar-value").map((t) => t.textContent), ["125", "50"]);
  assert.equal(fig.querySelectorAll("circle.radar-hit").length, 2);
  // the other callers pass neither option
  for (const f of ["battle-page.ts", "save-viewer.ts"]) assert.doesNotMatch(read(`web/src/ui/${f}`), /fixedRims|values: false/, f);
});

test("skills: unlock levels from the game's rule; the lvl-51 skill is Frozen Tome content", () => {
  assert.deepEqual(skillUnlockLevels(WARRIOR), [10, 15, 20, 25, 30, 35, 51]);
  assert.deepEqual(skillUnlockLevels(9), [10, 15, 20, 25, 30, 35, 40, 51], "the Bard's 8 skills");
  for (let id = 1; id <= 9; id++) assert.equal(skillUnlockLevels(id).at(-1), 51, `class ${id}'s last skill`);
  assert.deepEqual(needsOf("level", 51), ["Frozen"]);
  assert.deepEqual(needsOf("level", 50), []);
  const c51 = fake(unlockCell(51)), c35 = fake(unlockCell(35));
  assert.equal(c51.textContent.trim(), "51");
  assert.ok(qq(c51, ".xp-badge .xp-frozen")[0], "the Frozen Tome marker");
  assert.equal(c35.textContent, "35");
  assert.equal(c35.querySelector(".xp-badge"), null);
});

test("skills: the class page hides the expansion skills with the expansion content, as the rest of the wiki does", () => {
  setShowAll(false);
  assert.equal(isVisible("level", 51), false);
  assert.equal(isVisible("level", 35), true);
  setShowAll(true);
  assert.equal(isVisible("level", 51), true);
  setShowAll(false);
  const wiki = read("web/src/ui/wiki.ts");
  assert.match(wiki, /partitionVisible\(allSkills, \(\[, l\]\) => l === null \|\| isVisible\("level", l\)\)/);
  assert.match(wiki, /hiddenNote\(hiddenSkills, "skills"\)/);
  assert.match(wiki, /abilityTable\("skill", skills, shownSkills\.map/);
});

test("U54 CSS: table and radar side by side, the radar under the table at 600 px and less", () => {
  assert.equal(css.split("/* U54 */").length, 2);
  assert.match(block, /\.cls-stats \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(200px, 260px\);[^}]*align-items: stretch; \}/);
  const phone = block.split("@media (max-width: 600px) {")[1];
  assert.match(phone, /\.cls-stats \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(phone, /\.cls-shape \.radar-fig \{ max-width: 220px; \}/);
});
