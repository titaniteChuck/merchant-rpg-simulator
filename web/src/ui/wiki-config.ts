/**
 * U49: the configuration of a wiki details page: the ascension, prefix and suffix an item or map is shown with, kept
 * in the hash route's query (`#/map/22?asc=1&prefix=20&suffix=5`, `#/item/equipment/5?suffix=3`). No configuration
 * (asc 0, no prefix, no suffix) is the clean URL. Pure lookups on G and the engine (node tests import them).
 *
 * Which object takes what (docs/game-economy: ascension, crafting, maps):
 * - Ascension: equipment and consumables 0–2, maps 0–1, materials none; an item with lockPrestige 0 only
 *   (wiki-items itemAscLevels).
 * - Prefix and suffix: equipment and maps, from a craft roll or the Enchanter. The Enchanter's prefix pool depends on
 *   its own level and the item's grade (obj.Enchant enchantPrefix: effective level = enchanter level + 5 + 2 × grade,
 *   8 to 75), not on the item's level, so every prefix can end up on any enchantable item. Suffixes step +1 … +16,
 *   then *1 … *8 on asc-1 items, **1 … **8 on asc-2 items (tools/enchant maxSuffixFor; an asc-2 item keeps the *N of
 *   the asc-1 item it was upgraded from). Trinkets (slot 6) take no suffix; Worn items carry their fixed "Worn" suffix
 *   and take nothing else; items above level 60 (the level-70 maps) have no rune or gem, so no modifier.
 *
 * Figures: computed by the engine (sim/map GameMap, sim/enemy Enemy, sim/defaults mapEssenceReward and consumableStat,
 * sim/equipment Item:applyPrefix / applySuffix, tools/engine sellValue and rarity), never by a formula of the page.
 */
import * as api from "../sim/api.ts";
import { determineMapWalkTime } from "../sim/campaign.ts";
import { G } from "../sim/data.ts";
import { consumableStat, mapEssenceReward } from "../sim/defaults.ts";
import { Enemy } from "../sim/enemy.ts";
import { band, maxSuffixFor, PREFIX_GEM } from "../tools/enchant.ts";
import { rarity as rarityAfter, sellValue } from "../tools/engine.ts";
import { bonusText, game, itemAscLevels, totalCost } from "./wiki-items.ts";
import { maxQuestAmount } from "../tools/combat.ts";
import { isBoardQuest, mapRunStats, mapsWithQuest, questStats, TREASURE_CHANCE, TREASURE_IDS } from "../tools/quest-stats.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** A details page's configuration: ascension, prefix id (0 none), suffix id (0 none). */
export interface ItemConfig {
  asc: number;
  prefix: number;
  suffix: number;
}
export const NO_CONFIG: Readonly<ItemConfig> = Object.freeze({ asc: 0, prefix: 0, suffix: 0 });

/** The item types whose details pages take a configuration. */
export const CONFIG_TYPES = new Set(["equipment", "consumable", "map"]);

const itemOf = (type: string, id: number): Any => G.itemData?.[type]?.[id];
const sortedIds = (table: Any): number[] => Object.keys(table ?? {}).map(Number).filter((n) => n > 0).sort((a, b) => a - b);

// ---------------------------------------------------------------- what an item can carry
/** Ascension levels an item exists at (equipment and consumables 0–2, maps 0–1; materials and locked items 0). */
export function validAscs(type: string, id: number): number[] {
  if (!CONFIG_TYPES.has(type)) return itemOf(type, id) ? [0] : [];
  return itemAscLevels(type, id);
}

/** Whether an item can carry a prefix or suffix: equipment or a map, up to level 60 (a gem / rune band), not Worn. */
export function takesModifiers(type: string, id: number): boolean {
  const it = itemOf(type, id);
  if (!it || (type !== "equipment" && type !== "map")) return false;
  if (band(PREFIX_GEM, it.itemLevel ?? 0) === undefined) return false;
  return !(type === "equipment" && String(it.name ?? "").includes("Worn"));
}

/** Prefix ids an item can carry (every prefix for an enchantable item; none otherwise). */
export function validPrefixes(type: string, id: number): number[] {
  return takesModifiers(type, id) ? sortedIds(G.prefixList) : [];
}

