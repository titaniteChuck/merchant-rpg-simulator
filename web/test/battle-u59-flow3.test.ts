// Battle Simulator and Solver U59: Flow 3 (web/src/ui/flow3.ts), one card per action in its fighter's column, in the
// order the fighters act, no turn bands and no end-of-turn summary. No browser: the data, the Flow built in the fake
// DOM, and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import type { TracedFight } from "../src/ui/battle-plan.ts";
import { type Flow3Card, flow3Items, flow3Sentence, renderFlow3 } from "../src/ui/flow3.ts";
import { loadTimelineData, partyPlan, type PlanMember } from "../src/ui/timeline.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* Flow 3 */"), css.indexOf("/* end Flow 3 */"));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const timelines = JSON.parse(read("inventory/timelines.json"));
(globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(timelines)).buffer });
await loadTimelineData();

const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const members: PlanMember[] = IDX.flatMap((row, r) => row.map((idx, i): PlanMember => {
  const raw = sv.raw.hero[idx];
  return { row: r ? "back" : "front", i, name: String(raw.name), cls: Number(raw.class), rotation: api.newHero(raw).attackList.slice(1, 6) };
}));
const traceOf = (quest: number) => {
  const [f, b] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  return traceFight(sim, quest, [...f], [...b]);
};
const render = (trace: TracedFight) => renderFlow3({ id: 72, rare: false }, members, trace) as unknown as FakeElement;
const gridRow = (e: FakeElement) => Number(/grid-row: (\d+)/.exec(e.getAttribute("style") ?? "")![1]);

const odin = traceOf(72); // Odin: lost on turn 14, heroes fall on the way

test("the signature matches Flow 1's entry point (partyPlan)", () => {
  const f3: typeof partyPlan = renderFlow3;
  assert.equal(typeof f3, "function");
  assert.equal(renderFlow3({ id: 999999, rare: false }, members, odin), null, "no timeline: null, as Flow 1");
  // no fight to show: the rotation as planned, Flow 1's
  const plan = renderFlow3({ id: 72, rare: false }, members, null) as unknown as FakeElement;
  assert.ok(plan.querySelector("div.pg-turngroup"));
});

test("one card per action, in its fighter's column; a fighter that is down shows one † per fall, not a card", () => {
  const flow = render(odin);
  const cards = flow.querySelectorAll("li.f3-card");
  const acted = odin.actions.filter((a) => a.did !== null);
  assert.equal(cards.length, acted.length, "one card per action played (or lost to a stun)");
  const cols = members.length + 1;
  assert.equal(flow.getAttribute("style"), `--pg-cols: ${cols}`);
  assert.equal(flow.querySelector("div.f3-heads")!.children.length, cols);
  // each card names its fighter, in that fighter's column
  const heads = flow.querySelector("div.f3-heads")!.children.map((h) => h.querySelector("strong")!.textContent);
  for (const c of cards) {
    const col = Number(/--f3-col: (\d+)/.exec(c.getAttribute("style")!)![1]);
    assert.equal(c.querySelector("span.f3-who")!.textContent, heads[col - 1]);
  }
  // down: the trace has no action for a fallen fighter; each hero down at the start of a later turn gets one "†",
  // in its column, and no card after it (nobody stands up again in this fight)
  const last = odin.actions.at(-1)!;
  const fell = [...new Set(odin.actions.filter((a) => a.turn < last.turn).flatMap((a) => a.life.filter((l) => l.who > 0 && l.hp <= 0).map((l) => l.who)))];
  assert.ok(fell.length > 0, "Odin's fight has heroes down");
  const items = flow.querySelector("ol.f3-grid")!.children;
  const dead = items.filter((i) => i.classList.contains("f3-dead"));
  assert.equal(dead.length, fell.length, "one † per fallen hero, not one per turn");
  const colOf = (e: FakeElement) => Number(/--f3-col: (\d+)/.exec(e.getAttribute("style")!)![1]);
  for (const d of dead) {
    assert.match(d.textContent, /†/);
    assert.match(d.querySelector("span.sr-only")!.textContent, /^Turn \d+, .+ is down\.$/);
    const later = items.slice(items.indexOf(d) + 1).filter((i) => i.classList.contains("f3-card") && colOf(i) === colOf(d));
    assert.equal(later.length, 0, "no card after its †");
  }
});

