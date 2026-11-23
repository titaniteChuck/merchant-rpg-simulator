/** obj.Combatant: shared by Hero and Enemy (actions, attacks, effects, heals). */
import { abilityFunc } from "./abilities/index.ts";
import { CombatStatistics } from "./combatStatistics.ts";
import { attackList as defaultAttackList } from "./defaults.ts";
import { noopLogger } from "./logger.ts";
import { copyTable, mathRound, random, round, truthy } from "./lua.ts";
import { calculateReduction } from "./stats.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** Effect on a combatant (buff, debuff, damage over time…). Plain object, Lua field names. */
export interface Effect {
  name: string;
  trigger?: string;
  turns?: number;
  stats?: Any;
  remove?: boolean;
  debuff?: boolean;
  stacks?: boolean;
  reversible?: boolean;
  cannotDispell?: boolean;
  heal?: number;
  caster?: Combatant;
  dmgFunc?: (attack: Any) => Any;
  statFunc?: (c: Combatant) => void;
  triggerFunc?: (c: Combatant, actionName: Any) => Any;
  _isAmplified?: boolean;
  [k: string]: Any;
}

const statToPct: Record<string, string> = {
  atk: "atkPct", matk: "matkPct", def: "defPct", mdef: "mdefPct", acc: "accPct", maxHP: "hpPct",
  crit: "crit", critMod: "critMod", eva: "evaPct",
  atkBns: "atk", matkBns: "matk", accBns: "acc", defBns: "def", mdefBns: "mdef",
};

const toAmplify: Record<string, boolean> = { atk: true, matk: true, eva: true, def: true, mdef: true };

/** Optional hook called after every action (trace / per-skill damage, as the former Lua harness recorded them). */
export const hooks: { afterAction?: (c: Combatant, name: Any, before: Any) => void; beforeAction?: (c: Combatant) => Any } = {};

export class Combatant {
  // Combat fields are dynamic in the game (skills and effects add stats by name).
  [k: string]: Any;

  attackList: Any[];
  effectList: Effect[];
  combatStatistics: CombatStatistics;
  questHP: number;
  logger: Any;

  constructor(params: Any) {
    this.attackList = params.attackList ?? defaultAttackList();
    this.effectList = params.effectList ?? [];
    this.combatStatistics = new CombatStatistics(params);
    this.questHP = params.questHP ?? 0;
    this.logger = noopLogger;
  }

  // Overridden by Hero / Enemy.
  determineStats(_isQuest?: boolean): void {}
  getTarget(): Any {
    return undefined;
  }
  getDamageRatio(): number[] {
    return [0, 0, 0, 0, 0, 0, 0];
  }
  getFirstRowRatio(): number[] {
    return [0, 0, 0, 0, 0, 0, 0];
  }
  getBackRowRatio(): number[] {
    return [0, 0, 0, 0, 0, 0, 0];
  }

  removePassive(): void {
    this.passiveEffect = false;
    this.determineStats(true);
  }

  determineAction(turnNumber: number): Any {
    const name = this.attackList?.[turnNumber] ?? "?";
    const before = hooks.beforeAction?.(this);
    const r = this._determineAction(turnNumber);
    hooks.afterAction?.(this, name, before);
    return r;
  }

