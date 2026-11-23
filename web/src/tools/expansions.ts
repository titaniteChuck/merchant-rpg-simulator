/**
 * The game's two paid expansions, Frozen and Scribe: what each one gates, and which ones a save proves it owns.
 * Pure and browser-safe; reads the game tables from G (load inventory/gamedata.json with loadGameData first).
 * File:line references are to the decompiled Lua (decompiled/); docs/game-economy/expansions/ explains the rules.
 *
 *   contentExpansion("material", 222)              // { needs: ["Frozen"], gate: "obtain" }
 *   contentExpansion("map", 21)                    // { needs: ["Frozen", "Scribe"], gate: "obtain" }
 *   contentExpansion("crafter", 8)                 // { needs: ["Scribe"], gate: "access" }
 *   effectiveExpansions(inferExpansions(raw), { Frozen: false })
 *
 * Ownership itself lives in UserInfo.usr (purchaseList), which the site never sees, so the site infers it from
 * PlayerData signals. Inference only proves ownership; it never disproves it.
 */
import { G, type GameData } from "../sim/data.ts";
import { parseItem } from "./save.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type Expansion = "Frozen" | "Scribe";
export const EXPANSION_IDS: readonly Expansion[] = ["Frozen", "Scribe"];

export interface ExpansionInfo {
  id: Expansion;
  /** Name the game uses in news and locks (obj.GameClass.lua:1569, data.HeroData.lua:875). */
  name: string;
  /** Title of the purchase screen (data.TextData-EN.lua:554, 561). */
  storeTitle: string;
  /** Store product id (scene.UnlockExpansionOverlay.lua:4-6, data.PurchaseData.lua:180-194). */
  productId: string;
  description: string;
  adds: string[];
}

export const EXPANSIONS: Record<Expansion, ExpansionInfo> = {
  Frozen: {
    id: "Frozen",
    name: "Frozen Tome",
    storeTitle: "Frozen Expansion",
    productId: "bearface.games.merchant.expansion.frozen",
    description: "A new region (Frentir), more inventory, 2 hero slots, a new hero type and a new hero prestige level.",
    adds: [
      "Region 6, Frentir, and its quests",
      "The Bard hero class",
      "Hero prestige 3 (levels 51-60)",
      "+2 hero slots",
      "+16 inventory slots",
      "Shop theme 7 and merchant skin 12",
      "Level 51-60 materials, equipment and potions",
    ],
  },
  Scribe: {
    id: "Scribe",
    name: "Scribe",
    storeTitle: "Scribe Expansion",
    productId: "bearface.games.merchant.expansion.scribe",
    description: "Item ascension, a new crafter (the Scribe), maps & dungeons, more inventory and 3 hero slots.",
    adds: [
      "The Scribe crafter: maps and scrolls",
      "Maps & dungeons, their bosses and essences",
      "Crafter and item ascension",
      "17 locked rarity-7 recipes (equipment 764-780)",
      "+3 hero slots",
      "+16 inventory slots",
    ],
  },
};

/** Also grants both expansions (data.PurchaseData.lua:213-243), as do the "inlogic"/"offline" builds (main.lua:16-33). */
export const EVERYTHING_PRODUCT = "bearface.games.merchant.everything";

export type GateKind = "access" | "obtain";
export interface ContentGate {
  needs: Expansion[];
  gate: GateKind;
}
export type ItemKind = "material" | "equipment" | "consumable" | "map";
export type ContentKind = "region" | "quest" | "enemy" | "class" | "prestige" | "level" | "crafter" | "itemAscension" | ItemKind | "item";
export interface ContentExtra {
  /** Item type, for kind "item". */
  type?: ItemKind;
  /** Ascension level of the item (0 = not ascended). */
  ascension?: number;
}

// --- Hard-coded exceptions: rules that live in the Lua code, not in the exported tables. ---

