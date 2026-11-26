// Battle Simulator and Solver U67: the Party view's hero and enemy cards at the chart's turn. No HP bar; the stats two
// per row, "name value (modifier)", HP across both ("HP 1,234 / 2,000"), no Eva on a hero card, no Crit on the enemy's;
// the modifier is the stat's % sum (and an effect's flat points) at that turn, its parts (skill, passive, item…) and the
// game's calculation in a tooltip; the effects listed are only those that are no stat modifier (a stun); the turn's
// rotation row says what came of it (💫, damage, "!" a crit, Miss, +heal); on a phone hero cards two per row. The trace
// records it (TraceLife.mods, TraceEntry.out / by), read only. No browser: known traces, the cards in the fake DOM, the
// page code and CSS as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { Sim } from "../src/tools/engine.ts";
import { fightSeed } from "../src/tools/combat.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { cardTurnOf, modLabel, modLeft, modsAt, outcomeAt, statMods } from "../src/ui/card-turn.ts";
import { type CardOutcome, fighterCard, type ModPart, modSums, modText, modTipLines, outcomeText, paintCard, signedPct, statCell, statGrid }
  from "../src/ui/fighter-card.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css"), cardSrc = read("web/src/ui/fighter-card.ts"), hpChartSrc = read("web/src/ui/hp-chart.ts");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));
const block = css.slice(css.indexOf("/* U67 */"), css.indexOf("/* end U67 */"));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const party = () => IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
const traceOf = (quest: number) => {
  const [f, b] = party();
  return traceFight(sim, quest, [...f], [...b]);
};
type F = FakeElement & HTMLElement;
const ODIN = 72; // buffs, debuffs, heals
const STUN = 89; // a hero stunned
const FLAT = 73; // an effect's flat Matk on the enemy
const odin = traceOf(ODIN);
const names = (w: number) => (w ? `Hero ${w}` : "Odin");

// ---------------------------------------------------------------- 1. the trace: stat parts with their sources
test("trace: each fighter's stat parts at the start: the passive and the gear's %, matching the hero's own sums", () => {
  const start = odin.start!;
  const [f, b] = party();
  const heroes = new Map([[2, f[0]], [4, f[1]], [6, f[2]], [1, b[0]], [3, b[1]], [5, b[2]]]);
  for (const l of start.life.filter((x) => x.who > 0)) {
    const h = heroes.get(l.who)! as unknown as Record<string, number>;
    const mods = l.mods ?? [];
    assert.ok(mods.every((m) => m.src !== "other"), "every part of a hero's % is explained");
    for (const [stat, field] of [["maxHP", "hpPct"], ["atk", "atkPct"], ["matk", "matkPct"], ["def", "defPct"], ["mdef", "mdefPct"], ["acc", "accPct"]]) {
      const sum = mods.filter((m) => m.stat === stat && m.kind === "pct" && m.src !== "effect").reduce((a, m) => a + m.value, 0);
      assert.ok(Math.abs(sum - (h[field] ?? 0)) < 1e-9, `${l.who} ${stat}: parts ${sum} = the hero's ${h[field]}`);
    }
    assert.ok(!mods.some((m) => m.stat === "eva"), "no Eva on a hero");
    const passive = mods.filter((m) => m.src === "passive");
    for (const m of passive) assert.equal(m.value, G.passiveData[m.name].stats[`${m.stat === "maxHP" ? "hp" : m.stat}Pct`]);
  }
  const all = start.life.flatMap((l) => l.mods ?? []);
  assert.ok(all.some((m) => m.src === "passive" && m.name === "Juggernaut" && m.stat === "maxHP" && m.value === 0.25));
  assert.ok(all.some((m) => m.src === "item" && m.name === "Sturdy Inferno Chapeau" && m.stat === "mdef"), "an item, by its engine name");
});

