// Battle Simulator and Solver U69: the Party view's fighter cards. The skill / passive picker floats over the page
// (pick-list.ts `float`, placePopup) instead of opening inside the card; the choices the AP budget can't take are greyed
// out and can't be picked (battle-edit.ts skillFits / budgetOptions, the rule editRotationSkill enforces, this slot's
// skill replaced); on a phone the hero cards stay two per row, back row | front row (battle-layout.ts PARTY_COLUMNS),
// the stats two per row; the turn's outcome colours its damage red and its heals green; HP's modifier is the turn's HP
// change ("+120", "−340"), its sources in the tooltip; no effects line. No browser: the cards and the picker in the
// fake DOM, known traces, the page code and CSS as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { type ApBudget, apUsed, budgetOptions, editRotationSkill, type PartyState, skillFits } from "../src/ui/battle-edit.ts";
import { PARTY_COLUMNS } from "../src/ui/battle-layout.ts";
import { cardTurnOf, hpAt, hpDeltaAt } from "../src/ui/card-turn.ts";
import * as card from "../src/ui/fighter-card.ts";
import { type CardRow, fighterCard, type HpDelta, hpDeltaText, hpDeltaTipLines, outcomeParts, outcomeText, paintCard, statCell, statGrid }
  from "../src/ui/fighter-card.ts";
import { openPick, placePopup, POPUP } from "../src/ui/pick-list.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css"), cardSrc = read("web/src/ui/fighter-card.ts");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));
const block = css.slice(css.indexOf("/* U69 */"), css.indexOf("/* end U69 */"));
const phone = block.slice(block.indexOf("@media (max-width: 560px)"));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const ODIN = 72; // buffs, debuffs, heals
const odin = (() => {
  const [f, b] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  return traceFight(sim, ODIN, [...f], [...b]);
})();
const names = (w: number) => (w ? `Hero ${w}` : "Odin");

type F = FakeElement & HTMLElement;
const body = () => document.body as unknown as F;
const key = (list: FakeElement, k: string) => list.listeners.get("keydown")![0]({ key: k, preventDefault() {}, stopPropagation() {} } as never);

// ---------------------------------------------------------------- 1. the AP budget in the skill list
const COST: Record<string, number> = { Fireball: 3, Heal: 4, Meteor: 6, Nova: 7 };
const budget = (max: number): ApBudget => ({ cost: (s) => COST[s] ?? 0, max });
const opts = ["Basic", "Fireball", "Heal", "Meteor", "Nova"].map((v) => ({ value: v, label: v, ap: COST[v] ?? 0 }));

