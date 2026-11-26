/**
 * Merchant save files: decoding and compact item strings (port of the parsing
 * half of the former tools/savegame.py). Works in the browser and in Node; finding and
 * copying the save on disk is in savefiles.ts (Node). Give it the text of PlayerData.txt.
 *
 *   const sv = loadSaveText(text)
 *   sv.raw.hero[0], sv.inventory[0].itemSlot, sv.mapInventory[1].compact
 */

// deno-lint-ignore no-explicit-any
type Any = any;

// Utilities.lua: baseEncode/baseDecode is plain base64 with this alphabet.
const GAME_B64 = "ABva12+rsKghixL6EueCl78fV5OPQmnopzTUyWXYZwb/RHIJqcdD0FG9MN34Sjkt";
const STD_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const TO_STD = new Map([...GAME_B64].map((c, i) => [c, STD_B64[i]]));

/** Utilities.baseDecode: drop characters outside the alphabet, then decode. */
export function baseDecode(text: string): Uint8Array {
  let data = "";
  for (const c of text) {
    const s = TO_STD.get(c);
    if (s !== undefined) data += s;
  }
  data += "=".repeat((4 - (data.length % 4)) % 4);
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const TO_GAME = new Map([...STD_B64].map((c, i) => [c, GAME_B64[i]]));

/** Utilities.baseEncode: plain base64 written in the game's alphabet, "=" padding kept (baseDecode ignores it). */
export function baseEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return [...btoa(bin)].map((c) => TO_GAME.get(c) ?? c).join("");
}

/** What the game writes to PlayerData.txt (GameObject:encodeSaveFile): the JSON, UTF-8, baseEncode. */
export function encodeSaveText(raw: Any): string {
  return baseEncode(new TextEncoder().encode(JSON.stringify(raw)));
}

/** GameObject:decodeSaveFile. PC saves are always encoded; mobile ones may be raw JSON. */
export function decodeSaveText(text: string): Any {
  if (text.includes("{")) return JSON.parse(text);
  return JSON.parse(new TextDecoder("utf-8").decode(baseDecode(text)));
}

export const ITEM_TYPES: Record<number, string> = { 1: "material", 2: "consumable", 3: "equipment", 4: "map" };
export const EQUIP_BONUS = ["atkBns", "matkBns", "accBns", "critBns", "defBns", "mdefBns", "hpBns", "str", "int",
  "dex", "UNUSED", "lckMod", "expMod", "speed", "atkPct", "matkPct", "defPct", "mdefPct",
  "accPct", "critMod", "hpPct", "apMod"];
const FIELDS: Record<string, string[]> = {
  material: ["itemType", "id", "amount", "grade"],
  consumable: ["itemType", "id", "amount", "grade", "prestigeLevel"],
  map: ["itemType", "id", "seed", "grade", "prefix", "suffix", "enchantAttempt", "prestigeLevel"],
  equipment: ["itemType", "id", "grade", "itemSlot", "prefix", "suffix", "stats", "bns", "enchantAttempt", "prestigeLevel"],
};
const TAIL_KEYS: Record<string, Record<string, string>> = {
  S: { S: "sellPrice", B: "sellTime", C: "startTime" }, // sale slot
  C: { C: "startTime", B: "craftTime" },
};

/** Python savegame._num: ints stay ints, other numbers floats, the rest strings. */
function num(s: string): number | string {
  const t = s.trim();
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^[-+]?(inf|infinity|nan)$/i.test(t)) return s;
  return Number(t);
}

function letterPairs(word: string): [string, number | string][] {
  return [...word.matchAll(/([A-Za-z])(-?[\d.]+)/g)].map((m) => [m[1], num(m[2])]);
}

/** readCompactGrade: a plain number, or a stack split by grade, e.g. 'B93A100' -> {B: 93, A: 100}. */
function grade(word: string): Any {
  if (!/[A-Za-z]/.test(word)) return num(word);
  return Object.fromEntries(letterPairs(word));
}

