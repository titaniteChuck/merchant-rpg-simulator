/** data.Default / data.GameModsData functions the combat code uses. */
import { G } from "./data.ts";
import { LuaTable } from "./lua-table.ts";
import { clamp, copyTable, len, mathRound, oneBased, random, round } from "./lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** Mutable game constants (`default.*`): literals from gamedata.json plus what setMode sets. */
export const D: Any = {};

const ENEMY_MODS: Record<string, Any> = {
  Standard: { maxHP: 1, atk: 1, matk: 1, def: 1, mdef: 1, eva: 1 },
  "Hard Enemies": { maxHP: 4, atk: 3, matk: 3, def: 3, mdef: 3, eva: 1.2 },
  Crafters: { maxHP: 2, atk: 1.25, matk: 1.25, def: 1.25, mdef: 1.25, eva: 1.25 },
  Legendary: { maxHP: 4, atk: 2, matk: 2, def: 2, mdef: 2, eva: 2 },
};
const MODES = ["Standard", "Quick", "Hard Enemies", "Customers", "Crafters", "Legendary"];

/** default.setMode: GameModsData.applyMods (only the parts combat reads, plus grade ranges). */
export function setMode(mode = "Standard"): void {
  Object.assign(D, structuredClone(G.default));
  if (!MODES.includes(mode)) mode = "Standard";
  // GameModsData setStandardDefaults, then the mode's setDefaults
  D.timePerTurn = 5;
  D.timePerAction = 5;
  D.questXpMod = 1;
  D.questTimeMod = 1;
  D.gradeMin = { 1: 0.75, 2: 0.9, 3: 1, 4: 1.1, 5: 1.25 };
  D.gradeMax = { 1: 0.9, 2: 1, 3: 1.1, 4: 1.2, 5: 1.5 };
  if (mode === "Quick") {
    D.questXpMod = 4;
    D.questTimeMod = 0.25;
  }
  if (mode === "Hard Enemies") {
    D.questXpMod = 4;
    D.questTimeMod = 0.5;
  }
  if (mode === "Crafters" || mode === "Legendary") {
    D.gradeMin = { 1: 0.5, 2: 0.75, 3: 0.9, 4: 1.2, 5: 1.5 };
    D.gradeMax = { 1: 0.75, 2: 0.9, 3: 1, 4: 1.4, 5: 1.8 };
  }
  if (mode === "Legendary") {
    D.questXpMod = 2;
    D.questTimeMod = 2;
  }
  D.enemyMods = { ...(ENEMY_MODS[mode] ?? ENEMY_MODS.Standard) };
  D.mode = mode;
  D.craftPrefixOdds = craftPrefixOddsStandard;
  D.craftSuffixOdds = craftSuffixOddsStandard;
}

// Crafting odds are only used by makeItem, which forces them to 0 (like the harness).
function craftPrefixOddsStandard(charLevel: number): [number, number] {
  return [0, charLevel];
}
function craftSuffixOddsStandard(charLevel: number): [number, number] {
  return [0, charLevel];
}

export function enemyAttackList(id: number, isRare: boolean): Any[] {
  const q = G.questData[id];
  const list = isRare ? (q.attackListB ?? q.attackList) : q.attackList;
  return oneBased(list);
}

export function attackList(): string[] {
  return [undefined as Any, "Basic", "Basic", "Basic", "Basic", "Basic"];
}

export function heroAttackList(cls: number): string[] {
  return oneBased(G.heroList[cls].defaultAttackList);
}

export function heroPassive(hero: Any): string {
  if (hero.level < D.heroLevelUnlockSkills) return "None";
  return G.heroList[hero.class].passiveList[1];
}

export function heroSkillSet(hero: Any): Any[] {
  const s1 = { passive: hero.passiveSelect, attackList: hero.attackList };
  const s2 = { passive: heroPassive(hero), attackList: heroAttackList(hero.class) };
  return [undefined, s1, s2];
}

