// Browser QA fixes after R3 (no browser here: a tiny fake DOM, helpers/fake-dom.ts, builds the Flow for real):
// the calculation's terms explain themselves through the shared tooltip (hover, focus, tap), not a hover-only title;
// rotation turns a short fight never reached keep their ▾ editors in "planned, not reached" rows; a map run that
// Scribe hidden pushed back to a quest comes back when Scribe shows again; the Profit table's scroll stops clear of
// its sticky Item column. Game data and the site's example save only, CI runs it.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { loadTimelineData, partyPlan, type PlanEdit, type PlanMember } from "../src/ui/timeline.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const timelines = JSON.parse(read("inventory/timelines.json"));
// The page fetches data files as bytes (data-files.ts, review F13).
(globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(timelines)).buffer });
await loadTimelineData();

const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
/** Six level-60 heroes of the example save: front Paladin, Warrior, Berserker; back Cleric, Mage, Bard. */
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const party = () => IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
const members: PlanMember[] = IDX.flatMap((row, r) => row.map((idx, i): PlanMember => {
  const raw = sv.raw.hero[idx];
  return { row: r ? "back" : "front", i, name: String(raw.name), cls: Number(raw.class), rotation: api.newHero(raw).attackList.slice(1, 6) };
}));

/** A PlanEdit that offers a fixed skill list and records every rotation edit. */
function recorder() {
  const calls: [number, number, string][] = [];
  const edit: PlanEdit = {
    heroes: () => ({ options: [["x", "x"]], value: "x" }),
    setHero: () => {},
    skills: () => [["Basic", "Basic"]],
    setSkill: (loc, k, skill) => void calls.push([loc, k, skill]),
  };
  return { edit, calls };
}

function flow(quest: number, edit?: PlanEdit): FakeElement {
  const [f, b] = party();
  const trace = traceFight(sim, quest, [...f], [...b]);
  const plan = partyPlan({ id: quest, rare: false }, members, trace, edit);
  assert.ok(plan, `a flow for quest ${quest}`);
  return plan as unknown as FakeElement;
}

test("calculation terms: no title, the shared tooltip on hover, focus and tap instead", () => {
  const plan = flow(72); // Odin: a long fight with damage and healing
  const btns = plan.querySelectorAll("button.tc-calc-btn");
  assert.ok(btns.length > 0, "calculation toggles");
  for (const b of btns) {
    assert.equal(b.hasAttribute("title"), false, "the toggle's help is a tip, not a title");
    assert.ok(b.listeners.has("focus") && b.listeners.has("pointerenter"));
  }
  btns[0].dispatch("click");
  assert.equal(btns[0].firstElementChild!.textContent, "▸", "open: ▸ (as the user chose)");
  const terms = plan.querySelectorAll("span.cf-term");
  assert.ok(terms.length > 0, "the opened calculation has terms");
  for (const t of terms) {
    assert.equal(t.hasAttribute("title"), false);
    assert.equal(t.getAttribute("tabindex"), "0");
    for (const ev of ["pointerenter", "focus", "pointerleave", "blur"]) assert.ok(t.listeners.has(ev), `tip wired: ${ev}`);
  }
  // Focus shows the explanation and links it with aria-describedby.
  terms[0].dispatch("focus");
  const box = (globalThis as unknown as { document: { body: FakeElement } }).document.body.querySelector("[role=tooltip]")!;
  assert.equal(box.hidden, false);
  assert.ok(box.textContent.length > 0);
  assert.equal(terms[0].getAttribute("aria-describedby"), "tip");
  terms[0].dispatch("blur");
  assert.equal(box.hidden, true);
  assert.equal(terms[0].hasAttribute("aria-describedby"), false);
  // In the source too: no title on a term or on the toggle.
  const src = read("web/src/ui/timeline.ts");
  const termFn = src.slice(src.indexOf("function termEl"), src.indexOf("function calcPanel"));
  assert.doesNotMatch(termFn, /title/);
  assert.match(termFn, /tip\(term, \(\) => t\.tip\)/);
  const toggle = src.slice(src.indexOf("function calcToggle"), src.indexOf("function takenEl"));
  assert.doesNotMatch(toggle, /title:/);
});