test("budget: a skill fits when the rotation's AP with it in this slot (the slot's own skill taken off) is within the limit", () => {
  const rot = ["Fireball", "Heal", "Basic", "Basic", "Basic"]; // 7 of 10
  const b = budget(10);
  assert.equal(apUsed(rot, b), 7);
  // slot 0 (Fireball, 3): 7 − 3 + 6 = 10 fits, 7 − 3 + 7 = 11 doesn't
  assert.deepEqual(skillFits(rot, 0, "Meteor", b), { ok: true, used: 10, max: 10 });
  assert.deepEqual(skillFits(rot, 0, "Nova", b), { ok: false, used: 11, max: 10 });
  // slot 2 (Basic, 0): Fireball 10 fits, Meteor 13 doesn't
  assert.equal(skillFits(rot, 2, "Fireball", b).ok, true);
  assert.equal(skillFits(rot, 2, "Meteor", b).ok, false);
  // the list: greyed with the AP it would reach; the slot's own skill and Basic always fit
  const s0 = budgetOptions(opts, rot, 0, b);
  assert.deepEqual(s0.map((o) => [o.value, Boolean(o.disabled)]), [["Basic", false], ["Fireball", false], ["Heal", false], ["Meteor", false], ["Nova", true]]);
  assert.equal(s0[4].why, "11 / 10 AP");
  const s2 = budgetOptions(opts, rot, 2, b);
  assert.deepEqual(s2.filter((o) => o.disabled).map((o) => o.value), ["Heal", "Meteor", "Nova"]); // 11, 13, 14
  // a short rotation is padded with Basic
  assert.deepEqual(skillFits(["Heal"], 3, "Meteor", b), { ok: true, used: 10, max: 10 });
  // an old saved rotation already over the limit: what lowers it (or keeps it) stays pickable, what raises it doesn't
  const over = budgetOptions(opts, rot, 1, budget(5)); // Heal (4) in slot 1: 7 of 5
  assert.deepEqual(over.map((o) => [o.value, Boolean(o.disabled)]), [["Basic", false], ["Fireball", false], ["Heal", false], ["Meteor", true], ["Nova", true]]);
  // the same rule as the edit itself (editRotationSkill): greyed ⇔ refused
  for (const b2 of [budget(10), budget(5), budget(20)]) {
    for (let k = 0; k < 5; k++) {
      for (const o of budgetOptions(opts, rot, k, b2)) {
        const s: PartyState = { slots: {}, skills: {}, excluded: {} };
        assert.equal(editRotationSkill(s, 0, k, o.value, { attackList: rot }, b2).ok, !o.disabled, `${o.value} in slot ${k}, max ${b2.max}`);
      }
    }
  }
  // the page: the card's skill list goes through budgetOptions with the hero's budget; a passive the edit would refuse
  // is greyed too
  const hr = fn(page, "heroRows");
  assert.match(hr, /options: \(\) => budgetOptions\(rotationChoices\(raw, sk\)\.map\(skillOption\), rot, k, apBudgetOf\(idx!\)\)/);
  assert.match(hr, /const off = b !== null && u > b\.max && b\.max < apBudgetOf\(idx!, passive\)\.max;/);
  assert.match(hr, /if \(u > b\.max && b\.max < apBudgetOf\(idx!, passive\)\.max\) return refuseAp/, "the same test as the passive's onPick");
});

test("picker: a disabled choice is greyed, aria-disabled, reachable with the arrows, never picked", () => {
  const picked: string[] = [];
  const b = document.createElement("button") as unknown as F;
  const host = document.createElement("li") as unknown as F;
  const list = openPick(b as unknown as HTMLElement, { label: "Ana: turn 1 skill", text: "Basic", value: "Basic", focus: "x", float: true,
    host: () => host as unknown as HTMLElement, options: () => budgetOptions(opts, ["Basic", "Heal", "Heal", "Basic", "Basic"], 0, budget(11)),
    onPick: (v) => picked.push(v) }) as unknown as F;
  const items = list.querySelectorAll("li.pk-opt");
  const off = items.filter((i) => i.getAttribute("aria-disabled") === "true").map((i) => i.dataset.value);
  assert.deepEqual(off, ["Heal", "Meteor", "Nova"]); // 8 of 11 used: Fireball 11 fits, Heal 12, Meteor 14, Nova 15 don't
  for (const i of items) assert.equal(i.classList.contains("off"), i.getAttribute("aria-disabled") === "true");
  assert.equal(items[2].title, "12 / 11 AP");
  // a click on a greyed one: nothing, the list stays open
  items[3].dispatch("click");
  assert.deepEqual(picked, []);
  assert.ok(list.isConnected);
  // ↓ ↓ reach Heal (greyed): Enter does nothing; ↑ to Fireball: Enter picks it
  key(list, "ArrowDown");
  key(list, "ArrowDown");
  assert.equal(list.getAttribute("aria-activedescendant"), items[2].id);
  key(list, "Enter");
  assert.deepEqual(picked, []);
  assert.ok(list.isConnected);
  key(list, "ArrowUp");
  key(list, "Enter");
  assert.deepEqual(picked, ["Fireball"]);
  assert.ok(!list.isConnected);
  // CSS: greyed, not-allowed
  assert.match(block, /\.pk-opt\.off \{ cursor: not-allowed; \}/);
  assert.match(block, /\.pk-opt\.off \.pk-name, \.pk-opt\.off \.pk-note \{ color: var\(--muted\); \}/);
});

