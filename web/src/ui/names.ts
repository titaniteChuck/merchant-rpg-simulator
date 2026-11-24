/**
 * Game names and descriptions in the visitor's language (U29). Every name or description of game content the site
 * prints (items, materials, consumables, maps, skills, passives, enemies and their rare variants, quest titles, classes,
 * prefixes, crafters, regions) goes through these helpers: tr() of web/src/tools/i18n.ts in the current language,
 * the English of gamedata.json / wikidata.json when there is no translation. The site's own words stay English, and so
 * do stat labels (Atk, HP…) and suffix symbols (+1, *2), which the game data doesn't translate. An item with modifiers
 * is named by modItemName (U34), part by part: "[Defender] Molten Platemail +6".
 *
 * Ids stay English: skill routes and keys (wiki.html#/skill/Fireball), save data, worker requests. Only the text shown
 * changes. Pure (no DOM globals) so Node tests can import it; the browser side (loading a language file, the picker's
 * event, re-rendering) is language.ts.
 */
import { G } from "../sim/data.ts";
import { currentLanguage, type Field, type Kind, tr } from "../tools/i18n.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ITEM_KINDS = new Set(["equipment", "material", "consumable", "map"]);
const isItemType = (t: string): t is "equipment" | "material" | "consumable" | "map" => ITEM_KINDS.has(t);

/** True while the site shows the game's English (the default). */
export const isEnglish = (): boolean => currentLanguage() === "en";

/** BCP 47 tag of a language code of inventory/i18n/index.json (the game's "br" is Brazilian Portuguese). */
export const langTag = (code = currentLanguage()): string => (code === "br" ? "pt-BR" : code);

let collator: Intl.Collator | null = null;
let collatorLang = "";
/** Compare two names in the current language's alphabetical order (sorting lists and tables by name). */
export function compareNames(a: string, b: string): number {
  if (!collator || collatorLang !== currentLanguage()) {
    collatorLang = currentLanguage();
    collator = new Intl.Collator(langTag(collatorLang));
  }
  return collator.compare(a, b);
}

/** An item's or map's name (type: equipment, material, consumable, map), or undefined for an unknown item. */
export function itemName(type: string, id: number | string): string | undefined {
  return (isItemType(type) ? tr(type, id) : undefined) ?? G.itemData?.[type]?.[id]?.name;
}

/** An enemy's name: the quest's `name`, or its rare variant's `nameB`. */
export function enemyName(id: number | string, rare = false): string | undefined {
  const q: Any = G.questData?.[id];
  return tr("quest", id, rare ? "nb" : "n") ?? (rare ? q?.nameB : q?.name);
}

/** The game's quest title ("Boss", "Party Boss", "Treasure Bush"…; rare: "Rare Party Boss"), or undefined. */
export function questTitle(id: number | string, rare = false): string | undefined {
  const q: Any = G.questData?.[id];
  return tr("quest", id, rare ? "tb" : "t") ?? ((rare ? q?.titleB : q?.title) || undefined);
}

/** A hero class's name (heroList id). */
export const className = (id: number | string): string | undefined => tr("class", id) ?? G.heroList?.[id]?.name;

/** A skill's name from its English key ("Basic", the plain attack, is a site word and stays). */
export const skillName = (name: string): string => (name && name !== "Basic" ? tr("skill", name) ?? name : name);
/** A passive's name from its English key ("None" stays). */
export const passiveName = (name: string): string => (name && name !== "None" ? tr("passive", name) ?? name : name);

/** An item prefix's name (prefixList id; 0 = none → ""). */
export const prefixName = (id: number | string | null | undefined): string =>
  !id ? "" : tr("prefix", id) ?? G.prefixList?.[id as number]?.name ?? "";

/** A suffix's symbol (+1, *2: never translated); -1, a worn item, reads "Worn". */
export const suffixName = (id: number | string | null | undefined): string =>
  G.suffixList?.[id as number]?.name || (Number(id) === -1 ? "Worn" : "");

/** A crafter's name (crafterData id). */
export const crafterName = (id: number | string): string | undefined => tr("crafter", id) ?? (G as Any).crafterData?.[id]?.name;

/** A region's full name (1–6: "Tuvale Forest"…), `english` when untranslated. */
export const regionName = (id: number, english: string): string => tr("region", id) ?? english;

/**
 * The description of `kind` / `id` in the current language, or undefined: in English (and when a language has none)
 * the caller keeps the wiki's own English text (wikidata.json: six skill texts differ from the game's TextData, E19).
 */
export const descOf = (kind: Kind, id: number | string): string | undefined => (isEnglish() ? undefined : tr(kind, id, "d"));

// ---------------------------------------------------------------- modded items (U34)
/** An item's modifiers as the save and the engine store them: prefixList id, suffixList id (0 / null = none). */
export interface ItemMods {
  prefix?: number | string | null;
  suffix?: number | string | null;
}

