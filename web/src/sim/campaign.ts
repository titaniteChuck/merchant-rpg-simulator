/**
 * obj.combat.Campaign (a map run: rooms in order, HP carried over, loot, essence),
 * with lootService, QuestInventory, ScrollsComponent / data.ScrollsData and the
 * questService map timings.
 */
import { Battle, current, determineBattleGrade } from "./battle.ts";
import { G } from "./data.ts";
import { consumablePrestigeStat, D, mapEssenceReward } from "./defaults.ts";
import type { GameMap } from "./map.ts";
import { LuaTable } from "./lua-table.ts";
import { clamp, len, mathRound, random, round } from "./lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const COMBAT_STATUS_NONE = 0;
const COMBAT_STATUS_WIN = 1;
const COMBAT_STATUS_LOSE = 2;

// ---------------------------------------------------------------- Utilities.lua
/** weightedRandom over a Lua table: the threshold walk follows Lua's pairs() order. */
export function weightedRandom(choices: LuaTable): number {
  const entries = choices.entries();
  let total = 0;
  for (const [, w] of entries) total = total + (w as number);
  let threshold = random(0, total);
  let lastChoice: Any;
  for (const [choice, weight] of entries) {
    threshold = threshold - (weight as number);
    if (threshold <= 0) return choice as number;
    lastChoice = choice;
  }
  return lastChoice;
}

// ---------------------------------------------------------------- questService (maps)
function getBattleTime(battle: Battle): number {
  return battle.actions * D.timePerAction + battle.turns * D.timePerTurn;
}

function applyTimeMods(questTime: number, battle: Battle, bonusSpeedIn?: number): number {
  questTime = questTime * D.questTimeMod;
  const bonusSpeed = (battle.getSumOfStat("speed") + (bonusSpeedIn ?? 0)) * 0.01;
  return questTime * (1 - Math.min(bonusSpeed, 0.75));
}

/** questService.determineQuestTime / Quest:endQuesting: seconds a quest takes (grade 0 = lost, gradeTime[0] = 2). */
export function determineQuestTime(battle: Battle, questId: number, amount: number, grade: number): number {
  const questTime = getBattleTime(battle) + G.questData[questId].time * amount * G.gradeTime[grade];
  return applyTimeMods(questTime, battle);
}

export function determineMapBattleTime(battle: Battle, _questId: number, grade: number, mapSpeed?: number): number {
  const time = getBattleTime(battle) * G.gradeTime[grade];
  return mathRound(applyTimeMods(time, battle, mapSpeed));
}

export function determineMapWalkTime(battle: Battle, baseTime: number, mapSpeed?: number): number {
  return mathRound(applyTimeMods(baseTime, battle, mapSpeed));
}

// ---------------------------------------------------------------- QuestInventory
export interface Reward {
  itemType: string;
  itemID: number;
  amount: number;
  grade: Any;
  prestigeLevel?: number;
  isDrop?: boolean;
}

export class QuestInventory {
  rewards: Reward[] = [];
  goldReward = 0;

  addReward(reward: Reward): boolean | void {
    if (D.isStack[reward.itemType]) {
      for (const existing of this.rewards) {
        if (existing.itemID === reward.itemID && existing.itemType === reward.itemType) {
          if (typeof existing.grade === "number") {
            const newGrade = [undefined, 0, 0, 0, 0, 0] as Any[];
            newGrade[existing.grade] = existing.amount;
            existing.grade = newGrade;
          }
          existing.grade[reward.grade] = existing.grade[reward.grade] + reward.amount;
          existing.amount = existing.amount + reward.amount;
          return true;
        }
      }
    }
    this.rewards.push(reward);
  }
}

// ---------------------------------------------------------------- lootService
const normalRewards = ["rewardA1", "rewardA2"];
const rareRewards = ["rewardB1", "rewardB2"];
const normalParcel = ["rewardA3", "rewardA4"];
const rareParcel = ["rewardB3", "rewardB4"];

interface QuestParams {
  isRare: boolean;
  grade: number;
  enemyAmount: number;
  partyLuck: number;
}

export function generateRewardForQuest(questId: number, p: QuestParams, inv: QuestInventory): void {
  const slot12 = p.isRare ? rareRewards : normalRewards;
  const slot34 = p.isRare ? rareParcel : normalParcel;
  const q = G.questData[questId];
  for (const k of slot12) generateNormalItem(q[k], p, inv);
  for (const k of slot34) generateParcelItem(q[k], p, inv);
}