  private _determineAction(turnNumber: number): Any {
    if (truthy(this.reviveCooldown)) this.reviveCooldown = Math.max(0, this.reviveCooldown - 1);
    if (this.isDead) {
      this.isDead = true;
      return false;
    }
    let actionName = this.attackList[turnNumber];
    const fx = this.effectList;
    for (let n = fx.length - 1; n >= 0; n--) {
      if (truthy(fx[n].turns) && 0 >= (fx[n].turns as number)) fx[n].remove = true;
      if (fx[n].remove) this.removeEffect(n + 1);
    }
    this.determineStats(true);
    let finalActionName: Any;
    let triggerEffect: Any;
    for (let i = this.effectList.length - 1; i >= 0; i--) {
      const e = this.effectList[i];
      if (e.trigger === "OnDetermineAction") {
        finalActionName = e.triggerFunc!(this, actionName);
        triggerEffect = e.name;
        if (!truthy(e.turns)) e.remove = true;
      }
    }
    if (finalActionName !== actionName && finalActionName !== undefined && finalActionName !== null) {
      actionName = finalActionName;
    }
    void triggerEffect;
    const target = this.getTarget();
    let action: Any;
    if (actionName === false) {
      action = false;
    } else {
      const fn = abilityFunc[actionName];
      if (!fn) throw new Error(`skill not ported: ${actionName}`);
      action = fn(this, target);
    }
    for (let n = this.effectList.length - 1; n >= 0; n--) {
      const e = this.effectList[n];
      if (e.trigger === "OnTurn" || (e.trigger === "OnDamage" && truthy(e.turns)) ||
        (e.trigger === "OnAttack" && truthy(e.turns)) || (e.trigger === "OnDetermineAction" && truthy(e.turns)) ||
        (e.trigger === "DamageReceived" && truthy(e.turns))) {
        e.turns = (e.turns as number) - 1;
      } else if (e.trigger === "HealingOnTurn") {
        e.turns = (e.turns as number) - 1;
        const healingReceived = this.receiveHeal(e.heal as number);
        e.caster!.combatStatistics.recordHealingDone(healingReceived);
      } else if (e.trigger === "DamageOnTurn") {
        e.turns = (e.turns as number) - 1;
        const dotStats = copyTable(e.stats);
        dotStats.atk = dotStats.atk ?? 0;
        dotStats.matk = dotStats.matk ?? 0;
        dotStats.crit = dotStats.crit ?? 0;
        dotStats.isDot = true;
        this.receiveAttack(dotStats);
      }
    }
    for (let n = this.effectList.length - 1; n >= 0; n--) {
      if (this.effectList[n].remove) this.removeEffect(n + 1);
    }
    return truthy(action) ? action : true;
  }

