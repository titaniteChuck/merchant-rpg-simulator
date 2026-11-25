// Battle Simulator and Solver U63: Flow 1 removed (tabs Party · Flow 2 · Flow 3, a stored "flow" / "flow1" opens
// Flow 2, its shared parts moved to flow-parts.ts, the planned rotation kept in flow-planned.ts); Flow 2's hero cards
// outlined in the class colour; one HP bar for Flow 2 and Flow 3 (flow-hp.ts); the map room bar scrolls with the mouse
// wheel and ‹ › buttons and keeps the selected room in view. No browser: pure functions, the Flows built in the fake
// DOM, the sources and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import type { PlanMember } from "../src/ui/battle-plan.ts";
import { roomBarWheel, rowStep, scrollToShow } from "../src/ui/battle-layout.ts";
import { FLOW_LAYOUTS, flowLayout, parseTab } from "../src/ui/flow-layouts.ts";
import type { PlanEdit } from "../src/ui/flow-parts.ts";
import { hpBar, hpTexts, hpTone } from "../src/ui/flow-hp.ts";
import { plannedRotation } from "../src/ui/flow-planned.ts";
import { fighterCard, renderFlow2 } from "../src/ui/flow2.ts";
import { renderFlow3 } from "../src/ui/flow3.ts";
import { loadTimelineData } from "../src/ui/timeline.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css");
const u63 = css.slice(css.indexOf("/* U63 */"), css.indexOf("/* end U63 */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

// ---------------------------------------------------------------- 1. Flow 1 removed
test("tabs: Party · Flow 2 · Flow 3 on both pages, no Flow 1, the labels kept", () => {
  assert.deepEqual(FLOW_LAYOUTS.map((l) => [l.id, l.label]), [["flow2", "Flow 2"], ["flow3", "Flow 3"]]);
  for (const name of ["site/battle.html", "site/solver.html"]) {
    const html = read(name);
    const row = html.slice(html.indexOf('<div class="b3-tab-row">'), html.indexOf('<div id="flow-panel"'));
    assert.deepEqual([...row.matchAll(/role="tab"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]), ["Party", "Flow 2", "Flow 3"], name);
    assert.doesNotMatch(html, /tab-flow1|data-tab="flow1"|>Flow 1</, name);
    assert.match(html, /<div id="flow-panel" class="flow-panel" role="tabpanel" aria-labelledby="tab-flow2" hidden>/, name);
  }
});

test("a stored tab \"flow\" or \"flow1\" opens Flow 2; the panel starts on Flow 2", () => {
  assert.equal(parseTab("flow"), "flow2");
  assert.equal(parseTab("flow1"), "flow2");
  assert.equal(parseTab("flow2"), "flow2");
  assert.equal(parseTab("flow3"), "flow3");
  assert.equal(parseTab("party"), "party");
  assert.equal(parseTab("flow4"), "party");
  assert.equal(flowLayout("flow1").id, "flow2");
  assert.match(page, /let flowChoice: FlowId = "flow2";/);
  assert.match(fn(page, "storedTab"), /parseTab\(sessionStorage\.getItem\(tabKey\(\)\)\)/);
});

/** Every `.ts` file under a folder of the repo, recursively. */
function tsFiles(dir: string): string[] {
  return readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? tsFiles(`${dir}${d.name}/`) : d.name.endsWith(".ts") ? [`${dir}${d.name}`] : []);
}

test("no code left of Flow 1, and every name imported from the Flow modules exists", () => {
  const files = [...tsFiles("web/src/"), ...tsFiles("web/test/")].filter((f) => f !== "web/test/battle-u63.test.ts");
  // code only: the comments may name what was removed
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^.*doesNotMatch.*$/gm, "");
  for (const f of files) assert.doesNotMatch(code(f), /\bpartyPlan\b|\bplanNote\b|\bflowChart\b/, f);
  const tl = read("web/src/ui/timeline.ts");
  assert.doesNotMatch(tl, /export (function|const) (actorEl|calcToggle|calcPanel|skillEdit|nameEdit|turnRow|unreachedRows|fmtInt|FLOW_PAGE)\b/);
  // the named imports of these modules, in src and tests, all exist there
  const exportsOf = (mod: string) => new Set([...read(`web/src/ui/${mod}`).matchAll(/^export (?:async )?(?:function|const|let|type|interface|class) (\w+)/gm)].map((m) => m[1]));
  for (const mod of ["timeline.ts", "flow-parts.ts", "flow-planned.ts", "flow-hp.ts", "flow2.ts", "flow3.ts", "flow-layouts.ts"]) {
    const names = exportsOf(mod);
    for (const f of files) {
      for (const m of read(f).matchAll(new RegExp(`import (?:type )?\\{([^}]+)\\} from "[./]*(?:src/ui/)?${mod.replace(".", "\\.")}"`, "g"))) {
        for (const raw of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
          const name = raw.replace(/^type /, "").split(/\s+as\s+/)[0];
          assert.ok(names.has(name), `${f} imports ${name} from ${mod}`);
        }
      }
    }
  }
  // the helpers Flow 2 and Flow 3 share come from flow-parts.ts
  assert.match(read("web/src/ui/flow2.ts"), /from "\.\/flow-parts\.ts";/);
  assert.match(read("web/src/ui/flow3.ts"), /from "\.\/flow-parts\.ts";/);
  // the dead CSS is gone
  assert.doesNotMatch(css, /\.tc-status|\.tc-hp|\.tc-fxs|\.tc \.pg-heads|\.f2-hp|\.f2-bar|\.f3-hp|\.f2-card\.asc/);
});

