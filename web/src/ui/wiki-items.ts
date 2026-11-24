/**
 * Wiki items (U19): which item rows are real, rarity chips, equipment bonus-stat ranges and recipe chains.
 * Pure lookups on G (node tests import them); the few DOM helpers build nodes only when called.
 */
import { G } from "../sim/data.ts";
import { D, getBonusPrestige, getStatRange } from "../sim/defaults.ts";
import { seq } from "../sim/lua.ts";
import { sellValue } from "../tools/engine.ts";
import { type Game, gameFromData, PRESTIGE_TYPES } from "../tools/gamedata.ts";
import { ascLevels } from "../tools/profit.ts";
import { el, fmt, gold } from "./dom.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

// ---------------------------------------------------------------- placeholders
/**
 * Unused rows of the game's item tables. data.EquipmentData holds 108 rows with itemSlot 0 and subType "None" (plus two
 * with itemSlot 1 and subType "None": "30+ Items", "40+ Items"): "Region 5 Item", "Extra Item", "Event Item", "New Item",
 * "Break", "Black Dragon Knife"…, the second "Grok's Trinket" (549) and headers like "Bison", "Gods". They have no crafter,
 * no recipe, no image and no stat formula; no recipe, drop or shop uses them, so the game never shows them.
 * Materials and consumables have the same kind of rows with an empty subType ("Extra Item", "Region 5 Material",
 * "Weekly Material", "Extra Potion"…), which nothing references either.
 */
export function isPlaceholder(type: string, it: Any): boolean {
  if (!it?.name) return true;
  if (type === "equipment") return !(it.itemSlot >= 1 && it.itemSlot <= 6) || !it.subType || it.subType === "None";
  if (type === "material" || type === "consumable") return !it.subType;
  return false;
}

// ---------------------------------------------------------------- rarity
/**
 * The game's rarity colours (data.UIData UI.rarityColor, RGB 0..1 as hex): 10 and 11 reuse 3 and 4. The game has no
 * rarity names (TextData only has the word "Rarity"; the "Common … Legendary!" list in scene.SpinGame names the prize
 * wheel's slices, not items), so the wiki shows "Rarity N" in the game's colour.
 */
export const RARITY_COLOURS: Record<number, string> = {
  0: "#000000", 1: "#ffffff", 2: "#80ff80", 3: "#50a0ff", 4: "#ff00ff", 5: "#ffff00", 6: "#ffff00", 7: "#ff0000", 8: "#ff0000",
  10: "#50a0ff", 11: "#ff00ff",
};
export const rarityLabel = (r: unknown): string => `Rarity ${typeof r === "number" ? r : "?"}`;

/** Rarities the game draws in another rarity's colour (UI.rarityColor[10] = [3], [11] = [4]); essences are rarity 10. */
export const RARITY_SAME_COLOUR: Record<number, number> = { 10: 3, 11: 4 };

/** The chip's tooltip: the rarity and (R1 F39) for 10 and 11, that the game reuses the colour of rarity 3 / 4. */
export function rarityTip(r: unknown): string {
  const n = typeof r === "number" ? r : NaN;
  const same = RARITY_SAME_COLOUR[n];
  return same ? `${rarityLabel(r)}: the game draws it in the colour of rarity ${same}` : `${rarityLabel(r)} (the game's colour for it)`;
}

/** A chip in the game's own rarity colour (dark text and a thin outline keep white and yellow readable on light pages). */
export function rarityChip(r: unknown): HTMLElement {
  const n = typeof r === "number" ? r : NaN;
  const colour = RARITY_COLOURS[n];
  const s = el("span", { class: `rar-chip rar-${Number.isFinite(n) ? n : "x"}`, title: rarityTip(r) }, rarityLabel(r));
  if (colour) s.style.setProperty("--rar-game", colour);
  return s;
}

// ---------------------------------------------------------------- bonus stats
const STAT_LABEL: Record<string, string> = {
  str: "Str", int: "Int", dex: "Dex", lckMod: "luck", expMod: "XP", speed: "speed", atkBns: "Atk", matkBns: "Matk", accBns: "Acc",
  critBns: "Crit", defBns: "Def", mdefBns: "Mdef", hpBns: "HP", apMod: "AP", atkPct: "Atk", matkPct: "Matk", defPct: "Def",
  mdefPct: "Mdef", accPct: "Acc", hpPct: "HP", critMod: "crit damage",
};
export const bonusLabel = (key: string): string => STAT_LABEL[key] ?? key;