test("trace: an effect's part names the effect, its caster, its skill and its turns, with the effect's own value", () => {
  let seen = 0;
  for (const a of odin.actions) {
    for (const l of a.life) {
      for (const m of (l.mods ?? []).filter((x) => x.src === "effect")) {
        const fx = a.fx.find((e) => e.who === l.who && e.name === m.name);
        assert.ok(fx, `${m.name} on ${l.who} is among its effects`);
        assert.equal(m.from, fx!.from);
        assert.equal(m.skill, fx!.skill);
        assert.equal(m.turns, fx!.turns);
        if (m.kind === "pct") {
          const key = m.stat === "maxHP" ? "maxHP" : m.stat;
          assert.equal(m.value, fx!.stats?.[key], `${m.name}: ${m.stat}`);
        }
        seen++;
      }
    }
  }
  assert.ok(seen > 0);
  assert.ok(odin.actions.some((a) => a.life.some((l) => l.mods?.some((m) => m.src === "effect" && m.name === "Holy Blessing" && m.stat === "atk"))));
  // flat points: the enemy's Matk from an effect
  const flat = traceOf(FLAT).actions.flatMap((a) => a.life.flatMap((l) => l.mods ?? [])).find((m) => m.kind === "flat");
  assert.ok(flat && flat.stat === "matk" && flat.src === "effect" && flat.value > 0, "a flat part");
});

// ---------------------------------------------------------------- 2. the trace: what each action did
test("trace: each action's outcome per target (damage, heal, misses, crits) agrees with its calculations", () => {
  let hits = 0, heals = 0;
  for (const a of odin.actions) {
    if (a.did === null || a.did === false) {
      assert.deepEqual(a.out, [], "no action, no outcome");
      continue;
    }
    assert.equal(a.out.reduce((s, o) => s + o.miss, 0), a.misses, "the misses are the actor's");
    for (const o of a.out) {
      const calc = a.hits.find((h) => h.who === o.who)?.calc?.filter((x) => x.from === a.who && !x.tick) ?? [];
      const dmg = calc.filter((x) => x.kind === "dmg" && x.hpBefore > 0).reduce((s, x) => s + x.total, 0);
      assert.equal(o.dmg, dmg, `turn ${a.turn} ${a.who} → ${o.who}`);
      assert.equal(o.crit, calc.filter((x) => x.kind === "dmg" && x.hpBefore > 0 && x.crit).length);
      hits += o.hits;
      heals += o.heals;
    }
  }
  assert.ok(hits > 0 && heals > 0, "hits and heals");
  assert.ok(odin.actions.some((a) => a.out.some((o) => o.crit)), "a crit");
  assert.ok(odin.actions.some((a) => a.out.some((o) => o.miss)), "a miss");
});

test("trace: a stunned action names the effect that took it; the fight ends as a plain one", () => {
  const t = traceOf(STUN);
  const lost = t.actions.filter((a) => a.did === false);
  assert.ok(lost.length > 0);
  for (const a of lost) assert.equal(a.by, "Stun");
  assert.ok(t.actions.filter((a) => a.did !== false).every((a) => a.by === undefined || typeof a.did === "string"));
  // read only: the same seed without the trace ends the same
  for (const [q, tr] of [[STUN, t], [ODIN, odin]] as const) {
    const [f, b] = party();
    const plain = sim.fight(q, [...f], [...b], { seed: fightSeed(1, 0), isRare: false, amount: 1 });
    assert.equal(plain.won, tr.won);
    assert.equal(plain.turns, tr.turns);
  }
});