test("flow: a fight over on turn 1 lists turns 2-5 as planned, not reached, each hero with its ▾", () => {
  const { edit, calls } = recorder();
  const plan = flow(92, edit); // Murlok Monarch falls on turn 1
  const rows = plan.querySelectorAll("div.tc-unreached");
  assert.deepEqual(rows.map((r) => r.querySelector("div.tc-turnlab")!.textContent), ["T2", "T3", "T4", "T5"]);
  assert.ok(plan.querySelector("div.tc-unreached-head")!.textContent.includes("Planned, not reached"));
  // after the result
  const body = plan.querySelector("div.tc-body")!;
  const kids = body.children;
  assert.ok(kids.findIndex((k) => k.classList.contains("tc-result-row")) < kids.findIndex((k) => k.classList.contains("tc-unreached")));
  for (const [k, row] of rows.entries()) {
    const turn = k + 2;
    const cells = row.querySelectorAll("div.tc-planned");
    assert.equal(cells.length, members.length, `turn ${turn}: one planned cell per hero`);
    for (const c of cells) {
      assert.ok(c.querySelector(".tc-skill")!.textContent.length > 0, "the planned skill is shown");
      const ed = c.querySelector("span.fl-edit")!;
      assert.match(ed.getAttribute("data-flow-focus")!, new RegExp(`^skill-\\d-${turn}$`));
    }
  }
  // the editor changes the same rotation slot as on a reached turn (same PlanEdit: same state, same AP refusal)
  const sel = rows[2].querySelector("select")!; // turn 4
  sel.value = "Basic";
  sel.dispatch("change");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 3, "turn 4 is rotation slot 3");
  assert.equal(calls[0][2], "Basic");
  // turn 1 (reached) keeps its editors in the fight itself, not a planned row
  assert.ok(plan.querySelectorAll("div.tc-turn").some((t) => !t.classList.contains("tc-unreached") && t.querySelector("span.fl-edit")));
});

test("flow: no planned rows once the fight reached turn 5", () => {
  const plan = flow(72); // Odin: lost on turn 14
  assert.equal(plan.querySelectorAll("div.tc-unreached").length, 0);
  assert.equal(plan.querySelector("div.tc-unreached-head"), null);
});

test("Scribe back on: the map run it pushed back to a quest is restored, the fallback itself unchanged", () => {
  const src = read("web/src/ui/battle-page.ts");
  // remembered apart from the current and the stored opponent
  assert.match(src, /let scribeFallback: OppChoice \| null = null;/);
  const onX = src.slice(src.indexOf("function onExpansions"), src.indexOf("function restoreOpponent"));
  const sync = onX.indexOf("syncOppKinds()");
  // remembered only when syncOppKinds really pushed a map run back because Scribe is hidden
  const remember = onX.indexOf("scribeFallback = { kind: \"map\"");
  assert.ok(remember > sync);
  assert.match(onX, /if \(wasMap && oppKind\(\) !== "map" && mapsHidden\(\)\) \{/);
  // put back before syncOppKinds, once Scribe shows again, only when still valid, and used once
  const restore = onX.indexOf("if (scribeFallback && !mapsHidden())");
  assert.ok(restore >= 0 && restore < sync);
  assert.match(onX, /scribeFallback = null;/);
  assert.match(onX, /oppKind\(\) === "quest" && mapRunValid\(back\)/);
  assert.match(onX, /was = \{ \.\.\.was, \.\.\.back, kind: "map" \};/);
  assert.match(src, /function mapRunValid\(o: OppChoice\): boolean \{\s*return mapsAvailable\(\) && o\.map !== undefined && mapOptions\(state\.sv\)/);
  // the fallback itself is as before
  const syncFn = src.slice(src.indexOf("function syncOppKinds"), src.indexOf("// ---------------------------------------------------------------- party"));
  assert.doesNotMatch(syncFn, /scribeFallback/);
  assert.doesNotMatch(src.slice(src.indexOf("function saveOpponent"), src.indexOf("function storedOpponent")), /scribeFallback/);
});

test("Profit: the table's scroll padding is the sticky Item column's width", async () => {
  const css = read("site/style.css");
  assert.match(css, /\.table-wrap\.pf-table \{ scroll-padding-left: var\(--pf-sticky, 0px\); \}/);
  const { stickyPad } = await import("../src/ui/profit-tables.ts");
  const seen: { observe?: () => void } = {};
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    constructor(f: () => void) {
      seen.observe = f;
    }
    observe() {}
  };
  const doc = (globalThis as unknown as { document: { createElement(t: string): FakeElement } }).document;
  const wrap = doc.createElement("div"), table = doc.createElement("table"), thead = doc.createElement("thead"), tr = doc.createElement("tr");
  const th = doc.createElement("th");
  th.offsetWidth = 132;
  tr.append(th, doc.createElement("th"));
  thead.append(tr);
  table.append(thead);
  wrap.append(table);
  stickyPad(wrap as unknown as HTMLElement);
  assert.ok(seen.observe, "watches the Item column");
  seen.observe!();
  assert.equal(wrap.style["--pf-sticky"], "132px");
  delete (globalThis as Record<string, unknown>).ResizeObserver;
  // both kinds of Profit table get it
  assert.match(read("web/src/ui/profit.ts"), /const best = \(tier: number\) => stickyPad\(el\("div", \{ class: "table-wrap pf-table" \}/);
  assert.match(read("web/src/ui/profit-tables.ts"), /stickyPad\(wrap\);\n  if \(sorted\.length <= shown\.length\) return wrap;/);
});
