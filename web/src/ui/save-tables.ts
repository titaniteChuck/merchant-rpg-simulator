/**
 * Tables shown by the save viewer, one row object per line (port of the table
 * builders of tools/savegame.py: hero_rows, hero_gear_rows, inventory_rows,
 * map_rows, the crafter and summary parts of print_report).
 *
 * Needs the game data loaded (api.loadGameData) first.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { itemName, rarity, sellValue } from "../tools/engine.ts";
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

export function className(cls: number): string {
  return G.heroList[cls]?.name ?? `class ${cls}`;
}

function modNames(it: Any): [string, string] {
  const pre = G.prefixList[it.prefix || 0]?.name ?? "";
  const suf = G.suffixList[it.suffix || 0]?.name ?? (it.suffix === -1 ? "Worn" : "");
  return [pre, suf];
}

/** "Strong Undertaker +10". */
export function itemLabel(it: Any): string {
  const [pre, suf] = modNames(it);
  return [pre, itemName(it.itemType, it.id), suf].filter(Boolean).join(" ");
}

function itemRow(it: Any): Row {
  const data = G.itemData[it.itemType]?.[it.id];
  const asc = it.prestigeLevel || 0;
  const [pre, suf] = modNames(it);
  const mods = Number(Boolean(it.prefix)) + Number((it.suffix ?? 0) > 0);
  const amount = stackAmount(it);
  const unit = data ? sellValue(it.itemType, it.id, asc, mods) ?? null : null;
  return {
    type: it.itemType, id: it.id, name: itemLabel(it), subtype: data?.subType ?? "",
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
  gear: Row[];
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
    try {
      const all = api.heroStats(api.newHero(sv.raw.hero[i]));
      stats = Object.fromEntries(HERO_STATS.map((k) => [k, all[k] ?? 0]));
    } catch (e) {
      statsError = e instanceof Error ? e.message : String(e);
    }
    const gear = (h.heroInventory as Any[]).map((it) => {
      const r: Row = { slot: SLOT_LABELS[it.itemSlot] ?? it.itemSlot, ...itemRow(it) };
      for (const k of GEAR_STATS) if (it[k] !== undefined && it[k] !== 0) r[k] = it[k];
      return r;
    });
    return { row, cls: h.class, rotation: skillNames(h.class, set.attackList ?? []), stats, statsError, gear };
  });
}

/** Equipped items of every hero, one row each (hero_gear_rows). */
export function gearRows(views: HeroView[]): Row[] {
  return views.flatMap((v) => v.gear.map((g) => ({ hero_n: v.row.n, hero: v.row.name, class: v.row.class, ...g })));
}

/** Inventory stacks in save order, then items on the sale counter (inventory_rows). */
export function inventoryRows(sv: Save): Row[] {
  const rows: Row[] = sv.inventory.map((it: Any, i: number) => ({ where: "inventory", slot: i + 1, ...itemRow(it) }));
  sv.sales.forEach((it: Any, i: number) => {
    if (it) rows.push({ where: "counter", slot: i + 1, ...itemRow(it), sale_price: it.sellPrice ?? null });
  });
  return rows;
}

/** Owned maps (map_rows without the essence column, which needs the profit model). */
export function mapRows(sv: Save): Row[] {
  return sv.mapInventory.map((it: Any, i: number) => {
    const data = G.itemData.map?.[it.id] ?? {};
    const bosses = seq<number>(data.bossList ?? {}).map((b) => G.questData[b]?.name).filter(Boolean);
    return {
      slot: i + 1, ...itemRow(it),
      boss: bosses.join(", "), enemies: data.baseEnemyAmount ?? "", enemy_mod: data.enemyMod ?? "",
      base_time_min: Math.round(((data.baseMapTime ?? 0) / 60) * 10) / 10,
      enchant_attempts: (it.enchantAttempt ?? [0, 0, 0]).join("/"), seed: it.seed ?? "",
    };
  });
}

/** Crafters, with what they are working on. */
export function crafterRows(sv: Save): Row[] {
  return [...sv.crafters.entries()].sort(([a], [b]) => a - b).map(([id, c]) => {
    const busy = c.isCrafting && typeof c.isCrafting === "object" ? c.isCrafting : null;
    return {
      crafter: (G as Any).crafterData?.[id]?.name ?? `#${id}`, level: c.level ?? "", asc: c.ascLevel ?? 0,
      prestige_level: c.prestigeLevel ?? 0,
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