// ---------------------------------------------------------------- 2. the picker floats over the page
test("picker: the card's list floats over the page (in <body>, fixed, anchored to the row), Escape / Tab close it", () => {
  const rows: CardRow[] = ["Basic", "Fireball", "Basic", "Heal", "Basic"].map((s, k) => ({ text: s, ap: COST[s] ?? 0,
    pick: { label: `Ana: turn ${k + 1} skill`, value: s, focus: `f-${k}`, options: () => opts, onPick: () => {} } }));
  const c = fighterCard({ kind: "hero", head: document.createElement("span") as unknown as HTMLElement, stats: null, rotation: rows }) as unknown as F;
  body().append(c);
  Object.assign(globalThis, { innerWidth: 375, innerHeight: 700 });
  const row = c.querySelectorAll("li.fc-row")[1];
  (row as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left: 20, top: 300, bottom: 326, right: 180, width: 160, height: 26 });
  const b = row.querySelector("button.pk-btn")!;
  b.dispatch("click");
  const list = body().children.find((x) => x.classList.contains("pk-list"))!;
  assert.ok(list, "a child of <body>");
  assert.ok(!c.querySelector("ul.pk-list"), "not in the card");
  assert.ok(list.classList.contains("pk-float"));
  assert.equal(list.getAttribute("role"), "listbox");
  assert.equal(b.getAttribute("aria-expanded"), "true");
  assert.equal(b.getAttribute("aria-controls"), list.id);
  assert.equal((document as unknown as { activeElement: unknown }).activeElement, list, "the focus in the list");
  // placed under the row, at its left, at least POPUP.minWidth wide (the fake viewport: 375 wide)
  const st = list.style as Record<string, unknown>;
  assert.equal(st.left, "20px");
  assert.equal(st.top, `${326 + POPUP.gap}px`);
  assert.equal(st.bottom, "auto");
  assert.equal(st.width, `${POPUP.minWidth}px`);
  // Escape closes, the focus back on the button
  key(list, "Escape");
  assert.ok(!list.isConnected);
  assert.equal(b.getAttribute("aria-expanded"), "false");
  assert.equal((document as unknown as { activeElement: unknown }).activeElement, b);
  // Tab closes and hands the focus back to the button (the floating list is out of the page's order)
  b.dispatch("click");
  const l2 = body().querySelector("ul.pk-list")!;
  key(l2, "Tab");
  assert.ok(!l2.isConnected);
  assert.equal((document as unknown as { activeElement: unknown }).activeElement, b);
  // the Flows' cells keep theirs in place (no float)
  assert.match(read("web/src/ui/flow-parts.ts"), /focus: `skill-\$\{loc\}-\$\{turn\}`, host \}\);/);
  assert.match(cardSrc, /pickButton\(\{ \.\.\.r\.pick, text: r\.text, host: \(\) => li, float: true \}\)/);
  // CSS: fixed over the page, over the cards and the sticky bars
  assert.match(block, /\.pk-list\.pk-float \{ position: fixed; z-index: 55; flex: none;/);
  c.remove();
});

test("placePopup: under the row, above when there is more room there, inside the viewport", () => {
  const view = { width: 375, height: 700 };
  const box = (left: number, top: number, width = 160, h = 26) => ({ left, top, bottom: top + h, width });
  // under, as wide as the row when wider than the minimum
  assert.deepEqual(placePopup(box(10, 100, 300), view), { left: 10, width: 300, maxHeight: 320, top: 128 });
  // near the right edge: moved in, never past the margin
  const r = placePopup(box(300, 100), view);
  assert.equal(r.left + r.width, 375 - POPUP.margin);
  // a phone narrower than the minimum width: the viewport less its margins
  assert.deepEqual(placePopup(box(5, 100), { width: 240, height: 700 }), { left: 8, width: 224, maxHeight: 320, top: 128 });
  // near the bottom: above the row (anchored by its bottom edge), its height capped by the room above
  const up = placePopup(box(10, 600), view);
  assert.equal(up.top, undefined);
  assert.equal(up.bottom, 700 - 600 + POPUP.gap);
  assert.equal(up.maxHeight, 320);
  // little room either way: the larger side, capped by it
  const tight = placePopup(box(10, 150), { width: 375, height: 260 });
  assert.equal(tight.bottom, 260 - 150 + POPUP.gap);
  assert.equal(tight.maxHeight, Math.min(Math.round(260 * 0.6), 150 - POPUP.gap - POPUP.margin));
});

