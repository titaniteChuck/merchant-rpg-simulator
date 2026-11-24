/**
 * Quest-board quests vs map-only enemies, and the XP / time figures of a quest or a map run, without a simulation
 * (the UI shows them on wiki enemy pages and battle results; the levelling, farming and profit tools use the same rules).
 *
 *   isBoardQuest(92)                         // false: Murlok Monarch is a map boss (questType 8)
 *   mapsWithQuest(92)                        // [{ map: 7, role: "boss", perRun: 1 }, { map: 12, role: "boss", perRun: 1/3 }]
 *   questStats(80, { grade: 3, amount: 1, heroes: 3 })   // { xpPerHero, seconds, xpPerMin, ... }
 *   mapRunStats(7, { grade: 3, heroes: 3 })              // { craftSeconds, runSeconds, xpPerHero, xpPerMin, ... }
 *
 * Game rules (decompiled Lua):
 * - Quest board (scene.QuestMenu:drawEnemyLocations): a quest is drawn when quest.region == currentRegion and
 *   quest.questType ~= 8. questType 8 = map bosses 91-98 and Treasure Bushes 99-104: fought only inside a map run
 *   (obj.Map: bossList, enemyList, treasureId), so one of them costs a whole map (crafted, consumed, run room by room).
 * - Quest XP (Quest:calculateExperience, Hero:addExperience): round(exp / heroes) x amount per living hero of a won
 *   quest (expB for the rare variant), x (1 + expMod / 100) x questXpMod.
 * - Quest time (questService.determineQuestTime): (battle + time x amount x gradeTime[grade]) x questTimeMod
 *   x (1 - min(speed%, 75%)); battle = actions x 5 + turns x 5 seconds.
 * - Map room XP (obj.combat.Campaign:runCombat): round(exp x mapEnemyMod x 0.2 / heroes) per living hero of every room
 *   won, boss included; the map enemy mod = enemyMod x 2 at asc 1, + mapGradeMod[grade] (default.mapEnemyMod).
 * - Map run time: walk (baseMapTime split over the rooms) + each room's battle time x gradeTime, x questTimeMod.
 * - Craft time (obj.Craft:startCrafting): ceil(floor(runTime x craftGradeSpeed[grade]) x amount x craftTimeMod); a map's
 *   grade is its craft grade. A map recipe that needs a lower map adds that map's craft (the chain is crafted in turn).
 * - Map rooms (default.mapRoomQuantity): baseEnemyAmount + random(-1, 1), -1 at grade <= 2, +1 at grade >= 4; the last
 *   is the boss (one of bossList); treasure rooms by grade 0/0/1/8/10 % per room (obj.Map:generateTreasure).
 */
import { G } from "../sim/data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** questType of the enemies fought only in maps (never drawn on the quest board). */
export const MAP_ONLY_QUEST_TYPE = 8;
/** obj.Map treasureId: the Treasure Bush of each map tier (ceil(itemLevel / 10)). */
export const TREASURE_IDS = [99, 100, 101, 102, 103, 104];
/** obj.Map treasurePerRoomPerGradeChance, % per room by map grade 1..5. */
export const TREASURE_CHANCE: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 8, 5: 10 };

/** Per game mode (data.GameModsData): quest XP and time factors, craft time factor and craft speed by grade 1..5. */
const MODES: Record<string, { questXp: number; questTime: number; craftTime: number; craftSpeed: number[] }> = {
  Standard: { questXp: 1, questTime: 1, craftTime: 1, craftSpeed: [1.1, 1, 0.9, 0.8, 0.75] },
  Quick: { questXp: 4, questTime: 0.25, craftTime: 0.25, craftSpeed: [1.1, 1, 0.9, 0.8, 0.75] },
  "Hard Enemies": { questXp: 4, questTime: 0.5, craftTime: 0.5, craftSpeed: [1.1, 1, 0.9, 0.8, 0.75] },
  Customers: { questXp: 1, questTime: 1, craftTime: 1, craftSpeed: [1.1, 1, 0.9, 0.8, 0.75] },
  Crafters: { questXp: 1, questTime: 1, craftTime: 2, craftSpeed: [1.2, 1.1, 1, 0.8, 0.6] },
  Legendary: { questXp: 2, questTime: 2, craftTime: 2, craftSpeed: [1.2, 1.1, 1, 0.8, 0.6] },
};
export const modeFactors = (mode = "Standard") => MODES[mode] ?? MODES.Standard;