test("chronological: each item on its own grid row, in the DOM's reading order, as the fighters acted", () => {
  const flow = render(odin);
  const items = flow.querySelector("ol.f3-grid")!.children;
  const rows = items.map(gridRow);
  rows.forEach((r, k) => assert.equal(r, k + 1, "rows follow the DOM order, one item per row"));
  // the cards' sentences follow the trace's action order
  const cards = items.filter((i) => i.classList.contains("f3-card"));
  const acted = odin.actions.filter((a) => a.did !== null);
  const turns = cards.map((c) => Number(c.dataset.turn));
  assert.deepEqual(turns, acted.map((a) => a.turn));
  for (const [k, c] of cards.entries()) assert.ok(c.querySelector("span.sr-only")!.textContent.startsWith(`Turn ${acted[k].turn}, `));
});

test("no turn headers and no end-of-turn summary: a hairline between turns, a T tag on each turn's first item", () => {
  const flow = render(odin);
  for (const sel of ["div.tc-turnrow", "div.tc-turnhead", "div.tc-status", "div.tc-turn", "div.pg-turngroup", "[role=rowheader]", "[role=row]"]) {
    assert.equal(flow.querySelectorAll(sel).length, 0, sel);
  }
  const items = flow.querySelector("ol.f3-grid")!.children;
  const breaks = items.filter((i) => i.classList.contains("f3-break"));
  assert.equal(breaks.length, odin.turns - 1, "one hairline between two turns");
  for (const b of breaks) {
    assert.equal(b.textContent, "");
    assert.equal(b.getAttribute("aria-hidden"), "true");
  }
  const tags = flow.querySelectorAll("span.f3-t");
  assert.deepEqual(tags.map((t) => t.textContent), Array.from({ length: odin.turns }, (_, k) => `T${k + 1}`));
  // the tag sits on the first item after each hairline (and on the very first)
  items.forEach((it, k) => {
    if (it.classList.contains("f3-break")) assert.ok(items[k + 1].querySelector("span.f3-t"));
  });
  // the result stays at the end
  assert.match(flow.querySelector("p.tc-result")!.textContent, /Lost on turn 14/);
});

