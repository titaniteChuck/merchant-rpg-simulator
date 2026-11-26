/**
 * U78: the heroes the visitor edited or created in the save viewer, kept beside the loaded save and never written into
 * it. One overlay per save, under its file name (localStorage `merchant:hero-overlay:<name>`, the name the save is
 * kept under in save-store.ts), so every page opening that save sees the same heroes:
 * - `edits`: per save hero id, the fields the visitor changed (EDIT_KEYS whose value differs from the save's);
 * - `created`: whole raw heroes (save format: compact item strings, skill indices), ids from CREATED_ID_BASE up.
 * applyOverlay merges it into a decoded save (edits over the save's heroes, created heroes appended); tools/save.ts
 * loadSaveText runs it on every page through setSaveRawHook (save-source.ts installs overlayHook and names the save
 * being loaded with setActiveSave), so the Simulator, Solver, Levelling, Farming and Profit use the edited heroes.
 * Reset = the hero's edit dropped; Delete = a created hero dropped. Storage can be missing or blocked: reads give an
 * empty overlay, writes do nothing (the edit then lasts until the page is left).
 */

// deno-lint-ignore no-explicit-any
type Any = any;

export const OVERLAY_PREFIX = "merchant:hero-overlay:";
/** The raw hero fields an edit may change. */
export const EDIT_KEYS = ["name", "class", "level", "prestigeLevel", "exp", "attackList", "passiveSelect", "skillSet",
  "currentSkillSet", "heroInventory"] as const;
/** Created heroes get ids from here up, clear of the game's (1, 2, 3 … in hiring order). */
export const CREATED_ID_BASE = 1000;

export interface HeroOverlay {
  edits: Record<string, Any>;
  created: Any[];
}
export type HeroMark = "created" | "modified" | null;

export const emptyOverlay = (): HeroOverlay => ({ edits: {}, created: [] });
const isEmpty = (o: HeroOverlay) => !Object.keys(o.edits).length && !o.created.length;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const local = (): Store | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The save's overlay; empty when none is kept, storage is blocked or the entry is damaged. */
export function readOverlay(saveName: string, storage: Store | undefined = local()): HeroOverlay {
  try {
    const v = JSON.parse(storage?.getItem(OVERLAY_PREFIX + saveName) ?? "null");
    if (!v || typeof v !== "object") return emptyOverlay();
    const edits = v.edits && typeof v.edits === "object" && !Array.isArray(v.edits) ? v.edits : {};
    const created = Array.isArray(v.created) ? v.created.filter((h: Any) => h && typeof h === "object" && Number.isFinite(Number(h.id))) : [];
    return { edits, created };
  } catch {
    return emptyOverlay();
  }
}

/** Keep the overlay (an empty one removes the entry); false when storage refused it. */
export function writeOverlay(saveName: string, o: HeroOverlay, storage: Store | undefined = local()): boolean {
  try {
    if (!storage) return false;
    if (isEmpty(o)) storage.removeItem(OVERLAY_PREFIX + saveName);
    else storage.setItem(OVERLAY_PREFIX + saveName, JSON.stringify(o));
    return true;
  } catch {
    return false;
  }
}

/** A decoded save with the overlay merged in (a new object: `raw` and its heroes are left as they are). */
export function applyOverlay(raw: Any, o: HeroOverlay): Any {
  if (!raw || !Array.isArray(raw.hero) || isEmpty(o)) return raw;
  const own = new Set(raw.hero.map((h: Any) => Number(h?.id)));
  const hero = raw.hero.map((h: Any) => {
    const e = h ? o.edits[String(h.id)] : undefined;
    return e ? { ...h, ...structuredClone(e) } : h;
  });
  // a created hero whose id the save took since (a later hire) stays out rather than doubling it
  for (const c of o.created) if (!own.has(Number(c.id))) hero.push(structuredClone(c));
  return { ...raw, hero };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The EDIT_KEYS of `edited` that differ from the save's hero `base`. */
export function patchOf(base: Any, edited: Any): Any {
  const out: Any = {};
  for (const k of EDIT_KEYS) if (k in edited && !same(base?.[k], edited[k])) out[k] = structuredClone(edited[k]);
  return out;
}

export const isCreated = (o: HeroOverlay, id: unknown): boolean => o.created.some((h) => Number(h.id) === Number(id));
export const heroMark = (o: HeroOverlay, id: unknown): HeroMark =>
  isCreated(o, id) ? "created" : o.edits[String(id)] ? "modified" : null;

/**
 * The overlay after saving `edited`: a created hero is replaced whole (or added); a save hero (`base`, its state in
 * the save) keeps only the fields that differ from it, and no entry at all once they all match again.
 */
export function saveHero(o: HeroOverlay, base: Any | undefined, edited: Any): HeroOverlay {
  const id = Number(edited.id);
  if (!base) {
    const created = o.created.filter((h) => Number(h.id) !== id);
    const at = o.created.findIndex((h) => Number(h.id) === id);
    created.splice(at < 0 ? created.length : at, 0, structuredClone(edited));
    return { edits: o.edits, created };
  }
  const edits = { ...o.edits };
  const p = patchOf(base, edited);
  if (Object.keys(p).length) edits[String(id)] = p;
  else delete edits[String(id)];
  return { edits, created: o.created };
}

/** Reset: the save hero back to the save's state. */
export function resetHero(o: HeroOverlay, id: unknown): HeroOverlay {
  const edits = { ...o.edits };
  delete edits[String(id)];
  return { edits, created: o.created };
}

/** Delete: a created hero gone. */
export const deleteHero = (o: HeroOverlay, id: unknown): HeroOverlay =>
  ({ edits: o.edits, created: o.created.filter((h) => Number(h.id) !== Number(id)) });

/** The id of the next created hero: above every save and created hero, CREATED_ID_BASE at least. */
export function nextHeroId(raw: Any, o: HeroOverlay): number {
  const ids = [...(raw?.hero ?? []), ...o.created].map((h: Any) => Number(h?.id) || 0);
  return Math.max(CREATED_ID_BASE - 1, ...ids) + 1;
}

// ---------------------------------------------------------------- the hook every page's loadSaveText runs
let activeSave: string | null = null;
/** The save being loaded (its kept name); null: none, no overlay applied. */
export function setActiveSave(name: string | null): void {
  activeSave = name;
}
export const activeSaveName = (): string | null => activeSave;

/** tools/save.ts setSaveRawHook's hook: the active save's overlay merged in. */
export const overlayHook = (raw: Any): Any => (activeSave ? applyOverlay(raw, readOverlay(activeSave)) : raw);
