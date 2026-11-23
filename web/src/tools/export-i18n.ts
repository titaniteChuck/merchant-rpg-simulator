/**
 * Export the game's translations of game content (item, skill, enemy, class, prefix, crafter and region names and
 * descriptions) to inventory/i18n/<lc>.json, plus inventory/i18n/index.json (languages and coverage).
 *
 * Source: the game install's Resources/Localization/<LC>/TextData-<LC>.json (read-only, local). The game reads them
 * through obj.common.localizationService (getTextByKey(tableKey, index, key), getItemText(key, id, itemType)):
 * - Equipment / Materials / Consumables / Maps: by item id; name, desc1, desc2 (getItemText; missing id → itemData).
 * - skills: by English skill name (abilityData and passiveData keys); name, desc (obj.UIObject).
 * - Quests: by quest id; name, nameB (rare), title, titleB, nickname(B), qmDesc.
 * - Heroes: by class id; name, desc1, desc2, lockedDesc.
 * - Prefixes: by prefix id; name. Suffixes have no table (the game prints suffixList names: "+1", "*2"…).
 * - crafterNames: by English crafter name (crafterData[id].name) → string.
 * - regionText: a JSON array; region r (questData region, 1-based in Lua) is element r - 1.
 * UI, tutorial, menu, combat-log, order and stat-label texts are left out (stat labels such as "Atk" are
 * translated in Russian only). Only names and descriptions the website shows are kept.
 *
 *     node src/tools/export-i18n.ts [--src "<game>/Resources/Localization"] [--out ../inventory/i18n]
 *                                   [--gamedata ../inventory/gamedata.json]
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_SRC = "/mnt/c/Program Files (x86)/Steam/steamapps/common/Merchant/Resources/Localization";

/** Game language codes with a TextData JSON (CN, JP, KO only ship a flag; EScom is a Lua leftover). */
export const LANGUAGES = ["EN", "FR", "DE", "ES", "BR", "RU", "IT", "PL"] as const;
/** The game's service.knownLanguages names (English); the game has no native names, so they are listed here. */
export const LANGUAGE_NAMES: Record<string, { name: string; native: string; bcp47: string }> = {
  EN: { name: "English", native: "English", bcp47: "en" },
  FR: { name: "French", native: "Français", bcp47: "fr" },
  DE: { name: "German", native: "Deutsch", bcp47: "de" },
  ES: { name: "Spanish", native: "Español", bcp47: "es" },
  BR: { name: "Brazilian Portuguese", native: "Português (Brasil)", bcp47: "pt-BR" },
  RU: { name: "Russian", native: "Русский", bcp47: "ru" },
  IT: { name: "Italian", native: "Italiano", bcp47: "it" },
  PL: { name: "Polish", native: "Polski", bcp47: "pl" },
};

/** Item types as the site names them (itemData keys) → TextData table. */
const ITEM_TABLES = { equipment: "Equipment", material: "Materials", consumable: "Consumables", map: "Maps" } as const;

/** One translated entry: n = name, d = description (desc1 and desc2 joined by a space, as the wiki does),
 * nb = rare-variant name, t / tb = quest title (normal / rare). Absent fields fall back to English. */
export type Entry = { n?: string; d?: string; nb?: string; t?: string; tb?: string };
export type Table = Record<string, Entry>;
export interface I18nFile {
  lang: string;
  items: Record<keyof typeof ITEM_TABLES, Table>;
  skills: Table;
  quests: Table;
  classes: Table;
  prefixes: Table;
  crafters: Table;
  regions: Table;
}

// deno-lint-ignore no-explicit-any
type Any = any;

/** Lua-style byte escapes ("\195\169" = "é") decoded as UTF-8; BOM dropped; NFC; trimmed. Empty → undefined. */
export function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  let s = v.replace(/^﻿/, "");
  if (/\\\d{1,3}/.test(s)) {
    s = s.replace(/(?:\\\d{1,3})+/g, (run) => {
      const bytes = Uint8Array.from(run.split("\\").slice(1).map(Number));
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return run;
      }
    });
  }
  s = s.normalize("NFC").trim();
  return s ? s : undefined;
}

const joinLines = (...l: unknown[]): string | undefined => clean(l.map(clean).filter(Boolean).join(" "));

function entry(fields: Record<string, unknown>): Entry | undefined {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const t = clean(v);
    if (t !== undefined) e[k] = t;
  }
  return Object.keys(e).length ? e : undefined;
}