const round = (x: number) => Math.floor(x + 0.5); // math.round
const entries = (t: Any): Any[] => (Array.isArray(t) ? t.filter((x) => x !== undefined && x !== null)
  : t && typeof t === "object" ? Object.keys(t).map(Number).sort((a, b) => a - b).map((k) => t[k]) : []);

/** A quest the game draws on the quest board (questType ~= 8) with an enemy to fight. */
export function isBoardQuest(id: number): boolean {
  const q = G.questData?.[id];
  return Boolean(q?.enemyHp && q.attackList) && q.questType !== MAP_ONLY_QUEST_TYPE;
}

/** A map boss or Treasure Bush: only fought inside a map run. */
export function isMapOnlyQuest(id: number): boolean {
  return G.questData?.[id]?.questType === MAP_ONLY_QUEST_TYPE;
}

/** Maps players can craft: crafters cap at level 60 and a recipe needs itemLevel <= crafter level. */
export function isCraftableMap(mid: number, crafterLevel = 60): boolean {
  const m = G.itemData?.map?.[mid];
  return Boolean(m && (m.itemLevel ?? 0) <= Math.min(crafterLevel, 60) && entries(m.materialID).length && entries(m.bossList).length);
}

/** The quest ids a map's rooms are drawn from (enemyList ranges expanded). */
export function mapEnemyPool(mid: number): number[] {
  const pool: number[] = [];
  for (const e of entries(G.itemData.map[mid]?.enemyList)) {
    if (typeof e === "number") pool.push(e);
    else {
      const [a, b] = entries(e);
      for (let q = a; q <= b; q++) pool.push(q);
    }
  }
  return pool;
}

/** Expected rooms of a run (boss included, treasure rooms not): default.mapRoomQuantity, random(-1, 1) averages 0. */
export function mapRooms(mid: number, grade = 3): number {
  return (G.itemData.map[mid].baseEnemyAmount ?? 0) + (grade <= 2 ? -1 : grade >= 4 ? 1 : 0);
}

/** Expected treasure rooms of a run, and the Treasure Bush fought there (none above level 60: index out of range). */
export function mapTreasure(mid: number, grade = 3): { quest: number; perRun: number } | null {
  const m = G.itemData.map[mid];
  const id = TREASURE_IDS[Math.ceil((m.itemLevel ?? 1) / 10) - 1];
  const perRun = (TREASURE_CHANCE[grade] ?? 0) * mapRooms(mid, grade) / 100;
  return id !== undefined && perRun > 0 ? { quest: id, perRun } : null;
}

export interface MapAppearance {
  map: number;
  role: "boss" | "room" | "treasure";
  /** Expected fights against this quest per run (map grade `grade`). */
  perRun: number;
}

/** Craftable maps where this quest is fought, with how often per run (the cheapest way to meet a map-only enemy). */
export function mapsWithQuest(quest: number, grade = 3, crafterLevel = 60): MapAppearance[] {
  const out: MapAppearance[] = [];
  for (const k of Object.keys(G.itemData?.map ?? {}).map(Number).sort((a, b) => a - b)) {
    if (!isCraftableMap(k, crafterLevel)) continue;
    const m = G.itemData.map[k];
    const bosses = entries(m.bossList);
    if (bosses.includes(quest)) out.push({ map: k, role: "boss", perRun: bosses.filter((b) => b === quest).length / bosses.length });
    const pool = mapEnemyPool(k);
    const hits = pool.filter((q) => q === quest).length;
    if (hits) out.push({ map: k, role: "room", perRun: (mapRooms(k, grade) - 1) * hits / pool.length });
    const t = mapTreasure(k, grade);
    if (t && t.quest === quest) out.push({ map: k, role: "treasure", perRun: t.perRun });
  }
  return out;
}