/** Suffix ids an item can carry at an ascension: +1 up to the Enchanter's top for it (none on a trinket). */
export function validSuffixes(type: string, id: number, asc = 0): number[] {
  if (!takesModifiers(type, id) || !validAscs(type, id).includes(asc)) return [];
  if (type === "equipment" && itemOf(type, id).itemSlot === 6) return [];
  const top = maxSuffixFor(game(), asc);
  return sortedIds(G.suffixList).filter((n) => n <= top);
}

/** Whether a page shows any selector at all (more than one ascension, or modifiers). */
export function isConfigurable(type: string, id: number): boolean {
  return validAscs(type, id).length > 1 || takesModifiers(type, id);
}

/** A configuration with every value the item can't take reset to none (an unknown suffix after an ascension change…). */
export function normaliseConfig(type: string, id: number, cfg: Partial<ItemConfig> = {}): ItemConfig {
  const int = (v: unknown) => (Number.isInteger(Number(v)) ? Number(v) : 0);
  const asc = validAscs(type, id).includes(int(cfg.asc)) ? int(cfg.asc) : 0;
  const prefix = validPrefixes(type, id).includes(int(cfg.prefix)) ? int(cfg.prefix) : 0;
  const suffix = validSuffixes(type, id, asc).includes(int(cfg.suffix)) ? int(cfg.suffix) : 0;
  return { asc, prefix, suffix };
}

export const isPlain = (cfg: ItemConfig): boolean => !cfg.asc && !cfg.prefix && !cfg.suffix;
/** How many modifiers the configuration has (0–2): the rarity steps and sell value follow it. */
export const modCount = (cfg: ItemConfig): number => Number(cfg.prefix > 0) + Number(cfg.suffix > 0);

