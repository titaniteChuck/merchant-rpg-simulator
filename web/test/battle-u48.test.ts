// Battle Simulator and Solver U48: the result in the Simulate panel (no Results section, no section titles), no
// "vs <enemy> change" line over the Flow, hero cards moved by drag and drop (moveHero: swap or move, the slot rules
// kept), the size cap under the opponent's picker, the Flow as one long page on a phone with a "↑" back-to-top
// button, a calculation level with its column (calcPanelLeft), and the Solver's Party and Flow read-only
// (pageControls). No browser: the pure parts, a tiny fake DOM for the Flow, and the page code read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { moveHero, moveRefusal, pageControls, type PartyState } from "../src/ui/battle-edit.ts";
import { calcPanelLeft, toTopVisible } from "../src/ui/battle-layout.ts";
import { loadTimelineData, partyPlan, type PlanMember } from "../src/ui/timeline.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), drag = read("web/src/ui/party-drag.ts"), css = read("site/style.css");
const u48 = css.slice(css.indexOf("/* U48 */"), css.indexOf("/* end U48 */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

const party = (slots: PartyState["slots"], locked: PartyState["locked"] = {}, excluded: PartyState["excluded"] = {}): PartyState =>
  ({ slots: { ...slots }, skills: {}, locked: { ...locked }, excluded: { ...excluded } });
const FREE = { required: [] };
const QUEST = { required: ["front1"] }; // a party quest: Front 2 always filled
const SOLO = { required: ["front0"], solo: true };

test("moveHero: a drop on a filled slot swaps the two heroes, on an empty slot moves the hero", () => {
  const s = party({ front0: 3, front1: 5, back0: null });
  assert.deepEqual(moveHero(s, "front0", "front1", FREE), { ok: true, swapped: true });
  assert.deepEqual({ ...s.slots }, { front0: 5, front1: 3, back0: null });
  assert.deepEqual(moveHero(s, "front1", "back0", FREE), { ok: true, swapped: false });
  assert.deepEqual({ ...s.slots }, { front0: 5, front1: null, back0: 3 });
  // A slot never set yet counts as empty.
  assert.deepEqual(moveHero(s, "back0", "back2", FREE), { ok: true, swapped: false });
  assert.deepEqual({ ...s.slots }, { front0: 5, front1: null, back0: null, back2: 3 });
  // Across rows, back to front.
  assert.deepEqual(moveHero(s, "back2", "front0", FREE), { ok: true, swapped: true });
  assert.deepEqual([s.slots.front0, s.slots.back2], [3, 5]);
});

test("moveHero: each hero keeps its lock and its left-out tick", () => {
  const s = party({ front0: 1, back1: 2 }, { front0: true }, { back1: true });
  moveHero(s, "front0", "back1", FREE);
  assert.deepEqual({ ...s.slots }, { front0: 2, back1: 1 });
  assert.deepEqual({ ...s.locked }, { back1: true });
  assert.deepEqual({ ...s.excluded }, { front0: true });
  moveHero(s, "back1", "back2", FREE);
  assert.deepEqual({ ...s.locked }, { back2: true });
  assert.deepEqual({ ...s.excluded }, { front0: true });
});

test("moveHero: refused moves leave the party as it was", () => {
  const s = party({ front0: 1, front1: 2, back0: null });
  const was = structuredClone(s);
  assert.deepEqual(moveHero(s, "front0", "front0", FREE), { ok: false, reason: "same" });
  assert.deepEqual(moveHero(s, "back0", "front0", FREE), { ok: false, reason: "empty" }, "an empty slot can't be dragged");
  assert.deepEqual(moveHero(s, "back2", "front0", FREE), { ok: false, reason: "empty" });
  // Front 2 on a party quest: never emptied by a move, but swapped freely.
  assert.deepEqual(moveHero(s, "front1", "back0", QUEST), { ok: false, reason: "required" });
  assert.deepEqual({ ...s }, was);
  assert.deepEqual(moveHero(s, "front1", "front0", QUEST), { ok: true, swapped: true });
  assert.deepEqual({ ...s.slots }, { front0: 2, front1: 1, back0: null });
  // Into the required slot from elsewhere: fine (it was empty: it gets filled).
  const t = party({ back0: 4 });
  assert.deepEqual(moveHero(t, "back0", "front1", QUEST), { ok: true, swapped: false });
  assert.deepEqual({ ...t.slots }, { back0: null, front1: 4 });
  // A solo quest: its hero stays in Front 1.
  const u = party({ front0: 7 });
  assert.deepEqual(moveHero(u, "front0", "back0", SOLO), { ok: false, reason: "required" });
  assert.deepEqual(moveHero(party({ back1: 7 }), "back1", "back0", SOLO), { ok: false, reason: "solo" });
  assert.deepEqual(moveHero(party({ back1: 7 }), "back1", "front0", SOLO), { ok: true, swapped: false });
  assert.equal(moveRefusal("required", "Front 2"), "Front 2 can't be left empty on this quest.");
  assert.equal(moveRefusal("solo", "Front 1"), "Solo quest: one hero, in Front 1.");
});

test("the page: a drop goes through moveHero with the opponent's rules, then saves and redraws", () => {
  const drop = fn(page, "dropHero");
  assert.match(drop, /const rules = rulesOf\(pageTarget\(\)\);/);
  assert.match(drop, /moveHero\(state, from, to, \{ required, solo: rules\.kind === "solo" \}\)/);
  assert.match(drop, /toast\(moveRefusal\(/);
  assert.match(drop, /persistParty\(\);\s*renderParty\(\);/);
  assert.match(page, /enableSlotDrag\(\$\("#party"\), dropHero\);/);
  // Every slot is a target; only a filled one on the Simulator is picked up.
  const party = fn(page, "renderParty");
  assert.match(party, /"data-slot": key, \.\.\.\(ctl\.drag && raw \? \{ "data-drag": "" \} : \{\}\)/);
  // The click-to-pick hero picker stays on the Simulator's cards (keyboard and screen readers too).
  assert.match(party, /head, \.\.\.\(ctl\.edit \? \[s\] : \[\]\), statStrip\(raw\)/);
});

test("drag and drop: Pointer Events, the page still scrolls on touch (hold first), no native drag, Escape cancels", () => {
  for (const ev of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) assert.match(drag, new RegExp(`"${ev}"`), ev);
  assert.doesNotMatch(drag, /touchstart|mousedown|mousemove/);
  // A finger starts a drag only after resting; moving sooner is a scroll. A mouse starts after a few px.
  assert.match(drag, /if \(touch\) d\.timer = setTimeout\(start, DRAG_HOLD\);/);
  assert.match(drag, /if \(dist > DRAG_SLOP\) end\(\); \/\/ a scroll, not a drag/);
  assert.match(drag, /else if \(dist >= DRAG_MOVE\) start\(\);/);
  // Scrolling is stopped only once the drag is on, by a non-passive touchmove; no touch-action: none anywhere.
  assert.match(drag, /box\.addEventListener\("touchmove", \(e\) => \{\s*if \(d\?\.active && e\.cancelable\) e\.preventDefault\(\);\s*\}, \{ passive: false \}\);/);
  assert.doesNotMatch(u48, /touch-action\s*:\s*[\w-]+\s*[;}]/);
  assert.doesNotMatch(drag, /\.touchAction|setProperty\("touch-action"/);
  // The form controls keep their clicks; empty slots (no data-drag) aren't picked up.
  assert.match(drag, /t\.closest\("select, input, textarea, label\.include"\)/);
  assert.match(drag, /closest<HTMLElement>\("\[data-drag\]\[data-slot\]"\)/);
  assert.match(drag, /e\.key === "Escape"/);
  assert.match(drag, /"dragstart"/);
  assert.match(u48, /\.b3-slot\[data-drag\] \{ cursor: grab;/);
  assert.match(u48, /#party \.b3-slot\.drop-over \{/);
});

test("the size cap: under the opponent's picker, without the names left out", () => {
  assert.doesNotMatch(page, /left out\.`/);
  assert.match(page, /cap\.replaceChildren\(\.\.\.\(fight\.capped\.length \? \[`ℹ️ At most \$\{rules\.maxSize\} heroes`\] : \[\]\)\);/);
  // In both opponent kinds' controls, after the pickers.
  assert.equal(page.match(/capNote\(\)\), card\);/g)?.length, 2);
  assert.doesNotMatch(fn(page, "renderParty"), /party-capped/);
});

test("the Flow: no \"vs <enemy> change\" line; the enemy column's head changes the enemy", () => {
  const plan = fn(page, "renderPlan");
  assert.doesNotMatch(plan, /"vs "|"change"|toParty/);
  assert.match(page, /enemies: \(\) => \{/);
});

test("pageControls: the Simulator edits and drags; the Solver is read-only but its 🔒", () => {
  assert.deepEqual(pageControls("simulate"), { edit: true, drag: true, lock: false });
  assert.deepEqual(pageControls("solve"), { edit: false, drag: false, lock: true });
  const party = fn(page, "renderParty");
  assert.match(party, /const ctl = pageControls\(state\.mode\.key\);/);
  assert.match(party, /const include = raw && ctl\.edit \?/);
  assert.match(party, /\.\.\.\(ctl\.edit \? \[el\("div", \{ class: "toolbar party-tools" \}, clear/);
  assert.match(party, /abilityBlock\(raw \? idx : null, raw, key, ctl\.edit\)/);
  assert.match(fn(page, "abilityBlock"), /\.\.\.\(editable \? \[el\("td", \{ class: "swap-col"/);
  assert.match(fn(page, "renderPlan"), /const edit = pageControls\(state\.mode\.key\)\.edit \? planEdit\(\) : undefined;/);
});

test("the Flow on a phone: one long page, no scroll frame; the ↑ button", () => {
  assert.match(u48, /\.tc \.tc-scroll, \.flow-panel \.pg-scroll \{ overflow: visible; max-height: none; \}/);
  assert.match(u48, /\.flow-panel \.pg-grid, \.flow-panel \.tc-grid \{ min-width: 0; \}/);
  // The heads and the turns keep the same first column, so the columns line up.
  assert.match(u48, /\.flow-panel \.pg-row \{ grid-template-columns: 22px repeat\(var\(--pg-cols\), minmax\(0, 1fr\)\); \}/);
  assert.match(u48, /\.flow-panel \.tc-turn \{ grid-template-columns: 22px minmax\(0, 1fr\); \}/);
  // The button: named, hidden until the page is scrolled down, reduced motion respected, room left under the page's end.
  const top = fn(page, "initToTop");
  assert.match(top, /"aria-label": "Back to top"/);
  assert.match(top, /btn\.hidden = !toTopVisible\(scrollY, innerHeight\);/);
  assert.match(top, /prefers-reduced-motion: reduce/);
  assert.match(top, /behavior: smooth \? "smooth" : "instant"/);
  assert.match(u48, /\.to-top\[hidden\] \{ display: none; \}/);
  assert.match(u48, /body:has\(> \.to-top\) \{ padding-bottom: 76px; \}/);
  assert.equal(toTopVisible(0, 800), false);
  assert.equal(toTopVisible(800, 800), false);
  assert.equal(toTopVisible(801, 800), true);
  assert.equal(toTopVisible(300, 200), false, "at least 400 px down");
  assert.equal(toTopVisible(401, 200), true);
});

test("calcPanelLeft: level with its column, clamped inside the chart", () => {
  // 5 columns over 600 px, gap 3: each column (600 - 12) / 5 = 117.6 px, column k starts at k × 120.6.
  assert.equal(calcPanelLeft(0, 5, 600, 200), 0);
  assert.equal(calcPanelLeft(1, 5, 600, 200), 120);
  assert.equal(calcPanelLeft(2, 5, 600, 200), 241);
  // The last columns: pulled left so a 200 px panel ends at the right edge.
  assert.equal(calcPanelLeft(3, 5, 600, 200), 361);
  assert.equal(calcPanelLeft(4, 5, 600, 200), 400);
  // A panel as wide as the chart (a phone): at the left edge, whatever its column.
  assert.equal(calcPanelLeft(4, 5, 330, 330), 0);
  assert.equal(calcPanelLeft(4, 5, 330, 400), 0, "never below 0");
  // A phone, 7 columns over 320 px: column 6 starts at 6 × 323 / 7 = 276.9; a 120 px panel is pulled to 200.
  assert.equal(calcPanelLeft(6, 7, 320, 120), 200);
  assert.equal(calcPanelLeft(3, 7, 320, 120), 138);
  // Out-of-range input stays sane.
  assert.equal(calcPanelLeft(9, 5, 600, 100), 482, "clamped to the last column");
  assert.equal(calcPanelLeft(-1, 5, 600, 100), 0);
  assert.equal(calcPanelLeft(2, 0, 600, 100), 0);
  assert.equal(calcPanelLeft(2, 5, 0, 100), 0, "a hidden chart (no width)");
});

// ---------------------------------------------------------------- the Flow, built for real in the fake DOM
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
const flow = (quest: number) => {
  const [f, b] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  return partyPlan({ id: quest, rare: false }, members, traceFight(sim, quest, [...f], [...b])) as unknown as FakeElement;
};

test("the read-only Flow (no PlanEdit, the Solver): no ▾, no picker; the calculations still open", () => {
  const plan = flow(72);
  assert.equal(plan.querySelectorAll("select").length, 0);
  assert.equal(plan.querySelectorAll("span.fl-edit").length + plan.querySelectorAll("span.fl-name").length, 0);
  assert.ok(plan.querySelectorAll("button.tc-calc-btn").length > 0);
});

test("a calculation opens level with its column (data-cols, data-order, margin from calcPanelLeft)", () => {
  const plan = flow(72);
  const boxes = plan.querySelectorAll("div.tc-calcs");
  assert.ok(boxes.length > 0);
  const cols = 7; // six heroes and the enemy
  for (const b of boxes) {
    assert.equal(b.dataset.cols, String(cols));
    (b as unknown as { clientWidth: number }).clientWidth = 700;
  }
  const btn = plan.querySelectorAll("button.tc-calc-btn")[0];
  assert.ok(btn.querySelector("span.tc-calc-word"), "the word apart, so a phone shows only the ▾");
  btn.dispatch("click");
  const panel = plan.querySelectorAll("div.tc-calc")[0];
  const col = Math.floor(Number(panel.dataset.order) / 2);
  assert.equal(panel.style.marginLeft, `${calcPanelLeft(col, cols, 700, 0)}px`);
  assert.match(u48, /\.tc-calc \{ box-sizing: border-box; align-self: flex-start; width: max-content; max-width: min\(100%, 34rem\); \}/);
});