test("a card: name, skill as headline, the result, then HP and each effect on a line of its own", () => {
  const flow = render(odin);
  const cards = flow.querySelectorAll("li.f3-card");
  for (const c of cards) {
    const kids = c.children.map((k) => k.className);
    const at = (cls: string) => kids.findIndex((k) => k.split(" ").includes(cls));
    assert.ok(at("sr-only") === 0 && at("f3-top") < at("f3-skill") && at("f3-skill") < at("f3-state"));
    if (at("f3-out") >= 0) assert.ok(at("f3-skill") < at("f3-out") && at("f3-out") < at("f3-state"));
    assert.equal(c.querySelector("div.f3-hp")!.getAttribute("role"), "img");
  }
  // some card hits, one shows effects as a vertical list
  assert.ok(cards.some((c) => c.querySelector("span.tc-dmg")));
  const fx = cards.find((c) => c.querySelector("ul.f3-fx"))!;
  assert.ok(fx, "a card with effects");
  for (const li of fx.querySelector("ul.f3-fx")!.children) assert.equal(li.tagName, "li");
  // a party buff is one row, "Party", not one per hero
  const buff = cards.find((c) => /: [^;]+ on the party, /.test(c.querySelector("span.sr-only")!.textContent))!;
  assert.ok(buff, "a party buff in Odin's fight");
  const rows = buff.querySelector("ul.f3-out")!.children;
  assert.deepEqual(rows.map((r) => r.querySelector("span.f3-to")!.textContent), ["Party"]);
  // no coloured dots: effects are their text
  assert.doesNotMatch(block, /f3-fx[^{]*::before/);
});

test("the HP on a card is the fighter's right after its action", () => {
  const flow = render(odin);
  const cards = flow.querySelectorAll("li.f3-card");
  const acted = odin.actions.filter((a) => a.did !== null);
  for (const [k, c] of cards.entries()) {
    const a = acted[k], v = a.life.find((l) => l.who === a.who)!;
    const label = c.querySelector("div.f3-hp")!.getAttribute("aria-label")!;
    if (v.hp > 0) assert.ok(label.includes(`${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v.hp)} / `), label);
    else assert.match(label, /is down/);
  }
});

test("HP: \"remaining / total\" inside one compact bar, no number beside it; down is 0 / total in an empty bar", () => {
  const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const flow = render(odin);
  const cards = flow.querySelectorAll("li.f3-card");
  const acted = odin.actions.filter((a) => a.did !== null);
  for (const [k, c] of cards.entries()) {
    const a = acted[k], v = a.life.find((l) => l.who === a.who)!;
    const hp = c.querySelector("div.f3-hp")!;
    assert.equal(hp.querySelectorAll("span.f3-hpnum").length, 0, "no separate number");
    assert.equal(hp.children.length, 1, "the bar alone");
    const bar = hp.children[0];
    assert.ok(bar.classList.contains("f3-hpbar"));
    assert.equal(bar.getAttribute("aria-hidden"), "true");
    // the fill, then the text over it
    assert.ok(bar.children[0].classList.contains("f3-hpfill") && bar.children[1].classList.contains("f3-hptxt"));
    const full = bar.querySelector("span.f3-hpfull")!.textContent;
    assert.equal(full, `${fmt.format(Math.max(0, v.hp))} / ${fmt.format(v.maxHP)}`);
    // the compact form only for a total of 10,000 and over
    const short = bar.querySelector("span.f3-hpshort")!.textContent;
    if (v.maxHP < 10_000) assert.equal(short, full);
    else assert.match(short, /^[\d.]+[KMB]? \/ [\d.]+[KMB]$/);
  }
  // the made-up fight: the boss at 9,700 of 10,000 reads "9.7K / 10K" when the bar is narrow
  const small = renderFlow3({ id: 72, rare: false }, members, made) as unknown as FakeElement;
  const shorts = small.querySelectorAll("span.f3-hpshort").map((s) => s.textContent);
  assert.ok(shorts.includes("9.7K / 10K"), shorts.join(", "));
  // a fighter that falls on its own action (a recoil): "0 / 2,000" in an empty bar, the label unchanged
  const recoil = { ...made, actions: [act(1, 2, "Basic", [{ who: 2, dmg: 2000, heal: 0, hp: 0, ko: true }], life(10000, 0, 1000))] };
  const down = (renderFlow3({ id: 72, rare: false }, members, recoil) as unknown as FakeElement).querySelector("div.f3-hp")!;
  assert.ok(down.classList.contains("down"));
  assert.match(down.getAttribute("aria-label")!, / is down$/);
  assert.match(down.querySelector("span.f3-hpfull")!.textContent, /^0 \/ /);
  assert.match(down.querySelector("span.f3-hpfill")!.getAttribute("style")!, /width: 0\.0%/);
});

test("CSS: the HP bar holds one line of text, readable over the fill and the empty part; compact when narrow", () => {
  const bar = block.match(/\.f3-hpbar \{[^}]*\}/)![0];
  assert.match(bar, /container: f3hp \/ inline-size;/);
  assert.match(bar, /height: 13px;/);
  const txt = block.match(/\.f3-hptxt \{[^}]*\}/)![0];
  assert.match(txt, /line-height: 13px;/);
  assert.match(txt, /color: var\(--fg\);/);
  assert.match(txt, /text-shadow: [^;]*var\(--card\)/);
  assert.match(txt, /white-space: nowrap;/);
  // the fill is a tint, so the text's colour holds over it
  assert.match(block, /\.f3-hpfill \{[^}]*background: color-mix\(in srgb, var\(--good\) 55%, transparent\);/);
  assert.doesNotMatch(block, /\.f3-hpnum/);
  assert.match(block, /\.f3-hpshort \{ display: none; \}/);
  const narrow = block.slice(block.indexOf("@container f3hp (max-width: 118px)"));
  assert.match(narrow, /\.f3-hpfull \{ display: none; \}\s*\.f3-hpshort \{ display: inline; \}/);
  // a shorter state area
  assert.match(block, /\.f3-state \{ margin-top: 3px; padding-top: 3px;/);
});