/** obj.Craft:startCrafting: seconds to craft `amount` of an item at craft grade `grade`. */
export function craftSeconds(itype: string, id: number, grade = 3, o: { mode?: string; amount?: number } = {}): number {
  const it = G.itemData?.[itype]?.[id];
  if (!it) return 0;
  const f = modeFactors(o.mode);
  const g = Math.min(Math.max(Math.round(grade), 1), 5);
  return Math.ceil(Math.floor((it.runTime ?? 0) * f.craftSpeed[g - 1]) * (o.amount ?? 1) * f.craftTime);
}

/** Craft seconds of a map with the lower maps its recipe consumes (Hard Tuvale Map = Tuvale Map + ...), same grade. */
export function mapCraftSeconds(mid: number, grade = 3, mode?: string, seen = new Set<number>()): number {
  const m = G.itemData?.map?.[mid];
  if (!m || seen.has(mid)) return 0;
  const inner = new Set(seen).add(mid);
  const ids = entries(m.materialID), types = entries(m.materialType), amts = entries(m.materialAmount);
  let total = craftSeconds("map", mid, grade, { mode });
  ids.forEach((id, i) => {
    if (types[i] === "map") total += (amts[i] ?? 1) * mapCraftSeconds(id, grade, mode, inner);
  });
  return total;
}

export interface QuestStatsOptions {
  /** Fight grade 1..5 (default 3): quest time x gradeTime[grade]. */
  grade?: number;
  /** Quest amount (enemy HP, loot, XP and quest time x amount; "size" in the quest dialog). Default 1. */
  amount?: number;
  /** Alias of amount. */
  size?: number;
  /** Heroes in the party (XP is split: round(exp / heroes)). Default 1. */
  heroes?: number;
  /** The rare variant (expB, amount 1). */
  rare?: boolean;
  /** Party luck: not used by XP or time; kept so callers can pass one option object to questStats and loot. */
  luck?: number;
  /** Hero expMod (XP Boost potions +30 / +60 / +100). */
  expMod?: number;
  /** Battle seconds (actions x 5 + turns x 5) when known from a simulation; default 0. */
  battleSeconds?: number;
  /** Party speed bonus in % (sum of the heroes' speed stat), capped at 75. */
  speed?: number;
  mode?: string;
}

export interface QuestStats {
  quest: number;
  name: string;
  /** False for map bosses and Treasure Bushes: they need a map run (see mapRunStats / mapsWithQuest). */
  onBoard: boolean;
  amount: number;
  heroes: number;
  /** XP per living hero of a won quest, and the party's total. */
  xpPerHero: number;
  xpTotal: number;
  /** Quest seconds: (battle + time x amount x gradeTime) x questTimeMod x (1 - speed). */
  battleSeconds: number;
  questSeconds: number;
  seconds: number;
  /** XP per hero per minute of quest time. */
  xpPerMin: number;
  gold: number;
}

/** XP, time and XP/min of one quest-board quest (no simulation: pass battleSeconds to include the fight). */
export function questStats(quest: number, o: QuestStatsOptions = {}): QuestStats {
  const q = G.questData?.[quest];
  if (!q) throw new Error(`unknown quest ${quest}`);
  const f = modeFactors(o.mode);
  const rare = o.rare ?? false;
  const amount = rare ? 1 : Math.max(1, o.amount ?? o.size ?? 1);
  const heroes = Math.max(1, o.heroes ?? 1), grade = o.grade ?? 3;
  const exp = (rare ? q.expB ?? q.exp : q.exp) ?? 0;
  const xpPerHero = round(exp / heroes) * amount * (1 + (o.expMod ?? 0) / 100) * f.questXp;
  const speed = 1 - Math.min(Math.max(o.speed ?? 0, 0) / 100, 0.75);
  const battle = (o.battleSeconds ?? 0) * f.questTime * speed;
  const questPart = (q.time ?? 0) * amount * (G.gradeTime?.[grade] ?? 1) * f.questTime * speed;
  const seconds = battle + questPart;
  return {
    quest, name: q.name, onBoard: isBoardQuest(quest), amount, heroes,
    xpPerHero, xpTotal: xpPerHero * heroes, battleSeconds: battle, questSeconds: questPart, seconds,
    xpPerMin: seconds > 0 ? xpPerHero / (seconds / 60) : 0,
    gold: (rare ? q.goldB ?? q.gold : q.gold) ?? 0,
  };
}