/** Bard: the hero menu offers class 9 only with Frozen (scene.NewHeroMenu.lua:137-145). */
const FROZEN_CLASS = 9;
/** Hero prestige 2 -> 3 opens the Frozen purchase screen instead (scene.HeroStatsMenu.lua:61-62). */
const FROZEN_PRESTIGE = 3;
/** Crafter 8 (the Scribe) is sold only with the expansion (scene.CrafterMenu.lua:122, 160; obj.GameClass.lua:546-548). */
const SCRIBE_CRAFTER = 8;
/** Essence per ascension tier and region (data.Default.lua:540-556). Tier 1 drops from maps, tier 2 from asc-1 maps. */
const PRESTIGE_ITEM_ID: Record<number, number[]> = {
  1: [33, 55, 84, 109, 140, 255],
  2: [273, 274, 275, 276, 277, 278],
};
/** Treasure Bush quest per map tier, ceil(itemLevel / 10) (obj.Map.lua:177-184, 193). */
const TREASURE_ID = [99, 100, 101, 102, 103, 104];
/** Crafters cap at #crafterLevelRequirement = 60 (data.Default.lua:1376, obj.Crafter.lua:48) and craft itemLevel <= level (obj.Crafter.lua:88). */
const CRAFTER_MAX_LEVEL = 60;
/** questType 8 (map bosses, treasure bushes) is never on the quest board (scene.QuestMenu.lua:175). */
const MAP_ONLY_QUEST_TYPE = 8;
/** Region 7 is never entered: the region arrow stops before #regionLevelReqs (scene.QuestMenu.lua:138). */
const UNREACHABLE_REGION = 7;
/** Hero slots: 10 free + 3 bought (data.Default.lua:881-882), then 2 per Frozen, 3 per Scribe (scene.HeroMenu.lua:561-584). */
const HERO_SLOTS = { base: 13, Frozen: 2, Scribe: 3 };
/** Gold-bought inventory stops at 96 slots with no expansion, 112 with one, 160 with both (scene.AddSlotOverlay.lua:16-29). */
const GOLD_SLOTS = { none: 96, one: 112 };

// --- Derived tables: what each ownership combination can reach. ---

const F = 1;
const S = 2;
const maskNeeds = (m: number): Expansion[] => EXPANSION_IDS.filter((_, i) => m & (1 << i));

interface Reach {
  quests: Set<number>;
  items: Set<string>; // "type:id"
}

const entries = (t: Any): [number, Any][] => Object.entries(t ?? {}).map(([k, v]) => [Number(k), v]);
const values = (t: Any): Any[] => (Array.isArray(t) ? t.filter((v) => v != null) : Object.values(t ?? {}));
const isPlaceholderQuest = (q: Any) => /placeholder/i.test(q.name ?? "");
const regionOf = (itemLevel: number) => Math.min(Math.max(Math.floor((itemLevel - 1) / 10) + 1, 1), 6); // default.prestigeItemMaterial

/** Quest ids listed by a map: plain ids or {lo, hi} ranges (obj.Map.lua getPossibleEnemies). */
function mapQuests(map: Any): number[] {
  const out: number[] = [];
  for (const e of [...values(map.enemyList), ...values(map.bossList)]) {
    if (typeof e === "number") out.push(e);
    else {
      const [lo, hi] = values(e);
      for (let q = lo; q <= hi; q++) out.push(q);
    }
  }
  const tid = TREASURE_ID[Math.ceil(map.itemLevel / 10) - 1];
  if (tid) out.push(tid);
  return out;
}

/** Everything a player owning `mask` can reach: quests on the board or in maps, drops, crafts, map essences. */
function reach(data: GameData, mask: number): Reach {
  const quests = new Set<number>();
  const items = new Set<string>();
  const regionNeeds = data.default?.regionExpansions ?? {};
  for (const [id, q] of entries(data.questData)) {
    if (isPlaceholderQuest(q) || q.questType === MAP_ONLY_QUEST_TYPE || q.region === UNREACHABLE_REGION) continue;
    const xpac = regionNeeds[q.region];
    if (xpac && !(mask & (xpac === "Frozen" ? F : S))) continue;
    quests.add(id);
  }
  const doneQuests = new Set<number>();
  const doneMaps = new Set<number>();
  const add = (type: string, id: number) => {
    const k = `${type}:${id}`;
    if (items.has(k)) return false;
    items.add(k);
    return true;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of quests) {
      if (doneQuests.has(id)) continue;
      doneQuests.add(id);
      changed = true;
      const q = data.questData[id];
      for (const k of ["rewardA1", "rewardA2", "rewardB1", "rewardB2"]) {
        const r = q[k];
        if (r && typeof r === "object" && Number(r[1]) > 0) add("material", Number(r[1]));
      }
      for (const k of ["rewardA3", "rewardA4", "rewardB3", "rewardB4"]) {
        const p = q[k] && data.parcelData[q[k]];
        if (!p) continue; // "MapLegendary" (quest 98) has no parcel
        for (const it of values(p.itemList)) {
          const ids = values(it.id);
          if (ids.length > 1) add(String(ids[0]), Number(ids[1]));
          else add("material", Number(ids[0]));
        }
      }
    }
    for (const type of ["material", "equipment", "consumable", "map"] as const) {
      for (const [id, it] of entries(data.itemData[type])) {
        if (items.has(`${type}:${id}`) || !it.crafterID) continue;
        if (it.crafterID === SCRIBE_CRAFTER && !(mask & S)) continue;
        if (type === "equipment" && it.locked && !(mask & S)) continue; // unlocked by Scribe (obj.GameClass.lua:551-553)
        if (it.itemLevel > CRAFTER_MAX_LEVEL) continue;
        const mats = entries(it.materialID);
        if (!mats.length) continue;
        const kinds = it.materialType ?? {};
        if (mats.every(([k, m]) => items.has(`${kinds[k] ?? "material"}:${m}`)) && add(type, id)) changed = true;
      }
    }
    for (const [id, m] of entries(data.itemData.map)) {
      if (doneMaps.has(id) || !items.has(`map:${id}`)) continue;
      doneMaps.add(id);
      changed = true;
      for (const q of mapQuests(m)) if (data.questData[q]) quests.add(q);
      const rewards = values(m.baseReward);
      const essences = rewards.slice(0, rewards.length / 2);
      for (const e of essences) add("material", e);
      // asc-1 map (default.mapEssenceReward): each essence becomes its tier-2 version; ascending costs a tier-1 essence.
      if (items.has(`material:${PRESTIGE_ITEM_ID[1][regionOf(m.itemLevel) - 1]}`)) {
        for (const e of essences) {
          const i = PRESTIGE_ITEM_ID[1].indexOf(e);
          if (i >= 0) add("material", PRESTIGE_ITEM_ID[2][i]);
        }
      }
    }
  }
  return { quests, items };
}

