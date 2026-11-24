/**
 * The Simulator's Results (U43): compact first. Only the win rate and the average grade show, with a "Show details"
 * button for the rest (other tiles, XP and time, essence, the per-hero table). Open or closed is remembered for the
 * browser tab (sessionStorage `battle-results-details`, convenience only: closed when storage is missing or throws).
 *
 * Also the texts of the turn figures (the game's turn cap: Battle:combatLoop stops a fight at turn 200 as a loss) and
 * of each hero's HP left. Node tests import this file: no DOM is touched until a builder is called.
 */
import { TURN_CAP } from "../sim/battle.ts";
import type { HeroEval } from "../tools/combat.ts";
import { el, fmt, fmt1, pct } from "./dom.ts";

export const DETAILS_KEY = "battle-results-details";

type Store = Pick<Storage, "getItem" | "setItem">;

function session(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether the details were left open in this browser tab (closed by default). */
export function detailsOpen(store: Store | null = session()): boolean {
  try {
    return store?.getItem(DETAILS_KEY) === "open";
  } catch {
    return false;
  }
}

export function rememberDetails(open: boolean, store: Store | null = session()): void {
  try {
    store?.setItem(DETAILS_KEY, open ? "open" : "closed");
  } catch {
    // private mode or blocked storage: the choice lasts until the next result only
  }
}

export const detailsLabel = (open: boolean): string => (open ? "Hide details" : "Show details");

/** "max 37 of 200 turns (at 200 the enemy wins)". */
export const turnCapNote = (max: number, cap = TURN_CAP): string => `max ${fmt.format(max)} of ${cap} turns (at ${cap} the enemy wins)`;

/** How many fights (or map runs) the turn cap stopped, or null when none did. */
export function cappedNote(count: number, total: number, unit: "fights" | "runs"): string | null {
  if (!count) return null;
  return `${fmt.format(count)} of ${fmt.format(total)} ${unit} (${pct(count / total)}) reached turn ${TURN_CAP} and were lost`;
}

/** A hero's HP left at the end: the percent of max HP shown, the HP in the tooltip. */
export function hpLeftCell(h: Pick<HeroEval, "hp_left" | "hp_left_frac" | "max_hp">, unit: "fight" | "run"): { text: string; title: string } {
  return {
    text: pct(h.hp_left_frac),
    title: `${fmt.format(h.hp_left)} of ${fmt.format(h.max_hp)} HP on average at the end of the ${unit} (0 when dead)`,
  };
}

/** The essence of a map run, one line per essence ("2.4 Fire Essence"), or "none". */
export function essenceLines(essence: Record<string, number>, name: (english: string) => string): string[] {
  const lines = Object.entries(essence).map(([k, v]) => `${fmt1.format(v)} ${name(k)}`);
  return lines.length ? lines : ["none"];
}

/**
 * The result as the page shows it: the summary (always), then the toggle with the run line beside it, then the
 * details, hidden until opened.
 */
export function compactResult(summary: HTMLElement, details: HTMLElement[], runLine: HTMLElement): HTMLElement[] {
  let open = detailsOpen();
  const box = el("div", { id: "result-details", class: "result-details" }, ...details);
  const btn = el("button", { type: "button", class: "secondary small details-toggle", "aria-controls": "result-details" });
  const sync = () => {
    box.hidden = !open;
    btn.textContent = detailsLabel(open);
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => {
    open = !open;
    rememberDetails(open);
    sync();
  });
  sync();
  return [summary, el("div", { class: "result-toggle" }, btn, runLine), box];
}
