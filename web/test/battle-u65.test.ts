// Battle Simulator and Solver U65: the chart above the cards, full width, with HP · Damage dealt · Heals tabs; a click,
// a tap or a key on it picks the turn the cards show (HP, the engine's live stats, the effects, the row played; turn 0
// the start), from the Flows' own trace; a map room keeps its own turn 0 (U66: on the last turn's x); the enemy card shows one enemy (a map
// run: the selected turn's room's), its controls in the Simulate panel; no XP tiles in the details; the enemy line
// white (dark) or near-black (light). No browser: the data from known traces, the chart and cards in the fake DOM,
// the page code, HTML and CSS as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { fightSeed } from "../src/tools/combat.ts";
import { traceFight, traceMapRun } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { locationOf, mapRoomTabs, planTimeline } from "../src/ui/battle-plan.ts";
import { cardStats, fighterCard, paintCard } from "../src/ui/fighter-card.ts";
import { addCredits, CHART_TABS, chartLayout, chartTab, drawHpChart, hpChart, hpData, type HpFighter, HP_W, nearestStep, pickStep, plotted, stepAfterKey } from "../src/ui/hp-chart.ts";
import { fmt, fmtCompact } from "../src/ui/dom.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css");
const sim0 = read("site/battle.html"), solver = read("site/solver.html");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));
const block = css.slice(css.indexOf("/* U65 */"), css.indexOf("/* end U65 */"));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const fighters: HpFighter[] = IDX.flatMap((row, r) => row.map((idx, i): HpFighter => {
  const raw = sv.raw.hero[idx];
  return { who: locationOf(r ? "back" : "front", i), name: String(raw.name), cls: Number(raw.class) };
}));
const party = () => IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
const traceOf = (quest: number) => {
  const [f, b] = party();
  return traceFight(sim, quest, [...f], [...b]);
};
type F = FakeElement & HTMLElement;
const ODIN = 72; // a long fight: buffs, debuffs, heals, falls
const odin = traceOf(ODIN);
const odinData = hpData([{ trace: odin, enemy: "Odin", quest: { id: ODIN, rare: false } }], fighters)!;
const box = () => {
  const b = document.createElement("section") as unknown as F;
  (document.body as unknown as FakeElement).append(b);
  return b;
};

