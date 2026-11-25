// Battle Simulator and Solver U62: smaller Party view cards. One builder for the hero and enemy cards
// (web/src/ui/fighter-card.ts) with the picker as the head, the stats on two lines, the rotation without turn numbers or
// titles; a skill or passive opens its picker in place with each choice's effect (pick-list.ts); the enemy list holds
// each rare variant as its own entry; the enemy's rotation from its timeline. (U65: the three columns and the purple
// boss line are gone: the chart on top, the enemy line white; battle-u65.test.ts.) No browser: the cards and the picker in the fake DOM, the page code, HTML and CSS as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { enemyTimeline, loadTimelines } from "../src/tools/schedule.ts";
import { linkedOpponent } from "../src/ui/battle-links.ts";
import { enemyStats, enemyTurns, isFightable, parseQuestValue, questEntries, questValue } from "../src/ui/battle-setup.ts";
import { CARD_STATS, type CardRow, ENEMY_STATS, fighterCard, HERO_STATS, statGrid } from "../src/ui/fighter-card.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));
const block = css.slice(css.indexOf("/* U62 */"), css.indexOf("/* end U62 */"));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
loadTimelines(JSON.parse(read("inventory/timelines.json")));

type F = FakeElement & HTMLElement;
const STATS = { maxHP: 12345, atk: 120, matk: 80, def: 60, mdef: 50, acc: 95, eva: 30, crit: 12 };
const rows = (pick?: (k: number) => CardRow["pick"]): CardRow[] =>
  ["Basic", "Fireball", "Basic", "Heal", "Basic"].map((s, k) => ({ text: s, ap: s === "Basic" ? 0 : 3, pick: pick?.(k) }));
const firstRareQuest = () => Object.keys(G.questData).map(Number).find((id) => isFightable(id) && questEntries(id).length === 2)!;

