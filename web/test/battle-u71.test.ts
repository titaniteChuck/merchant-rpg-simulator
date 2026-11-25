/**
 * U71: the Party view's fighter cards (fighter-card.ts, card-turn.ts).
 * 1. The stats: the value right after its name, more room between the two stats of a row (style.css U67 grid, U71
 *    block), HP a line of its own; the phone rules too.
 * 2. HP's modifier tooltip: one line per source, no "Turn N" / "Damage taken" / "Heals received" header, no caster;
 *    damage "−N" red then heals "+N" green.
 * 3. A stat modifier's tooltip: no "MDef 280" header; "<effect>: +40% (1 turn left)", the value green (bonus) or red
 *    (malus), the time left plain; no caster; the calculation without "Base".
 * The game names in these tooltips go through the site's translation helpers (effectName → skillName → tr).
 */
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadLanguage, setLanguage } from "../src/tools/i18n.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { hpDeltaAt, modLabel, modLeft, statMods } from "../src/ui/card-turn.ts";
import { type HpDelta, hpDeltaTip, hpDeltaTipLines, type ModPart, modTip, modTipLines, statGrid, tipLineText } from "../src/ui/fighter-card.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const css = read("site/style.css");
const between = (a: string, b: string) => css.slice(css.indexOf(a), css.indexOf(b));
const u67 = between("/* U67 */", "/* end U67 */"), u69 = between("/* U69 */", "/* end U69 */"), u71 = between("/* U71 */", "/* end U71 */");
const u69Phone = u69.slice(u69.indexOf("@media (max-width: 560px)"));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
type F = FakeElement & HTMLElement;
const body = () => document.body as unknown as F;
const MINUS = "−";

