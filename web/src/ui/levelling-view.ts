/**
 * Levelling page (levelling.ts) texts without DOM, so Node tests can check them (review-levelling.md, L2): hero picker
 * labels with the ascension and a number for heroes sharing a name (F24), the quest size beside the quest (F17), the
 * XP per run and the map craft + run split as tooltips (F17, F20). R3 (review-r3.md): the hero's level beside the
 * picker (F09), the gold split only when it has two parts or more (F04), short XP potion labels (F05) and the default
 * reference quest (F07).
 */
import type { LevelStep } from "../tools/levelling.ts";
import { duration, fmt, gold, heroAsc, lv, lvStart } from "./dom.ts";
import { xpText } from "./quest-xp.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * One label per hero, in save order: "Paladin (2) · Paladin · lvl 60 · Asc 2". Heroes sharing a name get a number,
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

/** R3 F09: what the hero picker doesn't say, beside it: "Lvl 53 / 60". */
export const heroLevelText = (level: number, max: number): string => `${lvStart(level)} / ${max}`;

export interface GoldParts { launchGold: number; reviveGold: number; potionGold: number; mapGold: number; potions: number }

/** The parts of a gold total that aren't 0: "launch 1,200 g", "revive 300 g", "12 XP Boost +2 2,400 g", "maps 0 g". */
export function goldParts(g: GoldParts, potion = "potions"): string[] {
  const parts: string[] = [];
  if (g.launchGold) parts.push(`launch ${gold(g.launchGold)}`);
  if (g.reviveGold) parts.push(`revive ${gold(g.reviveGold)}`);
  if (g.potions) parts.push(`${fmt.format(g.potions)} ${potion} ${gold(g.potionGold)}`);
  if (g.mapGold) parts.push(`maps ${gold(g.mapGold)}`);
  return parts;
}

/** R3 F04: the split as a hint only when it has two parts or more (one part is the total again). */
export const goldHint = (parts: string[]): string | undefined => (parts.length > 1 ? parts.join(" · ") : undefined);

/** R3 F05: XP potion option labels, weakest first: "Boost", "+1", "+2" (the full name in the option's tooltip). */
export const potionShort = (index: number): string => (index ? `+${index}` : "Boost");

/**
 * R3 F07: the reference quest to compare on by default: the plan's last quest when it is in the list, else the
 * toughest quest at or below the hero's level − 5 (one it wins now), else the easiest. `ids` is toughest first.
 */
export function defaultRefQuest(ids: number[], levelReq: (id: number) => number, heroLevel: number, lastPlanQuest: number | null): number | undefined {
  if (lastPlanQuest !== null && ids.includes(lastPlanQuest)) return lastPlanQuest;
  return ids.find((id) => levelReq(id) <= heroLevel - 5) ?? ids.at(-1);
}
