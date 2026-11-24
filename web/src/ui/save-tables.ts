/**
 * Tables shown by the save viewer, one row object per line (port of the table
 * builders of the former Python savegame.py: hero_rows, hero_gear_rows, inventory_rows,
 * map_rows, the crafter and summary parts of print_report).
 *
 * Needs the game data loaded (api.loadGameData) first.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { itemName as englishItemName, rarity, sellValue } from "../tools/engine.ts";
import {
  className as classNameOf, crafterName, enemyName, itemName as shownItemName, itemTypeText, modItemName, prefixTag, suffixName,
} from "./names.ts";
import { type Game, gameFromData } from "../tools/gamedata.ts";
import { mapEssence } from "../tools/profit.ts";
import { type Save, stackAmount } from "../tools/save.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export type Row = Record<string, string | number | boolean | null>;

const GRADES = "DCBAS"; // gradeString, 1..5
export const SLOT_LABELS: Record<number, string> = { 1: "weapon", 2: "head", 3: "body", 4: "hands", 5: "feet", 6: "trinket" };
const GEAR_STATS = ["atk", "matk", "acc", "crit", "def", "mdef", "atkBns", "matkBns", "accBns", "critBns", "defBns", "mdefBns",
  "hpBns", "str", "int", "dex", "lckMod", "expMod", "speed", "atkPct", "matkPct", "defPct", "mdefPct", "accPct", "critMod",
  "hpPct", "apMod"];
/** Combat stats shown per hero (api.heroStats keys). */
export const HERO_STATS = ["maxHP", "atk", "matk", "acc", "crit", "critMod", "def", "mdef", "eva", "speed", "maxActionPoints"];

/** 5 -> "S"; {B: 93, A: 100} -> "B93 A100". */
export function gradeLabel(gr: unknown): string {
  if (gr !== null && typeof gr === "object") return Object.entries(gr).map(([k, v]) => `${k}${v}`).join(" ");
  if (typeof gr === "number" && gr >= 1 && gr <= 5) return GRADES[Math.trunc(gr) - 1];
  return gr === undefined || gr === null ? "" : String(gr);
}

/** Game names in the visitor's language (U29, names.ts); English by default. */
const itemName = (type: string, id: number): string => shownItemName(type, id) ?? englishItemName(type, id);

export function className(cls: number): string {
  return classNameOf(cls) ?? `class ${cls}`;
}

/** The prefix (as in brackets, without "'s") and suffix symbol of a saved item, for the prefix / suffix columns. */
function modNames(it: Any): [string, string] {
  return [prefixTag(it.prefix || 0), suffixName(it.suffix || 0)];
}

/** A saved item's name with its modifiers: "[Strong] Undertaker +10" (names.ts modItemName, U34). */
export const itemLabel = (it: Any): string => modItemName(it.itemType, it.id, it);

function itemRow(it: Any): Row {
  const data = G.itemData[it.itemType]?.[it.id];
  const asc = it.prestigeLevel || 0;
  const [pre, suf] = modNames(it);
  const mods = Number(Boolean(it.prefix)) + Number((it.suffix ?? 0) > 0);
  const amount = stackAmount(it);
  const unit = data ? sellValue(it.itemType, it.id, asc, mods) ?? null : null;
  return {
    type: it.itemType, id: it.id, name: itemLabel(it), subtype: itemTypeText(it.itemType, data?.subType), // "Essence", "Health", "Hood" (R1 F30)
    item_level: data?.itemLevel ?? "", asc, grade: gradeLabel(it.grade), prefix: pre, suffix: suf, mods,
    rarity: data ? rarity(it.itemType, it.id, mods) : "", amount,
    unit_sell: unit, total_sell: unit === null ? null : unit * amount,
  };
}

/** Hero:returnSaveData stores attacks as indices into heroList[class].skillList, 0 = Basic. */
export function skillNames(cls: number, attackList: unknown[]): string[] {
  const skills = seq<string>(G.heroList[cls]?.skillList ?? {});
  return attackList.map((a) => typeof a === "string" ? a : a === 0 ? "Basic"
    : typeof a === "number" && a > 0 && a <= skills.length ? skills[a - 1] : `#${a}`);
}

function currentSet(h: Any): Any {
  const sets = h.skillSet ?? [];
  return sets[(h.currentSkillSet || 1) - 1] ?? { passive: h.passiveSelect, attackList: h.attackList ?? [] };
}

