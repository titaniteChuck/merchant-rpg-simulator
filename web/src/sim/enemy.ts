/** obj.Enemy: a quest enemy (stats from questData, game mode and map modifiers). */
import { Combatant } from "./combatant.ts";
import { G } from "./data.ts";
import { D, enemyAttackList } from "./defaults.ts";
import { mathRound, tableSum } from "./lua.ts";
import { calculatePercentStats } from "./stats.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const enemyStatsMap: Record<string, string> = {
  maxHP: "enemyHp", atk: "enemyAtk", matk: "enemyMatk", def: "enemyDef", mdef: "enemyMdef", eva: "enemyEva",
};
const enemyStatsB: Record<string, string> = {
  maxHP: "enemyHpB", atk: "enemyAtkB", matk: "enemyMatkB", def: "enemyDefB", mdef: "enemyMdefB", eva: "enemyEvaB",
};
const bonusMapStats: Record<string, string> = {
  atk: "atkBns", matk: "matkBns", def: "defBns", mdef: "mdefBns", eva: "accBns", maxHP: "hpBns",
};

export class Enemy extends Combatant {
  constructor(params: Any) {
    super({ ...params, attackList: undefined, effectList: params.effectList, questHP: params.questHP });
    // Lua: self.class is the MiddleClass class object (enemiesService checks class.name).
    this.class = { name: "Enemy" };
    this.questID = params.questID;
    this.enemyType = params.questType ?? G.questData[this.questID].questType;
    this.amount = params.amount ?? 1;
    this.prefix = params.prefix;
    this.suffix = params.suffix;
    let isRare = false;
    if (params.isRare !== undefined && params.isRare !== null) isRare = params.isRare;
    else isRare = this.enemyType > 2 && G.currentQuestType?.[this.questID] === 2;
    this.isRare = isRare;
    this.name = "unused";
    if (params.mapStats) {
      this.mapStats = params.mapStats;
      this.mapMod = params.mapStats._mod;
    }
    this.isTurnSkipped = false;
    this.isDead = false;
    this.attackList = params.attackList ?? enemyAttackList(this.questID, isRare);
    if (!(params.loadedQuest && !params.isRunning)) {
      this.determineStats(true);
      this.hp = this.maxHP;
      this.questHP = this.maxHP;
    }
  }

  override determineStats(_isQuest?: boolean): void {
    const statsMapTable = this.isRare ? enemyStatsB : enemyStatsMap;
    const q = G.questData[this.questID];
    const mapStats = this.mapStats;
    for (const k of Object.keys(statsMapTable)) {
      let statValue = q[statsMapTable[k]];
      // Lua: arithmetic on a nil stat errors (e.g. isRare on a quest without a rare variant)
      if (statValue === undefined || statValue === null) {
        throw new Error(this.isRare && q[enemyStatsMap[k]] !== undefined
          ? `quest ${this.questID} has no rare variant`
          : `quest ${this.questID} has no ${statsMapTable[k]}`);
      }
      if (mapStats) {
        const bonusStat = bonusMapStats[k];
        if (bonusStat && mapStats[bonusStat]) statValue = statValue + mapStats[bonusStat];
        statValue = statValue * mapStats[k];
      }
      this[k] = mathRound(statValue * D.enemyMods[k]);
    }
    this.maxHP = this.maxHP * this.amount;
    this.acc = 100;
    this.crit = 0;
    this.critMod = 2;
    this.atkPct = 0;
    this.matkPct = 0;
    this.defPct = 0;
    this.mdefPct = 0;
    this.evaPct = 0;
    this.hpPct = 0;
    this.determineEffectStats();
    calculatePercentStats(this);
  }

  setParty(party: Any): void {
    this._party = party;
  }

  override getTarget(): Any {
    return this._party;
  }

  override getDamageRatio(): number[] {
    const party = this._party;
    let frontRowAlive = false;
    const damageRatio = [0, 0, 0, 0, 0, 0, 0];
    for (let n = 1; n <= 3; n++) {
      if (party.frontRow[n] && 0 < party.frontRow[n].questHP) {
        frontRowAlive = true;
        damageRatio[n * 2] = 1;
      }
    }
    if (!frontRowAlive) {
      for (let n = 1; n <= 3; n++) {
        if (party.backRow[n] && 0 < party.backRow[n].questHP) damageRatio[n * 2 - 1] = 1;
      }
    }
    const sum = tableSum(damageRatio);
    for (let n = 1; n <= 6; n++) if (damageRatio[n] === 1) damageRatio[n] = damageRatio[n] / sum;
    return damageRatio;
  }

  override getFirstRowRatio(): number[] {
    return this.getTarget().getFirstRowRatio();
  }

  override getBackRowRatio(): number[] {
    return this.getTarget().getBackRowRatio();
  }
}