/** An equipment bonus stat's [min, max] (the data stores a range { 1: min, 2: max }, not a number). */
export function bonusPair(v: unknown): [number, number] | null {
  if (typeof v === "number") return Number.isFinite(v) ? [v, v] : null;
  if (Array.isArray(v)) return typeof v[0] === "number" ? [v[0], typeof v[1] === "number" ? v[1] : v[0]] : null;
  if (v && typeof v === "object") {
    const a = (v as Any)[1] ?? (v as Any)["1"], b = (v as Any)[2] ?? (v as Any)["2"];
    return typeof a === "number" ? [a, typeof b === "number" ? b : a] : null;
  }
  return null;
}

/**
 * Range of one bonus stat on a crafted item, as default.getStatRange gives it: values between -1 and 1 are fractions
 * (shown in %), the rest scale with the grade (gradeMin / gradeMax), × the ascension multiplier (ascStat), and a crafter
 * above the item level raises the minimum. No grade: the item's own numbers.
 */
export function bonusRange(key: string, v: unknown, grade?: number, asc = 0, craftDiff = 0): { lo: number; hi: number; pct: boolean } | null {
  const p = bonusPair(v);
  if (!p) return null;
  const pct = p[0] < 1 && p[0] > -1;
  if (!grade) return pct ? { lo: Math.round(p[0] * 1000) / 10, hi: Math.round(p[1] * 1000) / 10, pct } : { lo: p[0], hi: p[1], pct };
  let mult: number | false = false;
  if (asc > 0) {
    try {
      mult = getBonusPrestige(key, asc) ?? false;
    } catch {
      mult = false;
    }
  }
  if (!D.gradeMin) return null; // game data not loaded
  const [lo, hi] = getStatRange({ 1: p[0], 2: p[1] }, grade, mult, craftDiff);
  return { lo, hi, pct };
}

/** "+20–25 Str", "−7 to +7 Acc", "+5–15% Atk", "+1 AP". */
export function bonusText(key: string, v: unknown, grade?: number, asc = 0, craftDiff = 0): string {
  const r = bonusRange(key, v, grade, asc, craftDiff);
  if (!r) return "";
  const n = (x: number) => fmt.format(Math.abs(x));
  const sgn = (x: number) => (x < 0 ? "−" : "+");
  const unit = r.pct ? "%" : "";
  const lo = Math.min(r.lo, r.hi), hi = Math.max(r.lo, r.hi);
  const num = lo === hi ? `${sgn(lo)}${n(lo)}${unit}`
    : lo < 0 && hi > 0 ? `${sgn(lo)}${n(lo)}${unit} to ${sgn(hi)}${n(hi)}${unit}`
    : lo < 0 ? `${sgn(lo)}${n(hi)}–${n(lo)}${unit}` : `+${n(lo)}–${n(hi)}${unit}`;
  return `${num} ${bonusLabel(key)}`;
}

/** Every bonus stat of an equipment item, as text (base numbers, or at a grade / ascension). */
export function bonusLines(it: Any, grade?: number, asc = 0, craftDiff = 0): string[] {
  return Object.entries<unknown>(it?.bonusStat ?? {}).map(([k, v]) => bonusText(k, v, grade, asc, craftDiff)).filter(Boolean);
}

// ---------------------------------------------------------------- crafting
/** [type, id, amount] ingredients of a craftable item (none when it has no crafter). */
export function recipeOf(type: string, id: number): [string, number, number][] {
  const it = G.itemData?.[type]?.[id];
  const mids = seq<number>(it?.materialID ?? {});
  if (!mids.length || !it.crafterID) return [];
  const types = seq<string>(it.materialType ?? {}), amounts = seq<number>(it.materialAmount ?? {});
  return mids.map((m, i) => [types[i] || "material", m, amounts[i] ?? 1]);
}

export const isCraftable = (type: string, id: number): boolean => recipeOf(type, id).length > 0;

/** default.craftGradeSpeed (standard mode): a craft takes floor(runTime × speed[grade]) × amount seconds (obj.Craft). */
export const CRAFT_GRADE_SPEED = [1.1, 1, 0.9, 0.8, 0.75];