// ---------------------------------------------------------------- the Flows, built in the fake DOM
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const timelines = JSON.parse(read("inventory/timelines.json"));
(globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(timelines)).buffer });
await loadTimelineData();
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const members: PlanMember[] = IDX.flatMap((row, r) => row.map((idx, i): PlanMember => {
  const raw = sv.raw.hero[idx];
  return { row: r ? "back" : "front", i, name: String(raw.name), cls: Number(raw.class), rotation: api.newHero(raw).attackList.slice(1, 6), level: Number(raw.level) };
}));
const traceOf = (quest: number) => {
  const [f, b] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  return traceFight(sim, quest, [...f], [...b]);
};
const edit: PlanEdit = {
  heroes: () => ({ options: [["x", "x"]], value: "x" }),
  setHero: () => {},
  skills: () => [["Basic", "Basic"]],
  setSkill: () => {},
  enemies: () => ({ label: "Opponent", groups: [["Quests", [["72", "Odin"]]]], value: "72" }),
  setEnemy: () => {},
};

test("nothing editable lost: Flow 2's turn-1 cards and the planned rotation's heads hold every picker", () => {
  const f2 = renderFlow2({ id: 72, rare: false }, members, traceOf(72), edit) as unknown as FakeElement;
  const first = f2.querySelector("div.f2-cards")!;
  assert.equal(first.querySelectorAll("span.fl-name").length, members.length + 1, "a picker per hero and the opponent");
  assert.ok(f2.querySelectorAll("span.fl-edit").length > 0, "the rotation's ▾");
  for (const render of [renderFlow2, renderFlow3]) {
    const planned = render({ id: 72, rare: false }, members, null, edit) as unknown as FakeElement;
    assert.ok(planned.querySelector("div.pg-heads"), "no fight: the rotation as planned");
    assert.equal(planned.querySelectorAll("div.pg-turngroup").length, 5);
    assert.equal(planned.querySelectorAll("span.fl-name").length, members.length + 1);
    assert.equal(planned.querySelectorAll("span.fl-edit").length, members.length * 5);
  }
  assert.equal(plannedRotation({ id: 999999, rare: false }, members), null, "no timeline: null");
});

