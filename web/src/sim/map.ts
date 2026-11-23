/** obj.Map: a map item and its seed-based layout (rooms, enemies, rares, boss, treasure). */
import { G } from "./data.ts";
import { D, finalMapMod, mapBaseTime, mapBoss, mapEnemyMod, mapRoomQuantity } from "./defaults.ts";
import { LuaTable } from "./lua-table.ts";
import { len, mathRound, random, randomseed, toNumber } from "./lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const itemTypeToString = [undefined, "material", "consumable", "equipment", "map"];
const mapParseTable = ["itemType", "id", "seed", "grade", "prefix", "suffix", "enchantAttempt", "prestigeLevel"];

/** itemCompact.readCompact for a map string ("4|1A|1700000000|3|0|0|A0B0C0|1"). */
export function readMapCompact(compact: string): Any {
  const data: Any = {};
  const words = compact.match(/[A-Za-z0-9.]+/g) ?? [];
  for (let i = 0; i < words.length && i < mapParseTable.length; i++) {
    const word = words[i];
    const f = mapParseTable[i];
    if (f === "itemType") data.itemType = itemTypeToString[Number(word)];
    else if (f === "id") data.id = /^[0-9a-fA-F]+$/.test(word) ? parseInt(word, 16) : undefined;
    else if (f === "grade") {
      if (/[A-Za-z]/.test(word)) throw new Error("stacked map grades are not supported");
      data.grade = toNumber(word);
    } else if (f === "enchantAttempt") {
      data.enchantAttempt = [undefined, 0, 0, 0];
      let j = 1;
      for (const m of word.matchAll(/[A-Za-z]([\d.]+)/g)) data.enchantAttempt[j++] = toNumber(m[1]);
    } else data[f] = toNumber(word);
  }
  return data;
}

const statsScaledFromTier: Record<string, boolean> = {
  atkBns: true, matkBns: true, accBns: true, hpBns: true, defBns: true, mdefBns: true,
  accPct: true, atkPct: true, matkPct: true, defPct: true, mdefPct: true,
};
const treasurePerRoomPerGradeChance = [undefined, 0, 0, 1, 8, 10];
// treasureId[7] is nil: a treasure rolled on a level-70 map inserts nil into the room list.
const treasureId = [undefined, 99, 100, 101, 102, 103, 104];

function getPossibleEnemies(enemyList: Any): number[] {
  const result: number[] = [];
  const n = len(enemyList);
  for (let i = 1; i <= n; i++) {
    const range = enemyList[i];
    if (typeof range === "number") result.push(range);
    else for (let j = range[1]; j <= range[2]; j++) result.push(j);
  }
  return result;
}

/** enemySort: by quest type, then id. A total order, so any sort gives Lua's result. */
function enemySort(a: number, b: number): number {
  const ta = G.questData[a].questType;
  const tb = G.questData[b].questType;
  if (ta !== tb) return ta - tb;
  return a - b;
}

/** Utilities.lua shuffle on a 1-based list (0-based array here). */
function shuffle(array: number[]): void {
  for (let i = array.length; i >= 2; i--) {
    const j = random(1, i);
    const t = array[i - 1];
    array[i - 1] = array[j - 1];
    array[j - 1] = t;
  }
}

export class GameMap {
  [k: string]: Any;
  /** Room enemies as a Lua table: `#enemies` matters when a nil treasure was inserted. */
  enemies!: LuaTable;
  enemiesRare!: LuaTable;

  /** A compact save string, or {id, prestigeLevel, grade, prefix, suffix, seed}. */
  constructor(params: Any) {
    if (typeof params === "string") params = readMapCompact(params);
    else params = { ...params };
    params.itemType = "map";
    // Item:initialize (the fields maps use)
    this.id = params.id;
    this.itemType = "map";
    const data = G.itemData.map[this.id];
    if (!data) throw new Error(`unknown map id ${this.id}`);
    this.subType = data.subType;
    this.name = data.name;
    this.itemLevel = data.itemLevel;
    this.prestigeLevel = params.prestigeLevel ?? 0;
    this.cost = data.cost;
    this.rarity = data.rarity;
    this.runTime = params.runTime ?? data.runTime;
    // Map:initialize
    this.amount = params.amount ?? 1;
    if (params.grade === undefined) throw new Error("map grade is required");
    this.grade = params.grade;
    this.levelReq = data.itemLevel;
    this.mapStats = { essenceBase: 1 } as Any;
    this.seed = params.seed ?? Math.floor(Date.now() / 1000);
    if (params.isNew) throw new Error("crafting new maps (prefix/suffix rolls) is not supported");
    this.loadStats(params);
    if (this.mapStats.enemyMod !== undefined) {
      this.enemyMod = this.enemyMod + this.mapStats.enemyMod;
      delete this.mapStats.enemyMod;
    }
    this.finalMapStats = finalMapMod(this.enemyMod, this.mapStats);
    this.questSize = params.partySize ?? 6;
    this.enchantAttempt = params.enchantAttempt ?? [undefined, 0, 0, 0];
  }