export interface RecipeNode {
  type: string;
  id: number;
  name: string;
  rarity: number;
  /** how many the parent needs (1 for the root) */
  amount: number;
  crafterID: number;
  /** crafter level needed (the item level: Crafter:startCraft) */
  level: number;
  /** gold to craft one */
  cost: number;
  /** base craft time of one, seconds (grade C; × 1.1 at D down to × 0.75 at S) */
  time: number;
  /** craftable equipment ingredients, each with its own chain (the only ingredients drawn as boxes) */
  kids: RecipeNode[];
  /** every other ingredient [type, id, amount]: raw materials and crafted non-equipment (ingots, lumber, maps…) */
  raw: [string, number, number][];
  /** crafted non-equipment ingredients (part of raw): their crafting counts in the totals, but they get no box */
  hidden: { type: string; id: number; amount: number; time: number; cost: number }[];
  /** gold of the uncrafted ingredients (ores, logs, drops), each at its sell value per unit (U37) */
  rawCost: number;
  /**
   * One of this item, everything crafted one after the other: own time + amount × each crafted ingredient's total,
   * hidden material crafts (ingots…) included.
   */
  totalTime: number;
  /** gold for one, every ingredient included: crafted ones (hidden ones too) and uncrafted ones at their sell value */
  totalCost: number;
  /** longest chain of equipment crafts below and including this one */
  depth: number;
}

/** Boxes in a crafting chain: equipment only (U19 follow-up: "let's stick to equippable items"). */
const boxed = (type: string) => type === "equipment";

/**
 * The chain of crafts behind an item: crafted equipment ingredients become nodes; raw materials and crafted
 * non-equipment ingredients stay a list, the latter still counted in the totals.
 */
export function recipeTree(type: string, id: number, amount = 1, seen: Set<string> = new Set()): RecipeNode | null {
  const it = G.itemData?.[type]?.[id];
  if (!it) return null;
  const key = `${type}:${id}`;
  const ingredients = seen.has(key) ? [] : recipeOf(type, id); // a loop (none in the data) stops here
  const inner = new Set(seen).add(key);
  const kids: RecipeNode[] = [];
  const raw: [string, number, number][] = [];
  const hidden: RecipeNode["hidden"] = [];
  for (const [t, mid, amt] of ingredients) {
    const sub = isCraftable(t, mid) ? recipeTree(t, mid, amt, inner) : null;
    if (sub && boxed(t)) kids.push(sub);
    else {
      raw.push([t, mid, amt]);
      if (sub) hidden.push({ type: t, id: mid, amount: amt, time: sub.totalTime, cost: sub.totalCost });
    }
  }
  const own = ingredients.length ? it.runTime ?? 0 : 0;
  const ownCost = ingredients.length ? it.cost ?? 0 : 0;
  const parts = [...kids.map((k) => ({ amount: k.amount, time: k.totalTime, cost: k.totalCost })), ...hidden];
  // U37: the uncrafted ingredients count too, each at its sell value per unit (they used to add nothing)
  const rawCost = raw.filter(([t, mid]) => !isCraftable(t, mid)).reduce((s, [t, mid, amt]) => s + amt * (unitPrice(t, mid, 0) ?? 0), 0);
  return {
    type, id, name: it.name ?? `${type} #${id}`, rarity: it.rarity ?? 1, amount, crafterID: it.crafterID ?? 0, level: it.itemLevel ?? 0,
    cost: ownCost, time: own, kids, raw, hidden, rawCost,
    totalTime: own + parts.reduce((s, k) => s + k.amount * k.time, 0),
    totalCost: ownCost + rawCost + parts.reduce((s, k) => s + k.amount * k.cost, 0),
    depth: 1 + Math.max(0, ...kids.map((k) => k.depth)),
  };
}

// ---------------------------------------------------------------- costs by ascension (U37)
/** The tools' Game view of the data (for the essence an ascended craft takes), rebuilt when other data is loaded. */
let gameCache: { data: unknown; g: Game } | null = null;
function game(): Game {
  if (!gameCache || gameCache.data !== G.itemData) gameCache = { data: G.itemData, g: gameFromData() };
  return gameCache.g;
}

/**
 * Ascension variants of an item (tools/profit.ts ascLevels): 0–2 for equipment and consumables, 0–1 for maps, 0 for
 * materials; an item with lockPrestige only 0. [] for an unknown item.
 */
export function itemAscLevels(type: string, id: number): number[] {
  const it = G.itemData?.[type]?.[id];
  if (!it) return [];
  return ascLevels(type).filter((p) => !p || !it.lockPrestige);
}