// ---------------------------------------------------------------- 2. Flow 2: the class outline
test("Flow 2: a hero's card is outlined in its class colour, never an ascension frame; the enemy keeps its colour", () => {
  const card = fighterCard({ name: "Ana", enemy: false, cls: 3, life: { hp: 50, maxHP: 100 }, fx: [], when: "start of turn 1" }) as unknown as FakeElement;
  assert.ok(card.classList.contains("cls-3"));
  assert.doesNotMatch(card.className, /asc/);
  const plan = renderFlow2({ id: 72, rare: false }, members, traceOf(72)) as unknown as FakeElement;
  for (const c of plan.querySelectorAll("div.f2-card")) assert.doesNotMatch(c.className, /asc/);
  assert.match(u63, /\.f2-card:not\(\.dead\) \{ border-color: color-mix\(in srgb, var\(--c\) 80%, var\(--border\)\); \}/);
  assert.match(css, /\.f2-card\.enemy \{ --c: #ec4899; \}/);
  assert.match(css, /^\.cls-\d \{ --c: #[0-9a-f]{6}; \}/m);
});

// ---------------------------------------------------------------- 3. one HP bar
test("the shared HP bar: remaining / total inside, compact from 10,000, the tone, down at 0", () => {
  assert.deepEqual(hpTexts(1097, 2000), { full: "1,097 / 2,000", short: "1,097 / 2,000" });
  assert.deepEqual(hpTexts(9700, 10000), { full: "9,700 / 10,000", short: "9.7K / 10K" });
  assert.equal(hpTexts(-5, 900).full, "0 / 900");
  assert.deepEqual([hpTone(60, 100), hpTone(40, 100), hpTone(10, 100), hpTone(0, 100)], ["ok", "mid", "low", "down"]);
  const bar = hpBar({ hp: 25, maxHP: 100 }, "Ana: 25 / 100 HP") as unknown as FakeElement;
  assert.equal(bar.getAttribute("role"), "img");
  assert.equal(bar.getAttribute("aria-label"), "Ana: 25 / 100 HP");
  assert.ok(bar.classList.contains("fl-hp") && bar.classList.contains("low"));
  assert.match(bar.querySelector("span.fl-hpfill")!.getAttribute("style")!, /width: 25\.0%/);
  assert.equal(bar.querySelector("span.fl-hpfull")!.textContent, "25 / 100");
});

test("both Flows draw that bar, from the one module", () => {
  for (const f of ["flow2.ts", "flow3.ts"]) {
    const src = read(`web/src/ui/${f}`);
    assert.match(src, /import \{ hpBar \} from "\.\/flow-hp\.ts";/, f);
    assert.doesNotMatch(src, /fl-hpfill|f2-bar|f3-hpfill|fmtCompact/, `${f}: no bar of its own`);
  }
  const f2 = renderFlow2({ id: 72, rare: false }, members, traceOf(72)) as unknown as FakeElement;
  const f3 = renderFlow3({ id: 72, rare: false }, members, traceOf(72)) as unknown as FakeElement;
  assert.equal(f2.querySelectorAll("div.f2-card").length, f2.querySelectorAll("div.f2-card").filter((c) => c.querySelector("div.fl-hp")).length, "a bar on every Flow 2 card");
  assert.equal(f3.querySelectorAll("li.f3-card").length, f3.querySelectorAll("li.f3-card").filter((c) => c.querySelector("div.fl-hp")).length, "a bar on every Flow 3 card");
  // the bar's CSS: its own container, compact numbers when narrow
  assert.match(u63, /\.fl-hpbar \{ container: flhp \/ inline-size;/);
  assert.match(u63, /@container flhp \(max-width: 118px\) \{\s*\.fl-hpfull \{ display: none; \}\s*\.fl-hpshort \{ display: inline; \}/);
});

// ---------------------------------------------------------------- 4. the room bar on a PC
test("the room bar's wheel: vertical wheel moves it sideways while it can, then leaves the event to the page", () => {
  const row = { scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 };
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, row), 100);
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: -100 }, row), 0, "at the start, up scrolls the page");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, { ...row, scrollLeft: 600 }), 0, "at the end, down scrolls the page");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, { ...row, scrollLeft: 560 }), 40, "the last bit, clamped");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: -100 }, { ...row, scrollLeft: 300 }), -100);
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 }, row), 120, "lines");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 1, deltaMode: 2 }, row), 400, "pages");
  assert.equal(roomBarWheel({ deltaX: 80, deltaY: 10 }, row), 0, "a sideways swipe: the browser's own");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, { scrollLeft: 0, scrollWidth: 400, clientWidth: 400 }), 0, "a bar that fits");
});

test("the room bar's buttons and the selected room in view", () => {
  const row = { scrollLeft: 200, scrollWidth: 1000, clientWidth: 400 };
  assert.equal(rowStep(row, 1), 300);
  assert.equal(rowStep(row, -1), -300);
  assert.equal(rowStep({ ...row, clientWidth: 50 }, 1), 60);
  assert.equal(scrollToShow(row, 300, 60, 36), null, "in view");
  assert.equal(scrollToShow(row, 100, 60, 36), 64, "off the left: its left edge clear of the fade");
  assert.equal(scrollToShow(row, 700, 60, 36), 396, "off the right: its right edge clear of the fade");
  assert.equal(scrollToShow(row, 950, 50, 36), 600, "clamped to the end");
  assert.equal(scrollToShow(row, 10, 50, 36), 0, "clamped to the start");
});

test("battle-page.ts wires the room bar: a non-passive wheel, ‹ › buttons over the fades, the keys, the selected room revealed", () => {
  const sc = fn(page, "roomScroller");
  assert.match(sc, /addEventListener\("wheel", \(e\) => \{\n\s*const d = roomBarWheel\(e, bar\);\n\s*if \(!d\) return;\n\s*e\.preventDefault\(\);/);
  assert.match(sc, /\}, \{ passive: false \}\);/);
  assert.match(sc, /bar\.scrollBy\(\{ left: rowStep\(bar, dir\)/);
  assert.match(sc, /prev\.hidden = !bar\.classList\.contains\("fade-start"\);/);
  assert.match(sc, /next\.hidden = !bar\.classList\.contains\("fade-end"\);/);
  assert.match(sc, /scrollToShow\(bar, left, cur\.offsetWidth, ROOM_PAD\)/);
  assert.match(sc, /prefers-reduced-motion: reduce/);
  const plan = fn(page, "renderPlan");
  assert.match(plan, /scroller\.reveal\(smooth\);/);
  assert.match(plan, /tabKeys\(bar\);/, "arrows, Home and End");
  assert.match(plan, /box\.append\(scroller\.box, view\);/);
  assert.match(u63, /\.room-scroll\.prev \{ left: 4px; \}/);
  assert.match(u63, /\.room-scroll\[hidden\] \{ display: none; \}/);
  assert.match(u63, /@media \(hover: none\) \{ \.room-scroll \{ display: none; \} \}/);
});