/**
 * A prefix as it reads in brackets: its name in the current language, the English possessive dropped ("Defender's"
 * → "Defender", "Titan's" → "Titan"); "" for none.
 */
export const prefixTag = (id: number | string | null | undefined): string => prefixName(id).replace(/['’]s$/, "");

/** The parts of a modded item's name: [prefix tag, base name, suffix symbol] in the current language. */
export function modItemParts(type: string, id: number | string, mods: ItemMods = {}): [string, string, string] {
  return [prefixTag(mods.prefix), itemName(type, id) ?? `${type} #${id}`, suffixName(mods.suffix)];
}

/**
 * THE name of a saved or generated item with its modifiers (U34), built from its parts so each one is translated on
 * its own: the prefix in brackets before the base name, the suffix symbol (never translated) after it.
 *
 *     modItemName("equipment", 372, { prefix: 25, suffix: 6 })  // "[Defender] Molten Platemail +6"; FR "[du Défenseur] Plate en Fusion +6"
 *
 * Without modifiers it is the plain item name. Pass the save's item itself as `mods` ({itemType, id, prefix, suffix…}).
 */
export function modItemName(type: string, id: number | string, mods: ItemMods = {}): string {
  const [pre, base, suf] = modItemParts(type, id, mods);
  return [pre && `[${pre}]`, base, suf].filter(Boolean).join(" ");
}

/** Item id from its English name (worker results name items in English: gear, essences), or undefined. */
export function itemIdByName(type: string, name: string): number | undefined {
  const hit = Object.entries<Any>(G.itemData?.[type] ?? {}).find(([, it]) => it?.name === name);
  return hit ? Number(hit[0]) : undefined;
}

/**
 * An English name as the engine builds it, prefix and suffix included ("Defender's Molten Platemail +6",
 * sim/equipment.ts), split back into the item id and its modifiers; undefined when no item matches.
 */
export function parseItemName(type: string, name: string): ({ id: number } & ItemMods) | undefined {
  const exact = itemIdByName(type, name);
  if (exact !== undefined) return { id: exact };
  let rest = name.trim(), suffix = 0, prefix = 0;
  const sp = rest.lastIndexOf(" ");
  const sufId = sp > 0 ? Object.entries<Any>(G.suffixList ?? {}).find(([, s]) => s?.name && s.name === rest.slice(sp + 1))?.[0] : undefined;
  if (sufId !== undefined) {
    suffix = Number(sufId);
    rest = rest.slice(0, sp);
  }
  let id = itemIdByName(type, rest);
  if (id === undefined) {
    // the longest prefix name the rest starts with ("Titan's" before a shorter one)
    const pres = Object.entries<Any>(G.prefixList ?? {}).filter(([, p]) => p?.name && rest.startsWith(`${p.name} `))
      .sort((a, b) => b[1].name.length - a[1].name.length);
    for (const [pid, p] of pres) {
      id = itemIdByName(type, rest.slice(p.name.length + 1));
      if (id !== undefined) {
        prefix = Number(pid);
        break;
      }
    }
  }
  return id === undefined ? undefined : { id, prefix, suffix };
}

/**
 * An English item name shown in the current language (unknown names as they are). A modded name from the engine
 * ("Defender's Molten Platemail +6") becomes modItemName's "[Defender] Molten Platemail +6", translated part by part.
 */
export function itemNameFromEnglish(type: string, name: string): string {
  const hit = parseItemName(type, name);
  if (!hit) return name;
  if (!hit.prefix && !hit.suffix) return isEnglish() ? name : itemName(type, hit.id) ?? name;
  return modItemName(type, hit.id, hit);
}

// ---------------------------------------------------------------- names kept in step (relabel)
/**
 * The kinds of name a page marks with `data-name` (see markName) so language.ts can put the new text in place,
 * without a re-render, when the language changes: item types, "enemy" / "enemyB" (rare), "class", "skill", "passive".
 */
export type NameKind = "equipment" | "material" | "consumable" | "map" | "enemy" | "enemyB" | "class" | "skill" | "passive";

/** The current text of a marked name, or undefined. */
export function nameFor(kind: string, id: string): string | undefined {
  switch (kind) {
    case "enemy": return enemyName(id, false);
    case "enemyB": return enemyName(id, true);
    case "class": return className(id);
    case "skill": return skillName(id);
    case "passive": return passiveName(id);
    default: return isItemType(kind) ? itemName(kind, id) : undefined;
  }
}

/**
 * Mark an element whose first text is exactly the name of `kind` / `id` (a name link: its text first, then badges),
 * so a change of language updates it in place (language.ts relabel()). Returns the element.
 */
export function markName<T extends Element>(e: T, kind: NameKind, id: number | string): T {
  e.setAttribute("data-name", `${kind}|${id}`);
  return e;
}

/** Text a search matches: the shown name and, in another language, the English one too. */
export const searchText = (shown: string | undefined, english: string | undefined): string =>
  shown === english || !english ? shown ?? "" : `${shown ?? ""} ${english}`;