// ---------------------------------------------------------------- 0. the trace (read only)
test("the trace records each fighter's live stats and the start, and changes no result", () => {
  assert.ok(odin.start, "the fight's start is recorded");
  for (const l of odin.start!.life) {
    assert.deepEqual(Object.keys(l.stats!).sort(), ["acc", "atk", "crit", "def", "eva", "matk", "mdef"]);
    assert.equal(l.hp, l.maxHP, "a quest starts at full HP");
  }
  for (const a of odin.actions) for (const l of a.life) assert.ok(l.stats && Number.isFinite(l.stats.atk), "every life has its stats");
  // only the first action carries the start; a plain fight with the same seed ends the same
  assert.equal(odin.actions.filter((a) => "start" in a).length, 0, "the start is the fight's, not an action's");
  const [f, b] = party();
  const plain = sim.fight(ODIN, [...f], [...b], { seed: fightSeed(1, 0), isRare: false, amount: 1 });
  assert.equal(plain.won, odin.won);
  assert.equal(plain.turns, odin.turns);
  // Lua parity is checked by lua-parity.test.ts (the engine is untouched: the trace hooks only read)
  const hook = read("web/src/sim/api.ts");
  assert.match(hook, /function lifeOf\(b: Battle\): TraceLife\[\] \{\n\s*return fighters\(b\)\.map\(\(\[who, f\]\) => \(\{ who, hp: f\.questHP, maxHP: f\.maxHP,\n\s*stats: Object\.fromEntries\(TRACE_STATS\.map\(\(k\) => \[k, num\(f\[k\]\)\]\)\) \}\)\);/);
});

// ---------------------------------------------------------------- 1. the tabs' data
test("tabs data: damage dealt and heals per turn (U66: not added up), per fighter, from the same trace", () => {
  assert.deepEqual(CHART_TABS.map((t) => t.label), ["HP", "Damage dealt", "Heals"]);
  const d = odinData;
  // every fighter's per-turn amounts are its actions' calculations of that turn; turn 0 is 0
  for (const s of d.series) {
    assert.equal(s.dealt[0], 0);
    assert.equal(s.healed[0], 0);
    for (let t = 1; t <= odin.turns; t++) {
      const c = { dealt: {} as Record<number, number>, healed: {} as Record<number, number> };
      for (const a of odin.actions.filter((x) => x.turn === t)) addCredits(c, a);
      assert.equal(s.dealt[t], c.dealt[s.who] ?? 0, `${s.name} dealt, turn ${t}`);
      assert.equal(s.healed[t], c.healed[s.who] ?? 0, `${s.name} healed, turn ${t}`);
    }
  }
  // the totals match the trace's own hits: the party's damage is what landed on the enemy standing, the enemy's what
  // landed on the heroes, the healing all the HP given back
  const landed = (to: (w: number) => boolean) => odin.actions.flatMap((a) => a.hits).filter((h) => to(h.who)).reduce((n, h) => n + h.dmg, 0);
  const sum = (who: (w: number) => boolean, k: "dealt" | "healed") => d.series.filter((s) => who(s.who)).reduce((n, s) => n + s[k].reduce<number>((a, v) => a + (v ?? 0), 0), 0);
  assert.equal(sum((w) => w > 0, "dealt"), landed((w) => w === 0));
  assert.equal(sum((w) => w === 0, "dealt"), landed((w) => w > 0));
  assert.equal(sum(() => true, "healed"), odin.actions.flatMap((a) => a.hits).reduce((n, h) => n + h.heal, 0));
  assert.ok(sum(() => true, "healed") > 0, "Odin's fight has heals");
  // the drawing: one line per fighter on each tab, the damage axis in round amounts, the table per tab
  for (const t of CHART_TABS) {
    const fig = hpChart(d, { tab: t.id }) as unknown as F;
    assert.equal(fig.querySelectorAll("path.hp-line").length, d.series.length, t.label);
    assert.equal(fig.querySelector('[role="tab"][aria-selected="true"]')!.textContent, t.label);
    assert.equal(fig.querySelector("tbody")!.children.length, d.steps.length);
    assert.equal(fig.querySelectorAll("path.hp-death").length > 0, t.id === "hp", "falls are marked on the HP tab");
  }
  const dmg = hpChart(d, { tab: "dmg" }) as unknown as F;
  // U66: per turn, so the top is over the largest turn's amount drawn (a fallen hero's later turns are not drawn)
  const top = Math.max(...d.series.flatMap((s) => plotted(d, s, "dmg")).map((v) => v ?? 0));
  const labels = dmg.querySelectorAll("text.hp-axis").map((x) => x.textContent);
  assert.ok(labels.includes("0") && !labels.some((x) => x.endsWith("%")), "amounts, not percents");
  // U68: the top is the largest turn's amount itself (the plot's full height; U65-U67 rounded it up)
  assert.ok(labels.includes(fmtCompact.format(Math.round(top))), "the top: the largest turn");
  // U66: the legend only names; the table's cells are each turn's own amount
  const legend = dmg.querySelector("ul.hp-legend")!.children;
  for (const [k, s] of d.series.entries()) assert.equal(legend[k].textContent, s.name);
  assert.equal(dmg.querySelectorAll("span.hp-val").length, 0);
  const row3 = dmg.querySelector("tbody")!.children[3].querySelectorAll("td").map((c) => c.textContent);
  assert.deepEqual(row3, d.series.map((s) => fmt.format(s.dealt[3]!)));
});

test("tabs: a click on a tab draws it, the turn kept; the arrow keys move between tabs", () => {
  const b = box();
  let picked = -1;
  drawHpChart(b, odinData, { selected: 3, onSelect: (i) => (picked = i) });
  assert.equal(chartTab(), "hp");
  b.querySelector('[data-tab="dmg"]')!.dispatch("click");
  assert.equal(chartTab(), "dmg");
  assert.equal(b.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute("data-tab"), "dmg");
  assert.equal(b.querySelector("svg")!.getAttribute("aria-valuenow"), "3", "the selected turn stays");
  assert.equal((document as unknown as { activeElement: unknown }).activeElement, b.querySelector('[role="tab"][aria-selected="true"]'));
  const key = (k: string) => b.querySelector(".hp-tabs")!.listeners.get("keydown")![0]({ key: k, preventDefault() {} } as never);
  key("ArrowRight");
  assert.equal(chartTab(), "heal");
  key("Home");
  assert.equal(chartTab(), "hp");
  assert.equal(picked, -1, "a tab is no turn pick");
});

// ---------------------------------------------------------------- 2. picking the turn
test("turn selection: a click or tap picks the nearest turn, the keys move it; a marker line and the turn number", () => {
  const n = odinData.steps.length;
  const xs = chartLayout(odinData).xs;
  assert.equal(nearestStep(38, xs), 0);
  assert.equal(nearestStep(HP_W - 10, xs), n - 1);
  assert.equal(nearestStep(-50, xs), 0);
  assert.deepEqual([stepAfterKey("ArrowRight", 3, n), stepAfterKey("ArrowLeft", 3, n), stepAfterKey("ArrowUp", 3, n), stepAfterKey("ArrowDown", 0, n)], [4, 2, 4, 0]);
  assert.deepEqual([stepAfterKey("Home", 3, n), stepAfterKey("End", 3, n), stepAfterKey("PageUp", n - 2, n), stepAfterKey("a", 3, n)], [0, n - 1, n - 1, null]);
  const picks: number[] = [];
  const fig = hpChart(odinData, { selected: 0, onSelect: (i) => picks.push(i) }) as unknown as F;
  const svg = fig.querySelector("svg")!;
  assert.equal(svg.getAttribute("role"), "slider");
  assert.equal(svg.getAttribute("tabindex"), "0");
  assert.equal(svg.getAttribute("aria-valuemax"), String(n - 1));
  assert.equal(svg.getAttribute("aria-valuetext"), "Start");
  assert.equal(fig.querySelector("text.hp-sel-label")!.textContent, "Turn 0");
  // a click at turn 5 (the plot as wide as its viewBox)
  (svg as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: HP_W, height: 200 });
  const x5 = xs[5];
  svg.listeners.get("click")![0]({ clientX: x5 } as never);
  assert.deepEqual(picks, [5]);
  assert.equal(svg.getAttribute("aria-valuenow"), "5");
  assert.equal(svg.getAttribute("aria-valuetext"), "Turn 5");
  assert.equal(fig.querySelector("text.hp-sel-label")!.textContent, "Turn 5");
  assert.equal(fig.querySelector("line.hp-sel")!.getAttribute("x1"), String(Math.round(x5 * 10) / 10));
  // keys on the focused chart
  const key = (k: string) => svg.listeners.get("keydown")![0]({ key: k, preventDefault() {} } as never);
  key("ArrowRight");
  key("ArrowRight");
  key("ArrowLeft");
  key("End");
  key("Home");
  key("Home"); // already there: nothing new
  assert.deepEqual(picks, [5, 6, 7, 6, n - 1, 0]);
  // the page: the pick goes to the cards (no new trace)
  assert.match(fn(page, "selectTurn"), /turnPick = \{ run: chart\.steps\[i\]\.run, turn: chart\.steps\[i\]\.turn \};\n\s*stepAt = null;[^\n]*\n\s*paintTurn\(\);/);
  assert.doesNotMatch(fn(page, "selectTurn") + fn(page, "paintTurn"), /renderPlan|renderParty|planTrace|mapTrace/);
});