export function heroMaxActionPoints(hero: Any): number {
  const levelCap = Math.min(hero.level, D.heroMaxAPLevel);
  const levelAdjustment = Math.max(levelCap - D.heroLevelUnlockSkills, 0);
  const additionalAP = Math.floor(levelAdjustment / D.heroAPEveryLevel);
  return D.heroStartingAP + additionalAP + hero.apMod;
}

export function attackListUnlocked(hero: Any): number {
  const h = G.heroList[hero.class];
  const maxSkills = len(h.skillList);
  let skillLevels = 0;
  if (h.skillUnlockLevel) {
    const n = len(h.skillUnlockLevel);
    for (let i = 1; i <= n; i++) if (h.skillUnlockLevel[i] >= hero.level) skillLevels = i;
    if (maxSkills > n && skillLevels === n) skillLevels = maxSkills;
    return skillLevels;
  }
  if (hero.level < D.heroLevelUnlockSkills) return 0;
  const diff = 5;
  skillLevels = Math.min(Math.floor((hero.level - diff) / diff), maxSkills - 1);
  if (hero.level > D.heroLastSkillUnlockLevel) skillLevels = maxSkills;
  return skillLevels;
}

export function getPotionStatPrestige(key: string, prestigeLevel: number): [number, number] {
  const ps = G.defaultLocals.potionStat[key];
  const mult = ps && ps[prestigeLevel] !== undefined ? ps[prestigeLevel] : 1;
  return [mult, G.defaultLocals.potionStatPlaces[key] ?? 0];
}

export function consumableStat(id: number, prestigeLevel: number): Any {
  let stats = G.itemData.consumable[id].stat;
  if (prestigeLevel && prestigeLevel > 0) stats = consumablePrestigeStat(stats, prestigeLevel);
  return stats;
}

export function consumablePrestigeStat(stats: Any, prestigeLevel: number): Any {
  if (prestigeLevel && prestigeLevel > 0) {
    stats = copyTable(stats);
    for (const key of Object.keys(stats)) {
      const [mult, places] = getPotionStatPrestige(key, prestigeLevel);
      stats[key] = round(stats[key] * mult, places);
    }
  }
  return stats;
}

// ---------------------------------------------------------------- item stat rolls (makeItem)
// The game draws these with a `random` captured at load time (C rand), so they are
// not reproducible against the reference harness; here they use the shared generator.

function baseStatFunc(baseField: string, levelField: string, level: number, subType: string,
  isCraft: boolean, grade: number, charLevelDiff?: number): number {
  const baseValue = G.itemFormula[subType][baseField];
  const plvlValue = G.itemFormula[subType][levelField];
  // Lua: arithmetic on nil errors (item formulas missing a field, e.g. equipment 549)
  if (baseValue === undefined || plvlValue === undefined) throw new Error(`item formula ${subType} has no ${baseValue === undefined ? baseField : levelField}`);
  const maxGrade = D.gradeMax[grade];
  let minGrade = D.gradeMin[grade];
  if (charLevelDiff && charLevelDiff > 0) {
    minGrade = Math.min(maxGrade, minGrade + (maxGrade - minGrade) * 0.04 * charLevelDiff);
  }
  if (isCraft) {
    if (grade) return Math.ceil((baseValue + level * plvlValue) * ((minGrade + maxGrade) / 2));
    return Math.ceil(baseValue + level * plvlValue);
  }
  const statMin = Math.ceil((baseValue + level * plvlValue) * minGrade);
  const statMax = Math.ceil((baseValue + level * plvlValue) * maxGrade);
  return random(statMin, statMax);
}