// ---------------------------------------------------------------- 3. back row | front row on a phone
test("phone: the hero cards stay two per row, the back row's in the first column, the front row's in the second", () => {
  assert.deepEqual([...PARTY_COLUMNS], ["back", "front"]);
  assert.match(fn(page, "renderParty"), /const cols = PARTY_COLUMNS\.map\(\(row\) => \{/);
  assert.match(phone, /\.party-cols \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 8px; \}/);
  // no rule stacks the two columns any more, nor puts a row's slots two per row
  assert.doesNotMatch(css, /\.party-cols \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.doesNotMatch(css, /\.party-cols \.slots \{ grid-template-columns: repeat\(2/);
  // the required slot (Front 2 on a party quest) is in the front column: SLOTS' keys front0..2 / back0..2
  assert.match(page, /const SLOTS = \[\["front", 0\], \["front", 1\], \["front", 2\], \["back", 0\], \["back", 1\], \["back", 2\]\] as const;/);
});

// ---------------------------------------------------------------- 4. the outcome's colours
test("outcome: damage red, heals green, Miss muted; the text unchanged (colour not the only cue)", () => {
  const t = (x: Partial<card.OutcomeTarget>): card.OutcomeTarget => ({ name: "Odin", dmg: 0, heal: 0, hits: 0, heals: 0, miss: 0, crit: 0, ...x });
  const cases: card.CardOutcome[] = [
    { row: 0, targets: [t({ dmg: 1234, hits: 1, crit: 1 })] },
    { row: 0, targets: [t({ name: "Ana", heal: 560, heals: 1 })] },
    { row: 0, targets: [t({ name: "Ana", dmg: 980, hits: 1 }), t({ name: "Bob", miss: 1 }), t({ name: "Cy", dmg: 12_000, hits: 2, crit: 1, miss: 1 })] },
    { row: 0, targets: [t({ dmg: 300, hits: 1, heal: 40, heals: 1 })] },
  ];
  for (const o of cases) assert.equal(outcomeParts(o)!.map((p) => p.text).join(""), outcomeText(o)!.text);
  assert.deepEqual(outcomeParts(cases[2]), [{ text: "980", kind: "dmg" }, { text: " · " }, { text: "Miss", kind: "miss" }, { text: " · " },
    { text: "12K!", kind: "dmg" }, { text: " (1 miss)" }]);
  assert.deepEqual(outcomeParts(cases[3]), [{ text: "300", kind: "dmg" }, { text: " " }, { text: "+40", kind: "heal" }]);
  assert.deepEqual(outcomeParts({ row: 0, lost: "Stun", targets: [] }), []);
  assert.equal(outcomeParts({ row: 0, targets: [] }), null);
  // on the card: the coloured spans, the words for a screen reader kept
  const rot = [0, 1, 2, 3, 4].map((k) => ({ text: `Skill ${k}` }));
  const c = fighterCard({ kind: "hero", head: document.createElement("span") as unknown as HTMLElement, stats: null, rotation: rot,
    turn: { active: 1, outcome: { row: 1, targets: cases[3].targets } } }) as unknown as F;
  const out = c.querySelector("span.fc-out")!;
  assert.equal(out.querySelector("span.o-dmg")!.textContent, "300");
  assert.equal(out.querySelector("span.o-heal")!.textContent, "+40");
  assert.equal(out.querySelector("span.visually-hidden")!.textContent, "Odin: 300 damage, +40 HP");
  // CSS: theme tokens (AA in both themes, on the played row's highlight too)
  assert.match(block, /\.fc-out \.o-dmg \{ color: color-mix\(in srgb, var\(--bad\) 70%, var\(--fg\)\); \}/);
  assert.match(block, /\.fc-out \.o-heal \{ color: color-mix\(in srgb, var\(--good\) 70%, var\(--fg\)\); \}/);
  assert.doesNotMatch(css, /\.fc-out\.crit \{/, "the whole outcome is no longer amber on a crit (\"!\" marks it)");
});

// ---------------------------------------------------------------- 5. the stats two per row on a phone
test("phone: the stats stay two per row, compact: smaller type, no brackets, values from four digits shortened", () => {
  assert.doesNotMatch(css, /\.fc-stats \{ grid-template-columns: auto minmax\(0, 1fr\) auto; \}/, "no one-stat-per-row rule");
  assert.match(phone, /\.fc-hero \.fc-paren \{ display: none; \}/);
  assert.match(phone, /\.fc-hero \.fc-val \.v-short \{ display: inline; \}/);
  assert.match(phone, /\.fc-hero \.fc-stats dt \{ font-size: 0\.6rem; \}/);
  const stats = { maxHP: 2000, atk: 1234, matk: 999, def: 15_000, mdef: 50, acc: 95, eva: 30, crit: 12 };
  assert.deepEqual(statCell("atk", "Atk", stats), { name: "Atk", value: "1,234", short: "1.2K", mod: "" });
  assert.deepEqual(statCell("matk", "Matk", stats), { name: "Matk", value: "999", mod: "" });
  const g = statGrid(stats, "hero", { mods: { atk: [{ kind: "pct", value: 0.15, label: "Might (passive)" }] } }) as unknown as F;
  const atk = g.querySelectorAll("div.fc-stat")[1];
  assert.deepEqual(atk.querySelector("dd.fc-val")!.children.map((x) => [x.className, x.textContent]), [["v-full", "1,234"], ["v-short", "1.2K"]]);
  assert.equal(atk.querySelector("dd.fc-val")!.title, "Atk 1,234");
  // the modifier's brackets are their own spans (hidden on a phone); the text reads the same
  const m = atk.querySelector("span.fc-mod-btn")!;
  assert.equal(m.textContent, "(+15%)");
  assert.deepEqual(m.querySelectorAll("span.fc-paren").map((x) => x.textContent), ["(", ")"]);
});

// ---------------------------------------------------------------- 6. HP's modifier: the turn's HP change
test("HP: the modifier is the turn's net HP change, its damage and heals by source in the tooltip", () => {
  const d = (x: Partial<HpDelta>): HpDelta => ({ turn: 3, net: 0, taken: [], healed: [], ...x });
  assert.equal(hpDeltaText(null), "");
  assert.equal(hpDeltaText(d({})), "", "nothing happened");
  assert.equal(hpDeltaText(d({ net: -340, taken: [{ label: "Odin · Fireball", value: 340 }] })), "−340");
  assert.equal(hpDeltaText(d({ net: 120, healed: [{ label: "Ana · Heal", value: 120 }] })), "+120");
  assert.equal(hpDeltaText(d({ net: -12_345 })), "−12.3K");
  assert.equal(hpDeltaText(d({ net: 0, taken: [{ label: "a", value: 50 }], healed: [{ label: "b", value: 50 }] })), "±0");
  const both = d({ net: -280, taken: [{ label: "Odin · Fireball", value: 300 }, { label: "Burn", value: 40 }], healed: [{ label: "Ana · Heal", value: 60 }] });
  assert.deepEqual(hpDeltaTipLines(both), ["Turn 3: −280 HP", "Damage taken: 340", "Odin · Fireball: 300", "Burn: 40", "Heals received: 60", "Ana · Heal: 60"]);
  assert.deepEqual(hpDeltaTipLines(d({ net: 100, healed: [{ label: "Ana · Heal", value: 60 }] })), ["Turn 3: +100 HP", "Heals received: 60", "Ana · Heal: 60", "Other: +40"]);
  // the cell: never a % on HP; "(−280)" red, "(+120)" green, "(±0)" plain, the tooltip on focus
  const stats = { maxHP: 2000, atk: 100, matk: 80, def: 60, mdef: 50, acc: 95, eva: 30, crit: 12 };
  const hpMods = { maxHP: [{ kind: "pct" as const, value: 0.1, label: "Juggernaut (passive)" }] };
  assert.equal(statCell("maxHP", "HP", stats, { hp: 1500, mods: hpMods }).mod, "");
  assert.equal(statCell("maxHP", "HP", stats, { hp: 1500, mods: hpMods, hpDelta: both }).mod, "(−280)");
  const tone = (x: HpDelta) => (statGrid(stats, "hero", { hp: 1500, hpDelta: x }) as unknown as F).querySelector("span.fc-mod-btn")!.className;
  assert.equal(tone(both), "fc-mod-btn down");
  assert.equal(tone(d({ net: 120, healed: [{ label: "Ana · Heal", value: 120 }] })), "fc-mod-btn up");
  assert.equal(tone(d({ net: 0, taken: [{ label: "a", value: 5 }], healed: [{ label: "b", value: 5 }] })), "fc-mod-btn even");
  const g = statGrid(stats, "hero", { hp: 1500, hpDelta: both }) as unknown as F;
  const btn = g.querySelector("span.fc-mod-btn")!;
  assert.equal(btn.getAttribute("tabindex"), "0");
  btn.dispatch("focus");
  const tipBox = body().children.find((x) => x.id === "tip")!;
  assert.equal(tipBox.textContent, hpDeltaTipLines(both).join(""));
  // the page passes it through cardTurnOf (turnOfCard), paintCard puts it on the grid
  assert.match(fn(page, "turnOfCard"), /cardTurnOf\(chart\?\.runs\[at\.run\]\?\.trace, at\.turn, who, nameOf\)/);
  assert.match(cardSrc, /\.\.\.\(t\.hpDelta \? \{ hpDelta: t\.hpDelta \} : \{\}\)/);
});

test("HP change from a real trace: the end-of-turn HP difference, the hits and heals behind it add up", () => {
  let seen = 0, healedSeen = 0;
  const whos = [0, ...new Set(odin.actions.flatMap((a) => a.life.map((l) => l.who)))];
  for (let t = 1; t <= odin.turns; t++) {
    for (const w of new Set(whos)) {
      const x = hpDeltaAt(odin, t, w, names);
      if (!x) continue;
      assert.equal(x.net, hpAt(odin, t, w)! - hpAt(odin, t - 1, w)!);
      const taken = x.taken.reduce((a, s) => a + s.value, 0), healed = x.healed.reduce((a, s) => a + s.value, 0);
      assert.equal(healed - taken, x.net, `turn ${t}, fighter ${w}: the sources explain the change`);
      if (x.taken.length) seen++;
      if (x.healed.length) healedSeen++;
      for (const s of [...x.taken, ...x.healed]) assert.ok(s.value > 0 && s.label.length > 0);
    }
  }
  assert.ok(seen > 0 && healedSeen > 0, "damage and heals both met in the Odin fight");
  assert.equal(hpDeltaAt(odin, 0, 1, names), null, "turn 0: no change");
  // cardTurnOf hands it to the card
  assert.deepEqual(cardTurnOf(odin, 3, 0, names).hpDelta, hpDeltaAt(odin, 3, 0, names));
  assert.deepEqual(cardTurnOf(undefined, 3, 0, names), { outcome: null });
});

// ---------------------------------------------------------------- 7. no effects line
test("no effects line under the stats any more (a stat effect is in its modifier, a lost action the 💫)", () => {
  assert.equal("fxList" in card, false);
  assert.doesNotMatch(cardSrc, /fc-fx/);
  assert.doesNotMatch(css, /\.fc-fx/);
  assert.doesNotMatch(read("web/src/ui/card-turn.ts"), /nonStatFx/);
  const rot = [0, 1, 2, 3, 4].map((k) => ({ text: `Skill ${k}` }));
  const c = fighterCard({ kind: "enemy", head: document.createElement("span") as unknown as HTMLElement, stats: null, rotation: rot }) as unknown as F;
  paintCard(c as unknown as HTMLElement, { stats: { maxHP: 10, atk: 1, matk: 1, def: 1, mdef: 1, acc: 1, eva: 1, crit: 1 }, hp: 5, active: 0,
    outcome: { row: 0, lost: "Stun", targets: [] } });
  assert.deepEqual(c.children.map((x) => x.className), ["fc-head", "fc-stats", "fc-rows fc-rot"]);
  assert.equal(c.querySelector("span.fc-out")!.textContent, "💫");
});
