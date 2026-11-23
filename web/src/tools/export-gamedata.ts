/**
 * Export the game data tables used by the TypeScript simulator to inventory/gamedata.json
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

if (/[\\/]export-gamedata\.ts$/.test(process.argv[1] ?? "")) {
  const { values: v } = parseArgs({
    options: {
      src: { type: "string", default: join(ROOT, "decompiled") },
      out: { type: "string", default: join(ROOT, "inventory", "gamedata.json") },
    },
  });
  const { json, missing } = exportGamedata(v.src!);
  writeFileSync(v.out!, json);
  console.log(`${v.out}: ${Math.floor(statSync(v.out!).size / 1024)} KB` + (missing.length ? `; missing ${JSON.stringify(missing)}` : ""));
}