function generateNormalItem(rewardTable: Any, p: QuestParams, inv: QuestInventory): void {
  if (rewardTable[1] === 0) return;
  const gb = G.gradeBonus[p.grade];
  const randomRange = random(rewardTable[2] * gb * 10, rewardTable[3] * gb * 10);
  let quantity = clamp(round((randomRange + p.partyLuck) / 10), 0, 5);
  if (p.enemyAmount !== 1) quantity = quantity * p.enemyAmount;
  if (quantity === 0) return;
  inv.addReward({ itemID: rewardTable[1], itemType: "material", amount: quantity, grade: p.grade, isDrop: false });
}

function generateParcelItem(parcelName: Any, p: QuestParams, inv: QuestInventory): void {
  if (parcelName === "" || parcelName === undefined || parcelName === null) return;
  const parcel = G.parcelData[parcelName];
  if (!parcel) throw new Error(`No parcel named ${parcelName} found.`);
  const odds = new LuaTable();
  odds.set(0, Math.max(parcel.nilOdds * G.gradeParcelBonus[p.grade] - p.partyLuck, 1));
  const n = len(parcel.itemList);
  for (let i = 1; i <= n; i++) odds.set(i, parcel.itemList[i].odds * p.enemyAmount);
  const itemID = weightedRandom(odds);
  if (itemID === 0) return;
  const itemFromList = parcel.itemList[itemID];
  let reward: Any;
  if (1 < len(itemFromList.id)) {
    reward = { itemType: itemFromList.id[1], itemID: itemFromList.id[2] };
  } else {
    let amount = 0;
    if (1 < len(itemFromList.amount)) {
      const amountData = itemFromList.amount;
      const amountOdds = new LuaTable();
      const m = len(amountData);
      for (let i = 1; i <= m; i += 2) amountOdds.set(amountData[i], amountData[i + 1]);
      if (p.enemyAmount !== 1) {
        for (let i = 1; i <= p.enemyAmount; i++) amount = amount + weightedRandom(amountOdds);
      } else {
        amount = weightedRandom(amountOdds);
      }
    } else {
      amount = itemFromList.amount[1] * p.enemyAmount;
    }
    reward = { itemType: "material", itemID: itemFromList.id[1], amount };
  }
  reward.grade = p.grade;
  inv.addReward(reward);
}

// ---------------------------------------------------------------- scrolls (data.ScrollsData + ScrollsComponent)
export interface ScrollSlot {
  id: number;
  amount: number;
  chargesUsed: number;
  prestigeLevel?: number;
}

const checks = {
  partOfPartyIsDead(campaign: Campaign, scrollData: Any): boolean {
    let total = 0;
    let dead = 0;
    campaign.iterateHeroes((hero) => {
      total = total + 1;
      if (hero.questHP <= 0) dead = dead + 1;
    });
    if (total === 0) return true;
    return dead / total >= scrollData.deadPart;
  },
  battleIDCheck(campaign: Campaign, scrollData: Any, combatNo: number): [boolean, Any] {
    if (scrollData.battleID > 0) return [false, undefined];
    if (campaign.combats.length + scrollData.battleID === combatNo) return [true, undefined];
    return [false, undefined];
  },
  heroHpPercentCheck(campaign: Campaign, scrollData: Any): [boolean, Any] {
    let target: Any;
    campaign.iterateHeroes((hero) => {
      if (hero.questHP / hero.maxHP <= scrollData.hpPercent) {
        target = hero;
        return true;
      }
    });
    return [target !== undefined, target];
  },
};

const acts = {
  restoreHp(_c: Campaign, stats: Any, target: Any): void {
    target.questHP = Math.min(target.questHP + stats.hp, target.maxHP);
  },
  revive(_c: Campaign, _stats: Any, target: Any): void {
    target.questHP = target.maxHP;
    target.isDead = false;
  },
  swapSkill(campaign: Campaign): void {
    campaign.iterateHeroes((hero) => {
      hero.setSkillSet();
    });
    campaign._skillsSwapped = !campaign._skillsSwapped;
  },
};

const scrollsData: Record<number, Any> = {
  60: { type: "escape", checkFunction: checks.partOfPartyIsDead, deadPart: 0.5 },
  61: { type: "post-battle", checkFunction: checks.heroHpPercentCheck, hpPercent: 0.25, actFunction: acts.restoreHp },
  62: { type: "post-battle", checkFunction: checks.heroHpPercentCheck, hpPercent: 0, actFunction: acts.revive },
  63: { type: "buff-stats" },
  64: { type: "buff-stats" },
  65: { type: "buff-stats" },
  66: { type: "post-battle", checkFunction: checks.battleIDCheck, battleID: -1, actFunction: acts.swapSkill },
  67: { type: "map-stats" },
  68: { type: "post-battle", checkFunction: checks.heroHpPercentCheck, hpPercent: 0, actFunction: acts.revive, charges: 3 },
  69: { type: "post-battle", checkFunction: checks.heroHpPercentCheck, hpPercent: 0.5, actFunction: acts.restoreHp, charges: 6 },
  70: { type: "map-stats" },
};

