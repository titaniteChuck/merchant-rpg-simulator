/**
 * Which expansions the visitor owns, and whether expansion content is shown (U28). One module for every page:
 *
 * - Owned = what the loaded save proves (inferExpansions, web/src/tools/expansions.ts), with the visitor's manual
 *   "I own Frozen Tome" / "I own Scribe" toggles on top (effectiveExpansions). No save: nothing is owned, the toggles
 *   still work. The game keeps ownership in UserInfo.usr, which the site never reads: inference only proves ownership.
 * - Show all: one global "Show expansion content" switch that reveals everything.
 * - isVisible(kind, id, extra): content the visitor owns (or everything when show-all is on) is visible; the rest is
 *   hidden by the pages (lists, pickers) or shown as a greyed placeholder where a table refers to it.
 *
 * Stored in this browser (localStorage, every access in try/catch): the overrides, the show-all flag, and the last
 * save's inference (so a page without a save picker, the wiki, knows it before the save is decoded again).
 * Pages subscribe() and re-render on change; a change in another tab arrives through the storage event.
 */
import { G } from "../sim/data.ts";
import { decodeSaveText } from "../tools/save.ts";
import {
  type ContentExtra, type ContentGate, type ContentKind, contentExpansion, effectiveExpansions, type Evidence, type Expansion,
  EXPANSION_IDS, type ExpansionOverrides, inferExpansions,
} from "../tools/expansions.ts";
import { expansionBadge, expansionPlaceholder } from "./dom.ts";
import { getSave } from "./save-store.ts";

export type { ContentGate, ContentKind, Expansion };

const KEY_OVERRIDES = "expansions-overrides";
const KEY_SHOW_ALL = "expansions-show-all";
const KEY_INFERRED = "expansions-inferred";

export interface InferredState {
  owned: Expansion[];
  evidence: Evidence[];
  /** Name of the save it was guessed from; null when no save is loaded. */
  source: string | null;
}

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown): void => {
  try {
    if (v === null || v === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch { /* storage blocked: kept for this page only */ }
};

const NONE: InferredState = { owned: [], evidence: [], source: null };
const cleanInferred = (v: Partial<InferredState> | null): InferredState => ({
  owned: EXPANSION_IDS.filter((x) => Array.isArray(v?.owned) && v.owned.includes(x)),
  evidence: Array.isArray(v?.evidence) ? v.evidence.filter((e) => e && typeof e.reason === "string") : [],
  source: typeof v?.source === "string" ? v.source : null,
});
const cleanOverrides = (v: unknown): ExpansionOverrides => {
  const out: ExpansionOverrides = {};
  for (const x of EXPANSION_IDS) {
    const o = (v as Record<string, unknown> | null)?.[x];
    if (typeof o === "boolean") out[x] = o;
  }
  return out;
};

let inferred: InferredState = cleanInferred(read(KEY_INFERRED, NONE));
let overrides: ExpansionOverrides = cleanOverrides(read(KEY_OVERRIDES, {}));
let showAllFlag = read<unknown>(KEY_SHOW_ALL, false) === true;
let owned: Set<Expansion> = effectiveExpansions(inferred.owned, overrides);

const listeners = new Set<() => void>();
/** Call `fn` after every change of ownership or of the show-all flag; returns the unsubscribe. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed(): void {
  owned = effectiveExpansions(inferred.owned, overrides);
  gateCache.clear();
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

// ---------------------------------------------------------------- reading the state
/** The expansions the visitor owns: the save's guess with the manual toggles on top. */
export const ownedExpansions = (): Set<Expansion> => new Set(owned);
/** What the save proves (before the manual toggles). */
export const inferredState = (): InferredState => ({ ...inferred, owned: [...inferred.owned], evidence: [...inferred.evidence] });
/** The manual toggle of an expansion: true / false, or null when it follows the save. */
export const overrideOf = (x: Expansion): boolean | null => overrides[x] ?? null;
/** "Show expansion content": everything visible, owned or not. */
export const showAll = (): boolean => showAllFlag;
export const owns = (x: Expansion): boolean => owned.has(x);
/**
 * U42: the content of expansion `x` is hidden on the pages: not owned and "Show expansion content" off (the rule of
 * isVisible, and of the Expansions page's "Not owned: its content is hidden"). The battle pages hide every map-run
 * control with Scribe hidden.
 */
export const isHidden = (x: Expansion): boolean => !showAllFlag && !owned.has(x);
/** The visitor owns every expansion of `needs`. */
export const ownsAll = (needs: readonly Expansion[]): boolean => needs.every((x) => owned.has(x));

// ---------------------------------------------------------------- changing it
/** Set (true / false) or clear (null: follow the save again) the manual toggle of an expansion. */
export function setOverride(x: Expansion, v: boolean | null): void {
  if (v === null) delete overrides[x];
  else overrides[x] = v;
  write(KEY_OVERRIDES, Object.keys(overrides).length ? overrides : null);
  changed();
}
/** Toggle "I own X": the state that differs from the save's guess is kept as an override; back to the guess clears it. */
export function setOwned(x: Expansion, on: boolean): void {
  setOverride(x, on === inferred.owned.includes(x) ? null : on);
}
export function setShowAll(on: boolean): void {
  showAllFlag = on;
  write(KEY_SHOW_ALL, on ? true : null);
  changed();
}

/** Wait (up to ~30 s) until the page has loaded the game data: inference reads the quest and item tables. */
function dataLoaded(): Promise<boolean> {
  return new Promise((ok) => {
    const t0 = Date.now();
    const poll = () => {
      if (G?.questData && Object.keys(G.questData).length && G.itemData?.equipment) return ok(true);
      if (Date.now() - t0 > 30000) return ok(false);
      setTimeout(poll, 50);
    };
    poll();
  });
}

function setInferred(next: InferredState): void {
  const same = JSON.stringify(next) === JSON.stringify(inferred);
  inferred = next;
  write(KEY_INFERRED, next.source === null ? null : next);
  if (!same) changed();
}

/**
 * The page loaded a save (`text` as read from the file) or forgot it (null): guess its expansions again. Called by
 * save-source.ts; waits for the game data. A save that can't be decoded counts as no save.
 */
export async function noteSave(text: string | null, name: string | null = null): Promise<void> {
  if (text === null) return setInferred({ ...NONE });
  if (!(await dataLoaded())) return;
  try {
    const r = inferExpansions(decodeSaveText(text), G);
    setInferred({ owned: [...r.owned], evidence: r.evidence, source: name ?? "your save" });
  } catch {
    setInferred({ ...NONE });
  }
}

/** Pages without a save picker (wiki, class balance): read the save kept in this browser, if any. */
export async function syncWithStoredSave(): Promise<void> {
  const s = await getSave();
  await noteSave(s?.text ?? null, s?.name ?? null);
}

// Another tab changed a toggle or loaded / forgot a save.
if (typeof addEventListener === "function") {
  addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== null && ![KEY_OVERRIDES, KEY_SHOW_ALL, KEY_INFERRED].includes(e.key)) return;
    inferred = cleanInferred(read(KEY_INFERRED, NONE));
    overrides = cleanOverrides(read(KEY_OVERRIDES, {}));
    showAllFlag = read<unknown>(KEY_SHOW_ALL, false) === true;
    changed();
  });
}