export interface HeroView {
  row: Row;
  cls: number; // heroList id, for colours
  rotation: string[];
  stats: Record<string, number> | null; // computed by the combat engine; null if the hero cannot be built
  statsError?: string;
  /** AP of the rotation and the hero's budget (null when the hero cannot be built). */
  ap: ApBudget | null;
  gear: Row[];
}

/**
 * A rotation's action points against the hero's budget. `max` is the engine's rule (api.skillInfo → default
 * heroMaxActionPoints): heroStartingAP + floor((min(level, heroMaxAPLevel) − heroLevelUnlockSkills) / heroAPEveryLevel)
 * + apMod (gear and passive), i.e. 5 + floor((min(level, 40) − 10) / 2) + apMod. Over budget, the game drops the
 * rotation for the class's default one (Hero.calculateAPRemainder).
 */
export interface ApBudget { used: number; max: number }

/** Sum of the skills' apCost (Basic and unknown skills cost 0). */
export function rotationAp(skills: string[]): number {
  return skills.reduce((s, n) => s + (Number(G.abilityData?.[n]?.apCost) || 0), 0);
}

/** Heroes with their summary row, engine-computed combat stats and equipped items. */
export function heroViews(sv: Save): HeroView[] {
  api.setMode(sv.raw.gameMode || "Standard");
  return sv.heroes.map((h: Any, i: number) => {
    const set = currentSet(h);
    const status = (h.campaignID ?? -1) > 0 ? "on a map" : (h.questListID ?? -1) > 0 ? "on a quest" : "idle";
    const row: Row = {
      n: i + 1, name: h.name, class: className(h.class), level: h.level, asc: h.prestigeLevel ?? 0, exp: h.exp,
      quests: h.totalQuests ?? 0, deaths: h.totalDeath ?? 0, status, passive: set.passive ?? "",
      rotation: skillNames(h.class, set.attackList ?? []).join(" / "),
      enchants: h.enchantsUsed ?? 0,
    };
    let stats: Record<string, number> | null = null;
    let statsError: string | undefined;
    let ap: ApBudget | null = null;
    const rotation = skillNames(h.class, set.attackList ?? []);
    try {
      const hero = api.newHero(sv.raw.hero[i]);
      const all = api.heroStats(hero);
      stats = Object.fromEntries(HERO_STATS.map((k) => [k, all[k] ?? 0]));
      ap = { used: rotationAp(rotation), max: api.skillInfo(hero).maxAP };
    } catch (e) {
      statsError = e instanceof Error ? e.message : String(e);
    }
    const gear = (h.heroInventory as Any[]).map((it) => {
      const r: Row = { slot: SLOT_LABELS[it.itemSlot] ?? it.itemSlot, ...itemRow(it) };
      for (const k of GEAR_STATS) if (it[k] !== undefined && it[k] !== 0) r[k] = it[k];
      return r;
    });
    return { row, cls: h.class, rotation, stats, statsError, ap, gear };
  });
}

/** Equipped items of every hero, one row each (hero_gear_rows). */
export function gearRows(views: HeroView[]): Row[] {
  return views.flatMap((v) => v.gear.map((g) => ({ hero_n: v.row.n, hero: v.row.name, class: v.row.class, ...g })));
}

/** Grades from the best down (S, A, B, C, D): the inventory's per-grade columns. */
export const GRADES_BEST_FIRST = [...GRADES].reverse();

/**
 * How many items of a stack have each grade ({S, A, B, C, D}, 0 when none): a stack split by grade
 * ({C: 14, B: 21}) keeps its split, a single grade counts the whole stack, an item without a grade counts nowhere.
 */
export function gradeCounts(it: Any): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(GRADES_BEST_FIRST.map((g) => [g, 0]));
  const gr = it.grade;
  if (gr !== null && typeof gr === "object") {
    for (const [g, n] of Object.entries(gr)) if (g in out) out[g] += Number(n) || 0;
  } else if (typeof gr === "number" && gr >= 1 && gr <= 5) {
    out[GRADES[Math.trunc(gr) - 1]] += stackAmount(it);
  }
  return out;
}

/**
 * One inventory line: one count column per grade (S … D) and `total` (the stack size) in place of the single
 * grade and amount, in the order the table and its CSV show them.
 */
function inventoryRow(where: string, slot: number, it: Any): Row {
  const { grade: _grade, amount, prefix, suffix, mods, rarity, unit_sell, total_sell, ...head } = itemRow(it);
  return { where, slot, ...head, ...gradeCounts(it), total: amount, unit_sell, total_sell, prefix, suffix, mods, rarity };
}