/** The game's sell value of one unit (stackables: the rounded average of the data's pair), or null. */
export function unitPrice(type: string, id: number, asc = 0): number | null {
  try {
    return sellValue(type, id, asc) ?? null;
  } catch {
    return null;
  }
}

/** Sell value of one at an ascension, or null when the item has no such variant. */
export function sellAt(type: string, id: number, asc: number): number | null {
  return itemAscLevels(type, id).includes(asc) ? unitPrice(type, id, asc) : null;
}

/**
 * Gold one craft costs at an ascension: the crafter's gold (not scaled by ascension) plus, for an ascended craft, the
 * essence it consumes (default.prestigeItemMaterial) at the essence's sell value. Null when the item isn't crafted or
 * has no such variant.
 */
export function craftCost(type: string, id: number, asc = 0): number | null {
  if (!isCraftable(type, id) || !itemAscLevels(type, id).includes(asc)) return null;
  let cost: number = G.itemData[type][id].cost ?? 0;
  if (asc > 0) {
    try {
      const [eid, amount] = game().essenceForAscension(type, id, asc, false);
      const price = unitPrice("material", eid, 0);
      if (price === null) return null;
      cost += amount * price;
    } catch {
      return null;
    }
  }
  return cost;
}

const totalsByData = new WeakMap<object, Map<string, number | null>>();

/**
 * Gold for one with the whole recipe tree: its own craft (craftCost), each crafted ingredient's own total (equipment,
 * consumables and maps at the same ascension, crafted materials such as bars plain) and each uncrafted ingredient at
 * its sell value per unit (ores, logs, drops), × the amounts. Null when the item isn't crafted, has no such variant or
 * an ingredient has no price.
 */
export function totalCost(type: string, id: number, asc = 0, seen: Set<string> = new Set()): number | null {
  const data = G.itemData as object | undefined;
  if (!data) return null;
  let memo = totalsByData.get(data);
  if (!memo) totalsByData.set(data, memo = new Map());
  const key = `${type}:${id}:${asc}`;
  if (memo.has(key)) return memo.get(key)!;
  const own = craftCost(type, id, asc);
  if (own === null || seen.has(key)) return own; // a loop (none in the data) stops here
  const inner = new Set(seen).add(key);
  let sum: number | null = own;
  for (const [t, mid, amt] of recipeOf(type, id)) {
    const a = PRESTIGE_TYPES.has(t) ? asc : 0;
    const part = isCraftable(t, mid) ? totalCost(t, mid, a, inner) : sellAt(t, mid, a);
    if (part === null) {
      sum = null;
      break;
    }
    sum += amt * part;
  }
  memo.set(key, sum);
  return sum;
}

// ---------------------------------------------------------------- selling
/**
 * R1 F43. The game's sell value of a stackable (obj.Item getSellValue) is round((sell[1] + sell[2]) / 2) × amount, the
 * pair first × 2 × ascension (default.itemSellValue): Minor Potion's 15–20 sells for 18, 35 and 70. So the value the
 * wiki shows (tools/engine.ts sellValue) is the game's; this gives the data's pair behind it, for materials and
 * consumables (equipment and maps have one value × rarityMod, no pair).
 */
export function sellRange(type: string, id: number, asc = 0): [number, number] | null {
  if (type !== "material" && type !== "consumable") return null;
  const p = bonusPair(G.itemData?.[type]?.[id]?.sell);
  if (!p) return null;
  const mult = asc > 0 ? asc * 2 : 1;
  return [p[0] * mult, p[1] * mult];
}

/** Tooltip of a stackable's sell value ("" without a pair): the data's pair and how the game turns it into one price. */
export function sellTip(type: string, id: number, asc = 0): string {
  const r = sellRange(type, id, asc);
  if (!r || r[0] === r[1]) return "";
  return `${fmt.format(r[0])}–${fmt.format(r[1])} g in the game's data; the game sells at the average, rounded (× the amount).`;
}

/** A sell value: "18 g"; for materials and consumables the data's pair is in its tooltip only (U37). */
export function sellNode(type: string, id: number, value: number, asc = 0): HTMLElement {
  const tip = sellTip(type, id, asc);
  return el("span", { class: "nowrap sell-val", ...(tip ? { title: tip } : {}) }, gold(value));
}