interface Tables {
  reach: Reach[]; // by mask 0..3
}
const cache = new WeakMap<object, Tables>();

function tables(data: GameData): Tables {
  let t = cache.get(data.itemData);
  if (!t) {
    t = { reach: [0, 1, 2, 3].map((m) => reach(data, m)) };
    cache.set(data.itemData, t);
  }
  return t;
}

/** The smallest set of expansions under which `has(mask)` holds, or null if it holds with none. undefined: never. */
function minimalNeeds(has: (mask: number) => boolean): Expansion[] | null | undefined {
  if (has(0)) return null;
  // Both single expansions work: no single one is required (does not happen in the current data).
  if (has(F) && has(S)) return null;
  if (has(F)) return ["Frozen"];
  if (has(S)) return ["Scribe"];
  if (has(F | S)) return ["Frozen", "Scribe"];
  return undefined;
}

const union = (...lists: Expansion[][]): Expansion[] => EXPANSION_IDS.filter((x) => lists.some((l) => l.includes(x)));
const gate = (needs: Expansion[], kind: GateKind): ContentGate | null => (needs.length ? { needs, gate: kind } : null);

function itemNeeds(data: GameData, type: ItemKind, id: number): Expansion[] {
  const it = data.itemData[type]?.[id];
  if (!it) return [];
  const t = tables(data);
  const n = minimalNeeds((m) => t.reach[m].items.has(`${type}:${id}`));
  if (n !== undefined) return n ?? [];
  // No source in any setup: list headers (no recipe) stay ungated; the uncraftable level-70 maps get their crafter
  // and their ingredients' needs.
  const kinds = it.materialType ?? {};
  const inputs = it.crafterID ? entries(it.materialID).map(([k, m]) => itemNeeds(data, kinds[k] ?? "material", m)) : [];
  return union(it.crafterID === SCRIBE_CRAFTER || (type === "equipment" && it.locked) ? ["Scribe"] : [], ...inputs);
}

/**
 * Which expansions a piece of content needs, or null when the base game has it.
 * gate "access": the game blocks the feature itself (region, class, prestige, crafter, map-only quests, ascension).
 * gate "obtain": the thing exists for everyone but its only sources are behind an expansion (items).
 * Kinds: region / quest / enemy (quest id) / class / prestige (hero tier) / level (hero level) / crafter /
 * itemAscension (ascension level) / material / equipment / consumable / map / item (with extra.type).
 * Item kinds take extra.ascension: an ascended item also needs Scribe and its region's essence.
 */
