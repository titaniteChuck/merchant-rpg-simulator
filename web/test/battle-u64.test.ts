// Battle Simulator and Solver U64: the Flows' skill names. No wiki link on a skill name in Flow 2, Flow 3 or the
// planned rotation; in an editable view a hero's turn 1-5 skill name opens the Party view's picker in place
// (pick-list.ts: each choice's name, AP and effect), the separate ▾ gone; a pick changes the rotation slot and the
// fight is traced again; read-only (the Solver, Flow 3's fight, turns 6+, the enemy): plain text, the effect on hover.
// No browser: the Flows built in the fake DOM, the sources and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { locationOf, type PlanMember } from "../src/ui/battle-plan.ts";
import type { PlanEdit } from "../src/ui/flow-parts.ts";
import { plannedRotation } from "../src/ui/flow-planned.ts";
import { renderFlow2 } from "../src/ui/flow2.ts";
import { renderFlow3 } from "../src/ui/flow3.ts";
import type { PickOption } from "../src/ui/pick-list.ts";
import { loadTimelineData } from "../src/ui/timeline.ts";
import { loadWikiText, skillDesc } from "../src/ui/wiki-data.ts";
import type { FakeElement as F } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), parts = read("web/src/ui/flow-parts.ts"), css = read("site/style.css");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const timelines = JSON.parse(read("inventory/timelines.json"));
const wikiText = JSON.parse(read("inventory/wikidata.json"));
(globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, json: async () => wikiText,
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(timelines)).buffer });
await loadTimelineData();
await loadWikiText();
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
/** Six level-60 heroes of the example save: front Paladin, Warrior, Berserker; back Cleric, Mage, Bard. */
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const ODIN = { id: 72, rare: false };

/** The party, its rotations editable: members, the trace with these rotations, and a PlanEdit that edits them. */
function party() {
  const members: PlanMember[] = IDX.flatMap((row, r) => row.map((idx, i): PlanMember => {
    const raw = sv.raw.hero[idx];
    return { row: r ? "back" : "front", i, name: String(raw.name), cls: Number(raw.class), rotation: api.newHero(raw).attackList.slice(1, 6) };
  }));
  const rawAt = (loc: number) => sv.raw.hero[IDX[loc % 2 ? 1 : 0][Math.ceil(loc / 2) - 1]];
  const memberAt = (loc: number) => members.find((m) => locationOf(m.row, m.i) === loc)!;
  const trace = () => {
    const [f, b] = IDX.map((row, r) => row.map((idx, i) => {
      const h = sim.hero(sv.raw.hero[idx]);
      sim.setSkills(h, members.find((m) => m.row === (r ? "back" : "front") && m.i === i)!.rotation);
      return h;
    }));
    return traceFight(sim, ODIN.id, [...f], [...b]);
  };
  const calls: [number, number, string][] = [];
  const edit: PlanEdit = {
    heroes: () => ({ options: [["x", "x"]], value: "x" }),
    setHero: () => {},
    // the page's choices: Basic and the unlocked skills, each with its AP and effect (battle-page.ts skillOption)
    skills: (loc) => {
      const info = api.skillInfo(api.newHero(rawAt(loc)));
      return [{ name: "Basic", ap: 0 }, ...info.skills.slice(0, info.unlocked).map((s: { name: string; ap: number }) => s)]
        .map((c): PickOption => ({ value: c.name, label: c.name, ap: c.ap, note: skillDesc(c.name) }));
    },
    setSkill: (loc, k, skill) => {
      calls.push([loc, k, skill]);
      memberAt(loc).rotation[k] = skill;
    },
  };
  return { members, trace, edit, calls, memberAt };
}

const actorCell = (plan: F, turn: number, name: string) =>
  plan.querySelector(`div[aria-label="Turn ${turn}"]`)!.querySelector(`div[aria-label="${name} acts"]`)!.querySelector("div.actor")!;

// ---------------------------------------------------------------- 1. no wiki links
test("no wiki link on a skill name in Flow 2, Flow 3 or the planned rotation, editable or not", () => {
  const p = party();
  const views = [
    renderFlow2(ODIN, p.members, p.trace(), p.edit), renderFlow2(ODIN, p.members, p.trace()),
    renderFlow3(ODIN, p.members, p.trace(), p.edit), renderFlow3(ODIN, p.members, p.trace()),
    plannedRotation(ODIN, p.members, p.edit), plannedRotation(ODIN, p.members),
  ] as unknown as F[];
  for (const v of views) {
    assert.ok(v);
    assert.equal(v.querySelectorAll("a").length, 0, "no link at all");
  }
  // the sources: no skillLink left in the Flows; skillEdit and its ▾ gone
  for (const f of ["flow-parts.ts", "flow2.ts", "flow3.ts", "flow-planned.ts"]) assert.doesNotMatch(read(`web/src/ui/${f}`), /skillLink|skillEdit|editControl/, f);
  assert.doesNotMatch(css, /\.fl-edit/);
  assert.doesNotMatch(page, /rotationOptions/);
});