/** Inventory stacks in save order, then items on the sale counter (inventory_rows). */
export function inventoryRows(sv: Save): Row[] {
  const rows: Row[] = sv.inventory.map((it: Any, i: number) => inventoryRow("inventory", i + 1, it));
  sv.sales.forEach((it: Any, i: number) => {
    if (it) rows.push({ ...inventoryRow("counter", i + 1, it), sale_price: it.sellPrice ?? null });
  });
  return rows;
}

let game: Game | null = null;
/**
 * Essence one run of an owned map gives: [essence id, amount], from the profit model (its grade, ascension, prefix
 * and suffix), as the former savegame.py map_rows did.
 */
export function mapEssenceOf(it: Any): [number, number][] {
  if (!G.itemData.map?.[it.id]) return [];
  game ??= gameFromData();
  const grade = Number.isInteger(it.grade) ? it.grade : 3;
  const ess = mapEssence(game, it.id, it.prestigeLevel || 0, grade, [[1.0, it.prefix || 0, Math.max(it.suffix || 0, 0)]]);
  return [...ess].map(([key, amt]) => [Number(key.split("|")[1]), amt]);
}

/** Owned maps (map_rows), with the essence one run gives. */
export function mapRows(sv: Save): Row[] {
  return sv.mapInventory.map((it: Any, i: number) => {
    const data = G.itemData.map?.[it.id] ?? {};
    const bosses = seq<number>(data.bossList ?? {}).map((b) => enemyName(b)).filter(Boolean);
    return {
      slot: i + 1, ...itemRow(it),
      essence: mapEssenceOf(it).map(([id, amt]) => `${amt} ${itemName("material", id)}`).join(", "),
      boss: bosses.join(", "), enemies: data.baseEnemyAmount ?? "", enemy_mod: data.enemyMod ?? "",
      base_time_min: Math.round(((data.baseMapTime ?? 0) / 60) * 10) / 10,
      enchant_attempts: (it.enchantAttempt ?? [0, 0, 0]).join("/"), seed: it.seed ?? "",
    };
  });
}

/** Crafters, with what they are working on. */
/**
 * The level a crafter works at for items of ascension `asc` (obj.Crafter getEffectiveLevelForItem): its
 * prestigeLevel for items of its current ascension (ascLevel; prestigeUp resets it to 1), its level for
 * ascension 0 and for ascensions it has passed, null for ascensions it hasn't reached. (getMaxAscLevel: items above
 * the prestigeLevel can only be crafted one ascension lower.)
 */
export function crafterLevelFor(c: Any, asc: number): number | null {
  const current = c.ascLevel ?? 0;
  if (asc > 0 && asc === current) return c.prestigeLevel ?? 1;
  if (asc <= current) return c.level ?? null;
  return null;
}

export function crafterRows(sv: Save): Row[] {
  return [...sv.crafters.entries()].sort(([a], [b]) => a - b).map(([id, c]) => {
    const busy = c.isCrafting && typeof c.isCrafting === "object" ? c.isCrafting : null;
    return {
      crafter: crafterName(id) ?? `#${id}`,
      level: crafterLevelFor(c, 0), asc1_level: crafterLevelFor(c, 1), asc2_level: crafterLevelFor(c, 2),
      crafting: busy ? `${busy.amount ?? 1}x ${itemLabel(busy)}${busy.prestigeLevel ? ` (asc ${busy.prestigeLevel})` : ""}` : "",
    };
  });
}

export interface Summary {
  version: unknown;
  mode: string;
  gold: number;
  totalGoldEarned: number;
  totalCrafted: number;
  totalSales: number;
  inventoryStacks: number;
  maps: number;
  mapSlots: unknown;
  saleSlotsUsed: number;
  saleSlots: number;
  heroes: number;
  inventoryValue: number;
}

export function summary(sv: Save): Summary {
  const r = sv.raw;
  const value = inventoryRows(sv).reduce((s, x) => s + (typeof x.total_sell === "number" ? x.total_sell : 0), 0);
  return {
    version: r.version, mode: r.gameMode || "Standard", gold: r.gold ?? 0, totalGoldEarned: r.totalGoldEarned ?? 0,
    totalCrafted: r.totalCrafted ?? 0, totalSales: r.totalSales ?? 0, inventoryStacks: sv.inventory.length,
    maps: sv.mapInventory.length, mapSlots: r.mapSlotsUnlocked ?? "?", saleSlotsUsed: sv.sales.filter(Boolean).length,
    saleSlots: sv.sales.length, heroes: sv.heroes.length, inventoryValue: value,
  };
}

/** RFC 4180 CSV of rows (union of their keys, in first-seen order). */
export function toCsv(rows: Row[]): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n") + "\n";
}