// ---------------------------------------------------------------- 3. the card's data at a turn (card-turn.ts)
test("card data: the parts at a turn, named; the outcome on the turn's row; the effects without the stat ones", () => {
  // the last record up to the turn, turn 0 the start
  assert.deepEqual(modsAt(odin, 0, 6), odin.start!.life.find((l) => l.who === 6)!.mods);
  const t = odin.actions.find((a) => a.turn > 1 && a.life.some((l) => l.mods?.some((m) => m.src === "effect")))!.turn;
  const last = odin.actions.filter((a) => a.turn <= t).at(-1)!;
  for (const l of last.life) assert.deepEqual(modsAt(odin, t, l.who), l.mods ?? []);
  // labels
  const m = (x: Partial<api.TraceMod>): api.TraceMod => ({ stat: "atk", kind: "pct", value: 0.1, src: "effect", name: "Holy Blessing", ...x });
  // U71: no caster; the time left apart (modLeft), after the value in the tooltip
  assert.equal(modLabel(m({ from: 2, skill: "Holy Blessing", turns: 2 })), "Holy Blessing");
  assert.equal(modLeft(m({ from: 2, skill: "Holy Blessing", turns: 2 })), "2 turns left");
  assert.equal(modLeft(m({ from: 0, turns: 1 })), "1 turn left");
  assert.equal(modLeft(m({ turns: 0 })), "ends at its next action");
  assert.equal(modLeft(m({ src: "passive", name: "Might" })), undefined);
  assert.equal(modLabel(m({ src: "passive", name: "Might" })), "Might (passive)");
  assert.equal(modLabel(m({ src: "item", name: "Sturdy Inferno Chapeau" })), "[Sturdy] Inferno Chapeau");
  assert.equal(modLabel(m({ src: "scroll", name: "Scrolls" })), "Scrolls");
  // by stat; two enchantments of a kind add up
  const sm = statMods([m({ src: "passive", name: "Might" }), m({ src: "enchant", name: "Enchantment", value: 0.02 }),
    m({ src: "enchant", name: "Enchantment", value: 0.03 }), m({ stat: "crit", kind: "flat", value: 25, name: "Expose Weakness" })]);
  assert.deepEqual(Object.keys(sm), ["atk", "crit"]);
  assert.deepEqual(sm.atk.map((p) => [p.label, p.value]), [["Might (passive)", 0.1], ["Enchantments", 0.05]]);
  assert.deepEqual(sm.crit, [{ kind: "flat", value: 25, label: "Expose Weakness" }]);
  // outcome: turn 1's row 0, turn 7's row 1; a hit names its target
  const a = odin.actions.find((x) => x.turn === 7 && typeof x.did === "string" && x.out.length)!;
  const o = outcomeAt(odin, 7, a.who, names)!;
  assert.equal(o.row, 1);
  assert.deepEqual(o.targets.map((x) => x.name), a.out.map((x) => names(x.who)));
  assert.equal(outcomeAt(odin, 0, a.who, names), null, "turn 0: nothing played");
  const stun = traceOf(STUN);
  const lost = stun.actions.find((x) => x.did === false)!;
  assert.deepEqual(outcomeAt(stun, lost.turn, lost.who, names), { row: (lost.turn - 1) % 5, lost: "Stun", targets: [] });
  // U69: no effects list any more; no trace: nothing more
  assert.deepEqual(cardTurnOf(undefined, 3, 1, names), { outcome: null });
});