// ---------------------------------------------------------------- 2. the name opens the picker
test("clicking a hero's skill name opens the picker in place, each choice with its AP and effect", () => {
  const p = party();
  const plan = renderFlow2(ODIN, p.members, p.trace(), p.edit) as unknown as F;
  const m = p.members[0];
  const cell = actorCell(plan, 1, m.name);
  const b = cell.querySelector("button.pk-btn")!;
  assert.equal(cell.querySelectorAll("button.pk-btn").length, 1, "one control: the name (no separate ▾)");
  assert.equal(b.getAttribute("data-focus"), `skill-${locationOf(m.row, m.i)}-1`);
  assert.equal(b.getAttribute("aria-haspopup"), "listbox");
  b.dispatch("click");
  const list = cell.querySelector("ul.pk-list")!;
  assert.ok(list, "the list opens in the cell");
  const opts = list.querySelectorAll("li.pk-opt");
  assert.ok(opts.length > 1);
  assert.equal(opts[0].querySelector("span.pk-name")!.textContent, "Basic");
  const skill = opts.find((o) => o.querySelector("span.pk-note"))!;
  assert.ok(skill.querySelector("span.pk-note")!.textContent.length > 0, "the effect under the name");
  assert.ok(skill.querySelector(".ap-badge"), "its AP");
  // the same keyboard as the Party view (one implementation, pick-list.ts)
  list.listeners.get("keydown")![0]({ key: "Escape", preventDefault() {}, stopPropagation() {} } as never);
  assert.ok(!cell.querySelector("ul.pk-list"));
  assert.equal(p.calls.length, 0);
  assert.match(parts, /import \{ pickButton, type PickOption \} from "\.\/pick-list\.ts";/);
  // the page gives the Party view's choices (rotationChoices, skillOption) and keeps the AP refusal toast
  const pe = fn(page, "planEdit");
  assert.match(pe, /rotationChoices\(state\.sv!\.raw\.hero\[idx\], current\)\.map\(skillOption\)/);
  assert.match(pe, /if \(!r\.ok\) return refuseAp\(idx, r, \(\) => refocus\(`skill-\$\{loc\}-\$\{k \+ 1\}`\)\);/);
  assert.match(pe, /#flow-panel \[data-focus="\$\{key\}"\]/);
});

test("the planned rotation and the turns not reached: the skill name is the picker too; turns 6+ and the enemy are text", () => {
  const p = party();
  const planned = plannedRotation(ODIN, p.members, p.edit) as unknown as F;
  assert.equal(planned.querySelectorAll("button.pk-btn").length, p.members.length * 5);
  for (const c of planned.querySelectorAll("div.pg-cell.enemy")) assert.equal(c.querySelectorAll("button").length, 0);
  const plan = renderFlow2(ODIN, p.members, p.trace(), p.edit) as unknown as F;
  const late = plan.querySelector('div[aria-label="Turn 6"]')!;
  assert.equal(late.querySelectorAll("button.pk-btn").length, 0, "turn 6 repeats turn 1: edited there");
  for (const c of plan.querySelectorAll("div.actor.enemy")) assert.equal(c.querySelectorAll("button.pk-btn").length, 0);
});

// ---------------------------------------------------------------- 3. a pick re-traces
test("a pick changes the rotation slot and the redrawn Flow shows the new trace", () => {
  const p = party();
  const m = p.members.find((x) => x.rotation[0] !== "Basic")!;
  const loc = locationOf(m.row, m.i);
  const plan = renderFlow2(ODIN, p.members, p.trace(), p.edit) as unknown as F;
  const before = p.trace();
  const cell = actorCell(plan, 1, m.name);
  assert.equal(cell.querySelector("button.pk-btn")!.textContent, m.rotation[0]);
  cell.querySelector("button.pk-btn")!.dispatch("click");
  cell.querySelectorAll("li.pk-opt").find((o) => o.getAttribute("data-value") === "Basic")!.dispatch("click");
  assert.deepEqual(p.calls, [[loc, 0, "Basic"]]);
  // the page redraws (renderParty → renderPlan, a new trace); here, the same: trace again, draw again
  const after = p.trace();
  assert.notDeepEqual(after.actions.map((a) => a.planned), before.actions.map((a) => a.planned));
  const again = renderFlow2(ODIN, p.members, after, p.edit) as unknown as F;
  assert.equal(actorCell(again, 1, m.name).querySelector("button.pk-btn")!.textContent, "Basic");
  assert.match(fn(page, "renderParty"), /renderPlan\(\);/);
});

// ---------------------------------------------------------------- 4. read-only
test("read-only (the Solver, Flow 3's fight): no picker, the skill name is text with its effect on hover", () => {
  const p = party();
  for (const v of [renderFlow2(ODIN, p.members, p.trace()), renderFlow3(ODIN, p.members, p.trace(), p.edit), plannedRotation(ODIN, p.members)] as unknown as F[]) {
    assert.equal(v.querySelectorAll("button.pk-btn").length, 0);
    assert.equal(v.querySelectorAll("select").length, 0);
  }
  const ro = renderFlow2(ODIN, p.members, p.trace()) as unknown as F;
  const m = p.members.find((x) => x.rotation[0] !== "Basic")!;
  const name = actorCell(ro, 1, m.name).querySelector("span.tc-skill")!.children[0];
  assert.equal(name.textContent, m.rotation[0]);
  assert.ok(name.listeners.get("pointerenter")?.length && name.listeners.get("focus")?.length, "the effect's tooltip");
  // Flow 3's skill line too
  const f3 = renderFlow3(ODIN, p.members, p.trace()) as unknown as F;
  const line = f3.querySelectorAll("div.f3-skill").find((d) => d.children.some((c) => c.listeners.get("pointerenter")));
  assert.ok(line, "Flow 3: a skill with its tooltip");
});
