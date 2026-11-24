/**
 * What the wiki knows about skills, passives, items, maps and classes: summaries (tooltips, list pages),
 * cross-references (who uses a skill, recipes, drops) and links to wiki.html. Game numbers come from
 * data/gamedata.json (loaded into G), texts from data/wikidata.json.
 */
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { ascLevel, ascText, el, expansionBadge, expansionNote, fmt, withAsc } from "./dom.ts";
import { type ContentKind, isVisible, needsOf, placeholderFor } from "./expansion-state.ts";
import { tip } from "./tooltip.ts";
import { bonusPair, bonusText, isPlaceholder } from "./wiki-items.ts";
import { BASE_GRADE, lootTable } from "./wiki-loot.ts";
import {
  className, compareNames, descOf, enemyName, isEnglish, itemName, markName, passiveName, questTitle, regionName, skillName,
} from "./names.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface WikiText {
  skills: Record<string, string>;
  items: Record<string, Record<string, string[]>>;
  classes: Record<string, string[]>;
}
let text: WikiText = { skills: {}, items: {}, classes: {} };
let textReady: Promise<void> | null = null;

/** Load data/wikidata.json once (tooltips work without it, with numbers only). */
export function loadWikiText(): Promise<void> {
  textReady ??= fetch("data/wikidata.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j) text = j;
  }).catch(() => undefined);
  return textReady;
}