interface ScrollEntry {
  data: Any;
  stats: Any;
  index: number;
  isAvailable: boolean;
  totalCharges: number;
}

export class ScrollsComponent {
  scrolls?: ScrollSlot[];
  scrollsPerType: Record<string, ScrollEntry[]> = {};

  constructor(scrolls?: ScrollSlot[]) {
    this.scrolls = scrolls;
    if (scrolls === undefined) return;
    scrolls.forEach((info, i) => {
      const data = scrollsData[info.id];
      if (data === undefined) return; // "scroll not implemented"
      const list = (this.scrollsPerType[data.type] ??= []);
      let stats = G.itemData.consumable[info.id]?.stat;
      if (stats && info.prestigeLevel && info.prestigeLevel > 0) stats = consumablePrestigeStat(stats, info.prestigeLevel);
      const totalCharges = info.amount * (data.charges ?? 1);
      list.push({ data, stats, index: i, isAvailable: totalCharges > info.chargesUsed, totalCharges });
    });
  }

  checkEscape(campaign: Campaign): boolean {
    const escapeScrolls = this.scrollsPerType.escape;
    if (!escapeScrolls || escapeScrolls.length === 0) return false;
    for (const scroll of escapeScrolls) if (scroll.data.checkFunction(campaign, scroll.data)) return true;
    return false;
  }

  checkPostBattleScrolls(campaign: Campaign, currentCombatNo: number): void {
    const list = this.scrollsPerType["post-battle"];
    if (!list || list.length === 0) return;
    for (const scroll of list) {
      let isTriggered = true;
      let params: Any;
      while (scroll.isAvailable && isTriggered) {
        [isTriggered, params] = scroll.data.checkFunction(campaign, scroll.data, currentCombatNo);
        if (isTriggered) {
          const info = (this.scrolls as ScrollSlot[])[scroll.index];
          info.chargesUsed = info.chargesUsed + 1;
          scroll.isAvailable = info.chargesUsed < scroll.totalCharges;
          scroll.data.actFunction(campaign, scroll.stats, params);
        }
      }
    }
  }

  calculateTotalBuffs(): Any {
    const list = this.scrollsPerType["buff-stats"];
    if (!list || list.length === 0) return undefined;
    const stats: Any = {};
    for (const scroll of list) {
      if (scroll.stats) {
        for (const k of Object.keys(scroll.stats)) stats[k] = (stats[k] ?? 0) + scroll.stats[k] * scroll.totalCharges;
      }
    }
    return stats;
  }

  addMapBuff(mapStats: Any): void {
    const list = this.scrollsPerType["map-stats"];
    if (!list || list.length === 0) return;
    for (const scroll of list) {
      if (scroll.stats) {
        for (const k of Object.keys(scroll.stats)) mapStats[k] = (mapStats[k] ?? 0) + scroll.stats[k] * scroll.totalCharges;
      }
    }
  }
}

// ---------------------------------------------------------------- Campaign
export interface Combat {
  questId: number;
  isRare: Any;
  status: number;
  grade?: number;
  walkTime?: number;
  timeTaken?: number;
}

function resetHero(hero: Any, isWin: boolean, exp: number): void {
  if (!hero) return;
  hero.addToTotals();
  hero.resetStats();
  if (isWin) {
    hero.questHP = Math.ceil(Math.min(hero.questHP, hero.maxHP));
    if (hero.questHP > 0) {
      if (hero.addExperience(exp)) hero.questHP = hero.maxHP;
    }
  }
  hero.reduceBoost();
}

export class Campaign {
  [k: string]: Any;
  frontRow: Any[];
  backRow: Any[];
  combats: Combat[] = [];
  lootInventory = new QuestInventory();
  isFinished = false;
  scrollsComponent: ScrollsComponent;