export interface MapRunStatsOptions {
  /** Map grade 1..5 = its craft grade (default 3): rooms, enemy mod, craft speed, treasure odds. */
  grade?: number;
  /** Map ascension 0 or 1 (enemy mod x 2 at asc 1). */
  asc?: number;
  heroes?: number;
  expMod?: number;
  /** Battle seconds per room when known (default 0: walk time only); or the whole measured run time. */
  battleSecondsPerRoom?: number;
  runSeconds?: number;
  /** Measured XP per hero per run (a simulation: rooms won, deaths); default every room won. */
  xpPerHero?: number;
  /** Fight grade of the rooms (gradeTime of each battle; default the map grade). */
  fightGrade?: number;
  mode?: string;
}

export interface MapRunStats {
  map: number;
  name: string;
  asc: number;
  grade: number;
  /** Expected rooms (boss included) and treasure rooms. */
  rooms: number;
  treasureRooms: number;
  /** default.mapEnemyMod (x 0.2 = the XP factor of every room). */
  enemyMod: number;
  boss: number[];
  /** Crafter seconds (the map and the lower maps in its recipe), run seconds, their sum. */
  craftSeconds: number;
  runSeconds: number;
  seconds: number;
  /** XP per hero per run (every room won unless measured), per minute of run and per minute including the craft. */
  xpPerHero: number;
  xpPerMinRun: number;
  xpPerMin: number;
}

/** XP and time of one run of a map (rooms room by room to the boss), plus the time to craft it. */
export function mapRunStats(mid: number, o: MapRunStatsOptions = {}): MapRunStats {
  const m = G.itemData?.map?.[mid];
  if (!m) throw new Error(`unknown map ${mid}`);
  const f = modeFactors(o.mode);
  const grade = o.grade ?? 3, asc = o.asc ?? 0, heroes = Math.max(1, o.heroes ?? 1);
  // default.mapEnemyMod
  const gm = G.default?.mapGradeMod ?? {};
  let mod = (m.enemyMod ?? 1) * (asc > 0 ? [1, 2, 3][asc] ?? 2 : 1);
  mod = Math.round(mod * 100) / 100;
  mod += grade > 4 ? gm[5] ?? 0 : grade > 3 ? gm[4] ?? 0 : grade > 2 ? gm[3] ?? 0 : gm[2] ?? 0;
  mod = Math.round(mod * 100) / 100;
  const roomXp = (q: number) => round((G.questData[q]?.exp ?? 0) * mod * 0.2 / heroes) * (1 + (o.expMod ?? 0) / 100) * f.questXp;
  const rooms = mapRooms(mid, grade);
  const pool = mapEnemyPool(mid), boss = entries(m.bossList) as number[];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const t = mapTreasure(mid, grade);
  const xpAll = (rooms - 1) * avg(pool.map(roomXp)) + avg(boss.map(roomXp)) + (t ? t.perRun * roomXp(t.quest) : 0);
  const fightGrade = o.fightGrade ?? grade;
  const runSeconds = o.runSeconds ?? ((m.baseMapTime ?? 0) +
    (rooms + (t?.perRun ?? 0)) * (o.battleSecondsPerRoom ?? 0) * (G.gradeTime?.[fightGrade] ?? 1)) * f.questTime;
  const craft = mapCraftSeconds(mid, grade, o.mode);
  const xpPerHero = o.xpPerHero ?? xpAll;
  return {
    map: mid, name: m.name, asc, grade, rooms, treasureRooms: t?.perRun ?? 0, enemyMod: mod, boss,
    craftSeconds: craft, runSeconds, seconds: craft + runSeconds, xpPerHero,
    xpPerMinRun: runSeconds > 0 ? xpPerHero / (runSeconds / 60) : 0,
    xpPerMin: craft + runSeconds > 0 ? xpPerHero / ((craft + runSeconds) / 60) : 0,
  };
}