/** itemCompact.readCompact. Sale slots carry an extra tail ('S<price>B<time>C<start>'). */
export function parseItem(compact: string): Any {
  const words = compact.split("|").filter((w) => w !== "");
  const itype = ITEM_TYPES[Number.parseInt(words[0], 10)] ?? words[0];
  const fields = FIELDS[itype] ?? FIELDS.material;
  const out: Any = { compact };
  fields.forEach((name, i) => {
    const word = words[i];
    if (word === undefined) return;
    if (name === "itemType") out[name] = itype;
    else if (name === "id") out[name] = Number.parseInt(word, 16);
    else if (name === "grade" && itype !== "equipment") out[name] = grade(word);
    else if (name === "enchantAttempt") {
      const v = letterPairs(word).map(([, x]) => x);
      out[name] = v.length ? v : [0, 0, 0];
    } else if (name === "stats") {
      const keys: Record<string, string> = out.itemSlot === 1 ? { A: "atk", B: "matk", C: "acc", D: "crit" }
        : out.itemSlot !== 6 ? { A: "def", B: "mdef" } : {};
      for (const [k, v] of letterPairs(word)) if (k in keys) out[keys[k]] = v;
    } else if (name === "bns") {
      if (!word.startsWith("0")) for (const [k, v] of letterPairs(word)) out[EQUIP_BONUS[k.charCodeAt(0) - 65]] = v;
    } else out[name] = num(word);
  });
  const tail = words.slice(fields.length);
  if (tail.length) {
    const keys = TAIL_KEYS[tail[0].slice(0, 1)] ?? {};
    for (const [k, v] of letterPairs(tail[0])) if (k in keys) out[keys[k]] = v;
  }
  return out;
}

export interface Save {
  raw: Any;
  inventory: Any[];
  mapInventory: Any[];
  sales: (Any | null)[];
  heroes: Any[];
  crafters: Map<number, Any>; // crafterData id -> save entry
}

/** itemCompact.readCompactCraft: the item a crafter is working on. */
export function parseCraft(compact: string): Any {
  const names = ["itemType", "id", "grade", "amount", "startTime", "craftTime", "prestigeLevel", "_suffixBoost", "_prefixBoost"];
  const out: Any = {};
  compact.split("|").forEach((word, i) => {
    if (i >= names.length) return;
    const name = names[i];
    out[name] = name === "itemType" ? (ITEM_TYPES[Number.parseInt(word, 10)] ?? word) : name === "id" ? Number.parseInt(word, 16) : num(word);
  });
  return out;
}

/** Total count of a material/consumable stack (its grade may be split per grade letter). */
export function stackAmount(item: Any): number {
  return item.itemType === "material" || item.itemType === "consumable" ? (item.amount ?? 0) : 1;
}

/** "itemType|id|ascension" -> count over inventory, maps, sale slots and hero gear (Save.owned). */
export function owned(sv: Save, includeHeroes = true, includeSales = true): Map<string, number> {
  const pools: Any[][] = [sv.inventory, sv.mapInventory];
  if (includeSales) pools.push(sv.sales.filter(Boolean));
  if (includeHeroes) for (const h of sv.heroes) pools.push(h.heroInventory);
  const out = new Map<string, number>();
  for (const pool of pools) {
    for (const it of pool) {
      const key = `${it.itemType}|${it.id}|${it.prestigeLevel || 0}`;
      out.set(key, (out.get(key) ?? 0) + stackAmount(it));
    }
  }
  return out;
}

/** Expand the compact strings of a decoded save (savegame.parse_save). */
export function parseSave(raw: Any): Save {
  const items = (list: unknown[] | undefined) => (list ?? []).filter((c) => typeof c === "string").map((c) => parseItem(c as string));
  return {
    raw,
    inventory: items(raw.inventory),
    mapInventory: items(raw.mapInventory),
    sales: (raw.sales ?? []).map((c: unknown) => (typeof c === "string" ? parseItem(c) : null)),
    heroes: (raw.hero ?? []).map((h: Any) => ({ ...h, heroInventory: items(h.heroInventory) })),
    crafters: new Map((raw.crafter ?? []).filter(Boolean).map((c: Any) =>
      [c.id, typeof c.isCrafting === "string" ? { ...c, isCrafting: parseCraft(c.isCrafting) } : { ...c }])),
  };
}

/**
 * U78: a change applied to every decoded save before it is parsed (the hero overlay of the save viewer's edited and
 * created heroes, ui/hero-overlay.ts, installed by ui/save-source.ts); none by default (Node tools and tests).
 */
let rawHook: ((raw: Any) => Any) | null = null;
export function setSaveRawHook(hook: ((raw: Any) => Any) | null): void {
  rawHook = hook;
}

export function loadSaveText(text: string): Save {
  const raw = decodeSaveText(text);
  return parseSave(rawHook ? rawHook(raw) : raw);
}