  /** params: map, frontRow/backRow (1-based), scrolls. */
  constructor(params: { map: GameMap; frontRow: Any[]; backRow: Any[]; scrolls?: ScrollSlot[] }) {
    this.frontRow = params.frontRow ?? [undefined];
    this.backRow = params.backRow ?? [undefined];
    const map = params.map;
    this.seed = map.seed;
    const n = map.enemies.len();
    for (let i = 1; i <= n; i++) {
      this.combats.push({ questId: map.enemies.get(i) as number, isRare: map.enemiesRare.get(i), status: COMBAT_STATUS_NONE });
    }
    this.combats.push({ questId: map.bossID, isRare: map.bossRare, status: COMBAT_STATUS_NONE });
    this.mapStats = map.finalMapStats;
    this.mapID = map.id;
    this.mapPrestigeLevel = map.prestigeLevel;
    this.mapBaseTime = map.baseTime;
    this.walkBaseTime = mathRound(this.mapBaseTime / this.combats.length);
    this.isFinished = false;
    this.scrollsComponent = new ScrollsComponent(params.scrolls);
    this.battleBuff = this.scrollsComponent.calculateTotalBuffs();
    this.scrollsComponent.addMapBuff(this.mapStats);
  }

  /** For i = 1..3: front then back; stops when func returns true. */
  iterateHeroes(func: (hero: Any) => boolean | void): void {
    for (let i = 1; i <= 3; i++) {
      const frontHero = this.frontRow[i];
      const backHero = this.backRow[i];
      if (frontHero && func(frontHero)) break;
      if (backHero && func(backHero)) break;
    }
  }

  runCombat(): number {
    if (this.isFinished) return -1;
    let currentCombatNo = 0;
    for (let i = 1; i <= this.combats.length; i++) {
      const status = this.combats[i - 1].status;
      if (status === COMBAT_STATUS_NONE) {
        currentCombatNo = i;
        break;
      } else if (status === COMBAT_STATUS_LOSE) {
        this.isFinished = true;
        this.isWin = false;
        return -1;
      }
    }
    const currentCombat = this.combats[currentCombatNo - 1];
    const isRare = currentCombat.isRare;
    const questId = currentCombat.questId;
    const battle = new Battle({
      frontRow: this.frontRow, backRow: this.backRow, questID: questId, isRare, mapStats: this.mapStats, useQuestHp: true,
    });
    battle.setup();
    battle.combatLoop();
    const partyLuck = battle.getSumOfStat("lckMod");
    let isWin: boolean = battle.hasWon;
    if (battle.heroCount === 0 && isWin) {
      isWin = false; // "battle with 0 heroes happened"
    } else {
      const exp = mathRound(G.questData[questId].exp * this.mapStats._mod * 0.2 / battle.heroCount);
      for (let i = 1; i <= 3; i++) {
        resetHero(battle.frontRow[i], isWin, exp);
        resetHero(battle.backRow[i], isWin, exp);
      }
    }
    currentCombat.walkTime = determineMapWalkTime(battle, this.walkBaseTime, this.mapStats.speed);
    currentCombat.status = isWin ? COMBAT_STATUS_WIN : COMBAT_STATUS_LOSE;
    currentCombat.grade = determineBattleGrade(battle, questId, isRare);
    currentCombat.timeTaken = determineMapBattleTime(battle, questId, currentCombat.grade, this.mapStats.speed);
    this.addLoot(battle, currentCombat.grade, questId, isRare, partyLuck);
    if (currentCombatNo === this.combats.length || isWin === false) {
      this.isFinished = true;
      this.isWin = isWin;
      if (this._skillsSwapped) this.iterateHeroes((hero) => {
        hero.setSkillSet();
      });
    }
    if (isWin && !this.isFinished) {
      if (this.scrollsComponent.checkEscape(this)) {
        this.isFinished = true;
        this.isWin = false;
        this.isEscape = true;
      } else {
        this.scrollsComponent.checkPostBattleScrolls(this, currentCombatNo);
      }
    }
    if (this.isFinished && this.isWin) {
      const grade = this.getGrade();
      const rewards = mapEssenceReward(this.mapID, this.mapPrestigeLevel, grade, this.mapStats, partyLuck);
      for (const r of rewards) this.lootInventory.addReward({ itemType: "material", itemID: r.id, amount: r.amount, grade });
    }
    return currentCombatNo;
  }

  addLoot(battle: Battle, grade: number, questId: number, isRare: Any, partyLuck: number): void {
    if (battle.hasWon === false) return;
    generateRewardForQuest(questId, { isRare, grade, enemyAmount: 1, partyLuck }, this.lootInventory);
  }

  getGrade(): number {
    let grade = 0;
    const combats = this.combats;
    if (this.isWin && 0 < combats.length) {
      for (const c of combats) grade = grade + (c.grade as number);
      grade = Math.max(Math.floor(grade / combats.length), 1);
    }
    return grade;
  }
}

export { current };
