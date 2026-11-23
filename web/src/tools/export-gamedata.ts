/**
 * Export the game data tables used by the TypeScript simulator to inventory/gamedata.json, and the
 * wiki text (descriptions) to inventory/wikidata.json
 * (port of the former tools/export_gamedata.py; output was byte-identical).
 *
 * Tables keep their Lua shape: every table becomes a JSON object with the same keys
 * (1-based integer keys stay keys), so ported code reads them exactly like the game does
 * (heroList[cls].hpPlv[prestigeLevel]). Only literal data is exported; the game's functions
 * are re-implemented in web/src/sim/.
 *
 *     node src/tools/export-gamedata.ts [--src ../decompiled] [--out ../inventory/gamedata.json]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Env, type Json, LuaTable, pyJsonDumps, type Value } from "./luadata.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const GLOBALS = [
  "itemData", "abilityData", "passiveData", "heroList", "questData", "parcelData",
  "prefixList", "suffixList", "rarityMod", "gradeBonus", "gradeParcelBonus", "gradeTime",
  "heroLevelRequirement", "itemFormula", "default", "currentQuestType", "crafterData",
  "heroPrestigeLevelRequirement", "heroPrestigeCost", "heroMaxPrestigeLevel",
];
export const DEFAULT_LOCALS = ["av", "ascStat", "potionStat", "potionStatPlaces", "bonusStatNames", "prestigeItemID",
  "mapPrestigeMod", "mapPercentStats", "mapModStats", "fibo"];
// Text only the UI needs.
const DROP_KEYS = new Set(["desc", "desc1", "desc2", "lockedDesc", "image", "sheet", "icon"]);

/** str(k) of a table key, as the Python export writes it. */
const keyStr = (k: Value): string =>
  typeof k === "string" ? k : k === true ? "True" : k === false ? "False" : k === null ? "None" : typeof k === "number" ? String(k) : String(toJson(k));

function toJson(v: Value): Json {
  if (v instanceof LuaTable) {
    const out = new Map<string, Json>();
    for (const [k, x] of v.items()) if (!(typeof k === "string" && DROP_KEYS.has(k))) out.set(keyStr(k), toJson(x));
    return out;
  }
  return v;
}

/** Evaluate the data.*.lua files of the decompiled game (sorted by path, as Python's sorted(glob)). */
export function loadDataFiles(src: string): Env {
  const env = new Env();
  env.globals.set("itemData", new LuaTable());
  const files = readdirSync(src).filter((f) => /^data\..*\.lua$/.test(f)).map((f) => join(src, f)).sort();
  for (const f of files) env.load(new TextDecoder("utf-8").decode(readFileSync(f)), f);
  return env;
}

export function exportGamedata(src: string): { json: string; missing: string[] } {
  const env = loadDataFiles(src);
  const out = new Map<string, Json>();
  for (const name of GLOBALS) if (env.globals.has(name)) out.set(name, toJson(env.globals.get(name)!));
  const missing = GLOBALS.filter((n) => !env.globals.has(n));
  const locals = env.fileLocals.get("data.Default") ?? new Map();
  const dl = new Map<string, Json>();
  for (const k of DEFAULT_LOCALS) if (locals.has(k)) dl.set(k, toJson(locals.get(k)!));
  out.set("defaultLocals", dl);
  // Keep source order: Lua pairs() order over constructor tables depends on it.
  return { json: pyJsonDumps(out, { compact: true }), missing };
}

// ---------------------------------------------------------------- wiki text
/**
 * The game's escapes are bytes ("\\226\\134\\145" = "↑"); the evaluator keeps one char per byte, as the
 * Python version did. Decode them as UTF-8 when the string is a valid byte sequence.
 */
export function utf8Fix(s: string): string {
  if (![...s].every((c) => c.charCodeAt(0) < 256) || !/[\x80-\xff]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...s].map((c) => c.charCodeAt(0))));
  } catch {
    return s;
  }
}

const text = (v: Value | undefined): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = utf8Fix(v).trim();
  return t ? t : undefined;
};

/**
 * Text the website's wiki shows (descriptions dropped from gamedata.json, which the engine reads):
 * skill effects, item / map / class descriptions. Written to inventory/wikidata.json.
 */
export function exportWikidata(src: string): string {
  const env = loadDataFiles(src);
  const g = (n: string) => env.globals.get(n);
  const out = new Map<string, Json>();
  const skills = new Map<string, Json>();
  const ab = g("abilityData");
  if (ab instanceof LuaTable) for (const [k, v] of ab.items()) {
    const d = v instanceof LuaTable ? text(v.get("desc")) : undefined;
    if (typeof k === "string" && d) skills.set(k, d);
  }
  out.set("skills", skills);
  const lines = (v: Value): Json => {
    if (!(v instanceof LuaTable)) return null;
    const l = [text(v.get("desc1")), text(v.get("desc2"))].filter((x): x is string => Boolean(x));
    return l.length ? l : null;
  };
  const items = new Map<string, Json>();
  const itemData = g("itemData");
  for (const t of ["equipment", "consumable", "material", "map"]) {
    const tbl = itemData instanceof LuaTable ? itemData.get(t) : null;
    const m = new Map<string, Json>();
    if (tbl instanceof LuaTable) for (const [k, v] of tbl.items()) {
      const l = lines(v);
      if (l) m.set(String(k), l);
    }
    items.set(t, m);
  }
  out.set("items", items);
  const classes = new Map<string, Json>();
  const hl = g("heroList");
  if (hl instanceof LuaTable) for (const [k, v] of hl.items()) {
    const l = lines(v);
    if (l) classes.set(String(k), l);
  }
  out.set("classes", classes);
  return pyJsonDumps(out, { compact: true, ensureAscii: false });
}

if (/[\\/]export-gamedata\.ts$/.test(process.argv[1] ?? "")) {
  const { values: v } = parseArgs({
    options: {
      src: { type: "string", default: join(ROOT, "decompiled") },
      out: { type: "string", default: join(ROOT, "inventory", "gamedata.json") },
      wiki: { type: "string", default: join(ROOT, "inventory", "wikidata.json") },
    },
  });
  const { json, missing } = exportGamedata(v.src!);
  writeFileSync(v.out!, json);
  console.log(`${v.out}: ${Math.floor(statSync(v.out!).size / 1024)} KB` + (missing.length ? `; missing ${JSON.stringify(missing)}` : ""));
  writeFileSync(v.wiki!, exportWikidata(v.src!));
  console.log(`${v.wiki}: ${Math.floor(statSync(v.wiki!).size / 1024)} KB`);
}