export const itemStat = {
  atk: (l: number, s: string, c: boolean, g: number, d?: number) => baseStatFunc("atkBase", "atkLvl", l, s, c, g, d),
  matk: (l: number, s: string, c: boolean, g: number, d?: number) => baseStatFunc("matkBase", "matkLvl", l, s, c, g, d),
  acc: (l: number, s: string, c: boolean, g: number, d?: number) => baseStatFunc("accBase", "accLvl", l, s, c, g, d),
  crit: (_l: number, s: string) => G.itemFormula[s].crit,
  def: (l: number, s: string, c: boolean, g: number, d?: number) => baseStatFunc("defBase", "defLvl", l, s, c, g, d),
  mdef: (l: number, s: string, c: boolean, g: number, d?: number) => baseStatFunc("mdefBase", "mdefLvl", l, s, c, g, d),
};

export function getStatRange(value: Any, grade: number, ascMulti: number | false, craftDiff?: number): [number, number, boolean] {
  let isDecimal = false;
  let statMin: number, statMax: number;
  if (value[1] < 1 && value[1] > -1) {
    statMin = value[1] * 100;
    statMax = value[2] * 100;
    isDecimal = true;
  } else if (value[1] <= -1) {
    statMin = value[1] / D.gradeMin[grade];
    statMax = value[2] / D.gradeMax[grade];
  } else {
    statMin = value[1] * D.gradeMin[grade];
    statMax = value[2] * D.gradeMax[grade];
  }
  if (ascMulti) {
    statMin *= ascMulti;
    statMax *= ascMulti;
  }
  if (craftDiff && craftDiff > 0) {
    let maxPossible = statMax * 0.92;
    if (statMin < 0) maxPossible = statMax * 1.08;
    if (statMin > maxPossible) maxPossible = statMin;
    statMin = Math.min(maxPossible, statMin + (statMax - statMin) * 0.04 * craftDiff);
  }
  return [Math.ceil(statMin), Math.ceil(statMax), isDecimal];
}

export function getBonusPrestige(key: string, ascLevel: number): number {
  return G.defaultLocals.ascStat[key][ascLevel];
}

/**
 * default.bonusStat. The roll order is Lua's pairs() order over the item's bonusStat
 * constructor table, rebuilt with the Lua table emulation from the source field order
 * (gamedata.json keeps it).
 */
export function bonusStat(id: number, grade: number, ascLevel: number, charLevelDiff: number): Any {
  const stat: Any = {
    str: 0, int: 0, dex: 0, lckMod: 0, expMod: 0, atkBns: 0, matkBns: 0, accBns: 0, critBns: 0,
    defBns: 0, mdefBns: 0, hpBns: 0, apMod: 0, atkPct: 0, matkPct: 0, defPct: 0, mdefPct: 0,
    accPct: 0, hpPct: 0, critMod: 0,
  };
  const bs = G.itemData.equipment[id].bonusStat ?? {};
  const order = LuaTable.fromRecord(Object.entries(bs)).keys() as string[];
  for (const key of order) {
    const ascMulti = ascLevel && ascLevel > 0 ? getBonusPrestige(key, ascLevel) : false;
    const [statMin, statMax, isDecimal] = getStatRange(bs[key], grade, ascMulti, charLevelDiff);
    stat[key] = random(statMin, statMax);
    if (isDecimal) stat[key] = stat[key] / 100;
    if (stat[key] === 0) delete stat[key];
  }
  return stat;
}

// ---------------------------------------------------------------- maps (data.Default)
// These draw from `random` like the game's `local random = math.random` / math.random.

/** default.mapRoomQuantity */
export function mapRoomQuantity(map: Any): number {
  let roomQuantity = G.itemData.map[map.id].baseEnemyAmount + random(-1, 1);
  if (map.grade <= 2) roomQuantity = roomQuantity - 1;
  else if (map.grade >= 4) roomQuantity = roomQuantity + 1;
  return roomQuantity;
}

/** default.mapBoss -> [bossID, isRareBoss] */
export function mapBoss(id: number): [number, boolean] {
  const bossList = G.itemData.map[id].bossList;
  const n = len(bossList);
  const bossID = n !== 1 ? bossList[random(1, n)] : bossList[1];
  return [bossID, G.itemData.map[id].isRareBoss];
}