test("a calculation opens inside its card, and closes again", () => {
  const flow = render(odin);
  const card = flow.querySelectorAll("li.f3-card").find((c) => c.querySelector("button.f3-calc-btn"))!;
  const btn = card.querySelector("button.f3-calc-btn")!;
  assert.match(btn.getAttribute("aria-label")!, /^Calculation: the (damage to|healing on) /);
  btn.dispatch("click");
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(card.children.at(-1)!.classList.contains("f3-calc"), true);
  assert.ok(card.querySelector("div.cf-block"));
  btn.dispatch("click");
  assert.equal(card.querySelectorAll("div.f3-calc").length, 0);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
});

// ---------------------------------------------------------------- a small made-up fight
const names: Record<number, string> = { 0: "Boss", 2: "Warrior", 1: "Mage" };
const nameOf = (w: number) => names[w];
const life = (boss: number, war: number, mage: number) => [{ who: 0, hp: boss, maxHP: 10000 }, { who: 2, hp: war, maxHP: 2000 }, { who: 1, hp: mage, maxHP: 1000 }];
const act = (turn: number, who: number, did: string | false | null, hits: TracedFight["actions"][number]["hits"], l: ReturnType<typeof life>) =>
  ({ turn, who, planned: did || "Basic", did, misses: 0, hits, fx: [], life: l });
const made: TracedFight = {
  won: false, turns: 4,
  actions: [
    act(1, 2, "Basic", [{ who: 0, dmg: 300, heal: 0, hp: 9700 }], life(9700, 2000, 1000)),
    act(1, 0, "Basic", [{ who: 1, dmg: 1000, heal: 0, hp: 0, ko: true }], life(9700, 2000, 0)),
    act(2, 1, null, [], life(9700, 2000, 0)),
    act(2, 2, "Basic", [], life(9700, 2000, 0)),
    act(2, 0, "Basic", [], life(9700, 2000, 0)),
    act(3, 1, null, [], life(9700, 2000, 0)),
    act(3, 2, "Basic", [{ who: 0, dmg: 1240, heal: 0, hp: 8460 }], life(8460, 2000, 0)),
    act(3, 0, "Basic", [], life(8460, 2000, 0)),
    act(4, 1, null, [], life(8460, 2000, 0)),
  ],
};
const whoCols = [1, 2, 0];

test("the screen-reader sentence: \"Turn 3, Warrior: Basic on Boss, 1,240 damage\"", () => {
  const items = flow3Items(made, whoCols, nameOf);
  const cards = items.filter((i): i is Flow3Card => i.kind === "card");
  const t3 = cards.find((c) => c.turn === 3)!;
  assert.equal(flow3Sentence(t3, whoCols, nameOf), "Turn 3, Warrior: Basic on Boss, 1,240 damage");
  assert.equal(flow3Sentence(cards[1], whoCols, nameOf), "Turn 1, Boss: Basic on Mage, 1,000 damage, falls");
  assert.equal(flow3Sentence(cards.find((c) => c.turn === 2 && c.who === 0)!, whoCols, nameOf), "Turn 2, Boss: Basic");
  // a stun: the action is lost
  const stunned = flow3Items({ ...made, actions: [act(1, 2, false, [], life(10000, 2000, 1000))] }, whoCols, nameOf)[0] as Flow3Card;
  assert.equal(flow3Sentence({ ...stunned, line: { ...stunned.line, planned: "Basic" } }, whoCols, nameOf), "Turn 1, Warrior: stunned, Basic lost");
});

test("down: one † on the first action lost, nothing on the later turns; no hairline left alone, T tags move on", () => {
  const items = flow3Items(made, whoCols, nameOf);
  assert.deepEqual(items.map((i) => (i.kind === "break" ? "|" : `${i.kind === "dead" ? "†" : ""}${nameOf(i.who)}${i.first ? `@T${i.turn}` : ""}`)),
    ["Warrior@T1", "Boss", "|", "†Mage@T2", "Warrior", "Boss", "|", "Warrior@T3", "Boss"]);
  // turn 4 shows nothing (only the fallen Mage): no hairline for it
  assert.equal(items.at(-1)!.kind, "card");
  // today's trace has no action at all for a fighter that is down: the "†" still goes at its place in the next turn
  const now = flow3Items({ ...made, actions: made.actions.filter((a) => a.did !== null) }, whoCols, nameOf);
  assert.deepEqual(now, items);
  // the Mage acts last (after the Warrior): its "†" comes after the Warrior's card in turn 2
  const late = flow3Items({ ...made, actions: made.actions.filter((a) => a.did !== null) }, [2, 1, 0], nameOf);
  assert.deepEqual(late.map((i) => (i.kind === "break" ? "|" : `${i.kind === "dead" ? "†" : ""}${nameOf(i.who)}`)),
    ["Warrior", "Boss", "|", "Warrior", "†Mage", "Boss", "|", "Warrior", "Boss"]);
});