// ---------------------------------------------------------------- 1. spacing
test("CSS: the value right after its name, the room between the two stats, HP its own line, phone too", () => {
  assert.ok(u71.length > 0, "a U71 block");
  // name auto, value as wide as the longest value (shrinks if it must), modifier at least its text, the rest after it
  assert.match(u67, /\.fc-stats \{ display: grid; grid-template-columns: auto minmax\(0, max-content\) minmax\(max-content, 1fr\) auto minmax\(0, max-content\) minmax\(max-content, 1fr\);/);
  assert.doesNotMatch(u67, /minmax\(0, 1fr\)/, "no stretchy value column (it pushed the value away from its name)");
  assert.match(u67, /\.fc-stats \.fc-val \{[^}]*text-align: right;/, "the numbers right-aligned in their (narrow) column");
  assert.match(u67, /\.fc-stat:nth-child\(2n\+3\) > dt \{ padding-left: 12px; \}/, "the second stat of a row: 12 px more");
  assert.match(u69Phone, /\.fc-hero \.fc-stat:nth-child\(2n\+3\) > dt \{ padding-left: 6px; \}/, "phone: 6 px more");
  assert.match(u69Phone, /\.fc-hero \.fc-stats \{ gap: 0 2px; \}/);
  // HP: its own line, across the card, "HP 1,234 / 2,000 (−340)"
  assert.doesNotMatch(css, /grid-column: 2 \/ span 4/, "HP's value no longer spans the middle columns");
  assert.match(u71, /\.fc-stats \.fc-stat-hp \{ display: flex; grid-column: 1 \/ -1; align-items: baseline; gap: 4px; min-width: 0; \}/);
  assert.match(u71.slice(u71.indexOf("@media (max-width: 560px)")), /\.fc-hero \.fc-stats \.fc-stat-hp \{ gap: 2px; \}/);
  // the tooltip colours: the U69 outcome tokens
  assert.match(u71, /\.fc-tip \.t-good \{ color: color-mix\(in srgb, var\(--good\) 70%, var\(--fg\)\); \}/);
  assert.match(u71, /\.fc-tip \.t-bad \{ color: color-mix\(in srgb, var\(--bad\) 70%, var\(--fg\)\); \}/);
  assert.match(u69, /\.fc-out \.o-dmg \{ color: color-mix\(in srgb, var\(--bad\) 70%, var\(--fg\)\); \}/);
});

// ---------------------------------------------------------------- 2. HP's tooltip
test("HP tooltip: a line per source, damage (red, −) then heals (green, +), no headers, no caster", () => {
  const d: HpDelta = { turn: 4, net: -280, taken: [{ label: "Bulawa Strike", value: 300 }, { label: "Burn", value: 40 }],
    healed: [{ label: "Holy Light", value: 60 }] };
  assert.deepEqual(hpDeltaTip(d), [
    [{ text: `Bulawa Strike: ${MINUS}300`, tone: "bad" }],
    [{ text: `Burn: ${MINUS}40`, tone: "bad" }],
    [{ text: "Holy Light: +60", tone: "good" }],
  ]);
  const lines = hpDeltaTipLines(d);
  assert.deepEqual(lines, [`Bulawa Strike: ${MINUS}300`, `Burn: ${MINUS}40`, "Holy Light: +60"]);
  for (const l of lines) assert.doesNotMatch(l, /^Turn |Damage taken|Heals received| · /);
  // what neither explains (a max HP change): plain
  assert.deepEqual(hpDeltaTip({ turn: 2, net: 100, taken: [], healed: [{ label: "Heal", value: 60 }] }),
    [[{ text: "Heal: +60", tone: "good" }], [{ text: "Other: +40" }]]);
  assert.deepEqual(hpDeltaTip({ turn: 2, net: 0, taken: [], healed: [] }), []);
});

test("HP sources from a real trace: the skill or effect only, one line per source whoever cast it", () => {
  const sv = loadSaveText(read("site/data/example-save.txt"));
  const sim = new Sim(sv.raw.gameMode || "Standard");
  const [f, b] = [[8, 0, 4], [5, 1, 2]].map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  const odin = traceFight(sim, 72, [...f], [...b]);
  const whos = new Set([0, ...odin.actions.flatMap((a) => a.life.map((l) => l.who))]);
  let seen = 0;
  for (let t = 1; t <= odin.turns; t++) {
    for (const w of whos) {
      const x = hpDeltaAt(odin, t, w);
      if (!x) continue;
      for (const s of [...x.taken, ...x.healed]) {
        seen++;
        assert.doesNotMatch(s.label, / · /, "no caster before the skill");
        assert.doesNotMatch(s.label, /^(Odin|Hero \d)/);
      }
      for (const list of [x.taken, x.healed]) assert.equal(new Set(list.map((s) => s.label)).size, list.length, "one line per source");
    }
  }
  assert.ok(seen > 0);
});

// ---------------------------------------------------------------- 3. a stat's tooltip
test("stat tooltip: no header; '<effect>: +40% (1 turn left)', the value coloured, no caster, no 'Base'", () => {
  const mdef: ModPart[] = [{ kind: "pct", value: 0.4, label: "Holy Blessing", left: "1 turn left" }];
  assert.deepEqual(modTip("mdef", "MDef", 280, mdef), [
    [{ text: "Holy Blessing: " }, { text: "+40%", tone: "good" }, { text: " (1 turn left)" }],
    [{ text: "200 × (1 + 40%) = 280" }],
  ]);
  assert.deepEqual(modTipLines("mdef", "MDef", 280, mdef), ["Holy Blessing: +40% (1 turn left)", "200 × (1 + 40%) = 280"]);
  // a malus red; a part without time left; flat points; no "Base" anywhere
  const def: ModPart[] = [{ kind: "pct", value: -0.2, label: "Shield Slam", left: "2 turns left" }, { kind: "flat", value: 30, label: "Fortify (passive)" }];
  const tip = modTip("def", "Def", 80, def);
  assert.deepEqual(tip[0], [{ text: "Shield Slam: " }, { text: `${MINUS}20%`, tone: "bad" }, { text: " (2 turns left)" }]);
  assert.deepEqual(tip[1], [{ text: "Fortify (passive): " }, { text: "+30", tone: "good" }]);
  assert.deepEqual(tip.map(tipLineText), ["Shield Slam: −20% (2 turns left)", "Fortify (passive): +30", "(70 + 30) × (1 − 20%) = 80"]);
  // the floor's note stays; a zero part has no colour; a "set" part plain
  assert.deepEqual(modTipLines("acc", "Acc", 0, [{ kind: "pct", value: -1.4, label: "Blind" }]),
    ["Blind: −140%", "Acc × (1 − 100%) = 0", "% sum −140%, floored at −100%"]);
  assert.deepEqual(modTip("atk", "Atk", 100, [{ kind: "pct", value: 0, label: "Nothing" }])[0], [{ text: "Nothing: " }, { text: "+0%" }]);
  assert.deepEqual(modTip("mdef", "MDef", 300, [{ kind: "set", value: 0, label: "Holy Shield", left: "1 turn left" }]),
    [[{ text: "Holy Shield: sets MDef" }, { text: " (1 turn left)" }]]);
  for (const l of [...modTipLines("mdef", "MDef", 280, mdef), ...tip.map(tipLineText)]) assert.doesNotMatch(l, /Base|MDef 280| from /);
});

test("stat parts from the trace: no caster, the time left apart; one effect from two casters added up", () => {
  const m = (x: Partial<api.TraceMod>): api.TraceMod => ({ stat: "mdef", kind: "pct", value: 0.4, src: "effect", name: "Holy Blessing", ...x });
  assert.equal(modLabel(m({ from: 3, turns: 1 })), "Holy Blessing");
  assert.equal(modLeft(m({ from: 3, turns: 1 })), "1 turn left");
  const sm = statMods([m({ from: 1, turns: 1 }), m({ from: 2, turns: 1 }), m({ from: 2, turns: 3 }), m({ src: "passive", name: "Might", value: 0.1 })]);
  assert.deepEqual(sm.mdef, [
    { kind: "pct", value: 0.8, label: "Holy Blessing", left: "1 turn left" },
    { kind: "pct", value: 0.4, label: "Holy Blessing", left: "3 turns left" },
    { kind: "pct", value: 0.1, label: "Might (passive)" },
  ]);
});

// ---------------------------------------------------------------- the DOM
test("the tooltips on the card: coloured pieces in spans, the text (signs included) for a screen reader", () => {
  const stats = { maxHP: 2000, atk: 100, matk: 80, def: 60, mdef: 280, acc: 95, eva: 30, crit: 12 };
  const hpDelta: HpDelta = { turn: 4, net: -63, taken: [{ label: "Bulawa Strike", value: 123 }], healed: [{ label: "Holy Light", value: 60 }] };
  const g = statGrid(stats, "hero", { hp: 1500, hpDelta, mods: { mdef: [{ kind: "pct", value: 0.4, label: "Holy Blessing", left: "1 turn left" }] } }) as unknown as F;
  const [hp, mdef] = g.querySelectorAll("span.fc-mod-btn");
  hp.dispatch("focus");
  const box = () => body().children.find((x) => x.id === "tip")!;
  const lines = box().querySelector("div.fc-tip")!.children;
  assert.deepEqual(lines.map((l) => l.textContent), [`Bulawa Strike: ${MINUS}123`, "Holy Light: +60"]);
  assert.deepEqual(lines.map((l) => l.children[0].className), ["t-bad", "t-good"]);
  hp.dispatch("blur");
  mdef.dispatch("focus");
  const ml = box().querySelector("div.fc-tip")!.children;
  assert.deepEqual(ml.map((l) => l.textContent), ["Holy Blessing: +40% (1 turn left)", "200 × (1 + 40%) = 280"]);
  assert.deepEqual(ml[0].children.map((s) => [s.className, s.textContent]), [["t-good", "+40%"]], "only the value coloured");
  assert.equal(ml[1].children.length, 0, "the calculation plain");
});

// ---------------------------------------------------------------- the names
test("the tooltips' game names: the site's translation helpers (English by default, the visitor's language else)", () => {
  const m: api.TraceMod = { stat: "mdef", kind: "pct", value: 0.4, src: "effect", name: "Holy Blessing", turns: 1 };
  assert.equal(modLabel(m), "Holy Blessing");
  loadLanguage(JSON.parse(read("inventory/i18n/fr.json")));
  try {
    setLanguage("fr");
    assert.equal(modLabel(m), "Bénédiction Sacrée", "French only when the visitor picked French (or the browser is French)");
  } finally {
    setLanguage("en");
  }
  assert.equal(modLabel(m), "Holy Blessing");
});
