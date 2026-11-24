/** obj.combat.Battle (one fight) and questService.determineBattleGrade. */
import { G } from "./data.ts";
import { Enemy } from "./enemy.ts";
import { clamp, round } from "./lua.ts";
import { Party } from "./party.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** The battle currently in combatLoop (read by the trace hook). */
export const current: { battle?: Battle } = {};

/**
 * Battle:combatLoop: once a turn ends with the turn counter at 200 the fight stops as a loss ("fatigue": hasWon false,
 * grade 0), checked after the win test, so an enemy that falls on turn 200 still counts as a loss.
 */
export const TURN_CAP = 200;

/** enemiesService.hasFirstAttack */
export function hasFirstAttack(enemy: Any): boolean {
  const enemyType = enemy instanceof Enemy ? enemy.enemyType : enemy.questType;
  return enemyType === 6;
}

export class Battle {
  [k: string]: Any;
  turns = 0;
  actions = 0;
  enemy: Enemy;
  frontRow: Any[] = [undefined];
  backRow: Any[] = [undefined];
  turnOrder: Any[] = [];

  /** params: questID, frontRow/backRow (1-based, index 0 unused), isRare, amount, mapStats, useQuestHp. */
  constructor(params: Any) {
    this.enemy = new Enemy(params);
    this.isRunning = params.isRunning ?? true;
    this.useQuestHp = params.useQuestHp;
    this.questID = params.questID;
    if (params.frontRow) this.loadHeroesRow(params.frontRow, this.frontRow);
    if (params.backRow) this.loadHeroesRow(params.backRow, this.backRow);
  }

  private currentHp(hero: Any): number {
    return this.useQuestHp ? hero.questHP : hero.hp;
  }

  loadHeroesRow(from: Any[], to: Any[]): void {
    for (let i = 1; i <= 3; i++) {
      const hero = from[i];
      if (hero !== undefined && hero !== null && 0 < this.currentHp(hero)) to[i] = hero;
    }
  }

  setup(): void {
    this.isRunning = true;
    this.heroCount = 0;
    this.party = new Party(this);
    this.enemy.setParty(this.party);
    for (let n = 1; n <= 3; n++) {
      this.setupHero(this.backRow[n], n * 2 - 1);
      this.setupHero(this.frontRow[n], n * 2);
    }
  }

  setupHero(hero: Any, partyLoc: number): void {
    if (hero === undefined || hero === null) return;
    const currentHp = this.currentHp(hero);
    hero.reviveCooldown = 0;
    if (0 < currentHp) {
      hero.resetStats();
      hero.questHP = currentHp;
      hero.isTurnSkipped = false;
      hero.isDead = false;
      hero.party = this.party;
      hero.partyLocation = partyLoc;
      hero._enemy = this.enemy;
      this.heroCount = this.heroCount + 1;
    }
  }

  combatLoop(): void {
    current.battle = this;
    this.determineTurnOrder();
    while (this.isRunning) {
      this.turns = this.turns + 1;
      for (let a = 0; a < this.turnOrder.length; a++) this.runAction(a);
      if (this.areHeroesFainted()) {
        this.isRunning = false;
        this.hasWon = false;
        this.grade = 0;
      }
      if (0 >= this.enemy.questHP) {
        this.hasWon = true;
        this.isRunning = false;
      }
      if (this.turns >= TURN_CAP) {
        this.isRunning = false;
        this.hasWon = false;
        this.grade = 0;
        return;
      }
    }
  }

  runAction(a: number): void {
    const c = this.turnOrder[a];
    if (c.questHP > 0 && !c.isTurnSkipped) {
      const action = c.determineAction(((this.turns - 1) % 5) + 1);
      if (action) this.actions = this.actions + 1;
    }
  }

  areHeroesFainted(): boolean {
    for (let n = 1; n <= 3; n++) {
      if (this.backRow[n] && this.backRow[n].questHP > 0) return false;
      if (this.frontRow[n] && 0 < this.frontRow[n].questHP) return false;
    }
    return true;
  }

  determineTurnOrder(): void {
    const first = hasFirstAttack(this.enemy);
    this.turnOrder = [];
    if (first) this.turnOrder.push(this.enemy);
    for (let n = 1; n <= 3; n++) {
      if (this.backRow[n] && this.backRow[n].questHP > 0) this.turnOrder.push(this.backRow[n]);
      if (this.frontRow[n] && 0 < this.frontRow[n].questHP) this.turnOrder.push(this.frontRow[n]);
    }
    if (!first) this.turnOrder.push(this.enemy);
  }

  getSumOfStat(statName: string): number {
    let val = 0;
    for (let n = 1; n <= 3; n++) {
      if (this.frontRow[n]) val = val + this.frontRow[n][statName];
      if (this.backRow[n]) val = val + this.backRow[n][statName];
    }
    return val;
  }
}

/** questService.determineBattleGrade */
export function determineBattleGrade(battle: Battle, questId: number, isRare: boolean): number {
  if (battle.hasWon === false) return 0;
  const q = G.questData[questId];
  let averageLvl = 0;
  for (let n = 1; n <= 3; n++) {
    if (battle.frontRow[n]) averageLvl = averageLvl + battle.frontRow[n].level;
    if (battle.backRow[n]) averageLvl = averageLvl + battle.backRow[n].level;
  }
  averageLvl = averageLvl / battle.heroCount;
  let grade = round(1.3 + (averageLvl + q.region * 5) / (q.levelReq + q.region * 5), 2);
  grade = clamp(grade, 1, 4.5);
  if (isRare) grade = grade - 0.5;
  const turns = battle.turns;
  let turnDiff = 0;
  const t = q.questType;
  if (t === 1) turnDiff = clamp(4 - turns, -1, 2);
  else if (t === 2) turnDiff = (4 + q.region * 2 - turns) / 4;
  else if (t === 3) turnDiff = (8 + q.region * 3 - turns) / 4;
  else if (t === 4) turnDiff = (12 + q.region * 3 - turns) / 4;
  else if (t === 5) turnDiff = (16 + q.region * 4 - turns) / 4;
  else if (t === 6 || t === 8) turnDiff = (20 + q.region * 5 - turns) / 4;
  grade = grade + turnDiff;
  return clamp(round(grade), 1, 5);
}