// ---------------------------------------------------------------- 4. the text builders
test("text: the stat cell, name value (modifier); HP now / max; no modifier part without one", () => {
  const stats = { maxHP: 20_000, atk: 1234, matk: 15_000, def: 50, mdef: 60, acc: 100, eva: 5, crit: 12 };
  const mods: Record<string, ModPart[]> = {
    atk: [{ kind: "pct", value: 0.1, label: "Might (passive)" }, { kind: "pct", value: 0.05, label: "Song of Courage" }],
    maxHP: [{ kind: "pct", value: 0.1, label: "Juggernaut (passive)" }],
    crit: [{ kind: "flat", value: 25, label: "Expose Weakness" }],
    def: [{ kind: "pct", value: -0.2, label: "Shield Slam" }, { kind: "flat", value: 30, label: "Inspiration" }],
    mdef: [{ kind: "set", value: 0, label: "Holy Shield" }],
  };
  // U69: from four digits a short form too (a hero card on a phone)
  assert.deepEqual(statCell("atk", "Atk", stats, { mods }), { name: "Atk", value: "1,234", short: "1.2K", mod: "(+15%)" });
  assert.deepEqual(statCell("acc", "Acc", stats, { mods }), { name: "Acc", value: "100", mod: "" });
  // U69: HP's modifier is the turn's HP change, never a %
  assert.deepEqual(statCell("maxHP", "HP", stats, { hp: 12_345, mods }),
    { name: "HP", value: "12,345 / 20,000", mod: "", short: "12.3K / 20K" });
  assert.deepEqual(statCell("maxHP", "HP", { ...stats, maxHP: 900 }, { hp: -5 }), { name: "HP", value: "0 / 900", mod: "" });
  assert.deepEqual(statCell("matk", "Matk", stats), { name: "Matk", value: "15K", full: "15,000", mod: "" });
  assert.deepEqual(statCell("atk", "Atk", null), { name: "Atk", value: "–", mod: "" });
  assert.equal(modText("crit", mods.crit), "+25");
  assert.equal(modText("def", mods.def), "−20% +30");
  assert.equal(modText("mdef", mods.mdef), "set");
  assert.equal(modText("atk", []), "");
  assert.equal(signedPct(0.125), "+12.5%");
  assert.equal(signedPct(-0.3), "−30%");
  // the floor: Atk's % sum never goes under −90%
  assert.deepEqual(modSums("atk", [{ kind: "pct", value: -1.2, label: "x" }]), { raw: -1.2, floor: -0.9, pct: -0.9, flat: 0, set: false });
  assert.equal(modText("atk", [{ kind: "pct", value: -1.2, label: "x" }]), "−90%");
});

test("text: the modifier's tooltip: the parts with their sources, then the game's calculation", () => {
  // U71: no header, no caster, the time left after the value, no "Base"
  const atk: ModPart[] = [{ kind: "pct", value: 0.1, label: "Might (passive)" }, { kind: "pct", value: 0.05, label: "Song of Courage", left: "2 turns left" }];
  assert.deepEqual(modTipLines("atk", "Atk", 1150, atk),
    ["Might (passive): +10%", "Song of Courage: +5% (2 turns left)", "1,000 × (1 + 15%) = 1,150"]);
  assert.deepEqual(modTipLines("maxHP", "HP", 2500, [{ kind: "pct", value: 0.25, label: "Juggernaut (passive)" }]),
    ["Juggernaut (passive): +25%", "2,000 × (1 + 25%) = 2,500"]);
  // flat points first, then the %
  assert.deepEqual(modTipLines("def", "Def", 80, [{ kind: "pct", value: -0.2, label: "Shield Slam" }, { kind: "flat", value: 30, label: "Inspiration" }]),
    ["Shield Slam: −20%", "Inspiration: +30", "(70 + 30) × (1 − 20%) = 80"]);
  assert.deepEqual(modTipLines("crit", "Crit", 37, [{ kind: "flat", value: 25, label: "Expose Weakness" }]),
    ["Expose Weakness: +25", "12 + 25 = 37"]);
  assert.deepEqual(modTipLines("acc", "Acc", 0, [{ kind: "pct", value: -1.4, label: "Other" }]),
    ["Other: −140%", "Acc × (1 − 100%) = 0", "% sum −140%, floored at −100%"]);
  assert.deepEqual(modTipLines("mdef", "Mdef", 300, [{ kind: "set", value: 0, label: "Holy Shield" }]),
    ["Holy Shield: sets Mdef"]);
});

