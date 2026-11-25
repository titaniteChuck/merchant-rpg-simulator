/**
 * Farming planner (farming.ts) result texts without DOM, so Node tests can check them (review-farming.md, second
 * batch): the rare-quest tag (F07), the time tooltip of a map row (F20), the value tooltip with the mode note (F19),
 * the fold summaries (F12) and the setup signature that tells a shown result is out of date (F23).
 *
 * Review R3 (review-r3.md, Farming): the ranking figure is "value/h", its gold and essence parts in the tile and the
 * tips (F27); loss colour (F29); help shown by tip() on hover, focus and tap instead of `title` (F33, F38); the
 * source's second line (F34, F35); "–" when there is no essence (F36).
 */
import type { FarmRow } from "../tools/farming.ts";
import { duration, fmt, fmt1, gold, lvStart } from "./dom.ts";

/** Tag of a rare quest row (F07): rare quests only show up at random on the quest board. */
export const RANDOM_OFFER = "random offer";
export const RANDOM_OFFER_TIP = "Rare quests show up at random on the quest board: they can't be picked at will";

/**
 * Value / h "?" (F27: gold plus essence priced in gold, not gold alone; F19: prices come from a Standard-mode profit
 * model, said when the save is in another mode).
 */
export function valueHelp(mode = "Standard"): string {
  return "Value per hour of the party's time: Gold / h plus the essence priced at its cheapest production cost " +
    "(profit model, grade 3). A source can lose gold and still rank high on its essence. Tap a value for its parts." +
    (mode && mode !== "Standard" ? ` Prices follow Standard mode, not ${mode}.` : "");
}

/** Gold / h "?" (F27). */
export const GOLD_HELP = "Gold only: loot sell value minus the run's cost (quest gold, map, scrolls, revives), per hour. " +
  "Essence isn't counted.";

/** The ranking figure (F27): "3,544 value/h". */
export const valueText = (v: number): string => valueParts(v).join(" ");

/** The ranking figure in two parts (R3 375 px fixes): the number, then the unit the podium tile sets smaller beside it. */
export const valueParts = (v: number): [number: string, unit: string] => [fmt.format(v), "value/h"];

/** Essence that shows as more than "0.0". */
export const hasEssence = (x: number): boolean => x >= 0.05;

/**
 * Value / h as its gold amount and the rest (R3 375 px fixes), so the podium tile colours a gold loss as the table
 * does: ["-1,283 g", " + 79.2 essence /h"], ["1,250 g", "/h"].
 */
// No-break spaces keep "essence /h" together, so "/h" never wraps alone on a 375 px tile.
export function valueSplitParts(goldPerHour: number, essencePerHour: number): [gold: string, rest: string] {
  return [gold(goldPerHour), hasEssence(essencePerHour) ? ` + ${fmt1.format(essencePerHour)}\u00a0essence\u00a0/h` : "/h"];
}

/** Value / h in its parts (F27): "-1,283 g + 79.2 essence /h"; "1,250 g/h" when the source gives no essence. */
export function valueSplit(goldPerHour: number, essencePerHour: number): string {
  return valueSplitParts(goldPerHour, essencePerHour).join("");
}

/** An essence cell (F36): "–" when the source gives none. */
export const essenceText = (x: number): string => (hasEssence(x) ? fmt1.format(x) : "–");

/** Colour class of a per-hour amount (F29): a loss red, zero muted. */
export const toneOf = (x: number): string => (x < 0 ? "pf-loss" : x === 0 ? "muted" : "");

/** Cost / run tip (F33): its parts, "Free" when nothing is paid. */
export function costTip(c: Pick<FarmRow["cost"], "gold" | "map" | "scrolls" | "revive">): string {
  const parts: [string, number][] = [["Quest gold", c.gold], ["Map", c.map], ["Scrolls", c.scrolls], ["Revives", c.revive]];
  return parts.filter(([, v]) => v > 0).map(([k, v]) => `${k} ${gold(v)}`).join(" · ") || "Free";
}

/** Grade cell tip (F33). */
export const gradeTip = (avg: number): string => `Average grade ${fmt1.format(avg)}`;

/** A source's second line (F34, F35): a quest's level; a map's own grade, apart from the run's Grade column. */
export function sourceSub(s: { kind: "quest"; level: number | undefined } | { kind: "map"; grade: string }): string {
  return s.kind === "quest" ? lvStart(s.level) : `Map grade ${s.grade}`;
}

/** Help shown by tip() (F33, F38). */
export const PARTY_TIP = "Shared with the Battle Simulator: rotations and ticked-out heroes too";
export const LEFT_OUT_TIP = "Ticked out on the Simulator: doesn't fight";
export const SCROLLS_TIP = "Bought for every map run";
export const ERRORS_TIP = "Runs the game's own code fails on are left out";

/** No-scroll option (F32): short, so the select isn't cut. */
export const NO_SCROLL = "None";

/** Time cell tooltip of a map row (F20): the Scribe's craft time and the run, which add up to the time per run. */
export function timeTip(r: Pick<FarmRow, "kind" | "craft_h" | "run_h">): string | undefined {
  if (r.kind !== "map" || !(r.craft_h > 0)) return undefined;
  return `Craft ${duration(r.craft_h * 3600)} + run ${duration(r.run_h * 3600)}`;
}

/** A fold's summary (F12): "Quests · 12 ticked". */
export const foldSummary = (label: string, ticked: number): string => `${label} · ${ticked} ticked`;

/** What a ranking was made from; a shown result is out of date once the page's setup no longer matches it (F23). */
export interface FarmSetup {
  slots: Record<string, number | null | undefined>;
  excluded: Record<string, boolean>;
  /** Ticked checkbox values ("quest:80", "cat:22:1", "rare"). */
  sources: string[];
  scrolls: string[];
  n: number;
  mapRuns: number;
}

export function setupSignature(s: FarmSetup): string {
  const slots = Object.keys(s.slots).filter((k) => s.slots[k] !== null && s.slots[k] !== undefined).sort().map((k) => `${k}=${s.slots[k]}`);
  const off = Object.keys(s.excluded).filter((k) => s.excluded[k] && s.slots[k] !== null && s.slots[k] !== undefined).sort();
  return JSON.stringify([slots, off, [...s.sources].sort(), s.scrolls.filter(Boolean), s.n, s.mapRuns]);
}