test("phone: no columns, one vertical list in chronological order, no head row, no notch", () => {
  const narrow = block.slice(block.indexOf("@container (max-width: 560px)"));
  assert.ok(narrow.length > 50, "a narrow-box rule");
  // the per-fighter columns are dropped: the list is a flex column, so the inline grid rows and columns don't apply
  assert.match(narrow, /\.f3-heads \{ display: none; \}/);
  assert.match(narrow, /\.f3-grid \{ display: flex; flex-direction: column;/);
  assert.doesNotMatch(narrow, /grid-column|grid-template-columns|::before/);
  // no span and no notch left anywhere
  assert.doesNotMatch(block, /--f3-nstart|--f3-nspan|--f3-notch/);
  // each card's fighter stands out: a class-colour edge on its left
  assert.match(narrow, /\.f3-card \{ border-left: 4px solid var\(--c, var\(--border\)\);/);
  // the "†" names its fighter in the list (the name hidden on a wide box)
  assert.match(block, /\.f3-dead-who \{ display: none; \}/);
  assert.match(narrow, /\.f3-dead-who \{ display: inline;/);
  const flow = render(odin);
  const items = flow.querySelector("ol.f3-grid")!.children;
  for (const it of items) assert.doesNotMatch(it.getAttribute("style") ?? "", /--f3-n|notch/);
  for (const d of items.filter((i) => i.classList.contains("f3-dead"))) {
    const who = d.querySelector("span.f3-dead-who")!;
    assert.equal(who.getAttribute("aria-hidden"), "true");
    assert.ok(d.querySelector("span.sr-only")!.textContent.includes(`${who.textContent} is down`));
  }
  // the list's order is the DOM's: the turns never go back, every card carries its fighter's name
  const turns = items.filter((i) => i.dataset.turn !== undefined).map((i) => Number(i.dataset.turn));
  turns.forEach((t, k) => assert.ok(k === 0 || t >= turns[k - 1], "chronological"));
  for (const c of items.filter((i) => i.classList.contains("f3-card"))) assert.ok(c.querySelector("span.f3-who")!.textContent.length > 0);
  // a calculation opens inside its card, so at the card's (full) width
  const card = items.find((i) => i.querySelector("button.f3-calc-btn"))!;
  card.querySelector("button.f3-calc-btn")!.dispatch("click");
  assert.ok(card.querySelector("div.f3-calc"), "the calculation is a child of the card");
});

test("CSS: the Flow 3 block, one long page (no scroll frame), the columns' grid, a narrow-box rule, theme tokens", () => {
  assert.ok(block.length > 200, "a /* Flow 3 */ block");
  assert.match(block, /\.f3-heads, \.f3-grid \{ display: grid; grid-template-columns: repeat\(var\(--pg-cols\), minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(block, /overflow(-y)?: (auto|scroll)|max-height|min-width: [1-9]/);
  assert.match(block, /@container \(max-width: 560px\)/);
  assert.match(block, /\.f3 \{ container-type: inline-size;/);
  for (const token of ["--card-2", "--fg", "--muted", "--border", "--good", "--bg"]) assert.ok(block.includes(`var(${token})`), token);
  assert.match(block, /:root\[data-theme="light"\] \.f3-card/);
});

test("Flow 1 is untouched by Flow 3: the same bands and status lines", () => {
  const plan = partyPlan({ id: 72, rare: false }, members, odin) as unknown as FakeElement;
  assert.ok(plan.querySelectorAll("div.tc-turnrow").length >= 10);
  assert.equal(plan.querySelectorAll("li.f3-card").length, 0);
});