test("text: the outcome on the turn's row: 💫, damage with a crit mark, Miss, heals, several targets compactly", () => {
  const t = (x: Partial<CardOutcome["targets"][number]>) => ({ name: "Odin", dmg: 0, heal: 0, hits: 0, heals: 0, miss: 0, crit: 0, ...x });
  assert.deepEqual(outcomeText({ row: 0, lost: "Stun", targets: [] }), { text: "💫", label: "Action lost: Stun", lines: ["Action lost: Stun"], tone: "lost" });
  assert.deepEqual(outcomeText({ row: 0, targets: [t({ dmg: 1234, hits: 1 })] }),
    { text: "1,234", label: "Odin: 1,234 damage", lines: ["Odin: 1,234 damage"], tone: "hit" });
  assert.deepEqual(outcomeText({ row: 0, targets: [t({ dmg: 2500, hits: 1, crit: 1 })] })!.text, "2,500!");
  assert.equal(outcomeText({ row: 0, targets: [t({ dmg: 2500, hits: 1, crit: 1 })] })!.tone, "crit");
  assert.equal(outcomeText({ row: 0, targets: [t({ dmg: 2500, hits: 1, crit: 1 })] })!.label, "Odin: 2,500 damage (critical)");
  assert.deepEqual(outcomeText({ row: 0, targets: [t({ miss: 1 })] }), { text: "Miss", label: "Odin: missed", lines: ["Odin: missed"], tone: "miss" });
  assert.deepEqual(outcomeText({ row: 0, targets: [t({ name: "Ana", heal: 560, heals: 1 }), t({ name: "Bob", heal: 0, heals: 1 })] }),
    { text: "+560 · +0", label: "Ana: +560 HP; Bob: +0 HP", lines: ["Ana: +560 HP", "Bob: +0 HP"], tone: "heal" });
  const aoe = outcomeText({ row: 0, targets: [t({ name: "Ana", dmg: 980, hits: 1 }), t({ name: "Bob", miss: 1 }), t({ name: "Cy", dmg: 12_000, hits: 2, crit: 1, miss: 1 })] })!;
  assert.equal(aoe.text, "980 · Miss · 12K! (1 miss)");
  assert.deepEqual(aoe.lines, ["Ana: 980 damage", "Bob: missed", "Cy: 12,000 damage (1 critical), 1 missed"]);
  assert.equal(outcomeText({ row: 0, targets: [] }), null, "a buff: nothing to say");
});

// ---------------------------------------------------------------- 5. the card
test("card: no HP bar; the stats two per row with the modifier focusable and its tooltip; the outcome on the row", () => {
  const stats = { maxHP: 2000, atk: 1150, matk: 80, def: 60, mdef: 50, acc: 95, eva: 30, crit: 12 };
  const mods = { atk: [{ kind: "pct" as const, value: 0.15, label: "Might (passive)" }], def: [{ kind: "pct" as const, value: -0.2, label: "Shield Slam" }] };
  const rot = [0, 1, 2, 3, 4].map((k) => ({ text: `Skill ${k}`, ap: 1 }));
  const card = fighterCard({ kind: "hero", head: document.createElement("span") as unknown as HTMLElement, stats, rotation: rot,
    turn: { hp: 1500, mods, active: 2, outcome: { row: 2, targets: [{ name: "Odin", dmg: 300, heal: 0, hits: 1, heals: 0, miss: 0, crit: 1 }] } } }) as unknown as F;
  assert.equal(card.querySelectorAll(".fc-hp").length, 0);
  assert.doesNotMatch(cardSrc, /hpBar|flow-hp/, "no HP bar on the cards");
  const cells = card.querySelectorAll("div.fc-stat");
  assert.deepEqual(cells.map((c) => c.children.map((x) => x.textContent)), [
    ["HP", "1,500 / 2,000", ""], ["Atk", "1,1501.2K", "(+15%)"], ["Matk", "80", ""], ["Def", "60", "(−20%)"], ["Mdef", "50", ""], ["Acc", "95", ""], ["Crit", "12", ""]]);
  assert.ok(cells[0].classList.contains("fc-stat-hp"));
  const up = card.querySelector("span.fc-mod-btn")!;
  assert.equal(up.getAttribute("tabindex"), "0");
  assert.ok(up.classList.contains("up"));
  assert.ok(card.querySelectorAll("span.fc-mod-btn")[1].classList.contains("down"));
  // the tooltip shows on hover and on focus (tooltip.ts)
  up.dispatch("focus");
  const box = (document.body as unknown as F).children.find((c) => c.id === "tip") as F;
  assert.ok(box && !box.hidden);
  assert.equal(box.textContent, "Might (passive): +15%1,000 × (1 + 15%) = 1,150");
  // the enemy card: Eva, no Crit
  const foe = fighterCard({ kind: "enemy", head: document.createElement("span") as unknown as HTMLElement, stats, rotation: rot }) as unknown as F;
  assert.deepEqual(foe.querySelectorAll("dt").map((d) => d.textContent), ["HP", "Atk", "Matk", "Def", "Mdef", "Acc", "Eva"]);
  // the outcome sits on the turn's row, after the skill; painting another turn moves it
  const rows = card.querySelectorAll("li.fc-turn");
  assert.equal(rows[2].children[1].className, "fc-out crit");
  assert.equal(rows[2].querySelector("span.fc-out")!.textContent, "300!Odin: 300 damage (critical)");
  paintCard(card as unknown as HTMLElement, { stats, hp: 1500, active: null, outcome: { row: 4, lost: "Stun", targets: [] } });
  assert.equal(card.querySelectorAll("span.fc-out").length, 1);
  const lost = rows[4].querySelector("span.fc-out")!;
  assert.equal(lost.getAttribute("role"), "img");
  assert.equal(lost.getAttribute("aria-label"), "Action lost: Stun");
  assert.equal(lost.textContent, "💫");
  paintCard(card as unknown as HTMLElement, { stats: null });
  assert.equal(card.querySelectorAll("span.fc-out").length + card.querySelectorAll("span.fc-mod-btn").length, 0);
  // a hero's HP from five digits: the short form for a phone beside the whole one
  const big = statGrid({ ...stats, maxHP: 20_000 }, "hero", { hp: 12_345 }) as unknown as F;
  assert.deepEqual(big.querySelector("dd.fc-val")!.children.map((c) => [c.className, c.textContent]), [["v-full", "12,345 / 20,000"], ["v-short", "12.3K / 20K"]]);
});

