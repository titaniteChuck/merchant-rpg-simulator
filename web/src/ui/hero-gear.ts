/**
 * U78: a hero's gear in the save viewer's edit mode, pure (Node tests import it). Each slot is one equipment item with
 * a configuration: item id, rank (the game's grade, 1–5 = D … S), ascension, prefix and suffix. A slot the visitor
 * changes is built as the wiki builds an item's figures (wiki-config equipmentAt: a craft at crafter level 60, seed 1,
 * then the prefix and suffix applied as the game does) and written back as the game's compact string
 * (obj.ItemCompact compactEquipment), so every tool reads it like a saved item. A slot left alone keeps its saved string.
 *
 * What each picker offers follows the game data (wiki-config validAscs / validPrefixes / validSuffixes): a Worn item has
 * rank D only and no modifier, a trinket no suffix, the suffixes stop at the Enchanter's top for the ascension.
 * Choosing another item resets its rank, ascension, prefix and suffix (pickItem); another ascension drops a suffix it
 * can't take (normaliseConfig).
 */
import { G } from "../sim/data.ts";
import { Equipment, readEquipmentCompact } from "../sim/equipment.ts";
import { seq } from "../sim/lua.ts";
import { equipmentAt, normaliseConfig, validAscs, validPrefixes, validSuffixes } from "./wiki-config.ts";
import { bonusLines, isPlaceholder } from "./wiki-items.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface GearConfig {
  id: number;
  /** 1–5 (D, C, B, A, S) */
  grade: number;
  asc: number;
  prefix: number;
  suffix: number;
}

/** The rank an item gets when it is picked (B, the grade the site's other figures use); a Worn item is always D. */
export const DEFAULT_GRADE = 3;
const equip = (id: number): Any => G.itemData?.equipment?.[id];
export const isWorn = (id: number): boolean => String(equip(id)?.name ?? "").includes("Worn");

/** A saved compact string read as a configuration. */
export function configOf(compact: string): GearConfig {
  const d = readEquipmentCompact(compact);
  return { id: Number(d.id) || 0, grade: Number(d.grade) || 1, asc: Number(d.prestigeLevel) || 0,
    prefix: Math.max(0, Number(d.prefix) || 0), suffix: Math.max(0, Number(d.suffix) || 0) };
}

/** Ranks the item can have: D only for a Worn item, else D … S. */
export const gradeOptions = (id: number): number[] => (isWorn(id) ? [1] : [1, 2, 3, 4, 5]);
export const ascOptions = (id: number): number[] => validAscs("equipment", id);
export const prefixOptions = (id: number): number[] => validPrefixes("equipment", id);
export const suffixOptions = (id: number, asc: number): number[] => validSuffixes("equipment", id, asc);

/** Another item in the slot: its default rank, ascension 0, no prefix, no suffix. */
export const pickItem = (id: number): GearConfig => ({ id, grade: isWorn(id) ? 1 : DEFAULT_GRADE, asc: 0, prefix: 0, suffix: 0 });

/** A configuration with one value changed, everything the item then can't take reset (rank clamped to its options). */
export function withGear(c: GearConfig, change: Partial<Omit<GearConfig, "id">>): GearConfig {
  const next = { ...c, ...change };
  const ranks = gradeOptions(next.id);
  const grade = ranks.includes(next.grade) ? next.grade : ranks[ranks.length - 1];
  return { id: next.id, grade, ...normaliseConfig("equipment", next.id, next) };
}

/** A number as Lua's tostring writes it (%.14g): 0.1 stays "0.1", not 0.30000000000000004. */
export const luaNum = (x: number): string => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(14))));

const BONUS = ["atkBns", "matkBns", "accBns", "critBns", "defBns", "mdefBns", "hpBns", "str", "int", "dex", "UNUSED",
  "lckMod", "expMod", "speed", "atkPct", "matkPct", "defPct", "mdefPct", "accPct", "critMod", "hpPct", "apMod"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** obj.ItemCompact getCompact for an equipment item (the inverse of readEquipmentCompact). */
export function compactOf(item: Any): string {
  const slot = Number(item.itemSlot);
  const stats = slot === 1 ? `A${luaNum(item.atk)}B${luaNum(item.matk)}C${luaNum(item.acc)}D${luaNum(item.crit)}`
    : slot !== 6 ? `A${luaNum(item.def)}B${luaNum(item.mdef)}` : "A";
  const bns = BONUS.map((k, i) => (item[k] && item[k] !== 0 ? `${LETTERS[i]}${luaNum(item[k])}` : "")).join("") || "0";
  const ea = item.enchantAttempt ?? [0, 0, 0];
  return [3, Number(item.id).toString(16).toUpperCase(), item.grade, slot, item.prefix || 0, item.suffix || 0, stats, bns,
    `A${ea[0] ?? 0}B${ea[1] ?? 0}C${ea[2] ?? 0}`, item.prestigeLevel || 0].join("|");
}

/** The compact string of an item built from a configuration (null when the engine can't make it). */
export function gearCompact(c: GearConfig): string | null {
  const made = equipmentAt(c.id, c.grade, { asc: c.asc, prefix: c.prefix, suffix: c.suffix });
  return made ? compactOf(made) : null;
}

/** One row of the item table: an equipment item of the slot. */
export interface ItemChoice {
  id: number;
  level: number;
  region: number;
  bonus: string[];
}

/**
 * The items a slot can take: real equipment items of that slot (no placeholder rows), at most the hero's level
 * (Hero.addItemStats ignores an item above it), not in an excluded region, `visible` (the expansions); sorted by level,
 * highest first, then by id. `regionOf` gives an item's region (wiki-data regionOf in the page).
 */
export function itemChoices(slot: number, heroLevel: number, o: { excluded?: ReadonlySet<number>; regionOf: (id: number) => number;
  visible?: (id: number) => boolean }): ItemChoice[] {
  const out: ItemChoice[] = [];
  for (const [k, it] of Object.entries<Any>(G.itemData?.equipment ?? {})) {
    const id = Number(k);
    if (isPlaceholder("equipment", it) || Number(it.itemSlot) !== slot || (Number(it.itemLevel) || 0) > heroLevel) continue;
    if (o.visible && !o.visible(id)) continue;
    const region = o.regionOf(id);
    if (o.excluded?.has(region)) continue;
    out.push({ id, level: Number(it.itemLevel) || 0, region, bonus: bonusLines(it) });
  }
  return out.sort((a, b) => b.level - a.level || a.id - b.id);
}

/**
 * The class's starting gear (heroList defaultHeroInventory: the Worn items) as compact strings, made as the game makes
 * a new hero's (Hero:addStartingItemToHero: Equipment:new by name, isNew, no crafter level).
 */
export function startingGear(cls: number): string[] {
  return seq<string>(G.heroList?.[cls]?.defaultHeroInventory ?? {}).map((name) => {
    try {
      return compactOf(new Equipment({ name, itemType: "equipment", isNew: true }));
    } catch {
      return "";
    }
  }).filter(Boolean);
}