const mapPrestigeMod = [undefined, 2, 3];

export function mapEnemyModPreview(mapId: number, prestigeLevel: number): number {
  let mod = G.itemData.map[mapId].enemyMod;
  if (0 < prestigeLevel) mod = mod * (mapPrestigeMod[prestigeLevel] as number);
  return round(mod, 2);
}

/** default.mapEnemyMod */
export function mapEnemyMod(map: Any): number {
  let mod = mapEnemyModPreview(map.id, map.prestigeLevel);
  const gm = D.mapGradeMod;
  if (map.grade > 4) mod = mod + gm[5];
  else if (map.grade > 3) mod = mod + gm[4];
  else if (map.grade > 2) mod = mod + gm[3];
  else if (map.grade < 3) mod = mod + gm[2];
  if (map.suffix && map.suffix > 0) mod = mod * (1 + G.suffixList[map.suffix].stats.atk);
  return round(mod, 2);
}

export function mapBaseTime(map: Any): number {
  return G.itemData.map[map.id].baseMapTime;
}

export function statModFromMap(mapModIn: number): Any {
  const mapMod = (mapModIn - 1) / 2;
  return {
    maxHP: mapMod * 1.5, atk: mapMod, matk: mapMod,
    def: 0.75 + mapMod * 0.25, mdef: 0.75 + mapMod * 0.25, eva: 0.75 + mapMod * 0.25,
  };
}

const mapPercentStats: Record<string, string> = {
  hpPct: "maxHP", atkPct: "atk", matkPct: "matk", defPct: "def", mdefPct: "mdef", accPct: "eva",
};

/** default.finalMapMod. No mapStats key maps onto another one, so key order does not matter. */
export function finalMapMod(mapEnemyModValue: number, mapStats: Any): Any {
  const base = statModFromMap(mapEnemyModValue);
  base._mod = mapEnemyModValue;
  if (mapStats.essenceMod !== undefined) {
    mapStats.essenceBase = mapStats.essenceBase * mapStats.essenceMod;
    delete mapStats.essenceMod;
  }
  for (const k of Object.keys(mapStats)) {
    let v = mapStats[k];
    let statName = k;
    let isMultiplier = false;
    if (mapPercentStats[statName]) {
      statName = mapPercentStats[statName];
      isMultiplier = true;
      v = v + 1;
    }
    if (base[statName] !== undefined) base[statName] = isMultiplier ? base[statName] * v : base[statName] + v;
    else base[statName] = v;
  }
  return base;
}

function getPrestigedEssenceID(baseEssenceID: number, prestigeLevel: number): number {
  if (prestigeLevel === 0) return baseEssenceID;
  const ids = G.defaultLocals.prestigeItemID;
  const n = len(ids[1]);
  for (let i = 1; i <= n; i++) if (ids[1][i] === baseEssenceID) return ids[prestigeLevel + 1][i];
  return baseEssenceID;
}

/** default.mapEssenceReward -> [{id, amount}] */
export function mapEssenceReward(mapID: number, mapPrestigeLevel: number, grade: number, mapStats: Any,
  partyLuck: number): { id: number; amount: number }[] {
  const essenceRewards = G.itemData.map[mapID].baseReward;
  const essenceTypes = len(essenceRewards) / 2;
  const out: { id: number; amount: number }[] = [];
  for (let i = 1; i <= essenceTypes; i++) {
    let amount = mathRound(G.gradeBonus[grade] * essenceRewards[i + essenceTypes] * mapStats.essenceBase * (1 + partyLuck / 100));
    if (mapStats.essenceMod !== undefined) amount = mathRound(amount * mapStats.essenceMod);
    out.push({ id: getPrestigedEssenceID(essenceRewards[i], mapPrestigeLevel), amount });
  }
  return out;
}

export { clamp };