export const ITEM_TYPES = ["equipment", "consumable", "material", "map"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const SLOT_NAMES: Record<number, string> = { 1: "Weapon", 2: "Head", 3: "Body", 4: "Hands", 5: "Feet", 6: "Trinket" };
export const GRADES = ["D", "C", "B", "A", "S"];

// ---------------------------------------------------------------- stats
const STAT_NAMES: Record<string, string> = {
  hp: "HP", maxHP: "max HP", atk: "Atk", matk: "Matk", acc: "Acc", def: "Def", mdef: "Mdef", eva: "Eva", crit: "Crit",
  critMod: "crit damage", speed: "speed", expMod: "XP", lckMod: "luck", str: "Str", int: "Int", dex: "Dex",
  apMod: "AP", charges: "charges", hpBns: "HP", atkBns: "Atk", matkBns: "Matk", accBns: "Acc", critBns: "Crit",
  defBns: "Def", mdefBns: "Mdef",
};

/**
 * "+25% HP", "+12 Crit", "+1 Acc per level", "+35% crit damage". An equipment bonus stat is a range { 1: min, 2: max }
 * (data.EquipmentData bonusStat), not a number: it reads "+20–25 Str" (U19: it used to print "+NaN Str").
 */
export function statText(key: string, v: number | unknown): string {
  if (typeof v !== "number") return bonusPair(v) ? bonusText(key, v) : "";
  const sign = v < 0 ? "−" : "+";
  const a = Math.abs(v);
  if (key.endsWith("Pct")) return `${sign}${fmt.format(a * 100)}% ${STAT_NAMES[key.slice(0, -3)] ?? key.slice(0, -3)}`;
  if (key === "critMod") return `${sign}${fmt.format(a * 100)}% crit damage`;
  if (key.endsWith("Plv")) return `${sign}${a} ${STAT_NAMES[key.slice(0, -3)] ?? key.slice(0, -3)} per level`;
  if (key === "expMod" || key === "lckMod") return `${sign}${fmt.format(a)}${key === "expMod" ? "%" : ""} ${STAT_NAMES[key]}`;
  return `${sign}${fmt.format(a)} ${STAT_NAMES[key] ?? key}`;
}
const statsText = (stats: Any) => Object.entries<number>(stats ?? {}).map(([k, v]) => statText(k, v)).filter(Boolean).join(", ");

// ---------------------------------------------------------------- lookups
export const item = (type: string, id: number | string): Any => G.itemData?.[type]?.[id];
export const itemTypeLabel: Record<string, string> = { equipment: "Equipment", consumable: "Consumable", material: "Material", map: "Map" };

/** [id, entry] of an item table, in id order; the game's unused placeholder rows left out (isPlaceholder). */
export function items(type: string): [number, Any][] {
  return Object.entries<Any>(G.itemData?.[type] ?? {}).filter(([, v]) => v?.name && !isPlaceholder(type, v)).map(([k, v]) => [Number(k), v] as [number, Any])
    .sort((a, b) => a[0] - b[0]);
}

/** Skill keys (English names), in the alphabetical order of their names in the visitor's language (U29). */
export const skillNames = (): string[] => Object.keys(G.abilityData ?? {}).sort((a, b) => compareNames(skillName(a), skillName(b)) || a.localeCompare(b));
export const passiveNames = (): string[] => Object.keys(G.passiveData ?? {}).filter((p) => p !== "None")
  .sort((a, b) => compareNames(passiveName(a), passiveName(b)) || a.localeCompare(b));
export const classes = (): [number, Any][] =>
  Object.entries<Any>(G.heroList ?? {}).filter(([, v]) => v?.name).map(([k, v]) => [Number(k), v] as [number, Any]).sort((a, b) => a[0] - b[0]);
export const quest = (id: number | string): Any => G.questData?.[id];

/** Classes that can learn a skill / take a passive. */
export function classesWith(kind: "skill" | "passive", name: string): [number, Any][] {
  return classes().filter(([, c]) => seq<string>(kind === "skill" ? c.skillList : c.passiveList).includes(name));
}

/**
 * Quest ids that are not enemies at all, so the wiki never lists them (Enemies list, "enemies with this skill", enemy
 * links, map roles): the placeholders, nickname "MissNo", title "Placeholder", dummy stats (9999 HP, 999 Atk, level 99
 * or 50). Unused slots the game skips itself (data.OrderData: `nickname ~= "MissNo"`). 39–41 "Region 4 Other",
 * 58–60 "Region 5", 75 "Weekly 15", 76 "Region 6". Static on purpose (the data has no "is an enemy" flag); no map's
 * room or boss list holds any of them. test/wiki-data.test.ts fails if a new "MissNo" quest appears.
 */
export const PLACEHOLDER_QUEST_IDS = new Set<number>([39, 40, 41, 58, 59, 60, 75, 76]);

/**
 * The quest bushes (gathering quests, questType 1, nickname "Gathering"): the first battle of each region's quest
 * board, fought on their own like any quest; no attack (enemyAtk / Matk 0), they drop mosses and roots for potions.
 * 1 Forest (Tuvale, level 1), 11 Yarsol (10), 21 Aldur (20), 30 Vulkrum (30), 42 Grimhal (40), 77 Hoarfrost (Frentir,
 * 51). Until U28 they were left out of the wiki with the placeholders; they are enemies again, labelled "Quest bush".
 * Not to be mixed with the map Treasure Bushes 99–104 (isTreasureBush), which hide in map rooms.
 */
export const isGathering = (id: number): boolean => quest(id)?.questType === 1;

/** A quest that is a battle: named and not a placeholder (quest bushes included). */
export const isEnemy = (id: number): boolean => !PLACEHOLDER_QUEST_IDS.has(id) && !!quest(id)?.name;
/** Quest ids of every enemy, in id order. */
export const enemyIds = (): number[] => Object.keys(G.questData ?? {}).map(Number).filter(isEnemy).sort((a, b) => a - b);
/** The quest has a rare variant with its own stats (nameB, enemyHpB…). */
export const hasRare = (id: number): boolean => !!quest(id)?.nameB && quest(id)?.enemyHpB !== undefined;
/**
 * The kind of battle (the Enemies list's Kind column): "Quest bush" (gathering quests), "Map treasure bush" (99–104),
 * "Event boss" (questType 6, the game's "Epic Boss"), "Map boss" (questType 8), else the game's title ("Boss",
 * "Party Boss") or "Quest".
 */
export const enemyKind = (id: number): string => {
  const q = quest(id);
  if (!q) return "Quest";
  if (q.questType === 1) return "Quest bush";
  if (TREASURE_IDS.includes(id)) return "Map treasure bush";
  if (q.questType === 6) return "Event boss";
  if (q.questType === 8) return "Map boss";
  return questTitle(id) || "Quest"; // the game's title ("Boss", "Party Boss"), in the visitor's language
};

/** Enemies (and their rare variant) that use a skill; gathering quests and placeholders left out. */
export function enemiesWith(skill: string): { id: number; name: string; rare: boolean }[] {
  const out: { id: number; name: string; rare: boolean }[] = [];
  for (const id of enemyIds()) {
    const q = quest(id);
    if (seq<string>(q.attackList ?? {}).includes(skill)) out.push({ id, name: enemyName(id) ?? q.name, rare: false });
    if (q.nameB && seq<string>(q.attackListB ?? {}).includes(skill)) out.push({ id, name: enemyName(id, true) ?? q.nameB, rare: true });
  }
  return out;
}

/** One entry per distinct enemy name (a quest reused under the same name counts once), in quest order. */
export function enemyNamesWith(skill: string): { id: number; name: string; rare: boolean }[] {
  const seen = new Set<string>();
  return enemiesWith(skill).filter((e) => {
    const k = `${e.name}|${e.rare}`;
    if (!e.name || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Treasure Bush quest per map level band (obj.Map: treasureId[ceil(levelReq / 10)]); it hides in a room at grade B or
 * better (treasurePerRoomPerGradeChance: 1% / 8% / 10% per room at B / A / S).
 */
const TREASURE_IDS = [99, 100, 101, 102, 103, 104];
export const treasureBushOf = (mapLevel: number): number | undefined => TREASURE_IDS[Math.ceil(mapLevel / 10) - 1];
export const isTreasureBush = (questId: number): boolean => TREASURE_IDS.includes(questId);

/**
 * The maps a Treasure Bush spawns in, lowest level first: every map whose level band picks it (obj.Map:generateTreasure,
 * treasureId[ceil(levelReq / 10)], inserted at a random room position). Bush 99 = maps of level 1–10 (Tuvale Map …
 * Yarsol Map), 100 = 11–20 … 104 = 51–60; level-70 maps have none. [] for any other quest.
 */
export function bushMaps(questId: number): number[] {
  if (!isTreasureBush(questId)) return [];
  return items("map").filter(([, m]) => treasureBushOf(m.itemLevel ?? 0) === questId)
    .sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || a[0] - b[0]).map(([id]) => id);
}
/** Level range of the maps a Treasure Bush spawns in ({ lo: 1, hi: 10 } for bush 99), or null. */
export function bushLevels(questId: number): { lo: number; hi: number } | null {
  const lv = bushMaps(questId).map((id) => item("map", id)?.itemLevel ?? 0);
  return lv.length ? { lo: Math.min(...lv), hi: Math.max(...lv) } : null;
}
/**
 * The level an enemy is shown with: a Treasure Bush's map level range ("1–10"; its quest levelReq, 10 … 60, is the top
 * of the band and read the bush of maps 1–10 as a level-10 Yarsol enemy), else the quest's levelReq.
 */
export function enemyLevelText(questId: number): string {
  const b = bushLevels(questId);
  return b ? (b.lo === b.hi ? String(b.lo) : `${b.lo}–${b.hi}`) : String(quest(questId)?.levelReq ?? "?");
}
/** Sort level of an enemy: a bush's lowest map level, else its quest level. */
export const enemyLevelSort = (questId: number): number => bushLevels(questId)?.lo ?? quest(questId)?.levelReq ?? 0;

export interface MapRole { map: number; room: boolean; boss: boolean; treasure: boolean }
let rolesOf: Map<number, MapRole[]> | null = null;
/** Maps whose rooms, boss slot or treasure room hold this enemy, lowest map level first (non-enemies have none). */
export function enemyMapRoles(questId: number): MapRole[] {
  if (!rolesOf) {
    rolesOf = new Map();
    const sorted = items("map").sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || a[0] - b[0]);
    for (const [mid, m] of sorted) {
      const rooms = new Set(mapEnemies(m)), bosses = new Set(seq<number>(m.bossList ?? {}));
      const bush = treasureBushOf(m.itemLevel ?? 0);
      for (const q of new Set([...rooms, ...bosses, ...(bush ? [bush] : [])])) {
        if (isEnemy(q)) rolesOf.set(q, [...(rolesOf.get(q) ?? []), { map: mid, room: rooms.has(q), boss: bosses.has(q), treasure: q === bush }]);
      }
    }
  }
  return rolesOf.get(questId) ?? [];
}

/** Map ids that hold this enemy (rooms or boss), lowest map level first. */
export const enemyMaps = (questId: number): number[] => enemyMapRoles(questId).map((r) => r.map);

// ---------------------------------------------------------------- regions
/**
 * The game's six regions (TEXT.regionText 1..6: "Tuvale Forest" … "Frentir Chasm"); `name` is the short form. English:
 * a Region (regionOf) reads them through getters, in the visitor's language (U29: the translations have the full name only).
 */
export const REGIONS: { id: number; name: string; full: string }[] = [
  { id: 1, name: "Tuvale", full: "Tuvale Forest" }, { id: 2, name: "Yarsol", full: "Yarsol Cove" },
  { id: 3, name: "Aldur", full: "Aldur Highlands" }, { id: 4, name: "Vulkrum", full: "Vulkrum Badlands" },
  { id: 5, name: "Grimhal", full: "Grimhal Volcano" }, { id: 6, name: "Frentir", full: "Frentir Chasm" },
];
/** "region": met in the region itself; "event": an event boss; "map": a boss met only in maps. */
export type RegionGroup = "region" | "event" | "map";
export interface Region {
  id: number;
  /** Short name ("Tuvale"); in another language the translated full name (the game has no short form). */
  name: string;
  /** Full name ("Tuvale Forest"), in the visitor's language. */
  full: string;
  /** English short name (search matches it in any language). */
  en: string;
  /** Sort key: region first, then group (region, event, map). */
  order: number;
  group: RegionGroup;
  /** How it was decided, in a few words for the reader ("on Grimhal's quest board", "boss of Treant Revenge Map"). */
  why: string;
}
/** A region's name as the page shows it: the English short form, or the translated full name. */
const regionShort = (id: number): string => {
  const r = REGIONS[clampRegion(id) - 1];
  return isEnglish() ? r.name : regionName(r.id, r.full);
};
const GROUP_RANK: Record<RegionGroup, number> = { region: 0, event: 1, map: 2 };
const clampRegion = (r: unknown): number => Math.max(1, Math.min(6, Math.trunc(Number(r)) || 1));
/** `why` is a function: the text names regions and maps, so it follows the language (the Region is cached). */
function mkRegion(id: number, group: RegionGroup, why: () => string): Region {
  const r = REGIONS[clampRegion(id) - 1];
  const out = { id: r.id, en: r.name, order: (r.id - 1) * 3 + GROUP_RANK[group], group } as Region;
  Object.defineProperties(out, {
    name: { get: () => regionShort(r.id), enumerable: true },
    full: { get: () => regionName(r.id, r.full), enumerable: true },
    why: { get: why, enumerable: true },
  });
  return out;
}

/** Fallback only: levels 1–10 Tuvale, 11–20 Yarsol, … 51–60 Frentir (level 0 is Tuvale, above 60 Frentir). */
export const regionOfLevel = (level: number): number => clampRegion(Math.ceil((Number(level) || 0) / 10));
/**
 * A map's region, as the game draws its map screen (scene.maps.MapViewMenu: regionID = min(floor(itemLevel / 10) + 1, 6)):
 * Yarsol Map (10) is Yarsol, Frentir Map (50) and the level-70 maps Frentir.
 */
export const mapRegionId = (m: Any): number => Math.min(Math.floor((m?.itemLevel ?? 0) / 10) + 1, 6);

let regionCache: Map<string, Region> | null = null;
/**
 * The region of an enemy (quest id), a map, or an item (equipment, consumable, material), from the game data:
 *
 * - Enemy, the default: `questData[id].region`, the field the game itself groups quests by. The quest board
 *   (scene.QuestMenu: drawEnemyLocations) shows a quest on region R's board when `quest.region == R`, and the quest
 *   screens draw the region's background from it. Fatalis (57) is region 5, Grimhal, whatever its level.
 * - Event bosses (questType 6: the quests that data.EventData's `unlockQuest` events open, 61–74): group "event",
 *   region = the same field, which is where the event news sends you ("Find Leviathan in Yarsol Cove":
 *   scene.ActiveEventsListOverlay reads `questData[i].region`).
 * - Map bosses (questType 8, title "Map Boss": Warlords, Khans, the Revenge maps' bosses…, 91–98): the quest board skips
 *   questType 8, so they are met only as a map's boss. Group "map", region = the region of the lowest-level map whose
 *   boss list holds them (see maps). Their own field is not used: Protector of the Forest and King of the Mountain say 1
 *   (Tuvale) but are level 60 and only met in the level-58 Revenge maps (Frentir).
 * - Treasure Bushes (99–104, also questType 8): group "region", the region of the lowest-level map they spawn in
 *   (bushMaps: obj.Map treasureId[ceil(mapLevel / 10)]), which is also their region field: 99 Tuvale … 104 Frentir.
 * - Map: mapRegionId (the game's map screen).
 * - Item (no region field in the item tables): the lowest region where it drops as an every-win reward or a map's essence
 *   (by the regions above), else the lowest region of an enemy whose loot roll holds it, else the region most of its
 *   recipe's ingredients come from (ties: the one nearest the item's level band), else its level band (regionOfLevel).
 * Cached; null for an unknown id.
 */
export function regionOf(kind: "enemy" | "map" | ItemType, id: number): Region | null {
  regionCache ??= new Map();
  const key = `${kind}:${id}`;
  if (regionCache.has(key)) return regionCache.get(key)!;
  regionCache.set(key, null as unknown as Region); // cycle guard for recipes
  const r = kind === "enemy" ? enemyRegion(id) : kind === "map" ? mapRegion(id) : itemRegion(kind, id);
  regionCache.set(key, r as Region);
  return r;
}

function enemyRegion(id: number): Region | null {
  const q = quest(id);
  if (!q) return null;
  if (q.questType === 8 && q.title !== "Treasure Bush") {
    const boss = items("map").filter(([, m]) => seq<number>(m.bossList ?? {}).includes(id))
      .sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || a[0] - b[0])[0];
    if (boss) return mkRegion(mapRegionId(boss[1]), "map", () => `map boss, met only in maps: first in ${itemName("map", boss[0])}`);
  }
  const name = () => regionShort(q.region);
  if (q.questType === 6) return mkRegion(q.region, "event", () => `event boss: the event sends you to ${name()}`);
  const bush = bushLevels(id);
  if (bush) return mkRegion(mapRegionId(item("map", bushMaps(id)[0])), "region", () => `bush of maps level ${bush.lo}–${bush.hi}`);
  if (q.title === "Treasure Bush") return mkRegion(q.region, "region", () => `hides in ${name()}'s maps`);
  if (q.region !== undefined) return mkRegion(q.region, "region", () => `on ${name()}'s quest board`);
  return mkRegion(regionOfLevel(q.levelReq), "region", () => `level ${q.levelReq}`);
}

function mapRegion(id: number): Region | null {
  const m = item("map", id);
  return m ? mkRegion(mapRegionId(m), "region", () => `map level ${m.itemLevel ?? 0}`) : null;
}

let sourcesOf: Map<string, { fixed: number[]; loot: number[] }> | null = null;
/** Regions where each item drops: every-win rewards and map essence ("fixed"), loot rolls ("loot"). */
function itemSources(): Map<string, { fixed: number[]; loot: number[] }> {
  if (sourcesOf) return sourcesOf;
  const out = new Map<string, { fixed: number[]; loot: number[] }>();
  const add = (type: string, id: number, region: number, how: "fixed" | "loot") => {
    const k = `${type}:${id}`;
    if (!out.has(k)) out.set(k, { fixed: [], loot: [] });
    out.get(k)![how].push(region);
  };
  for (const qid of Object.keys(G.questData ?? {}).map(Number)) {
    const q = quest(qid);
    if (!q?.name || q.nickname === "MissNo") continue; // gathering quests count (they give herbs), placeholders don't
    const reg = enemyRegion(qid)!.id;
    for (const rare of [false, ...(q.nameB ? [true] : [])]) {
      const d = enemyDrops(qid, rare);
      for (const [mid] of d.fixed) add("material", mid, reg, "fixed");
      for (const p of d.rolls) for (const r of lootTable(p)?.rows ?? []) add(r.type, r.id, reg, "loot");
    }
  }
  for (const [, m] of items("map")) {
    const br = seq<number>(m.baseReward ?? {});
    for (let i = 0; i < Math.floor(br.length / 2); i++) add("material", br[i], mapRegionId(m), "fixed");
  }
  sourcesOf = out;
  return out;
}

function itemRegion(type: string, id: number): Region | null {
  const it = item(type, id);
  if (!it) return null;
  const src = itemSources().get(`${type}:${id}`);
  if (src?.fixed.length) return mkRegion(Math.min(...src.fixed), "region", () => "where it drops every win");
  if (src?.loot.length) return mkRegion(Math.min(...src.loot), "region", () => "where it drops");
  const band = regionOfLevel(it.itemLevel ?? 0);
  const counts = new Map<number, number>();
  for (const [t, mid] of recipe(type, id)) {
    const r = regionOf(t as ItemType, mid);
    if (r) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  }
  if (counts.size) {
    const best = [...counts].sort((a, b) => b[1] - a[1] || Math.abs(a[0] - band) - Math.abs(b[0] - band) || a[0] - b[0])[0][0];
    return mkRegion(best, "region", () => "where its recipe's materials come from");
  }
  return mkRegion(band, "region", () => `item level ${it.itemLevel ?? 0}`);
}

const GROUP_TAG: Record<RegionGroup, string> = { region: "", event: "event", map: "map boss" };
/** Sortable number for a table cell: region and group first, then level. */
export const regionSortKey = (r: Region | null, level: number | null | undefined): number => (r ? r.order : 99) * 1000 + (Number(level) || 0);
/** "Grimhal", "Yarsol · event" (for search and plain text). */
export const regionText = (r: Region | null): string => (r ? [r.name, ...(r.name === r.en ? [] : [r.en]), GROUP_TAG[r.group]].filter(Boolean).join(" · ") : "");

/**
 * The region as a small chip in its colour (+ "event" / "map boss"); the tooltip says how it was decided. A region
 * behind an expansion (6, Frentir: the Frozen Tome) carries its badge (U28).
 */
export function regionChip(r: Region | null, withWhy = false): HTMLElement {
  if (!r) return el("span", { class: "muted" }, "–");
  const needs = needsOf("region", r.id);
  const chip = el("span", { class: `region-chip reg-${r.id}`, title: `${r.full}: ${r.why}${needs.length ? `. ${expansionNote(needs)}` : ""}` }, r.name,
    ...(needs.length ? [expansionBadge(needs)] : []));
  const tag = GROUP_TAG[r.group] ? [el("span", { class: `region-tag ${r.group}` }, GROUP_TAG[r.group])] : [];
  return el("span", { class: "region-cell" }, chip, ...tag, ...(withWhy ? [el("span", { class: "muted small" }, ` ${r.why}`)] : []));
}

/** One entry of a loot table: an item, its share of the roll (percent) and the amounts it can come in. */
export interface LootEntry { type: string; id: number; pct: number; amounts: number[] }
/**
 * A parcel (loot table) at base odds (grade B, party luck 0): the "nothing" share and each item's share of one roll,
 * exact for the game's weightedRandom (wiki-loot.ts, which also gives the other grades). Amounts are the possible
 * stack sizes.
 */
export function parcelRoll(name: string): { nilPct: number; entries: LootEntry[] } | null {
  const t = lootTable(name);
  if (!t) return null;
  const g = BASE_GRADE - 1;
  return {
    nilPct: t.nothing[g],
    entries: t.rows.map((r) => ({ type: r.type, id: r.id, pct: r.chance[g], amounts: [...r.amounts.keys()] })),
  };
}

/** What one win against an enemy gives: fixed materials (min–max per win, before grade) and its loot-table rolls. */
export function enemyDrops(id: number, rare: boolean): { fixed: [number, number, number][]; rolls: string[] } {
  const q = quest(id) ?? {};
  const s = rare ? "B" : "A";
  const fixed = [1, 2].map((n) => seq<number>(q[`reward${s}${n}`] ?? {})).filter((r) => r[0]).map((r) => [r[0], r[1], r[2]] as [number, number, number]);
  const rolls = [3, 4].map((n) => q[`reward${s}${n}`]).filter((p) => typeof p === "string" && G.parcelData?.[p]);
  return { fixed, rolls };
}

/** [type, id, amount] ingredients of a craftable item. */
export function recipe(type: string, id: number): [string, number, number][] {
  const it = item(type, id);
  const mids = seq<number>(it?.materialID ?? {});
  if (!mids.length || !it.crafterID) return [];
  const types = seq<string>(it.materialType ?? {}), amounts = seq<number>(it.materialAmount ?? {});
  return mids.map((m, i) => [types[i] || "material", m, amounts[i] ?? 1]);
}

let usedIn: Map<string, [string, number, number][]> | null = null;
/** Items whose recipe needs this one: [type, id, amount]. */
export function usedInRecipes(type: string, id: number): [string, number, number][] {
  if (!usedIn) {
    usedIn = new Map();
    for (const t of ITEM_TYPES) {
      for (const [iid] of items(t)) {
        for (const [mt, mid, amt] of recipe(t, iid)) {
          const k = `${mt}:${mid}`;
          usedIn.set(k, [...(usedIn.get(k) ?? []), [t, iid, amt]]);
        }
      }
    }
  }
  return usedIn.get(`${type}:${id}`) ?? [];
}

/** Where an item drops: quests (fixed rewards and loot tables) and, for materials, map essence rewards. */
export function dropSources(id: number, type = "material"): { kind: "quest" | "map"; id: number; rare: boolean; label: string; detail: string }[] {
  const out: { kind: "quest" | "map"; id: number; rare: boolean; label: string; detail: string }[] = [];
  for (const [qid, q] of Object.entries<Any>(G.questData ?? {})) {
    for (const rare of [false, true]) {
      if (rare && !q.nameB) continue;
      const label = rare ? q.nameB : q.name, note = rare ? " (rare)" : "";
      const drops = enemyDrops(Number(qid), rare);
      if (type === "material") {
        for (const r of drops.fixed) if (r[0] === id) out.push({ kind: "quest", id: Number(qid), rare, label, detail: `${r[1]}–${r[2]} per win${note}` });
      }
      for (const p of drops.rolls) {
        for (const e of parcelRoll(p)?.entries ?? []) {
          if (e.type === type && e.id === id) out.push({ kind: "quest", id: Number(qid), rare, label, detail: `${fmt.format(e.pct)}% loot roll${note}` });
        }
      }
    }
  }
  if (type !== "material") return out;
  for (const [mid, m] of items("map")) {
    const br = seq<number>(m.baseReward ?? {});
    const half = Math.floor(br.length / 2);
    for (let i = 0; i < half; i++) if (br[i] === id) out.push({ kind: "map", id: mid, rare: false, label: m.name, detail: `${br[i + half]} essence per run` });
  }
  return out;
}

/** Map enemy pool as quest ids (ranges expanded). */
export function mapEnemies(m: Any): number[] {
  const out: number[] = [];
  for (const e of seq<Any>(m.enemyList ?? {})) {
    const r = seq<number>(e ?? {});
    if (typeof e === "number") out.push(e);
    else if (r.length === 2) for (let q = r[0]; q <= r[1]; q++) out.push(q);
    else out.push(...r);
  }
  return out;
}

// ---------------------------------------------------------------- texts
/** A skill's effect: the wiki's English text, or the game's text in the visitor's language (U29). */
export const skillDesc = (name: string): string => descOf("skill", name) ?? text.skills[name] ?? "";
export const skillAp = (name: string): number | undefined => G.abilityData?.[name]?.apCost;
export const passiveText = (name: string): string => statsText(G.passiveData?.[name]?.stats) || "no bonus";
export const classText = (id: number): string => descOf("class", id) ?? (text.classes[id] ?? []).join(" ");

/** Item description with its {stat} placeholders filled (consumables), or the flavour lines. */
export function itemText(type: string, id: number): string {
  // U29: the game's text in the visitor's language, same {stat} placeholders
  const own = (ITEM_TYPES as readonly string[]).includes(type) ? descOf(type as ItemType, id) : undefined;
  const lines = own !== undefined ? [own] : text.items[type]?.[id] ?? [];
  const it = item(type, id);
  return lines.join(" ").replace(/\{(\w+)\}/g, (_, k) => (it?.stat?.[k] !== undefined ? fmt.format(it.stat[k]) : `{${k}}`)).trim();
}

/** One-line summary for tooltips and lists. */
export function itemSummary(type: string, id: number): string {
  const it = item(type, id);
  if (!it) return "";
  const head = [itemTypeLabel[type], type === "equipment" ? SLOT_NAMES[it.itemSlot] ?? it.subType : it.subType,
    it.itemLevel ? `level ${it.itemLevel}` : ""].filter(Boolean).join(" · ");
  const body = type === "consumable" ? itemText(type, id) || statsText(it.stat)
    : type === "map" ? mapLine(it) : type === "material" ? itemText(type, id) : statsText(it.bonusStat);
  return [head, body].filter(Boolean).join(" — ");
}

function mapLine(m: Any): string {
  const boss = seq<number>(m.bossList ?? {}).map((b) => enemyName(b)).filter(Boolean).join(", ");
  const br = seq<number>(m.baseReward ?? {});
  const half = Math.floor(br.length / 2);
  const ess = Array.from({ length: half }, (_, i) => `${br[i + half]} ${itemName("material", br[i]) ?? `#${br[i]}`}`).join(", ");
  return [boss ? `boss ${boss}` : "", ess ? `${ess} per run` : "", m.baseEnemyAmount ? `${m.baseEnemyAmount} rooms` : ""].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- links
export const href = {
  skill: (n: string) => `wiki.html#/skill/${encodeURIComponent(n)}`,
  passive: (n: string) => `wiki.html#/passive/${encodeURIComponent(n)}`,
  item: (t: string, id: number) => `wiki.html#/${t === "map" ? "map" : `item/${t}`}/${id}`,
  cls: (id: number) => `wiki.html#/class/${id}`,
  enemy: (id: number) => `wiki.html#/enemy/${id}`,
};

function tipBox(title: string, kind: string, body: string, extra = "", xp: string[] = []): HTMLElement {
  return el("span", { class: "tip-body" }, el("strong", {}, title), el("span", { class: "tip-kind" }, kind),
    ...(body ? [el("span", {}, body)] : []), ...(extra ? [el("span", { class: "muted" }, extra)] : []),
    ...(xp.length ? [el("span", { class: "tip-xp" }, expansionBadge(xp as ("Frozen" | "Scribe")[]), ` ${expansionNote(xp as ("Frozen" | "Scribe")[])}`)] : []));
}

/** Options of the name links (U28). */
export interface LinkOpts {
  /**
   * Always the real link, even for content of an expansion the visitor hides: the save's own items, heroes and maps
   * (the player has them), and pages that already filtered their rows. Without it, hidden content becomes the greyed
   * "expansion content" placeholder.
   */
  always?: boolean;
}

/** Put the expansion badge inside a name link (plain icons: a link can't hold another link). */
function withBadge<T extends HTMLElement>(a: T, needs: string[]): T {
  if (needs.length) a.append(expansionBadge(needs as ("Frozen" | "Scribe")[]));
  return a;
}

/** A link to a skill's wiki page, with its effect on hover. */
export function skillLink(name: string, cls = ""): HTMLElement {
  if (name === "Basic") return el("span", { class: `wl skill basic ${cls}`.trim() }, name);
  // The route stays the English key (stable URLs); the text is the visitor's language (U29).
  const a = markName(el("a", { class: `wl skill ${cls}`.trim(), href: href.skill(name) }, skillName(name)), "skill", name);
  tip(a, () => tipBox(skillName(name), `Skill · ${skillAp(name) ?? "?"} AP`, skillDesc(name)));
  return a;
}

export function passiveLink(name: string, cls = ""): HTMLElement {
  if (!name || name === "None" || !G.passiveData?.[name]) return el("span", { class: `wl ${cls}`.trim() }, name || "none");
  const a = markName(el("a", { class: `wl passive ${cls}`.trim(), href: href.passive(name) }, passiveName(name)), "passive", name);
  tip(a, () => tipBox(passiveName(name), "Passive", passiveText(name)));
  return a;
}

/** The content kind of an item type for the expansion rules (null: not an item). */
const itemKind = (type: string): ContentKind | null => ((ITEM_TYPES as readonly string[]).includes(type) ? type as ContentKind : null);

/**
 * A link to an item or map, coloured by rarity, with a summary on hover. `label` shows modifiers (e.g. "Strong Iron Sword +3");
 * `asc` (0–2) outlines it silver or gold. Expansion content carries its badge; content the visitor hides becomes the
 * "expansion content" placeholder unless `opts.always` (U28).
 */
export function itemLink(type: string, id: number, label?: string, rarity?: unknown, asc?: unknown, opts: LinkOpts = {}): HTMLElement {
  const it = item(type, id);
  const r = typeof rarity === "number" ? rarity : it?.rarity ?? 1;
  // A label equal to the English name (worker rows name items in English) is the plain name: translated and kept in step.
  const plain = label === undefined || label === it?.name;
  const name = plain ? itemName(type, id) ?? `${type} #${id}` : label;
  const kind = itemKind(type);
  const extra = { ascension: ascLevel(asc) };
  const needs = it && kind ? needsOf(kind, id, extra) : [];
  if (needs.length && !opts.always && !isVisible(kind!, id, extra)) return placeholderFor(kind!, id, extra);
  if (!it) return withAsc(el("span", { class: `item rar-${r}` }, name), asc);
  const a = el("a", { class: `wl item rar-${r}`, href: href.item(type, id) }, name);
  if (plain && kind) markName(a, kind as ItemType, id);
  const ascNote = ascLevel(asc) ? ` · ${ascText(asc)}` : "";
  tip(a, () => tipBox(itemName(type, id) ?? it.name, itemSummary(type, id).split(" — ")[0] + ascNote, itemSummary(type, id).split(" — ")[1] ?? "",
    type === "equipment" ? itemText(type, id) : "", needs)); // materials and consumables already show their text as the body
  withAsc(a, asc, name);
  return withBadge(a, needs);
}

export function classLink(id: number, opts: LinkOpts = {}): HTMLElement {
  const c = G.heroList?.[id];
  const needs = needsOf("class", id);
  if (needs.length && !opts.always && !isVisible("class", id)) return placeholderFor("class", id);
  const a = markName(el("a", { class: `wl cls-${id}`, href: href.cls(id) }, className(id) ?? `class ${id}`), "class", id);
  tip(a, () => tipBox(className(id) ?? "", "Hero class", classText(id), "", needs));
  return withBadge(a, needs);
}

/**
 * A link to an enemy's wiki page (normal and rare variant share the quest's page); the tooltip gives its kind, level
 * and the maps it appears in. Placeholders (PLACEHOLDER_QUEST_IDS) stay plain text.
 */
export function enemyLink(e: { id: number; name?: string; rare?: boolean }, opts: LinkOpts = {}): HTMLElement {
  const q = quest(e.id);
  // The game's name (given in English or already translated) is shown in the visitor's language and kept in step.
  const own = enemyName(e.id, !!e.rare);
  const plain = e.name === undefined || e.name === own || e.name === (e.rare ? q?.nameB : q?.name);
  const name = (plain ? own : e.name) ?? `quest #${e.id}`;
  const needs = q ? needsOf("enemy", e.id) : [];
  if (needs.length && !opts.always && !isVisible("enemy", e.id)) return placeholderFor("enemy", e.id);
  if (!isEnemy(e.id)) return withBadge(el("span", { class: "wl" }, name), needs);
  const maps = enemyMaps(e.id);
  const kind = () => `${enemyKind(e.id)}${e.rare ? " · rare" : ""}${bushLevels(e.id) ? ` · maps level ${enemyLevelText(e.id)}` : q?.levelReq !== undefined ? ` · level ${q.levelReq}` : ""}`;
  const where = () => (maps.length ? `Appears in ${maps.map((m) => itemName("map", m)).join(", ")}.` : "Quest only, in no map.");
  const a = el("a", { class: `wl enemy-link${e.rare ? " rare" : ""}`, href: href.enemy(e.id) }, name);
  if (plain) markName(a, e.rare ? "enemyB" : "enemy", e.id);
  tip(a, () => tipBox(plain ? enemyName(e.id, !!e.rare) ?? name : name, kind(), where(), "", needs));
  return withBadge(a, needs);
}
