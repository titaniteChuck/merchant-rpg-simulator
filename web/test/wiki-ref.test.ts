// Wiki reference pages (U25): Stats and Battle. Anchors, cross-links, the worked-example formulas against the port,
// and every "source" note against the decompiled game (when ../decompiled is there: it is local only, not in CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as api from "../src/sim/api.ts";
import { determineBattleGrade } from "../src/sim/battle.ts";
import { G } from "../src/sim/data.ts";
import { heroMaxActionPoints, itemStat } from "../src/sim/defaults.ts";
import { Rng, setRng } from "../src/sim/lua.ts";
import { calculateReduction } from "../src/sim/stats.ts";
import { Game } from "../src/tools/gamedata.ts";
import { BATTLE_SECTIONS } from "../src/ui/wiki-battle.ts";
import { BATTLE_TOPICS, battleHref, type RefSection, STAT_TOPICS, statHref } from "../src/ui/wiki-ref.ts";
import { ascendEssence, baseStatRange, battleGrade, hitChance, maxAp, reduction, STATS_SECTIONS } from "../src/ui/wiki-stats.ts";

const gamedata = JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8"));
api.loadGameData(gamedata);

const pages: [string, Record<string, readonly [string, string]>, RefSection[]][] = [
  ["stats", STAT_TOPICS, STATS_SECTIONS],
  ["battle", BATTLE_TOPICS, BATTLE_SECTIONS],
];

test("reference pages: one section per topic, in catalog order, stable hrefs", () => {
  for (const [page, topics, sections] of pages) {
    assert.deepEqual(sections.map((s) => s.id), Object.keys(topics), page);
    for (const id of Object.keys(topics)) assert.match(id, /^[a-z]+(-[a-z]+)*$/, `${page}/${id}: anchor is lowercase-hyphenated`);
  }
  assert.equal(statHref("hit-chance"), "wiki.html#/stats/hit-chance");
  assert.equal(battleHref("turn-order"), "wiki.html#/battle/turn-order");
  // the topics the roadmap asks for are all there
  for (const t of ["hero-stats", "max-hp", "damage", "defence", "hit-chance", "crit", "ap", "luck", "grade", "quest-size", "xp", "item-stats", "sell", "craft", "essence", "enchant", "map-essence"]) {
    assert.ok(t in STAT_TOPICS, t);
  }
  for (const t of ["setup", "turn-order", "rotation", "targeting", "attack", "effects", "buffs-debuffs", "heals", "revives", "death", "battle-end", "map-runs", "quest-size"]) {
    assert.ok(t in BATTLE_TOPICS, t);
  }
});

test("reference pages: bodies render, every cross-link points to a real section", () => {
  for (const [page, , sections] of pages) {
    for (const s of sections) {
      const html = s.html();
      assert.ok(html.length > 200, `${page}/${s.id}: body`);
      assert.doesNotMatch(html, /undefined|NaN|\[object /, `${page}/${s.id}`);
      for (const [, p, t] of html.matchAll(/href="wiki\.html#\/(stats|battle)\/([a-z-]+)"/g)) {
        assert.ok(t in (p === "stats" ? STAT_TOPICS : BATTLE_TOPICS), `${page}/${s.id} links to missing ${p}/${t}`);
      }
      assert.ok(s.src.length > 0, `${page}/${s.id}: has a source note`);
    }
  }
  // Stats and Battle link to each other
  assert.ok(STATS_SECTIONS.some((s) => s.html().includes("#/battle/")));
  assert.ok(BATTLE_SECTIONS.some((s) => s.html().includes("#/stats/")));
});

test("worked-example formulas match the port", () => {
  for (const def of [0, 1, 37, 100, 250, 999]) {
    for (const pen of [0, 40]) assert.equal(reduction(def, pen), calculateReduction(def, pen));
  }
  for (let level = 1; level <= 60; level++) {
    for (const apMod of [0, 2]) assert.equal(maxAp(level, apMod), heroMaxActionPoints({ level, apMod }), `AP at ${level}`);
  }
  assert.equal(maxAp(40), 20);
  assert.equal(hitChance(100, 100), 100);
  assert.equal(hitChance(100, 150), 80);
  assert.equal(hitChance(150, 300), 67);

  // grade: against the port's determineBattleGrade on real quests
  const quests = Object.entries<any>(G.questData).filter(([, q]) => q?.questType && q.levelReq).slice(0, 60);
  for (const [id, q] of quests) {
    for (const [lvl, turns, rare] of [[q.levelReq, 3, false], [q.levelReq + 7, 12, false], [Math.max(1, q.levelReq - 6), 25, true]] as const) {
      const battle: any = { hasWon: true, frontRow: { 1: { level: lvl } }, backRow: { 1: { level: lvl } }, heroCount: 2, turns };
      assert.equal(battleGrade(lvl, q.region, q.levelReq, q.questType, turns, rare), determineBattleGrade(battle, Number(id), rare), `quest ${id}`);
    }
  }

  // essence: against the tools' prestigeItemMaterial port (plain items, base rarity)
  const gd = new Game(G);
  for (const [id, it] of Object.entries<any>(G.itemData.equipment).filter(([, it]) => it?.itemLevel && it.rarity).slice(0, 80)) {
    for (const up of [false, true]) {
      assert.equal(ascendEssence(it.itemLevel, it.rarity, "equipment", up), gd.essenceForAscension("equipment", Number(id), 1, up)[1], `equipment ${id}`);
    }
  }

  // item base stats: the range is exactly what the port's random roll covers
  for (const [lvl, grade, asc, d] of [[20, 3, 0, 0], [20, 5, 1, 0], [40, 1, 0, 10], [55, 4, 2, 30]]) {
    const [lo, hi] = baseStatRange(G.itemFormula.Sword.atkBase, G.itemFormula.Sword.atkLvl, lvl, grade, asc, d);
    setRng(new Rng(7));
    const rolls = Array.from({ length: 3000 }, () => itemStat.atk(lvl + [0, 40, 80][asc], "Sword", false, grade, d));
    assert.equal(Math.min(...rolls), lo, `Sword ${lvl} g${grade} a${asc} d${d}`);
    assert.equal(Math.max(...rolls), hi);
  }
});

/** The decompiled game, when present: <repo>/decompiled, or the main checkout's when this is a worktree. */
function findDecompiled(): string | undefined {
  let dir = resolve(import.meta.dirname, "../..");
  for (let i = 0; i < 6; i++) {
    const d = join(dir, "decompiled");
    if (existsSync(join(d, "obj.Hero.lua"))) return d;
    dir = dirname(dir);
  }
  return process.env.DECOMPILED;
}

test("source notes point at the right lines of the decompiled game", { skip: !findDecompiled() && "no decompiled/ here" }, () => {
  const root = findDecompiled()!;
  const cache = new Map<string, string[]>();
  for (const [page, , sections] of pages) {
    for (const s of sections) {
      for (const [file, line, needle] of s.src) {
        if (!cache.has(file)) cache.set(file, readFileSync(join(root, file), "utf8").split("\n"));
        const text = cache.get(file)![line - 1] ?? "";
        assert.ok(text.includes(needle), `${page}/${s.id}: ${file}:${line} is “${text.trim()}”, expected “${needle}”`);
      }
    }
  }
});
