/**
 * Levelling page (levelling.ts) texts without DOM, so Node tests can check them (review-levelling.md, L2): hero picker
 * labels with the ascension and a number for heroes sharing a name (F24), the quest size beside the quest (F17), the
 * XP per run and the map craft + run split as tooltips (F17, F20).
 */
import type { LevelStep } from "../tools/levelling.ts";
import { duration, heroAsc, lv } from "./dom.ts";
import { xpText } from "./quest-xp.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * One label per hero, in save order: "Paladin (2) · Paladin · Lv 60 · Asc 2". Heroes sharing a name get a number,
 * counted in save order, so the pickers tell them apart.
 */
export function heroLabels(heroes: Any[], className: (cls: number) => string): string[] {
  const total = new Map<string, number>();
  for (const h of heroes) total.set(String(h.name), (total.get(String(h.name)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return heroes.map((h) => {
    const name = String(h.name);
    const k = (seen.get(name) ?? 0) + 1;
    seen.set(name, k);
    const shown = (total.get(name) ?? 1) > 1 ? `${name} (${k})` : name;
    return `${shown} · ${className(h.class)} · ${lv(h.level ?? 1)} · Asc ${heroAsc(h.prestigeLevel ?? 1)}`;
  });
}

/** The quest size shown after the quest's name: "×5", nothing for ×1. */
export const sizeText = (amount: number): string => (amount > 1 ? `×${amount}` : "");

/** Tooltip of a step's XP / min: the XP of one run. */
export const xpRunTip = (s: Pick<LevelStep, "xpPerRun">): string => `${xpText(s.xpPerRun)} XP per run`;

/** Tooltip of a map step's time: the Scribe's craft time and the runs, which add up to the step's time. */
export function stepTimeTip(s: Pick<LevelStep, "source" | "hours" | "runsExact" | "runs">): string | undefined {
  const craft = s.source.kind === "map" ? s.source.craftHours ?? 0 : 0;
  if (!(craft > 0)) return undefined;
  const craftTotal = craft * (s.runsExact ?? s.runs);
  return `Craft ${duration(craftTotal * 3600)} + run ${duration(Math.max(0, s.hours - craftTotal) * 3600)}`;
}
