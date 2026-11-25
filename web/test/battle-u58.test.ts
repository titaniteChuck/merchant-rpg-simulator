// Battle Simulator and Solver U58: the tabs Party · Flow 1 · Flow 2 · Flow 3 over one Flow panel (flow-layouts.ts, a
// registry of layouts with Flow 1's signature); Flow 2 (flow2.ts): no column heads, a row of fighter cards (name, HP at
// the turn's start, buffs then debuffs one per line) before each turn's actions, fallen fighters dimmed at 0 HP.
// No browser: the registry, the Flow built in the fake DOM, and the pages read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { planTimeline, type TimelineChip } from "../src/ui/battle-plan.ts";
import { FLOW_LAYOUTS, flowLayout, isFlow, parseTab } from "../src/ui/flow-layouts.ts";
import { fighterCard, fightStart, flow2Note, renderFlow2 } from "../src/ui/flow2.ts";
import { renderFlow3 } from "../src/ui/flow3.ts";
import { loadTimelineData, partyPlan, type PlanMember } from "../src/ui/timeline.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css");
const f2css = css.slice(css.indexOf("/* Flow 2 */"), css.indexOf("/* end Flow 2 */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

// ---------------------------------------------------------------- 1. the registry and the tabs
test("the registry: Flow 1 (timeline.ts partyPlan), Flow 2, Flow 3, in tab order, one signature", () => {
  assert.deepEqual(FLOW_LAYOUTS.map((l) => [l.id, l.label]), [["flow1", "Flow 1"], ["flow2", "Flow 2"], ["flow3", "Flow 3"]]);
  assert.equal(flowLayout("flow1").render, partyPlan, "Flow 1 is the Flow as it was");
  assert.equal(flowLayout("flow2").render, renderFlow2);
  assert.equal(flowLayout("flow3").render, renderFlow3);
  assert.equal(flowLayout("nope").id, "flow1");
  // each its own short help
  const q = { id: 72, rare: false };
  const helps = FLOW_LAYOUTS.map((l) => l.help(q, true));
  assert.equal(new Set(helps).size, 3);
  assert.ok(flow2Note(true).length > flow2Note(false).length, "the Solver's (read-only) leaves out the pickers");
});

test("tabs read back: Party, a Flow; the old \"flow\" is Flow 1; anything else Party", () => {
  assert.equal(parseTab("party"), "party");
  assert.equal(parseTab("flow"), "flow1");
  for (const t of ["flow1", "flow2", "flow3"]) assert.equal(parseTab(t), t);
  assert.equal(parseTab(null), "party");
  assert.equal(parseTab("flow9"), "party");
  assert.ok(isFlow("flow2") && !isFlow("party") && !isFlow("flow"));
});

test("both pages: Party · Flow 1 · Flow 2 · Flow 3, one Flow panel labelled by the open Flow tab", () => {
  for (const name of ["site/battle.html", "site/solver.html"]) {
    const html = read(name);
    const row = html.slice(html.indexOf('<div class="b3-tab-row">'), html.indexOf('<div id="flow-panel"'));
    const tabs = [...row.matchAll(/<button id="tab-(\w+)" type="button" role="tab" aria-selected="(\w+)" aria-controls="([\w-]+)" data-tab="(\w+)"( tabindex="-1")?>([^<]+)<\/button>/g)];
    assert.deepEqual(tabs.map((m) => m[6]), ["Party", ...FLOW_LAYOUTS.map((l) => l.label)], name);
    assert.deepEqual(tabs.map((m) => m[1]), tabs.map((m) => m[4]), "id tab-<data-tab>");
    assert.deepEqual(tabs.map((m) => m[3]), ["setup-grid", "flow-panel", "flow-panel", "flow-panel"]);
    assert.deepEqual(tabs.map((m) => Boolean(m[5])), [false, true, true, true], "roving tabindex: only Party starts in the tab order");
    assert.match(row, /<span id="party-help"><\/span><span id="plan-help" hidden><\/span>/);
    assert.match(html, /<div id="flow-panel" class="flow-panel" role="tabpanel" aria-labelledby="tab-flow1" hidden>/);
  }
  const show = fn(page, "showTab");
  assert.match(show, /const flow = isFlow\(tab\);/);
  assert.match(show, /\$\("#flow-panel"\)\.setAttribute\("aria-labelledby", `tab-\$\{tab\}`\);/);
  assert.match(show, /if \(flowDrawn !== null && flowDrawn !== tab\) renderPlan\(\);/, "another layout redraws the panel");
  assert.match(show, /flowTip\.hidden = !flow;/, "the \"?\" follows the open tab");
  // the keyboard: the tablist pattern, unchanged
  assert.match(fn(page, "initTabs"), /if \(list\) tabKeys\(list\);/);
  // remembered per page
  assert.match(page, /const tabKey = \(\) => \(solving\(\) \? "solver-tab" : "battle-tab"\);/);
  assert.match(fn(page, "storedTab"), /parseTab\(sessionStorage\.getItem\(tabKey\(\)\)\)/);
  // the panel is drawn by the open layout, the help is its own
  const plan = fn(page, "renderPlan");
  assert.match(plan, /const layout = flowLayout\(flowChoice\);/);
  assert.equal((plan.match(/layout\.render\(/g) ?? []).length, 2, "quest and map room");
  assert.equal((plan.match(/layout\.help\(/g) ?? []).length, 2);
  assert.doesNotMatch(plan, /partyPlan\(|planNote\(/);
});

// ---------------------------------------------------------------- 2. Flow 2
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const timelines = JSON.parse(read("inventory/timelines.json"));
(globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(timelines)).buffer });
await loadTimelineData();
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const members: PlanMember[] = IDX.flatMap((row, r) => row.map((idx, i): PlanMember => {
  const raw = sv.raw.hero[idx];
  return { row: r ? "back" : "front", i, name: String(raw.name), cls: Number(raw.class), rotation: api.newHero(raw).attackList.slice(1, 6),
    level: Number(raw.level), asc: 0 };
}));
const traceOf = (quest: number) => {
  const [f, b] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  return traceFight(sim, quest, [...f], [...b]);
};
const flow2 = (quest: number) => renderFlow2({ id: quest, rare: false }, members, traceOf(quest)) as unknown as FakeElement;

test("Flow 2: no column heads; each turn is its band, a row of cards (one per fighter), then its actions", () => {
  const plan = flow2(72); // Odin: lost on turn 14
  assert.ok(plan.classList.contains("f2"));
  assert.equal(plan.querySelectorAll("div.pg-heads").length, 0, "no header row");
  assert.equal(plan.querySelectorAll("[role=columnheader]").length, 0);
  const turns = plan.querySelectorAll("div.tc-turn").filter((t) => !t.classList.contains("tc-unreached"));
  const trace = traceOf(72);
  assert.equal(turns.length, trace.turns + 1, "every turn, then the end");
  for (const [k, t] of turns.entries()) {
    const [band, cards, lines] = t.children;
    assert.ok(band.classList.contains("tc-turnrow"));
    assert.equal(band.children[0].getAttribute("role"), "rowheader");
    assert.ok(band.children[0].textContent.startsWith(k < trace.turns ? `Turn ${k + 1}` : "End"));
    assert.ok(cards.classList.contains("f2-cards"));
    assert.equal(cards.getAttribute("role"), "row");
    assert.equal(cards.children.length, 7, "the six heroes and the enemy");
    assert.ok(cards.children.every((c) => c.classList.contains("f2-card") && c.getAttribute("role") === "cell"));
    assert.equal(cards.children.filter((c) => c.classList.contains("enemy")).length, 1, "one enemy card");
    if (k < trace.turns) assert.ok(lines.classList.contains("tc-lines"));
  }
  // names on every card, duplicated every turn; the place and level only on turn 1's
  const first = turns[0].children[1].children;
  assert.deepEqual(first.map((c) => c.querySelector("div.f2-name")!.textContent.replace("✝", "")), planNames(), "Flow 1's column order");
  const heroes = first.filter((c) => c.classList.contains("hero")), enemy = first.find((c) => c.classList.contains("enemy"))!;
  for (const h of heroes) assert.match(h.querySelector("div.f2-meta")!.textContent, /^(Front|Back) \d · lvl \d+$/);
  assert.equal(enemy.querySelector("div.f2-meta")!.textContent, "enemy");
  assert.equal(turns[1].children[1].querySelectorAll("div.f2-meta").length, 0);
  // the effects left the action lines (they are in the cards)
  assert.equal(plan.querySelectorAll("span.tc-fx").length, 0);
  assert.equal(plan.querySelectorAll("div.tc-status").length, 0);
  assert.ok(plan.querySelectorAll("li.f2-fx").length > 0);
  assert.ok(plan.querySelector("p.tc-result"));
});
/** Flow 1's column order (its heads) for the same party. */
function planNames(): string[] {
  const p = partyPlan({ id: 72, rare: false }, members, traceOf(72)) as unknown as FakeElement;
  return p.querySelector("div.pg-heads")!.children.map((h) => h.querySelector("strong")!.textContent);
}

test("Flow 2: a card's HP is the HP at its turn's start (Flow 1's end of the turn before; turn 1 from the trace)", () => {
  const trace = traceOf(72);
  const data = planTimeline(trace, [1, 2, 3, 4, 5, 6]);
  const plan = flow2(72);
  const turns = plan.querySelectorAll("div.f2-turn");
  const enemyHP = (t: FakeElement) => t.children[1].children.find((c) => c.classList.contains("enemy"))!.querySelector("span.f2-full")!.textContent;
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, n));
  for (let k = 1; k < turns.length; k++) assert.equal(enemyHP(turns[k]), fmt(data.turns[k - 1].hp[0].hp), `turn ${k + 1}`);
  const start = fightStart(trace);
  assert.equal(enemyHP(turns[0]), fmt(start[0].hp));
  for (const l of Object.values(start)) assert.ok(l.hp > 0 && l.hp <= l.maxHP, "everyone standing at the start of a quest fight");
  // a screen reader reads the HP as text
  assert.match(turns[0].children[1].children[1].querySelector("div.f2-hp")!.textContent, /[\d,]+ \/ [\d,]+ HP/);
});

test("Flow 2: buffs and debuffs listed one under the other, buffs first, text only with the turns left", () => {
  const plan = flow2(72);
  const withBoth = plan.querySelectorAll("div.f2-card").find((c) => c.querySelector("ul.buffs") && c.querySelector("ul.debuffs"))
    ?? plan.querySelectorAll("div.f2-card").find((c) => c.querySelector("ul.f2-fxs"))!;
  assert.ok(withBoth, "a card with effects");
  const lists = withBoth.children.filter((c) => c.tagName === "UL" || c.tagName === "ul");
  assert.ok(lists.length >= 1);
  if (lists.length === 2) assert.deepEqual(lists.map((l) => l.classList.contains("buffs")), [true, false], "buffs, then debuffs");
  for (const li of withBoth.querySelectorAll("li.f2-fx")) {
    assert.ok(li.querySelector("span.f2-fx-name")!.textContent.length > 0);
    assert.ok(li.getAttribute("title"), "the source on hover");
    assert.match(li.querySelector("span.visually-hidden")!.textContent, /^(Buff|Debuff): $/);
  }
  // as a unit: mixed effects come out buffs first, one line each
  const chip = (label: string, debuff: boolean, turns?: number): TimelineChip => ({ who: 1, name: label, label, debuff, title: label, ...(turns ? { turns } : {}) });
  const card = fighterCard({ name: "Ana", enemy: false, cls: 5, life: { hp: 50, maxHP: 100 }, when: "start of turn 2",
    fx: [chip("−20% Def", true, 2), chip("+15% Atk", false, 3), chip("Taunt", false), chip("Stun", true, 1)] }) as unknown as FakeElement;
  assert.deepEqual(card.querySelectorAll("span.f2-fx-name").map((s) => s.textContent), ["+15% Atk", "Taunt", "−20% Def", "Stun"]);
  assert.deepEqual(card.querySelectorAll("span.f2-fx-left").map((s) => s.textContent), ["3", "2", "1"]);
  assert.ok(card.classList.contains("cls-5"));
  assert.equal(card.querySelector("div.f2-hp")!.classList.contains("mid"), true);
  // CSS: one per line, no coloured dots
  assert.match(f2css, /\.f2-fxs \{[^}]*flex-direction: column;/);
  assert.doesNotMatch(f2css, /\.f2-fx[^{]*::(before|after)/);
});

test("Flow 2: a fallen fighter's card is dimmed, ✝ before its name, the bar at 0, no effects", () => {
  const card = fighterCard({ name: "Ana", enemy: false, cls: 1, life: { hp: 0, maxHP: 900 }, when: "start of turn 9",
    fx: [{ who: 1, name: "x", label: "+10% Atk", debuff: false, title: "x" }] }) as unknown as FakeElement;
  assert.ok(card.classList.contains("dead"));
  assert.equal(card.querySelector("span.f2-dead")!.textContent, "✝");
  assert.match(card.querySelector("span.f2-bar")!.children[0].getAttribute("style")!, /width: 0\.0%/);
  assert.equal(card.querySelector("span.f2-full")!.textContent, "0");
  assert.match(card.querySelector("div.f2-hp")!.textContent, /down, 0 \/ 900 HP/);
  assert.equal(card.querySelectorAll("li.f2-fx").length, 0);
  // in a real fight: Odin wins, so heroes fall; their cards say so from the next turn on
  const plan = flow2(72);
  const dead = plan.querySelectorAll("div.f2-card.dead");
  assert.ok(dead.length > 0, "someone falls against Odin");
  assert.match(f2css, /\.f2-card\.dead \{[^}]*dashed/);
  assert.match(f2css, /\.f2-card\.dead \.f2-name \{ color: var\(--muted\); \}/);
});

test("Flow 2: the calculations open in their column (calcColumn), as in Flow 1", () => {
  const plan = flow2(72);
  const line = plan.querySelectorAll("div.tc-line").find((l) => l.children.some((c) => c.querySelector("button.tc-calc-btn")))!;
  const lines = line.parentNode!.children;
  const box = lines[lines.indexOf(line) + 1];
  assert.ok(box.classList.contains("tc-calcs"));
  const k = line.children.findIndex((c) => c.querySelector("button.tc-calc-btn"));
  line.children[k].querySelector("button.tc-calc-btn")!.dispatch("click");
  assert.equal(box.hidden, false);
  assert.equal(box.children[0].style.gridColumn, String(k + 1));
});

test("Flow 2 without a fight: Flow 1's planned rotation; Flow 1 keeps its heads, effects and end-of-turn band", () => {
  const planned = renderFlow2({ id: 72, rare: false }, members, null) as unknown as FakeElement;
  assert.equal(planned.querySelectorAll("div.pg-turngroup").length, 5);
  const f1 = partyPlan({ id: 72, rare: false }, members, traceOf(72)) as unknown as FakeElement;
  assert.ok(f1.querySelector("div.pg-heads"));
  assert.ok(f1.querySelectorAll("div.tc-status").length > 0);
  assert.equal(f1.querySelectorAll("div.f2-card").length, 0);
});

test("Flow 3: registered; until U59 lands, \"Coming soon\"", () => {
  const out = renderFlow3({ id: 72, rare: false }, members, traceOf(72)) as unknown as FakeElement | null;
  assert.ok(out);
});

test("CSS: Flow 2's own block: the cards share the lines' columns; a narrow card stacks its bar over its number", () => {
  assert.match(f2css, /\.f2-cards \{ display: grid; grid-template-columns: repeat\(var\(--pg-cols\), minmax\(0, 1fr\)\); gap: 3px;/);
  assert.match(f2css, /\.f2-card \{[^}]*container-type: inline-size;/);
  assert.match(f2css, /@container \(max-width: 84px\) \{\s*\.f2-hp \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(f2css, /\.f2-card\.asc-1, \.f2-card\.asc-2 \{/);
  assert.doesNotMatch(f2css, /overflow: (auto|scroll)/, "no inner scroller");
});