// ---------------------------------------------------------------- content
const gateCache = new Map<string, ContentGate | null>();
/** contentExpansion, cached, and null (base game) when the game data isn't loaded or the id is unknown. */
export function gateOf(kind: ContentKind, id: number, extra: ContentExtra = {}): ContentGate | null {
  const key = `${kind}:${id}:${extra.type ?? ""}:${extra.ascension ?? 0}`;
  if (gateCache.has(key)) return gateCache.get(key)!;
  let g: ContentGate | null = null;
  try {
    if (G?.questData && G.itemData) g = contentExpansion(kind, id, extra, G);
  } catch {
    g = null;
  }
  gateCache.set(key, g);
  return g;
}
/** The expansions a piece of content needs ([] for the base game). */
export const needsOf = (kind: ContentKind, id: number, extra: ContentExtra = {}): Expansion[] => gateOf(kind, id, extra)?.needs ?? [];
/** Shown on the pages: base game, owned, or "Show expansion content" on. */
export function isVisible(kind: ContentKind, id: number, extra: ContentExtra = {}): boolean {
  if (showAllFlag) return true;
  const g = gateOf(kind, id, extra);
  return !g || ownsAll(g.needs);
}
/** The expansions `needs` asks for that the visitor doesn't own (what hides it). */
export const missing = (needs: readonly Expansion[]): Expansion[] => needs.filter((x) => !owned.has(x));

/** The expansion badge of a piece of content (null for the base game). `link`: the badge links to the Expansions page. */
export function badgeFor(kind: ContentKind, id: number, extra: ContentExtra = {}, link = false): HTMLElement | null {
  const n = needsOf(kind, id, extra);
  return n.length ? expansionBadge(n, { link }) : null;
}
/** The greyed "expansion content" stand-in for a hidden item, enemy, map or class. */
export function placeholderFor(kind: ContentKind, id: number, extra: ContentExtra = {}): HTMLElement {
  return expansionPlaceholder(needsOf(kind, id, extra));
}

/** Count of the rows a filter hid (for "N hidden" notes). */
export function partitionVisible<T>(list: T[], visible: (x: T) => boolean): { shown: T[]; hidden: number } {
  const shown = list.filter(visible);
  return { shown, hidden: list.length - shown.length };
}
