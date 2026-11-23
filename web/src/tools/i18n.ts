/**
 * Game-content translations (inventory/i18n/<lc>.json, written by export-i18n.ts): pure and browser-safe, no fetch,
 * no DOM. The caller loads a language file, selects it, then asks tr() for each name or description; undefined means
 * "no translation", and the caller keeps its English text. English is the default language and needs no file: the
 * site's own English (gamedata.json / wikidata.json) stays the reference, so the UI may skip tr() when
 * currentLanguage() is "en".
 *
 *     loadLanguage(await (await fetch("data/i18n/fr.json")).json());
 *     setLanguage("fr");
 *     tr("equipment", 1) ?? item("equipment", 1).name   // "Dague en Fer"
 */

/** n = name, d = description, nb = rare-variant name, t / tb = quest title (normal / rare). */
export type Field = "n" | "d" | "nb" | "t" | "tb";
type Table = Record<string, Partial<Record<Field, string>>>;
export interface I18nFile {
  lang: string;
  items: Record<string, Table>;
  skills: Table;
  quests: Table;
  classes: Table;
  prefixes: Table;
  crafters: Table;
  regions: Table;
}

/**
 * What tr() can translate, and the id it takes:
 * - equipment, material, consumable, map: item id (itemData[type] key);
 * - skill, passive: the English skill name (abilityData / passiveData key);
 * - quest: quest id (n = name, nb = rare name, t / tb = title such as "Party Boss");
 * - class: heroList id; prefix: prefixList id; crafter: crafterData id; region: questData region (1–6).
 */
export type Kind = "equipment" | "material" | "consumable" | "map" | "skill" | "passive" | "quest" | "class" | "prefix"
  | "crafter" | "region";

const loaded = new Map<string, I18nFile>();
let current = "en";

const tableOf = (f: I18nFile, kind: Kind): Table | undefined => {
  switch (kind) {
    case "equipment": case "material": case "consumable": case "map": return f.items?.[kind];
    case "skill": case "passive": return f.skills;
    case "quest": return f.quests;
    case "class": return f.classes;
    case "prefix": return f.prefixes;
    case "crafter": return f.crafters;
    case "region": return f.regions;
  }
};

/** Register a parsed language file (keyed by its lowercase `lang`) and return its code. Throws on a non-i18n object. */
export function loadLanguage(json: unknown): string {
  const f = json as I18nFile;
  if (!f || typeof f !== "object" || typeof f.lang !== "string" || typeof f.items !== "object") {
    throw new Error("loadLanguage: not an i18n language file");
  }
  const code = f.lang.toLowerCase();
  loaded.set(code, f);
  return code;
}

/** Make a loaded language (or "en") current. Returns false, and changes nothing, for a language not loaded. */
export function setLanguage(code: string): boolean {
  const c = code.toLowerCase();
  if (c !== "en" && !loaded.has(c)) return false;
  current = c;
  return true;
}

/** The current language code ("en" until setLanguage() picks another). */
export const currentLanguage = (): string => current;

/** Codes of the languages loaded so far. */
export const loadedLanguages = (): string[] => [...loaded.keys()];

/** The current language's text for an id (name by default), or undefined so the caller falls back to English. */
export function tr(kind: Kind, id: number | string, field: Field = "n"): string | undefined {
  const f = loaded.get(current);
  if (!f) return undefined;
  const v = tableOf(f, kind)?.[String(id)]?.[field];
  return v ? v : undefined;
}
