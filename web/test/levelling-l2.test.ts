/**
 * Levelling review, second batch (docs/tooling/roadmap/review-levelling.md, L2): hero picker labels with the
 * ascension and a number for same-named heroes (F24), the quest size beside the quest and the XP per run as a
 * tooltip (F17), a map step's craft + run time (F20).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LevelStep, XpSource } from "../src/tools/levelling.ts";
import { heroLabels, sizeText, stepTimeTip, xpRunTip } from "../src/ui/levelling-view.ts";

const cls = (c: number) => ["?", "Warrior", "Cleric"][c] ?? `class ${c}`;

test("F24: hero labels show level and ascension, and number heroes sharing a name", () => {
  const labels = heroLabels([
    { name: "Paladin", class: 1, level: 60, prestigeLevel: 3 },
    { name: "Aria", class: 2, level: 12, prestigeLevel: 1 },
    { name: "Paladin", class: 1, level: 42, prestigeLevel: 2 },
  ], cls);
  assert.deepEqual(labels, [
    "Paladin (1) · Warrior · Lv 60 · Asc 2",
    "Aria · Cleric · Lv 12 · Asc 0",
    "Paladin (2) · Warrior · Lv 42 · Asc 1",
  ]);
  assert.equal(new Set(labels).size, labels.length, "every label differs");
});

test("F17: quest size after the name only above x1; XP per run as a tooltip", () => {
  assert.equal(sizeText(1), "");
  assert.equal(sizeText(5), "×5");
  assert.equal(xpRunTip({ xpPerRun: 1234.4 }), "1,234 XP per run");
});

test("F20: a map step's time splits into the Scribe's craft time and the runs", () => {
  const src = (kind: "quest" | "map", craftHours?: number) => ({ kind, craftHours } as unknown as XpSource);
  const step = (source: XpSource, runsExact: number, hours: number) => ({ source, runsExact, runs: Math.ceil(runsExact), hours } as Pick<LevelStep, "source" | "hours" | "runsExact" | "runs">);
  assert.equal(stepTimeTip(step(src("quest"), 10, 5)), undefined);
  assert.equal(stepTimeTip(step(src("map", 0), 10, 5)), undefined);
  // 4 runs, 1.5 h craft each (6 h) + 2 h of runs = 8 h.
  assert.equal(stepTimeTip(step(src("map", 1.5), 4, 8)), "Craft 6 h + run 2 h");
});