export function contentExpansion(kind: ContentKind, id: number, extra: ContentExtra = {}, data: GameData = G): ContentGate | null {
  switch (kind) {
    case "region": {
      const x = data.default?.regionExpansions?.[id]; // default.regionExpansions (data.Default.lua:778-785)
      return x ? gate([x as Expansion], "access") : null;
    }
    case "quest":
    case "enemy": {
      const q = data.questData[id];
      if (!q) return null;
      const t = tables(data);
      const n = minimalNeeds((m) => t.reach[m].quests.has(id));
      if (n !== undefined) return gate(n ?? [], "access");
      // Never reachable (placeholders; 98, boss of the uncraftable map 32): region rule, plus Scribe if map-only.
      const region = contentExpansion("region", q.region, {}, data)?.needs ?? [];
      return gate(union(region, q.questType === MAP_ONLY_QUEST_TYPE ? ["Scribe"] : []), "access");
    }
    case "class":
      return id === FROZEN_CLASS ? gate(["Frozen"], "access") : null;
    case "prestige":
      return id >= FROZEN_PRESTIGE ? gate(["Frozen"], "access") : null;
    case "level": {
      // Tiers below FROZEN_PRESTIGE cap at their heroLevelRequirement length (50).
      const reqs = values(data.heroLevelRequirement);
      const cap = Math.max(0, ...reqs.slice(0, FROZEN_PRESTIGE - 1).map((r: Any) => values(r).length));
      return id > cap ? gate(["Frozen"], "access") : null;
    }
    case "crafter":
      return id === SCRIBE_CRAFTER ? gate(["Scribe"], "access") : null;
    case "itemAscension":
      return id > 0 ? gate(["Scribe"], "access") : null;
    case "item":
      if (!extra.type) throw new Error('contentExpansion("item") needs extra.type');
      return contentExpansion(extra.type, id, extra, data);
    case "material":
    case "equipment":
    case "consumable":
    case "map": {
      let needs = itemNeeds(data, kind, id);
      const asc = extra.ascension ?? 0;
      const it = data.itemData[kind]?.[id];
      if (asc > 0 && it) {
        const essence = PRESTIGE_ITEM_ID[asc]?.[regionOf(it.itemLevel) - 1];
        needs = union(needs, ["Scribe"], essence ? itemNeeds(data, "material", essence) : []);
      }
      return gate(needs, "obtain");
    }
  }
  return null;
}

/** All ids of an item type that need `expansion` (alone or with the other one). */
export function gatedItems(type: ItemKind, expansion: Expansion, data: GameData = G): number[] {
  return entries(data.itemData[type]).filter(([id]) => contentExpansion(type, id, {}, data)?.needs.includes(expansion)).map(([id]) => id);
}

/** All quest ids that need `expansion` (alone or with the other one). */
export function gatedQuests(expansion: Expansion, data: GameData = G): number[] {
  return entries(data.questData).filter(([id]) => contentExpansion("quest", id, {}, data)?.needs.includes(expansion)).map(([id]) => id);
}

// --- Inference from PlayerData.txt ---

export interface Evidence {
  /** "either": proves at least one expansion without saying which. */
  expansion: Expansion | "either";
  reason: string;
}
export interface InferredExpansions {
  owned: Set<Expansion>;
  /** At least one expansion is owned (true whenever owned is non-empty). */
  anyOwned: boolean;
  evidence: Evidence[];
}

/** Decoded save (decodeSaveText) or parsed Save (parseSave): only the raw tables are read. */
function rawOf(save: Any): Any {
  return save && typeof save === "object" && "raw" in save && save.raw && typeof save.raw === "object" ? save.raw : save ?? {};
}

/** Compact item string -> type, id and ascension (parseItem, web/src/tools/save.ts). */
function compactItem(s: unknown): { type: ItemKind; id: number; asc: number } | null {
  if (typeof s !== "string") return null;
  try {
    const it = parseItem(s);
    return typeof it.itemType === "string" && Number.isFinite(it.id) ? { type: it.itemType, id: it.id, asc: Number(it.prestigeLevel) || 0 } : null;
  } catch {
    return null;
  }
}

/**
 * Expansions a save proves it owns. Never proves the absence of one: a player may own an expansion and not use it.
 * Frozen: Bard hero, prestige 3 or level > 50, a hero standing in region 6, a remembered region-6 quest amount.
 * Scribe: crafter ascension fields (written only with Scribe), crafter 8, maps, ascended items, essences, 764-780.
 * Counts: > 13 heroes or > 96 gold-bought slots: at least one; > 15 heroes: Scribe; > 16 heroes: Frozen;
 * > 112 gold-bought slots: both.
 */
