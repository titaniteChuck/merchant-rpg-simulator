/**
 * Farming planner (farming.ts) result texts without DOM, so Node tests can check them (review-farming.md, second
 * batch): the rare-quest tag (F07), the time tooltip of a map row (F20), the value tooltip with the mode note (F19),
 * the fold summaries (F12) and the setup signature that tells a shown result is out of date (F23).
 */
import type { FarmRow } from "../tools/farming.ts";
import { duration } from "./dom.ts";

/** Tag of a rare quest row (F07): rare quests only show up at random on the quest board. */
export const RANDOM_OFFER = "random offer";
export const RANDOM_OFFER_TIP = "Rare quests show up at random on the quest board: they can't be picked at will";

/** Value column "?" (F19: prices come from a Standard-mode profit model, said when the save is in another mode). */
export function valueHelp(mode = "Standard"): string {
  return "Loot sell value minus the run's cost (quest gold, map, scrolls, revives), plus essence at its cheapest " +
    "production cost (profit model, grade 3), per hour of the party's time." +
    (mode && mode !== "Standard" ? ` Prices follow Standard mode, not ${mode}.` : "");
}

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