/** Keys in a stable order: integers ascending, then strings in code-point order. */
const sortedKeys = (o: object): string[] =>
  Object.keys(o).sort((a, b) => {
    const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
    if (na && nb) return Number(a) - Number(b);
    if (na !== nb) return na ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

function table(src: Any, f: (v: Any, k: string) => Entry | undefined): Table {
  const out: Table = {};
  if (src && typeof src === "object") for (const k of sortedKeys(src)) {
    const e = f(src[k], k);
    if (e) out[k] = e;
  }
  return out;
}

/** Read a TextData JSON (UTF-8, the EN file has a BOM). */
export function readTextData(src: string, lc: string): Any {
  return JSON.parse(readFileSync(join(src, lc, `TextData-${lc}.json`), "utf8").replace(/^﻿/, ""));
}

/** The site-facing subset of one language's TextData. crafterIds: crafterData id → English crafter name. */
export function extract(lang: string, t: Any, crafterIds: Record<string, string>): I18nFile {
  const items = {} as I18nFile["items"];
  for (const [type, key] of Object.entries(ITEM_TABLES)) {
    items[type as keyof typeof ITEM_TABLES] = table(t[key], (v) => v && entry({ n: v.name, d: joinLines(v.desc1, v.desc2) }));
  }
  const crafters: Table = {};
  for (const id of sortedKeys(crafterIds)) {
    const n = clean(t.crafterNames?.[crafterIds[id]]);
    if (n) crafters[id] = { n };
  }
  const regions: Table = {};
  (Array.isArray(t.regionText) ? t.regionText : []).forEach((v: unknown, i: number) => {
    const n = clean(v);
    if (n) regions[String(i + 1)] = { n };
  });
  return {
    lang: lang.toLowerCase(),
    items,
    skills: table(t.skills, (v) => v && entry({ n: v.name, d: v.desc })),
    quests: table(t.Quests, (v) => v && entry({ n: v.name, nb: v.nameB, t: v.title, tb: v.titleB })),
    classes: table(t.Heroes, (v) => v && entry({ n: v.name, d: joinLines(v.desc1, v.desc2) })),
    prefixes: table(t.Prefixes, (v) => v && entry({ n: v.name })),
    crafters,
    regions,
  };
}

/** [table path, Table] pairs of a file, for coverage (items flattened as "items.equipment"…). */
export function tables(f: I18nFile): [string, Table][] {
  return [
    ...Object.entries(f.items).map(([k, v]) => [`items.${k}`, v] as [string, Table]),
    ["skills", f.skills], ["quests", f.quests], ["classes", f.classes], ["prefixes", f.prefixes],
    ["crafters", f.crafters], ["regions", f.regions],
  ];
}

export interface Coverage {
  /** % of the English fields present in this language (100 = nothing falls back to English). */
  coverage: Record<string, number>;
  /** % of the English fields whose text differs from English (proper names often stay the same). */
  translated: Record<string, number>;
  /** "table.id.field" present in English but missing here; the site shows the English text for them. */
  missing: string[];
}

export function coverage(f: I18nFile, en: I18nFile): Coverage {
  const out: Coverage = { coverage: {}, translated: {}, missing: [] };
  const mine = new Map(tables(f));
  const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 100);
  for (const [name, enT] of tables(en)) {
    const t = mine.get(name) ?? {};
    let total = 0, present = 0, differs = 0;
    for (const [id, e] of Object.entries(enT)) for (const [field, v] of Object.entries(e)) {
      total++;
      const x = t[id]?.[field as keyof Entry];
      if (x === undefined) out.missing.push(`${name}.${id}.${field}`);
      else {
        present++;
        if (x !== v) differs++;
      }
    }
    out.coverage[name] = pct(present, total);
    out.translated[name] = pct(differs, total);
  }
  return out;
}

export function exportI18n(src: string, gamedata: Any): { files: Record<string, string>; index: string } {
  const crafterIds: Record<string, string> = {};
  for (const [id, c] of Object.entries<Any>(gamedata.crafterData ?? {})) if (c?.name) crafterIds[id] = c.name;
  const data = Object.fromEntries(LANGUAGES.map((lc) => [lc, extract(lc, readTextData(src, lc), crafterIds)]));
  const files: Record<string, string> = {};
  const languages = LANGUAGES.map((lc) => {
    files[`${lc.toLowerCase()}.json`] = JSON.stringify(data[lc]) + "\n";
    const c = coverage(data[lc], data.EN);
    return { code: lc.toLowerCase(), game: lc, ...LANGUAGE_NAMES[lc], file: `${lc.toLowerCase()}.json`, ...c };
  });
  const index = {
    source: "Merchant game install: Resources/Localization/<LC>/TextData-<LC>.json",
    fallback: "en",
    fields: { n: "name", d: "description", nb: "rare name", t: "title", tb: "rare title" },
    languages,
  };
  return { files, index: JSON.stringify(index, null, 1) + "\n" };
}

if (/[\\/]export-i18n\.ts$/.test(process.argv[1] ?? "")) {
  const { values: v } = parseArgs({
    options: {
      src: { type: "string", default: DEFAULT_SRC },
      out: { type: "string", default: join(ROOT, "inventory", "i18n") },
      gamedata: { type: "string", default: join(ROOT, "inventory", "gamedata.json") },
    },
  });
  const { files, index } = exportI18n(v.src!, JSON.parse(readFileSync(v.gamedata!, "utf8")));
  mkdirSync(v.out!, { recursive: true });
  for (const [name, json] of Object.entries({ ...files, "index.json": index })) {
    const p = join(v.out!, name);
    writeFileSync(p, json);
    console.log(`${p}: ${(statSync(p).size / 1024).toFixed(1)} KB`);
  }
  for (const l of JSON.parse(index).languages) {
    const low = Object.entries<number>(l.coverage).filter(([, x]) => x < 100).map(([k, x]) => `${k} ${x}%`);
    console.log(`${l.code}: ${low.length ? `coverage ${low.join(", ")}` : "complete"}; missing ${l.missing.length}`);
  }
}