export function inferExpansions(save: Any, data: GameData = G): InferredExpansions {
  const raw = rawOf(save);
  const evidence: Evidence[] = [];
  const note = (expansion: Expansion | "either", reason: string) => {
    if (!evidence.some((e) => e.expansion === expansion && e.reason === reason)) evidence.push({ expansion, reason });
  };
  const heroes: Any[] = values(raw.hero);

  // Frozen
  if (heroes.some((h) => h?.class === FROZEN_CLASS)) note("Frozen", "has a Bard (class 9) hero");
  if (heroes.some((h) => (h?.prestigeLevel ?? 0) >= FROZEN_PRESTIGE)) note("Frozen", "a hero is at prestige 3");
  const levelGate = contentExpansion("level", 51, {}, data) ? 50 : Infinity;
  if (heroes.some((h) => (h?.level ?? 0) > levelGate)) note("Frozen", "a hero is above level 50");
  if (heroes.some((h) => contentExpansion("region", h?.region, {}, data)?.needs.includes("Frozen"))) note("Frozen", "a hero is in region 6 (Frentir)");
  const qa = raw.qAmounts;
  const qids: number[] = Array.isArray(qa) ? qa.flatMap((v, i) => (v != null ? [i + 1] : [])) : Object.keys(qa ?? {}).map(Number);
  const r6 = qids.filter((q) => {
    const quest = data.questData?.[q];
    return quest && quest.questType !== MAP_ONLY_QUEST_TYPE && contentExpansion("region", quest.region, {}, data)?.needs.includes("Frozen");
  });
  if (r6.length) note("Frozen", `quest amounts remembered for region-6 quests ${r6.join(", ")}`);

  // Scribe
  const crafters: Any[] = values(raw.crafter);
  if (crafters.some((c) => c && "ascLevel" in c)) note("Scribe", "crafters carry ascension fields (saved only with Scribe)");
  if (crafters.some((c) => c?.id === SCRIBE_CRAFTER)) note("Scribe", "has the Scribe crafter (8)");
  const pools: unknown[] = [...values(raw.inventory), ...values(raw.sales), ...heroes.flatMap((h) => values(h?.heroInventory))];
  const maps = values(raw.mapInventory).map(compactItem).filter((x) => x);
  if (maps.length) note("Scribe", `owns ${maps.length} map(s)`);
  for (const it of [...pools.map(compactItem), ...maps]) {
    if (!it) continue;
    const info = data.itemData?.[it.type]?.[it.id];
    if (it.asc > 0) note("Scribe", "owns ascended items");
    if (it.type === "material" && info?.subType === "essence") note("Scribe", "owns essences");
    if (it.type === "equipment" && info?.locked) note("Scribe", "owns a Scribe-locked recipe item (764-780)");
  }

  // Counts
  const n = heroes.length;
  if (n > HERO_SLOTS.base + HERO_SLOTS.Frozen + HERO_SLOTS.Scribe - HERO_SLOTS.Frozen) note("Frozen", `${n} heroes (Scribe alone allows ${HERO_SLOTS.base + HERO_SLOTS.Scribe})`);
  if (n > HERO_SLOTS.base + HERO_SLOTS.Frozen) note("Scribe", `${n} heroes (Frozen alone allows ${HERO_SLOTS.base + HERO_SLOTS.Frozen})`);
  if (n > HERO_SLOTS.base) note("either", `${n} heroes (the base game allows ${HERO_SLOTS.base})`);
  const bought = Number(raw.inventorySlotsBought) || 0;
  if (bought > GOLD_SLOTS.one) {
    note("Frozen", `${bought} gold-bought inventory slots (one expansion allows ${GOLD_SLOTS.one})`);
    note("Scribe", `${bought} gold-bought inventory slots (one expansion allows ${GOLD_SLOTS.one})`);
  } else if (bought > GOLD_SLOTS.none) note("either", `${bought} gold-bought inventory slots (the base game allows ${GOLD_SLOTS.none})`);

  const owned = new Set(EXPANSION_IDS.filter((x) => evidence.some((e) => e.expansion === x)));
  return { owned, anyOwned: owned.size > 0 || evidence.some((e) => e.expansion === "either"), evidence };
}

export type ExpansionOverrides = Partial<Record<Expansion, boolean | null | undefined>>;

/** Inferred ownership with the user's manual toggles on top (true/false override, null/undefined keeps the inference). */
export function effectiveExpansions(inferred: InferredExpansions | Set<Expansion> | Iterable<Expansion>, overrides: ExpansionOverrides = {}): Set<Expansion> {
  const base = inferred instanceof Set ? inferred : "owned" in (inferred as Any) ? (inferred as InferredExpansions).owned : new Set(inferred as Iterable<Expansion>);
  const out = new Set<Expansion>();
  for (const x of EXPANSION_IDS) {
    const o = overrides[x];
    if (o === true || (o == null && base.has(x))) out.add(x);
  }
  return out;
}