// ---------------------------------------------------------------- URL
/** The query of a configuration: "" when plain, else "?asc=1&prefix=20&suffix=5" (only the values set). */
export function configQuery(cfg: Partial<ItemConfig> = {}): string {
  const parts = (["asc", "prefix", "suffix"] as const).filter((k) => Number(cfg[k]) > 0).map((k) => `${k}=${Number(cfg[k])}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** A query string or URLSearchParams read into a configuration valid for the item. */
export function parseConfig(type: string, id: number, query: URLSearchParams | string = ""): ItemConfig {
  const q = typeof query === "string" ? new URLSearchParams(query.replace(/^\?/, "")) : query;
  return normaliseConfig(type, id, { asc: Number(q.get("asc") ?? 0), prefix: Number(q.get("prefix") ?? 0), suffix: Number(q.get("suffix") ?? 0) });
}

/** The wiki route of an item's details page: "#/map/22", "#/item/equipment/5". */
export const detailRoute = (type: string, id: number): string => `#/${type === "map" ? "map" : `item/${type}`}/${id}`;

/** A route with the configuration's query; values the item can't take are left out. */
export function configRoute(type: string, id: number, cfg?: Partial<ItemConfig>): string {
  return detailRoute(type, id) + (cfg && CONFIG_TYPES.has(type) ? configQuery(normaliseConfig(type, id, cfg)) : "");
}

/** The link to an item's wiki page with a configuration (the save viewer's maps and items). */
export const configHref = (type: string, id: number, cfg?: Partial<ItemConfig>): string => `wiki.html${configRoute(type, id, cfg)}`;

/**
 * A wiki hash split into its route parts (decoded) and its query: "#/map/22?asc=1" → { parts: ["map", "22"], query }.
 * The query starts at the first literal "?" (names in a route are encoded, so theirs is %3F).
 */
export function parseHash(hash: string): { parts: string[]; query: URLSearchParams } {
  const raw = hash.replace(/^#\/?/, "");
  const at = raw.indexOf("?");
  const path = at < 0 ? raw : raw.slice(0, at);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch { /* a malformed escape: as typed */ }
  return { parts: decoded.split("/").filter(Boolean), query: new URLSearchParams(at < 0 ? "" : raw.slice(at + 1)) };
}

// ---------------------------------------------------------------- labels
/** The game's prefix name, English (the page translates it: names.ts prefixTag). */
const prefixData = (p: number): Any => G.prefixList?.[p];
const suffixData = (s: number): Any => G.suffixList?.[s];
const signed = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(Math.round(v * 1000) / 1000)}`;
const times = (v: number) => `×${Math.round(v * 1000) / 1000}`;

/** Enemy stat a map's prefix bonus raises (sim/enemy bonusMapStats, sim/defaults mapPercentStats). */
const MAP_STAT_LABEL: Record<string, string> = {
  hpBns: "HP", atkBns: "Atk", matkBns: "Matk", defBns: "Def", mdefBns: "Mdef", accBns: "Eva",
  hpPct: "HP", atkPct: "Atk", matkPct: "Matk", defPct: "Def", mdefPct: "Mdef", accPct: "Eva",
};

/** One of a map prefix's stats as text ("enemy HP +240", "treasure luck +2", "Enemy × +1"). */
export function mapStatText(key: string, v: number): string {
  if (key.endsWith("Pct")) return `enemy ${MAP_STAT_LABEL[key] ?? key} +${Math.round(v * 1000) / 10}%`;
  if (MAP_STAT_LABEL[key]) return `enemy ${MAP_STAT_LABEL[key]} ${signed(v)}`;
  if (key === "lckMod") return `treasure luck ${signed(v)}`;
  if (key === "speed") return `speed ${signed(v)}`;
  if (key === "enemyMod") return `Enemy × ${signed(v)}`;
  if (key === "essenceMod") return `essence ${times(v)}`;
  return `${key} ${signed(v)}`;
}

/** What a prefix does on this item: map stats (scaled by the map's tier, as the engine applies them) or item stats. */
export function prefixEffect(type: string, id: number, p: number): string {
  const d = prefixData(p);
  if (!d) return "";
  if (type === "map") {
    const v = mapView(id, { asc: 0, prefix: p, suffix: 0 });
    if (!v) return "";
    const parts = Object.keys(d.mapStats ?? {}).filter((k) => k !== "essenceMod")
      .map((k) => mapStatText(k, v.prefixStats[k] ?? d.mapStats[k]));
    return [`essence ${times(v.essenceBase)}`, ...parts].join(", ");
  }
  return Object.entries<number>(d.stats ?? {}).map(([k, val]) => bonusText(k, val)).filter(Boolean).join(", ");
}

/** What a suffix does on this item: maps ×(1 + atk) essence and Enemy ×; equipment raises its base stats. */
export function suffixEffect(type: string, s: number): string {
  const d = suffixData(s);
  if (!d) return "";
  const atk = d.stats?.atk ?? 0;
  if (type === "map") return `essence and Enemy × ${times(1 + atk)}`;
  return `base Atk, Matk, Acc, Def, Mdef ${signed(Math.round(atk * 100))}%`;
}

// ---------------------------------------------------------------- figures: maps
export interface MapView {
  /** Rarity after the modifiers (Map:applyPrefix / applySuffix). */
  rarity: number;
  /** Enemy multiplier at grade C (no grade bonus): asc, suffix and a prefix's enemy modifier included (mapEnemyMod). */
  enemyMod: number;
  /** essenceBase after the modifiers (prefix sell, suffix atk, a prefix's essence modifier). */
  essenceBase: number;
  /** Essence of one run at grade C, no party luck: [essence id, amount] (default.mapEssenceReward). */
  essence: [number, number][];
  /** The run's map stats (default.finalMapMod): what the room enemies get. */
  stats: Any;
  /** The prefix's map stats as the map applied them (bonuses scaled by the map's tier). */
  prefixStats: Record<string, number>;
  /** Sell value (tools/engine sellValue with the ascension and modifier count), null when unknown. */
  sell: number | null;
  /** U53: the run's base (walk) time in seconds with the prefix's speed, no party speed (mapBaseTime); null without one. */
  baseTime: number | null;
}

/** A battle with no hero speed: what the walk time takes from the party (questService applyTimeMods). */
const NO_PARTY_SPEED = { getSumOfStat: () => 0 } as unknown as Parameters<typeof determineMapWalkTime>[0];

/**
 * U53: a map run's base time with a speed prefix (Quick +4, Swift +8: data.PrefixData mapStats.speed). The game splits
 * the map's baseMapTime over the rooms and the boss as walk time, each walk × questTimeMod × (1 − min((party speed +
 * map speed) / 100, 0.75)) (obj.combat.Campaign, questService.determineMapWalkTime); the fights get the same factor
 * on their own time. Here the whole base time at once (the per-room rounding aside), no party speed, through the
 * engine's determineMapWalkTime. Null when the map has no base time.
 */
export function mapBaseTime(baseTime: number | undefined, speed = 0): number | null {
  if (!baseTime) return null;
  return determineMapWalkTime(NO_PARTY_SPEED, baseTime, speed);
}

/** The map built by the engine with a configuration, at a map grade (default 3); null when the engine can't (unknown map). */
function buildMap(id: number, cfg: ItemConfig, grade = 3): Any | null {
  // The seed only draws the rooms (none of these figures); a level-70 map's room draw can crash (its missing treasure
  // tier, docs maps.md), so a few seeds are tried.
  let map: Any = null;
  for (let seed = 1; seed <= 8 && !map; seed++) {
    try {
      map = api.makeMap({ id, prestigeLevel: cfg.asc, grade, prefix: cfg.prefix || undefined, suffix: cfg.suffix || undefined, seed });
    } catch {
      if (!itemOf("map", id)) return null;
    }
  }
  return map;
}

/** Essence of one run of a built map at `grade`, no party luck: [essence id, amount] (default.mapEssenceReward). */
function runEssence(id: number, asc: number, grade: number, map: Any): [number, number][] {
  try {
    return mapEssenceReward(id, asc, grade, map.finalMapStats, 0).map((e: Any) => [e.id, e.amount] as [number, number]);
  } catch {
    return [];
  }
}

/**
 * Essence one run of a map gives with a configuration, at a grade (default C), no party luck: [essence id, amount].
 * The engine's figure (default.finalMapMod, then mapEssenceReward), so every modifier counts: the prefix's sell and
 * the suffix's atk on essenceBase, and a prefix's essence modifier (Skilled × 1.25, Expert's × 1.5, data.PrefixData
 * mapStats.essenceMod). The wiki map page and the save viewer's maps table both use it.
 */
export function mapRunEssence(id: number, cfg: ItemConfig, grade = 3): [number, number][] {
  const map = buildMap(id, cfg);
  return map ? runEssence(id, cfg.asc, grade, map) : [];
}

/**
 * The map built by the engine with a configuration, at a map grade (default 3, the wiki's map figures; U60: an enemy
 * page's grade for a map-only enemy); null when the engine can't (unknown map).
 */
export function mapView(id: number, cfg: ItemConfig, grade = 3): MapView | null {
  const map = buildMap(id, cfg, grade);
  if (!map) return null;
  const prefixStats: Record<string, number> = {};
  for (const k of Object.keys(prefixData(cfg.prefix)?.mapStats ?? {})) {
    if (typeof map.mapStats[k] === "number") prefixStats[k] = map.mapStats[k];
  }
  let sell: number | null = null;
  try {
    sell = sellValue("map", id, cfg.asc, modCount(cfg)) ?? null;
  } catch { /* unknown */ }
  const essence = runEssence(id, cfg.asc, grade, map);
  const baseTime = mapBaseTime(map.baseTime, map.finalMapStats.speed ?? 0);
  return { rarity: map.rarity, enemyMod: map.enemyMod, essenceBase: map.finalMapStats.essenceBase ?? 1, essence, stats: map.finalMapStats, prefixStats, sell, baseTime };
}

/** [engine stat, table label] of a map's enemy rows. */
export const MAP_ENEMY_STATS: [string, string][] = [["maxHP", "HP"], ["atk", "Atk"], ["matk", "Matk"], ["def", "Def"], ["mdef", "Mdef"], ["eva", "Eva"]];

/**
 * An enemy's stats inside a map (sim/enemy Enemy:determineStats with the run's map stats: (base + prefix bonus) ×
 * the map multiplier × prefix %), by table label; null when the engine can't build it.
 */
export function mapEnemyStats(questId: number, rare: boolean, stats: Any): Record<string, number> | null {
  if (!stats) return null;
  try {
    const e: Any = new Enemy({ questID: questId, isRare: rare, mapStats: stats, amount: 1 });
    return Object.fromEntries(MAP_ENEMY_STATS.map(([k, label]) => [label, e[k]]));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- U60: an enemy page's grade and quest size
/**
 * An enemy page's modifiers (U60): the battle grade (1..5 = D..S, as the wiki's grade badges) and the quest size ×N
 * (the game's enemyAmount). Kept in the route's query like a map's (`#/enemy/12?grade=4&size=3`); grade 3 (B) and
 * size 1 are the clean URL.
 */
export interface EnemyConfig {
  grade: number;
  size: number;
}
export const ENEMY_DEFAULT: Readonly<EnemyConfig> = Object.freeze({ grade: 3, size: 1 });

/**
 * Grades an enemy page offers: D..S; a Treasure Bush only B..S (it appears only in a map run of grade B or better:
 * obj.Map treasurePerRoomPerGradeChance is 0 at grades 1 and 2).
 */
export function enemyGrades(id: number): number[] {
  return TREASURE_IDS.includes(id) ? [1, 2, 3, 4, 5].filter((g) => (TREASURE_CHANCE[g] ?? 0) > 0) : [1, 2, 3, 4, 5];
}

/**
 * Quest sizes an enemy page offers: a quest-board quest ×1 up to the game's cap for a hero of tier `maxTier`
 * (default.enemyAmount = tier × 2 − 1: ×3 at tier 2, ×5 at tier 3; questService.getCurrentAndMaxAmount, any size in
 * between); a map-only enemy ×1 (a map room is one enemy).
 */
export function enemySizes(id: number, maxTier = 3, mode = "Standard"): number[] {
  if (!isBoardQuest(id)) return [1];
  const top = maxQuestAmount([{ prestigeLevel: maxTier } as never], false, mode);
  return Array.from({ length: Math.max(1, top) }, (_, i) => i + 1);
}

/** An enemy configuration with any value the enemy can't take back to its default. */
export function normaliseEnemyConfig(id: number, cfg: Partial<EnemyConfig> = {}): EnemyConfig {
  const int = (v: unknown) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
  return {
    grade: enemyGrades(id).includes(int(cfg.grade)) ? int(cfg.grade) : ENEMY_DEFAULT.grade,
    size: enemySizes(id).includes(int(cfg.size)) ? int(cfg.size) : ENEMY_DEFAULT.size,
  };
}

/** The query of an enemy configuration: "" at the defaults, else "?grade=4&size=3" (only the values not default). */
export function enemyConfigQuery(cfg: Partial<EnemyConfig> = {}): string {
  const parts = (["grade", "size"] as const).filter((k) => cfg[k] !== undefined && Number(cfg[k]) !== ENEMY_DEFAULT[k]).map((k) => `${k}=${Number(cfg[k])}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** A query read into a configuration valid for the enemy. */
export function parseEnemyConfig(id: number, query: URLSearchParams | string = ""): EnemyConfig {
  const q = typeof query === "string" ? new URLSearchParams(query.replace(/^\?/, "")) : query;
  return normaliseEnemyConfig(id, { grade: Number(q.get("grade") ?? ENEMY_DEFAULT.grade), size: Number(q.get("size") ?? ENEMY_DEFAULT.size) });
}

/** The route of an enemy page with its configuration ("#/enemy/12?grade=4&size=3"); values it can't take left out. */
export const enemyRoute = (id: number, cfg?: Partial<EnemyConfig>): string =>
  `#/enemy/${id}${cfg ? enemyConfigQuery(normaliseEnemyConfig(id, cfg)) : ""}`;

/**
 * A quest enemy's stats at a quest size, by table label: the engine's Enemy (sim/enemy determineStats: max HP × the
 * amount, the other stats unchanged; questData × default.enemyMods). The rare variant is always ×1
 * (questService.getCurrentAndMaxAmount). Null when the engine can't build it.
 */
export function questEnemyStats(questId: number, rare: boolean, size = 1): Record<string, number> | null {
  try {
    const e: Any = new Enemy({ questID: questId, isRare: rare, amount: rare ? 1 : size });
    return Object.fromEntries(MAP_ENEMY_STATS.map(([k, label]) => [label, e[k]]));
  } catch {
    return null;
  }
}

/** What fighting an enemy once costs and gives: gold paid, seconds (no fight), XP for the whole party, XP per minute. */
export interface EnemyRun {
  cost: number | null;
  seconds: number;
  xp: number;
  xpPerMin: number;
}

/**
 * A quest-board quest at a grade and size (tools/quest-stats questStats, one hero so the XP is the party's whole share):
 * cost = the quest's gold × size (rare: goldB, ×1; scene.QuestDescriptionOverlay), time = quest time × size ×
 * gradeTime[grade] without the fight, XP = exp × size.
 */
export function questRun(questId: number, rare: boolean, cfg: EnemyConfig): EnemyRun {
  const q = G.questData[questId];
  const s = questStats(questId, { grade: cfg.grade, amount: rare ? 1 : cfg.size, heroes: 1, rare });
  const cost = rare ? q.goldB ?? q.gold ?? 0 : (q.gold ?? 0) * s.amount;
  return { cost, seconds: s.seconds, xp: s.xpPerHero, xpPerMin: s.xpPerMin };
}

/**
 * One run of a map at a grade (tools/quest-stats mapRunStats, one hero: every room's XP): cost = the map's total cost
 * (wiki-items totalCost, asc 0), time = craft + walk (the fights add to it), XP = the whole run with every room won.
 */
export function mapRun(map: number, grade: number): EnemyRun {
  const s = mapRunStats(map, { grade, asc: 0, heroes: 1 });
  return { cost: totalCost("map", map, 0), seconds: s.seconds, xp: s.xpPerHero, xpPerMin: s.xpPerMin };
}

const ROLE_RANK: Record<string, number> = { boss: 0, room: 1, treasure: 2 };

/**
 * U60: the one map a map-only enemy's page takes its cost, time and XP from: among the craftable maps that fight it at
 * the grade (`visible`: the maps the visitor's expansions show), the ones where it is the boss first (its own map),
 * then the cheapest (total cost), then the lowest id. `of`: how many maps fight it. Null when none does.
 */
export function enemyRunMap(questId: number, grade: number, visible: (map: number) => boolean = () => true): { map: number; role: string; of: number } | null {
  const all = mapsWithQuest(questId, grade).filter((a) => visible(a.map));
  if (!all.length) return null;
  const cost = (m: number) => totalCost("map", m, 0) ?? Infinity;
  const best = [...all].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || cost(a.map) - cost(b.map) || a.map - b.map)[0];
  return { map: best.map, role: best.role, of: new Set(all.map((a) => a.map)).size };
}

// ---------------------------------------------------------------- figures: equipment and consumables
/**
 * A freshly crafted item (crafter level 60, seed 1: tools' makeItem) at a grade and ascension, then its prefix and suffix
 * applied as the game does after a craft or an enchant (Item:applyPrefix / applySuffix with isNew: the prefix adds its
 * stats, the suffix scales the base stats it names). The same base roll with or without modifiers. Null on an error.
 */
export function equipmentAt(id: number, grade: number, cfg: ItemConfig): Any | null {
  try {
    const made: Any = api.makeItem(id, grade, cfg.asc, 60, 1);
    if (cfg.prefix) {
      made.prefix = cfg.prefix;
      made.applyPrefix(true);
    }
    if (cfg.suffix) {
      made.suffix = cfg.suffix;
      made.applySuffix(true);
    }
    return made;
  } catch {
    return null;
  }
}

/** The stats a prefix adds to an item ({ atkBns: 2 }). */
export const prefixStats = (p: number): Record<string, number> => ({ ...(prefixData(p)?.stats ?? {}) });

/** Rarity of an item with the configuration's modifiers (tools/engine rarity). */
export const configRarity = (type: string, id: number, cfg: ItemConfig): number | null => {
  try {
    return rarityAfter(type, id, modCount(cfg));
  } catch {
    return null;
  }
};

/** Sell value of one at an ascension with the configuration's modifiers, null when unknown. */
export function configSell(type: string, id: number, asc: number, cfg: ItemConfig): number | null {
  try {
    return sellValue(type, id, asc, modCount(cfg)) ?? null;
  } catch {
    return null;
  }
}

/** A consumable's stats at an ascension (default.consumableStat: potions and scrolls scale with it). */
export function consumableStatsAt(id: number, asc: number): Record<string, number> {
  try {
    return { ...(consumableStat(id, asc) ?? {}) };
  } catch {
    return { ...(itemOf("consumable", id)?.stat ?? {}) };
  }
}

/** [essence id, amount] one ascended craft needs on top of the recipe at that ascension (gamedata essenceForAscension). */
export function ascCraftEssence(type: string, id: number, asc: number): [number, number] | null {
  if (!asc) return null;
  try {
    const [eid, amount] = game().essenceForAscension(type, id, asc, false);
    return typeof eid === "number" && amount ? [eid, amount] : null;
  } catch {
    return null;
  }
}