test("a new trace keeps the picked turn when the fight still has it, else turn 0", () => {
  assert.equal(pickStep(odinData, { run: 0, turn: 7 }), 7);
  assert.equal(pickStep(odinData, { run: 0, turn: 999 }), 0);
  assert.equal(pickStep(odinData, { run: 3, turn: 1 }), 0);
  assert.equal(pickStep(odinData, null), 0);
  const show = fn(page, "showHp");
  assert.match(show, /turnAt = chart \? pickStep\(chart, turnPick\) : 0;/);
  assert.match(page, /let turnPick: \{ run: number; turn: number \} = \{ run: 0, turn: 0 \};/, "turn 0 by default");
  // the redraw after an edit draws the marker where the cards are
  const b = box();
  drawHpChart(b, odinData, { selected: 4 });
  assert.equal(b.querySelector("svg")!.getAttribute("aria-valuenow"), "4");
});

// ---------------------------------------------------------------- 3. the cards at a chosen turn
test("the cards at a turn: HP, the engine's live stats, the effects and the row played, checked against the trace", () => {
  const tl = planTimeline(odin, [], (w) => (w ? fighters.find((f) => f.who === w)!.name : "Odin"));
  let live = 0;
  for (let t = 1; t <= odin.turns; t++) {
    const st = odinData.steps[t];
    assert.equal(st.turn, t);
    for (const [w, s] of Object.entries(st.states).map(([w, s]) => [Number(w), s] as const)) {
      const lives = odin.actions.filter((a) => a.turn <= t).flatMap((a) => a.life).filter((l) => l.who === w);
      const last = lives[lives.length - 1];
      assert.equal(s.hp, Math.max(0, last.hp));
      assert.equal(s.maxHP, last.maxHP);
      assert.deepEqual(s.stats, last.stats, `stats of ${w} at turn ${t}`);
      assert.deepEqual(s.fx, tl.turns[t - 1].status[w] ?? [], `effects of ${w} at turn ${t}`);
      const acted = odin.actions.find((a) => a.turn === t && a.who === w);
      assert.equal(s.active, acted && typeof acted.did === "string" ? (t - 1) % 5 : null);
      if (JSON.stringify(s.stats) !== JSON.stringify(odinData.steps[0].states[w].stats)) live++;
    }
  }
  assert.ok(live > 0, "some stats change with the effects (they are live, not the card's own)");
  // a card at a turn with effects: the bar, the stats, the effects under them and above the passive, the row played
  const t = odinData.steps.findIndex((s) => s.turn > 0 && Object.values(s.states).some((x) => x.fx.length && x.active !== null));
  const [w, s] = Object.entries(odinData.steps[t].states).find(([, x]) => x.fx.length && x.active !== null)!;
  const stats = { ...s.stats!, maxHP: s.maxHP };
  const rot = [0, 1, 2, 3, 4].map((k) => ({ text: `Skill ${k}` }));
  const kind = Number(w) ? "hero" : "enemy";
  const card = fighterCard({ kind, head: document.createElement("span") as unknown as HTMLElement, stats,
    turn: { hp: s.hp, active: s.active }, passive: { text: "Might" }, rotation: rot }) as unknown as F;
  const kids = card.children.map((c) => c.className);
  // U67: no HP bar; the HP cell reads "HP now / max HP"
  // U69: no effects line: the stats, then the passive
  assert.deepEqual(kids.slice(1, 4), ["fc-stats", "fc-rows fc-passive", "fc-rows fc-rot"], "stats, then the passive");
  assert.deepEqual(card.querySelectorAll("dd.fc-val").map((x) => (x.querySelector("span.v-full") ?? x).textContent),
    cardStats(kind).map(([k]) => (k === "maxHP" ? `${fmt.format(s.hp)} / ${fmt.format(s.maxHP)}`
      : Math.abs(stats[k]) >= 10_000 ? fmtCompact.format(stats[k]) : fmt.format(stats[k]))));
  assert.equal(card.querySelectorAll("ul.fc-fx").length, 0, "U69: no effects line");
  const rows = card.querySelectorAll("li.fc-turn");
  assert.deepEqual(rows.map((r) => r.classList.contains("active")), [0, 1, 2, 3, 4].map((k) => k === s.active));
  assert.equal(rows[s.active!].getAttribute("aria-current"), "true");
  // another turn painted in place: one grid, the effects and the mark follow (turn 0: none of them)
  paintCard(card as unknown as HTMLElement, { stats: odinData.steps[0].states[Number(w)].stats!, hp: 1, active: null });
  assert.equal(card.querySelectorAll(".fc-hp").length, 0, "U67: no HP bar");
  assert.equal(card.querySelectorAll("dl.fc-stats").length, 1);
  assert.equal(card.querySelectorAll("ul.fc-fx").length, 0);
  assert.equal(card.querySelectorAll("li.active").length, 0);
  paintCard(card as unknown as HTMLElement, { stats: null });
  assert.equal(card.querySelectorAll("span.fc-mod-btn").length, 0, "no fight: the card's own stats only");
  // the page paints every hero card and the enemy's from the chart's step (the Flows' trace)
  const paint = fn(page, "paintTurn");
  assert.match(paint, /const view = turnView\(\);\n\s*const at = view\?\.at;/, "U73: the turn's end, or a step within it");
  assert.match(fn(page, "turnView"), /const at = chart\?\.steps\[turnAt\];/);
  assert.match(paint, /paintCard\(card, inFight/);
  assert.match(paint, /stats: now\.stats \? \{ \.\.\.now\.stats, maxHP: now\.maxHP \}/);
  assert.match(paint, /\.\.\.turnOfCard\(at, w, now\)/, "U67: HP, modifiers, effects, outcome");
  assert.match(paint, /drawEnemyCard\(\);/);
  assert.match(fn(page, "showHp"), /paintTurn\(\);/);
});

test("turn 0: the start, before any action: full HP, the recorded stats, no effects, no row played", () => {
  const s0 = odinData.steps[0];
  assert.equal(s0.turn, 0);
  assert.equal(s0.label, "Start");
  for (const l of odin.start!.life) {
    const s = s0.states[l.who];
    assert.equal(s.hp, l.hp);
    assert.equal(s.hp, s.maxHP);
    assert.deepEqual(s.stats, l.stats);
    assert.deepEqual(s.fx, []);
    assert.equal(s.active, null);
  }
  // a hero's stats at turn 0 are its own, as the engine fights it (no effect yet): the hero's Atk and Def
  const [f] = party();
  const h = f[0] as unknown as Record<string, number>;
  assert.equal(s0.states[locationOf("front", 0)].stats!.atk, h.atk);
  assert.equal(s0.states[locationOf("front", 0)].stats!.def, h.def);
});

// ---------------------------------------------------------------- 4. a map run
test("a map run: each room keeps its turn 0 (U66: on the x of the last room's last turn), its state carried over", () => {
  const [f, b] = party();
  const rooms = traceMapRun(sim, { id: 1, prestigeLevel: 0, grade: 3 }, [...f], [...b]);
  const tabs = mapRoomTabs(rooms);
  const runs = rooms.flatMap((r, k) => (r.trace ? [{ trace: r.trace, enemy: r.name, room: tabs[k].label, quest: { id: r.questId, rare: r.isRare } }] : []));
  assert.ok(runs.length >= 2);
  const d = hpData(runs, fighters)!;
  // the steps: every room's turn 0 … n, one room after the other
  assert.deepEqual(d.steps.map((s) => [s.run, s.turn]), runs.flatMap((r, k) => Array.from({ length: r.trace.turns + 1 }, (_, t) => [k, t])));
  for (const [k, i] of d.runStarts.entries()) {
    const st = d.steps[i];
    assert.equal(st.turn, 0, "a room starts with its turn 0");
    assert.equal(st.label, `${runs[k].room}: start`);
    assert.equal(st.states[0].hp, st.states[0].maxHP, "the room's enemy at full HP");
    assert.deepEqual(d.runs[k].quest, runs[k].quest, "the room's enemy, for its card");
    if (!k) continue;
    // the heroes carry their HP over from the last room's last turn (no scroll here; the next room starts from the
    // HP rounded), their effects are gone
    const prev = d.steps[i - 1];
    for (const w of Object.keys(st.states).map(Number).filter((w) => w > 0)) {
      assert.ok(Math.abs(st.states[w].hp - prev.states[w].hp) < 1, `hero ${w} in room ${k + 1}: ${st.states[w].hp} after ${prev.states[w].hp}`);
      assert.deepEqual(st.states[w].fx, []);
    }
    // nobody acts at a turn 0
    for (const s of d.series) assert.ok(!s.dealt[i] && !s.healed[i]);
  }
  // the room boundaries: on the shared x; the keys walk room N's last turn → room N+1's turn 0 → its turn 1
  const n = d.steps.length, xs = chartLayout(d).xs;
  const svgEl = hpChart(d, { tab: "dmg" }) as unknown as F;
  const lines = svgEl.querySelectorAll("line.hp-room").map((l) => Number(l.getAttribute("x1")));
  assert.deepEqual(lines, d.runStarts.slice(1).map((i) => Math.round(xs[i] * 10) / 10));
  const i1 = d.runStarts[1];
  assert.equal(stepAfterKey("ArrowRight", i1 - 1, n), i1);
  assert.equal(stepAfterKey("ArrowRight", i1, n), i1 + 1);
  // the table: one row per step, every room's start row
  const rows = svgEl.querySelectorAll("th").filter((h) => h.getAttribute("scope") === "row").map((h) => h.textContent);
  assert.deepEqual(rows, d.steps.map((s) => s.label));
  assert.equal(rows.filter((r) => /: start$/.test(r!)).length, runs.length);
  // every step names its room's enemy (the enemy card follows the selected turn's room)
  for (const st of d.steps) assert.equal(d.runs[st.run].quest!.id, runs[st.run].quest.id);
  const card = fn(page, "drawEnemyCard");
  assert.match(card, /const run = chart\.runs\[at\.run\];\n\s*if \(run\.quest\) foe = \{ \.\.\.run\.quest, n: 1, room: run\.room \};/);
  assert.match(page, /quest: \{ id: r\.questId, rare: r\.isRare \} \}\] : \[\]\)\), members\);/);
});