// ---------------------------------------------------------------- 1. one builder
test("one builder for both cards: the same .fc family, head, stats and rotation; the page builds both with it", () => {
  const hero = fighterCard({ kind: "hero", classes: "filled cls-3", head: document.createElement("select") as unknown as HTMLElement, stats: STATS,
    passive: { text: "Might" }, rotation: rows() }) as unknown as F;
  const enemy = fighterCard({ kind: "enemy", head: document.createElement("select") as unknown as HTMLElement, stats: STATS, rotation: rows() }) as unknown as F;
  for (const c of [hero, enemy]) {
    assert.equal(c.tagName, "article");
    assert.ok(c.classList.contains("fc"));
    assert.equal(c.children[0].className, "fc-head");
    assert.ok(c.querySelector("dl.fc-stats"));
    assert.equal(c.querySelector("ol.fc-rot")!.querySelectorAll("li.fc-row").length, 5);
  }
  assert.ok(hero.classList.contains("fc-hero") && enemy.classList.contains("fc-enemy"));
  assert.ok(hero.querySelector("ul.fc-passive") && !enemy.querySelector("ul.fc-passive"), "the enemy has no passive");
  // the page: both cards from fighterCard, the old builders and the spider chart gone
  assert.match(fn(page, "renderParty"), /return fighterCard\(\{\s*kind: "hero"/);
  assert.match(fn(page, "drawEnemyCard"), /host\.replaceChildren\(fighterCard\(\{\s*kind: "enemy"/);
  assert.doesNotMatch(page, /function (abilityBlock|statStrip|swapControl)|radar\(|enemyRadar|" Rare variant"|id: "rare"/);
  // one CSS family, the old one deleted (not overridden)
  assert.match(block, /^\.fc \{/m);
  assert.doesNotMatch(css, /\.b3-slot|\.stat-strip|table\.slot-rows|\.swap-select|\.ap-mini|\.slot-head|\.opp-hp|\.opp-card\.rare|\.req-badge|\.out-badge/);
});

// ---------------------------------------------------------------- 2. the picker as the head
test("the picker is the card's head: no chips beside the hero's; U65: the enemy's card has no picker", () => {
  const party = fn(page, "renderParty");
  assert.match(party, /const head = ctl\.edit \? s/);
  assert.match(party, /s\.classList\.add\("fc-pick"\)/);
  assert.doesNotMatch(party, /pill\(|class: "avatar|slot-name|out-badge|req-badge/, "no class, level or state chips");
  assert.match(party, /tools: include \? \[include\] : \[\]/);
  // U65: the enemy and the quest size are the Simulate (Solve) panel's controls; the card's head is the plain name
  const target = fn(page, "renderTarget");
  assert.match(target, /select\(\{ id: "quest", "aria-label": "Enemy" \}/);
  assert.match(target, /select\(\{ id: "amount", "aria-label": "Quest size" \}/);
  assert.doesNotMatch(target, /"Quest size"\),|el\("span", \{ class: "muted small" \}, "Quest size"\)/, "no visible \"Quest size\" label");
  assert.match(fn(page, "drawEnemyCard"), /head: el\("span", \{ class: "fc-name" \}/);
  assert.doesNotMatch(fn(page, "drawEnemyCard"), /tools:/);
  // the built head: the node handed in, then the tools
  const sel = document.createElement("select") as unknown as F;
  const tick = document.createElement("label") as unknown as F;
  const c = fighterCard({ kind: "hero", head: sel as unknown as HTMLElement, tools: [tick as unknown as HTMLElement], stats: null, rotation: [] }) as unknown as F;
  assert.equal(c.children[0].children[0], sel);
  assert.equal(c.children[0].children[1].className, "fc-tools");
});

// ---------------------------------------------------------------- 3. rare entries
test("the enemy list holds the normal and the rare variant as separate entries; the stored format is kept", () => {
  const id = firstRareQuest();
  assert.deepEqual(questEntries(id), [[String(id), false], [`${id}:rare`, true]]);
  assert.deepEqual(parseQuestValue(`${id}:rare`), { id, rare: true });
  assert.deepEqual(parseQuestValue(String(id)), { id, rare: false });
  for (const q of Object.keys(G.questData).map(Number).filter(isFightable)) {
    const e = questEntries(q);
    assert.equal(e.length, G.questData[q].enemyHpB !== undefined && G.questData[q].attackListB !== undefined ? 2 : 1, String(q));
  }
  const opts = fn(page, "questOptions");
  assert.match(opts, /questEntries\(id\)\.map/);
  assert.match(opts, /lvStart\(enemyLevelText\(id\)\)/, "\"Lvl\" through dom.ts");
  assert.match(opts, /\$\{rare \? " \(rare\)" : ""\}/);
  // stored as { quest, rare } still; a "Fight in simulator" link (U53) picks the rare entry
  assert.match(fn(page, "currentOpponent"), /quest: q \? String\(q\.id\) : undefined, rare: q\?\.rare \?\? false/);
  const linked = linkedOpponent(`?quest=${id}&rare=1`)!;
  assert.equal(questValue(linked.quest!, Boolean(linked.rare)), `${id}:rare`);
  assert.match(fn(page, "restoreOpponent"), /put\("#quest", \[questValue\(was\.quest, Boolean\(was\.rare\)\), was\.quest\]/);
  // the Flow's enemy head uses the same list (no flowEnemyOptions)
  assert.doesNotMatch(page, /function flowEnemyOptions/);
  assert.match(page, /groups: questOptions\(\), value: q\.value/);
});

// ---------------------------------------------------------------- 4. a skill opens its picker
test("clicking a skill opens its picker in place (keyboard: a button with an aria-label); read-only is plain text", () => {
  const picked: string[] = [];
  const pick = (k: number): CardRow["pick"] => ({ label: `Ana: turn ${k + 1} skill`, value: "Basic", focus: `front0-${k}`,
    options: () => [{ value: "Basic", label: "Basic", ap: 0 }, { value: "Fireball", label: "Fireball", ap: 3, note: "Deal 2x Matk" }],
    onPick: (v) => picked.push(v) });
  const card = fighterCard({ kind: "hero", head: document.createElement("select") as unknown as HTMLElement, stats: STATS, rotation: rows(pick) }) as unknown as F;
  const row = card.querySelectorAll("li.fc-row")[1];
  const b = row.querySelector("button.pk-btn")!;
  assert.equal(b.getAttribute("type"), "button");
  assert.equal(b.getAttribute("aria-label"), "Ana: turn 2 skill: Fireball. Change");
  assert.equal(b.getAttribute("aria-haspopup"), "listbox");
  assert.equal(b.getAttribute("aria-expanded"), "false");
  assert.ok(!row.querySelector("a"), "no wiki link");
  b.dispatch("click");
  // U69: the list floats over the page (in <body>), no longer in the row
  const body = document.body as unknown as F;
  const list = body.querySelector("ul.pk-list")!;
  assert.ok(list && !row.querySelector("ul.pk-list"), "the list opens over the page");
  assert.equal(list.getAttribute("role"), "listbox");
  assert.equal(b.getAttribute("aria-expanded"), "true");
  assert.equal(b.getAttribute("aria-controls"), list.id);
  assert.equal((document as unknown as { activeElement: unknown }).activeElement, list);
  // ↓ then Enter picks the next choice
  const key = (k: string) => list.listeners.get("keydown")![0]({ key: k, preventDefault() {}, stopPropagation() {} } as never);
  key("ArrowDown");
  assert.equal(list.getAttribute("aria-activedescendant"), list.children[1].id);
  key("Enter");
  assert.deepEqual(picked, ["Fireball"]);
  assert.ok(!body.querySelector("ul.pk-list"), "closed");
  assert.equal(b.getAttribute("aria-expanded"), "false");
  // Escape closes without a change
  b.dispatch("click");
  body.querySelector("ul.pk-list")!.listeners.get("keydown")![0]({ key: "Escape", preventDefault() {}, stopPropagation() {} } as never);
  assert.ok(!body.querySelector("ul.pk-list"));
  assert.deepEqual(picked, ["Fireball"]);
  // read-only (the Solver): text, no button
  const ro = fighterCard({ kind: "hero", head: document.createElement("span") as unknown as HTMLElement, stats: STATS, rotation: rows() }) as unknown as F;
  assert.equal(ro.querySelectorAll("button").length, 0);
  assert.equal(ro.querySelectorAll("span.fc-skill").length, 5);
  // the page: no ⇄, no link on the rows, the picker only where the page edits
  const hr = fn(page, "heroRows");
  assert.match(hr, /pick: editable && live \? \{/);
  assert.doesNotMatch(hr, /skillLink|passiveLink|clickableRow|swap/);
  assert.match(page, /const refocusCard = \(focusKey: string\) => document\.querySelector<HTMLElement>\(`\[data-focus="\$\{focusKey\}"\]`\)\?\.focus\(\);/);
  // the drag leaves the open list alone
  assert.match(read("web/src/ui/party-drag.ts"), /label\.include, \.pk-list"\)/);
});

// ---------------------------------------------------------------- 5. effects in the picker
test("the picker shows each choice's effect; the passive's effect is not on its line", () => {
  const card = fighterCard({ kind: "hero", head: document.createElement("select") as unknown as HTMLElement, stats: STATS,
    passive: { text: "Might", pick: { label: "Ana: passive", value: "Might", focus: "p",
      options: () => [{ value: "None", label: "No passive" }, { value: "Might", label: "Might", note: "Atk +10%" }], onPick: () => {} } },
    rotation: rows() }) as unknown as F;
  const row = card.querySelector("li.fc-pas")!;
  assert.equal(row.textContent.includes("Atk +10%"), false, "not on the passive's line");
  row.querySelector("button")!.dispatch("click");
  const opts = (document.body as unknown as F).querySelectorAll("li.pk-opt"); // U69: over the page
  assert.equal(opts.length, 2);
  assert.equal(opts[1].querySelector("span.pk-note")!.textContent, "Atk +10%");
  assert.equal(opts[1].getAttribute("aria-selected"), "true");
  assert.equal(opts[0].querySelectorAll(".ap-badge").length, 0, "a passive has no AP");
  // the page: skills with their AP and skillDesc, passives with passiveText; the passive row shows its name only
  assert.match(page, /const skillOption = \(c: \{ name: string; ap: number \| undefined \}\): PickOption => \(\{ value: c\.name, label: skillName\(c\.name\), ap: c\.ap, note: skillDesc\(c\.name\) \}\);/);
  assert.match(fn(page, "heroRows"), /note: x === "None" \? "" : passiveText\(x\)/);
  assert.doesNotMatch(fn(page, "heroRows"), /class: "eff"/);
  // in place (the Flows), the list sits in the row, full width; its notes wrap (no native <select>). U69: the cards float it
  assert.match(block, /\.pk-list \{ flex: 1 0 100%;/);
  assert.match(block, /\.pk-opt \.pk-note \{ grid-column: 1 \/ -1;/);
});

// ---------------------------------------------------------------- 6. the stats (U67: HP, then two per row)
test("the stats: HP, then two per row; no Eva on a hero card, no Crit on the enemy's (U67)", () => {
  assert.deepEqual(HERO_STATS.map(([, label]) => label), ["HP", "Atk", "Matk", "Def", "Mdef", "Acc", "Crit"]);
  assert.deepEqual(ENEMY_STATS.map(([, label]) => label), ["HP", "Atk", "Matk", "Def", "Mdef", "Acc", "Eva"]);
  const g = statGrid(STATS) as unknown as F;
  assert.equal(g.tagName, "dl");
  assert.equal(g.children.length, HERO_STATS.length);
  assert.deepEqual(g.querySelectorAll("dt").map((d) => d.textContent), ["HP", "Atk", "Matk", "Def", "Mdef", "Acc", "Crit"]);
  assert.equal(g.querySelector("dd.fc-val")!.textContent, "12.3K", "five digits shortened");
  assert.equal(g.querySelector("dd.fc-val")!.title, "HP 12,345");
  assert.deepEqual((statGrid(null) as unknown as F).querySelectorAll("dd.fc-val").map((d) => d.textContent), Array(7).fill("–"));
  // the enemy's are the engine's, the same eight keys
  assert.deepEqual(Object.keys(enemyStats(72)), CARD_STATS.map(([k]) => k));
  assert.match(fn(page, "drawEnemyCard"), /: enemyStats\(foe\.id, foe\.rare, foe\.n\)/);
});

// ---------------------------------------------------------------- 7. the enemy's rotation
test("the enemy's rotation: its skill per turn from its timeline, read-only, the same row look", () => {
  const id = firstRareQuest();
  for (const rare of [false, true]) {
    const tl = enemyTimeline(id, rare);
    assert.deepEqual(enemyTurns(id, rare, tl), tl.slots.map((s) => s.name));
    assert.equal(enemyTurns(id, rare, tl).length, 5);
  }
  // without timeline data: the game's rotation of that variant
  assert.ok(enemyTurns(id, true, null).length > 0);
  const rot = fn(page, "enemyRotation");
  assert.match(rot, /enemyTurns\(id, rare, timelineOf\(id, rare\)\)/);
  assert.doesNotMatch(rot, /pick:|ap:/, "read-only, no AP");
  assert.match(fn(page, "drawEnemyCard"), /rotation: enemyRotation\(foe\.id, foe\.rare\)/);
});

// ---------------------------------------------------------------- 8. the columns (U65: chart on top, heroes | opponent)
test("the Party view: the chart's row on top, then heroes | opponent; stacked on a phone", () => {
  for (const html of [read("site/battle.html"), read("site/solver.html")]) {
    const grid = html.slice(html.indexOf('id="setup-grid"'));
    assert.ok(grid.indexOf('id="hp-col"') < grid.indexOf('id="party-col"') && grid.indexOf('id="party-col"') < grid.indexOf('id="opp-col"'));
  }
  assert.match(fn(page, "hpBox"), /document\.querySelector<HTMLElement>\("#hp-col"\)/);
  // the U62 three-column rules are deleted, not overridden (the U65 block has the grid)
  assert.doesNotMatch(block, /grid-template-areas/);
  assert.doesNotMatch(css, /"party opp hp"|"party party" "opp hp"|\.setup-grid\.b3-grid|minmax\(300px, 1fr\) minmax\(0, 2fr\)/);
});

// 9. the purple boss line: replaced in U65 by the white / near-black enemy line (battle-u65.test.ts).
