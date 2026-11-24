/**
 * The Simulator's Results (U43): compact first. Only the win rate and the average grade show, with a "Show details"
 * button for the rest (other tiles, XP and time, essence, the per-hero table). Open or closed is remembered for the
 * browser tab (sessionStorage `battle-results-details`, convenience only: closed when storage is missing or throws).
 *
 * R2 F24: a result tile is a label and a value only; what used to be its subline is in a "?" on its label
 * (resultTile), and the details are one grid whose columns leave no tile alone on a row (tileColumns).
 *
 * Also the texts of the turn figures (the game's turn cap: Battle:combatLoop stops a fight at turn 200 as a loss) and
 * of each hero's HP left. Node tests import this file: no DOM is touched until a builder is called.
 */
import { TURN_CAP } from "../sim/battle.ts";
import type { HeroEval } from "../tools/combat.ts";
import { el, fmt, fmt1, pct, tile, type TileOptions } from "./dom.ts";
import { helpTip } from "./wiki-help.ts";

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

// ---------------------------------------------------------------- R2 F24: compact tiles, no orphans
/**
 * A result tile (R2 F24): label and value, no subline. `tip`, when given, is the "?" on the label (one paragraph or
 * several, empty ones dropped), with `refs` (links to the Stats page) on its last line.
 */
export function resultTile(label: string, value: string | Node, tip?: string | (string | null | undefined)[] | null, opts: TileOptions = {},
  refs: HTMLAnchorElement[] = []): HTMLElement {
  const t = tile(label, value, undefined, opts);
  const paras = (Array.isArray(tip) ? tip : [tip]).filter((p): p is string => Boolean(p));
  if (paras.length || refs.length) t.querySelector(".tile-label")?.append(" ", helpTip(paras, label.toLowerCase(), refs));
  return t;
}

/**
 * The columns of a grid of `n` result tiles (R2 F24), so no row ends with a lone tile: on a phone (`phone`) 3, or 2
 * for 2 and 4 tiles; on a wider screen (`wide`) one row up to 6 tiles, else 3 per row when that divides, else 4,
 * else the phone count. The details hold 3, 6 or 9 tiles, the summary 2.
 */
export function tileColumns(n: number): { phone: number; wide: number } {
  const k = Math.max(1, Math.trunc(n) || 1);
  const phone = k <= 2 ? k : k === 4 ? 2 : 3;
  const wide = k <= 6 ? k : k % 3 === 0 ? 3 : k % 4 === 0 ? 4 : phone;
  return { phone, wide };
}

/** True when `n` tiles in `cols` columns leave one tile alone on the last of several rows. */
export const hasOrphan = (n: number, cols: number): boolean => n > cols && n % cols === 1;