// ---------------------------------------------------------------- 5. the enemy card and the controls
test("the enemy card shows one enemy, no picker; the opponent's controls are in the Simulate panel", () => {
  const card = fn(page, "drawEnemyCard");
  assert.doesNotMatch(card, /select\(|questOptions|mapOptions|pickButton/, "no picker on the card");
  assert.match(card, /head: el\("span", \{ class: "fc-name" \}, `\$\{lvStart\(enemyLevelText\(foe\.id\)\)\} · \$\{name\}`/, "Lvl through dom.ts");
  // the Simulator: the toggle and #target in the Simulate panel, before its row (U70: no ▶ Simulate); the opponent
  // column only the card
  const panel = sim0.slice(sim0.indexOf('<div class="run-box"'), sim0.indexOf('id="sim-stats"'));
  for (const id of ["opp-switch", "target", "party-tools"]) assert.ok(panel.includes(`id="${id}"`), id);
  assert.ok(panel.indexOf('id="target"') < panel.indexOf('id="party-tools"'));
  const opp = sim0.slice(sim0.indexOf('id="opp-col"'), sim0.indexOf("</section>", sim0.indexOf('id="opp-col"')));
  assert.match(opp, /<div id="target-card"><\/div>/);
  assert.doesNotMatch(opp, /opp-switch|id="target"|<select|type="radio"/);
  // the Solver: already in its Solve panel
  const solve = solver.slice(solver.indexOf('id="solve-box"'), solver.indexOf('id="search-results"'));
  for (const id of ["opp-switch", "target", "search-form"]) assert.ok(solve.includes(`id="${id}"`), id);
  // renderTarget: the enemy, the quest size (its "?"), the map, its grade, the scrolls and the size cap, all in #target
  const target = fn(page, "renderTarget");
  assert.equal(target.match(/box\.replaceChildren\(el\("div", \{ class: "opp-controls" \}/g)?.length, 2);
  assert.match(target, /q, el\("div", \{ class: "toolbar" \}, amount, sizeNote\), capNote\(\)/);
  assert.match(target, /el\("div", \{ class: "toolbar opp-scrolls", role: "group", "aria-label": "Scrolls" \}, \.\.\.scrolls\), facts, capNote\(\)/);
  assert.doesNotMatch(page, /opp-card|placeTarget|class: "fc-pick", "aria-label": "Enemy"/);
  // rare entries stay in the enemy list; U53's links still pick them (restoreOpponent unchanged)
  assert.match(fn(page, "questOptions"), /questEntries\(id\)\.map/);
  assert.match(fn(page, "restoreOpponent"), /put\("#quest", \[questValue\(was\.quest, Boolean\(was\.rare\)\), was\.quest\]/);
  assert.match(page, /if \(kind === "simulate"\) takeLinkedOpponent\(\);/);
  // the Party view: the chart on top, full width; heroes | opponent; one column on a phone
  for (const html of [sim0, solver]) {
    const grid = html.slice(html.indexOf('id="setup-grid"'));
    assert.ok(grid.indexOf('id="hp-col"') < grid.indexOf('id="party-col"') && grid.indexOf('id="party-col"') < grid.indexOf('id="opp-col"'));
  }
  assert.match(block, /\.setup-grid \{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(260px, 1fr\);\s*grid-template-areas: "hp hp" "party opp"; \}/);
  assert.match(block, /@media \(max-width: 960px\) \{\s*\.setup-grid \{ grid-template-columns: minmax\(0, 1fr\); grid-template-areas: "hp" "party" "opp"; \}/);
  assert.equal(css.match(/\.setup-grid \{/g)!.length, 4, "one set of grid rules, U73's nav row added");
  // the chart is as wide as its box (the viewBox follows it), its text keeps its size
  assert.match(read("web/src/ui/hp-chart.ts"), /const width = chartWidth\(box\.clientWidth \?\? 0\);/);
});

// ---------------------------------------------------------------- 7. the enemy line
test("the enemy line: white in the dark theme, the theme's near-black in the light one, still dashed", () => {
  const dark = /:root, :root\[data-theme="dark"\] \{([\s\S]*?)\n\}/, light = /:root\[data-theme="light"\] \{([\s\S]*?)\n\}/;
  const token = (theme: RegExp, name: string) => css.match(theme)![1].match(new RegExp(`--${name}: (#[0-9a-f]{6})`))![1];
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.equal(token(dark, "enemy-line"), "#ffffff");
  const near = token(light, "enemy-line");
  assert.equal(near, token(light, "fg"), "the light theme's strongest neutral, its text colour");
  assert.ok(lum(near) < 0.03, `${near} is near-black`);
  for (const t of [dark, light]) assert.ok(ratio(token(t, "enemy-line"), token(t, "card")) >= 7, `on ${token(t, "card")}`);
  assert.match(block, /\.hp-enemy, \.fc-enemy \{ --c: var\(--enemy-line\); \}/, "the line and the card's stripe");
  assert.match(css, /\.hp-line\.hp-enemy \{ stroke-width: 2\.5; stroke-dasharray: 6 3; \}/, "dashed");
  assert.doesNotMatch(css, /--boss/, "U62's purple is gone");
  const fig = hpChart(odinData) as unknown as F;
  assert.equal(fig.querySelectorAll("path.hp-line.hp-enemy").length, 1);
});