test("page: the cards take the modifiers, effects and outcome from the trace; CSS: two per row, HP across, phone two cards per row", () => {
  const turn = fn(page, "turnOfCard");
  assert.match(turn, /cardTurnOf\(chart\?\.runs\[at\.run\]\?\.trace, at\.turn, who, nameOf, view\?\.upTo\)/);
  assert.match(fn(page, "paintTurn"), /\.\.\.turnOfCard\(at, w, now\)/);
  assert.match(fn(page, "drawEnemyCard"), /turn: turnOfCard\(at, 0, now\)/);
  assert.doesNotMatch(page, /chartRuns/, "the cards read the chart\'s own fought runs (chart.runs[i].trace)");
  assert.match(hpChartSrc, /won: r\.trace\.won, turns: r\.trace\.turns, trace: r\.trace \}/);
  assert.doesNotMatch(page, /hpTexts/);
  // U71: the value right after its name, the room left between the two stats; HP its own line (the U71 block)
  assert.match(block, /\.fc-stats \{ display: grid; grid-template-columns: auto minmax\(0, max-content\) minmax\(max-content, 1fr\) auto minmax\(0, max-content\) minmax\(max-content, 1fr\);/);
  assert.match(block, /\.fc-stat \{ display: contents; \}/);
  assert.doesNotMatch(block, /\.fc-stat-hp > \.fc-val \{ grid-column: 2 \/ span 4; \}/);
  // U69: the phone rules moved to the U69 block (the two columns back | front, the stats two per row)
  assert.doesNotMatch(block, /@media \(max-width: 560px\)/);
  const u69 = css.slice(css.indexOf("/* U69 */"), css.indexOf("/* end U69 */"));
  const phone = u69.slice(u69.indexOf("@media (max-width: 560px)"));
  assert.match(phone, /\.party-cols \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(phone, /\.fc-hero \.fc-val \.v-short \{ display: inline; \}/);
  assert.doesNotMatch(css, /\.fc-hp \{/, "the bar's rule is gone");
});