  sendAttack(params?: Any): Any {
    let attackParams: Any = {
      attacker: this,
      atk: this.atk,
      matk: this.matk,
      acc: this.acc,
      crit: this.crit,
      dmg: 0,
      critMod: this.critMod,
      defPen: this.defPen ?? 0,
      mdefPen: this.mdefPen ?? 0,
      luck: this.lckMod ?? 0,
    };
    if (params) {
      for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined || value === null) continue;
        if (truthy(attackParams[key])) {
          if (key === "defPen" || key === "mdefPen") {
            if (value < attackParams[key]) attackParams[key] = value;
          } else {
            attackParams[key] = value;
          }
        }
      }
      if (truthy(params.dmg)) {
        if (!truthy(params.atk)) attackParams.atk = 0;
        if (!truthy(params.matk)) attackParams.matk = 0;
      } else if (truthy(params.atk) && !truthy(params.matk)) {
        attackParams.matk = 0;
      } else if (truthy(params.matk) && !truthy(params.atk)) {
        attackParams.atk = 0;
      }
      if (truthy(params.hitChance)) attackParams.hitChance = params.hitChance;
      if (truthy(params.damageSource)) attackParams.damageSource = params.damageSource;
    }
    const target = this.getTarget();
    let result: Any;
    if (target.name === "Party") {
      if (params && truthy(params.damageRatio)) {
        let damRatio = params.damageRatio;
        if (typeof damRatio === "string") {
          if (damRatio === "front") damRatio = this.getFirstRowRatio();
          else if (damRatio === "mid") damRatio = [0, 0, 0, 0, 1, 0, 0];
          else if (damRatio === "midline") damRatio = [0, 0, 0, 1, 1, 0, 0];
          else if (damRatio === "aoe") damRatio = [0, 1, 1, 1, 1, 1, 1];
          else if (damRatio === "back") damRatio = this.getBackRowRatio();
          else damRatio = this.getDamageRatio();
        }
        attackParams.damageRatio = damRatio;
      } else {
        attackParams.damageRatio = this.getDamageRatio();
      }
    }
    for (let n = this.effectList.length - 1; n >= 0; n--) {
      const effect = this.effectList[n];
      if (truthy(effect.trigger) && effect.trigger === "OnAttack" && !effect.remove) {
        if (attackParams) {
          if (effect.dmgFunc) {
            attackParams = effect.dmgFunc(attackParams);
          } else {
            for (const key of Object.keys(effect.stats)) attackParams[key] = attackParams[key] + effect.stats[key];
          }
        }
        if (!truthy(effect.turns)) effect.remove = true;
      }
    }
    if (attackParams) result = target.receiveAttack(attackParams);
    return result;
  }

  determineEffectStats(): void {
    for (let n = 0; n < this.effectList.length; n++) {
      const effect = this.effectList[n];
      if (effect.trigger === "OnTurn" || effect.trigger === "Permanent") {
        if (effect.statFunc) {
          effect.statFunc(this);
        } else {
          for (const key of Object.keys(effect.stats)) {
            const statName = statToPct[key] ?? key;
            this[statName] = this[statName] + effect.stats[key];
          }
        }
      }
    }
  }

  addEffect(params: Any): void {
    if (this.isDead) return;
    let isApplied = false;
    let effectID = 0; // 1-based like Lua; 0 = none
    for (let n = 1; n <= this.effectList.length; n++) {
      if (this.effectList[n - 1].name === params.name) {
        isApplied = true;
        effectID = n;
      }
    }
    if (!isApplied) {
      effectID = this.effectList.length + 1;
      const newEffect = copyTable(params);
      if (newEffect.stats) newEffect.stats = copyTable(newEffect.stats);
      this.effectList[effectID - 1] = newEffect;
    } else if (params.reversible) {
      this.removeEffect(effectID);
    } else if (params.stacks) {
      const cur = this.effectList[effectID - 1];
      for (const key of Object.keys(params.stats)) {
        if (key === "attacker") cur.stats[key] = params.stats[key];
        else cur.stats[key] = cur.stats[key] + params.stats[key];
      }
      if (truthy(cur.turns) && truthy(params.turns)) cur.turns = params.turns;
    } else {
      this.effectList[effectID - 1] = copyTable(params);
    }
    const e = this.effectList[effectID - 1];
    if (e && !truthy(e.trigger) && truthy(e.turns)) e.trigger = "OnTurn";
    this.determineStats(true);
  }

  /** id: effect name, or 1-based position (Lua index). */
  removeEffect(id: string | number): boolean {
    let removeID = 0;
    if (typeof id === "string") {
      for (let n = this.effectList.length - 1; n >= 0; n--) {
        if (this.effectList[n].name === id) {
          removeID = n + 1;
          this.effectList.splice(n, 1);
        }
      }
    } else if (typeof id === "number" && this.effectList[id - 1]) {
      removeID = id;
      this.effectList.splice(id - 1, 1);
    }
    if (removeID !== 0) {
      this.determineStats(true);
      return true;
    }
    return false;
  }

  removeAllEffects(debuffOnly?: boolean, isSpell?: boolean): void {
    for (let n = this.effectList.length - 1; n >= 0; n--) {
      const effect = this.effectList[n];
      let doRemove: Any;
      if (debuffOnly === true) doRemove = effect.debuff;
      else if (debuffOnly === false) doRemove = !effect.debuff;
      else doRemove = true;
      if (isSpell && doRemove && effect.cannotDispell) doRemove = false;
      if (doRemove) this.effectList.splice(n, 1);
    }
    this.determineStats(true);
  }

  sendHeal(target: Any, amount: number, revive?: boolean, overload?: boolean, isPercent?: boolean): void {
    const totalHeal = target.receiveHeal(amount, revive, overload, isPercent);
    this.combatStatistics.recordHealingDone(totalHeal);
  }

  receiveHeal(amount: number, revive?: boolean, overload?: boolean, isPercent?: boolean): number {
    if (this.isDead && !revive) return 0;
    if (revive) {
      this.isDead = false;
      this.questHP = 0;
    }
    const totalHeal = isPercent ? round(this.maxHP * amount) : round(amount);
    if (!overload) {
      if (revive) {
        this.questHP = Math.min(totalHeal, this.maxHP);
        this.reviveCooldown = 2;
      } else if (!(this.questHP > this.maxHP)) {
        this.questHP = this.questHP + totalHeal;
        this.questHP = Math.min(this.questHP, this.maxHP);
      }
    } else {
      this.questHP = this.questHP + totalHeal;
    }
    this.combatStatistics.recordHealingTaken(totalHeal);
    return totalHeal;
  }

  receiveAttack(attack: Any): Any {
    if (attack.damageRatio) {
      const mod = attack.damageRatio[this.partyLocation];
      if (mod === 0) return { totalDamage: 0, atk: 0, matk: 0, crit: false, zeroRatio: true };
      attack.atk = attack.atk * mod;
      attack.matk = attack.matk * mod;
      attack.dmg = attack.dmg * mod;
    }
    const attacker = attack.attacker;
    const rawDamage = attack.atk + attack.matk + (attack.dmg ?? 0);
    if (0 < rawDamage) {
      for (let n = this.effectList.length - 1; n >= 0; n--) {
        const effect = this.effectList[n];
        if (truthy(effect.trigger) && effect.trigger === "OnDamage" && !effect.remove) {
          const doRemove = !truthy(effect.turns);
          if (doRemove) effect.remove = true;
          if (effect.dmgFunc) {
            attack = effect.dmgFunc(attack);
          } else if (effect.stats) {
            for (const key of Object.keys(effect.stats)) {
              if (truthy(attack[key])) attack[key] = attack[key] * effect.stats[key];
            }
          }
        }
      }
    }
    let hitChance: number;
    if (attack.isDot) hitChance = attack.hitChance ?? 100;
    else hitChance = attack.hitChance ?? mathRound((200 * attack.acc) / (attack.acc + this.eva));
    let isHit: boolean;
    if (100 < hitChance) {
      hitChance = 100;
      isHit = true;
    } else {
      isHit = hitChance >= random(1, 100);
    }
    if (!isHit) {
      attacker.combatStatistics.recordMiss();
      return { missed: true, hitChance };
    }
    const critChance = random(1, 100);
    let dmgMod = 1;
    let isCrit = false;
    let isLuck = false;
    const notTrueAttack = 0 < attack.atk + attack.matk;
    if (critChance <= attack.crit && notTrueAttack) {
      dmgMod = truthy(attack.critMod) ? attack.critMod : attacker.critMod;
      if (dmgMod < 1) dmgMod = 1;
      isCrit = true;
    } else if (truthy(attack.luck) && 0 < attack.luck) {
      let luckyRoll = critChance;
      if (notTrueAttack) luckyRoll = luckyRoll - attack.crit;
      if (luckyRoll <= 1.6 * attack.luck) {
        isLuck = true;
        dmgMod = 1.35;
      }
    }
    const defReduction = calculateReduction(this.def, attack.defPen);
    const mdefReduction = calculateReduction(this.mdef, attack.mdefPen);
    attack.physicalDamage = mathRound(defReduction * attack.atk * dmgMod);
    attack.magicDamage = mathRound(mdefReduction * attack.matk * dmgMod);
    attack.trueDamage = mathRound((attack.dmg ?? 0) * (isLuck ? dmgMod : 1));
    attack.totalDamage = attack.physicalDamage + attack.magicDamage + attack.trueDamage;
    if (0 < attack.totalDamage) {
      for (let n = this.effectList.length - 1; n >= 0; n--) {
        const effect = this.effectList[n];
        if (effect.trigger === "DamageReceived" && !effect.remove) {
          const doRemove = !truthy(effect.turns);
          if (doRemove) effect.remove = true;
          if (effect.dmgFunc) {
            attack = effect.dmgFunc(attack);
          } else {
            for (const key of Object.keys(effect.stats)) attack[key] = attack[key] * effect.stats[key];
          }
        }
      }
      attack.totalDamage = mathRound(attack.physicalDamage + attack.magicDamage + attack.trueDamage);
    }
    this.questHP = this.questHP - attack.totalDamage;
    this.combatStatistics.recordDamageTaken(attack);
    if (0 >= this.questHP) {
      if (!this.isDead) {
        for (let n = this.effectList.length - 1; n >= 0; n--) this.effectList[n].remove = true;
      }
      this.isDead = true;
    }
    attacker.combatStatistics.recordAttackHit(attack, isCrit, isLuck);
    return { totalDamage: attack.totalDamage, atk: attack.physicalDamage, matk: attack.magicDamage, crit: isCrit };
  }

  attachLog(_log: Any): void {}
  detachLog(): void {}

  amplifyEffects(isDebuffs: boolean | undefined, modifier: number): number {
    let count = 0;
    for (let i = 0; i < this.effectList.length; i++) {
      const effect = this.effectList[i];
      const shouldAmplify = isDebuffs === undefined || isDebuffs === null || effect.debuff === isDebuffs;
      if (shouldAmplify) count++;
      if (shouldAmplify && !effect._isAmplified && effect.stats) {
        const isDmgReceived = effect.trigger === "DamageReceived";
        for (const key of Object.keys(effect.stats)) {
          const value = effect.stats[key];
          if (toAmplify[key]) {
            if (isDmgReceived) effect.stats[key] = Math.max(0.1, (value - 1) * modifier + 1);
            else effect.stats[key] = modifier * value;
          }
        }
        effect._isAmplified = true;
      }
    }
    if (0 < count) this.determineStats(true);
    return count;
  }
}