  loadStats(params: Any): void {
    this.prefix = params.prefix ?? undefined;
    this.suffix = params.suffix ?? undefined;
    if (this.prefix && this.prefix !== 0) this.applyPrefix();
    if (this.suffix && this.suffix !== 0) this.applySuffix();
    this.determineSeedBasedStats();
  }

  applyPrefix(): void {
    const p = G.prefixList[this.prefix];
    const tierMod = Math.ceil(this.levelReq / 10);
    for (const key of Object.keys(p.mapStats ?? {})) {
      let value = p.mapStats[key];
      if (statsScaledFromTier[key]) value = value * tierMod;
      this.mapStats[key] = this.mapStats[key] !== undefined ? this.mapStats[key] + value : value;
    }
    this.mapStats.essenceBase = this.mapStats.essenceBase * (1 + p.sell);
    this.rarity = this.rarity < 7 ? Math.min(this.rarity + 1, 6) : Math.min(this.rarity + 1, 8);
    this.cost = Math.floor(this.cost * (1 + p.sell));
    this.runTime = Math.floor(this.runTime * (1 + p.sell));
    this.name = `${p.name} ${this.name}`;
  }

  applySuffix(): void {
    const s = G.suffixList[this.suffix];
    this.mapStats.essenceBase = this.mapStats.essenceBase * (1 + s.stats.atk);
    this.rarity = this.rarity < 7 ? Math.min(this.rarity + 1, 6) : Math.min(this.rarity + 1, 8);
    this.cost = Math.floor(this.cost * (1 + s.sell));
    this.runTime = Math.floor(this.runTime * (1 + s.sell));
    this.name = `${this.name} ${s.name}`;
  }

  determineSeedBasedStats(): void {
    randomseed(this.seed);
    [this.bossID, this.bossRare] = mapBoss(this.id);
    this.roomAmount = mapRoomQuantity(this);
    this.enemyMod = mapEnemyMod(this);
    this.baseTime = mapBaseTime(this);
    this.generateEnemies();
    randomseed(Math.floor(Date.now() / 1000)); // math.randomseed(os.time())
  }

  generateEnemies(): void {
    const enemyList = G.itemData.map[this.id].enemyList;
    this.enemies = new LuaTable();
    this.enemiesRare = new LuaTable();
    if (len(enemyList) === 0) return;
    const possibleEnemies = getPossibleEnemies(enemyList);
    let countToGenerate = this.roomAmount - 1;
    const possibleCount = possibleEnemies.length;
    if (countToGenerate > possibleCount) {
      const times = Math.floor(countToGenerate / possibleCount);
      for (let i = 1; i <= times * possibleCount; i++) this.enemies.set(i, possibleEnemies[(i - 1) % possibleCount]);
      countToGenerate = countToGenerate - possibleCount * times;
    }
    if (0 < countToGenerate) {
      shuffle(possibleEnemies);
      for (let i = 1; i <= countToGenerate; i++) this.enemies.set(this.enemies.len() + 1, possibleEnemies[i - 1]);
    }
    // table.sort: rewrites slots 1..#t in place (no new keys), so the table layout is unchanged
    const n = this.enemies.len();
    const sorted: number[] = [];
    for (let i = 1; i <= n; i++) sorted.push(this.enemies.get(i) as number);
    sorted.sort(enemySort);
    for (let i = 1; i <= n; i++) this.enemies.set(i, sorted[i - 1]);
    this.generateTreasure();
    const count = this.enemies.len();
    for (let i = 1; i <= count; i++) {
      this.enemiesRare.set(i, false);
      const enemyID = this.enemies.get(i) as number;
      const q = G.questData[enemyID as Any];
      if (q === undefined) throw new Error(`obj.Map.lua:164: attempt to index field '?' (a nil value)`);
      if (0 < q.abRand) this.enemiesRare.set(i, random(0, 100) < q.abRand);
    }
  }

  generateTreasure(): void {
    const chancePerRoom = treasurePerRoomPerGradeChance[this.grade] as number;
    let totalChance = chancePerRoom * this.roomAmount;
    if (this.mapStats.lckMod !== undefined) totalChance = mathRound(totalChance * (1 + this.mapStats.lckMod * 0.1));
    const tID = treasureId[Math.ceil(this.levelReq / 10)];
    while (100 < totalChance) {
      totalChance = totalChance - 100;
      this.enemies.insert(random(1, this.enemies.len()), tID);
    }
    if (totalChance >= random(1, 100)) {
      const position = random(1, this.enemies.len());
      this.enemies.insert(position, tID);
    }
  }
}

export { D };
