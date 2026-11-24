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

/**
 * U40: the damage and heal calculations, recorded only while a sink is set (the battle page's traced fight). Each
 * record holds the real intermediate values of one hit or one heal. Recording only reads: no result changes, and
 * without a sink nothing is built (one property check per attack, heal and effect).
 */
export interface CalcSink {
  attack(rec: Any): void;
  heal(rec: Any): void;
  /** An effect was put on (or stacked on, or cast again on) a fighter. */
  effect(target: Combatant, effect: Effect): void;
}

/** Optional hook called after every action (trace / per-skill damage, as the former Lua harness recorded them). */
export const hooks: { afterAction?: (c: Combatant, name: Any, before: Any) => void; beforeAction?: (c: Combatant) => Any; calc?: CalcSink } = {};

/**
 * While a calc sink is set: the attacks and heals being sent (innermost last: a reflect sends from inside another
 * attack), the effects whose dmgFunc runs (innermost last), and the damage or heal over time being applied.
 */
export const calcState: { sends: Any[]; heals: Any[]; effects: string[]; tick?: { name: string; from?: Any }; seq: number } = {
  sends: [], heals: [], effects: [], seq: 0,
};
/** The attack's three parts (physical, magic, true) as numbers. */
const parts3 = (a: Any) => ({ atk: Number(a.atk) || 0, matk: Number(a.matk) || 0, dmg: Number(a.dmg) || 0 });
const dmg3 = (a: Any) => ({ p: Number(a.physicalDamage) || 0, m: Number(a.magicDamage) || 0, t: Number(a.trueDamage) || 0 });
/** A fighter's stats a skill's formula may start from, and its stat effects then (for the calculation's notes). */
function statsOf(c: Any): Any {
  return {
    atk: c.atk, matk: c.matk, acc: c.acc, def: c.def, mdef: c.mdef, maxHP: c.maxHP, level: c.level,
    fx: (c.effectList ?? []).filter((e: Effect) => e.stats && typeof e.stats === "object")
      .map((e: Effect) => ({ name: e.name, stats: Object.fromEntries(Object.entries(e.stats).filter(([, v]) => typeof v === "number")) })),
  };
}
/** Run an effect's dmgFunc with its name on the calc stack (tracing only), so what it sends is named after it. */
function runDmgFunc(effect: Effect, attack: Any): Any {
  if (!hooks.calc) return effect.dmgFunc!(attack);
  calcState.effects.push(effect.name);
  try {
    return effect.dmgFunc!(attack);
  } finally {
    calcState.effects.pop();
  }
}

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
    // What the combatant really played (read by the trace only): the skill, false when stunned, null when dead.
    this._did = null;
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
    this._did = actionName;
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
        if (hooks.calc) calcState.tick = { name: e.name, from: e.caster };
        const healingReceived = this.receiveHeal(e.heal as number);
        calcState.tick = undefined;
        e.caster!.combatStatistics.recordHealingDone(healingReceived);
      } else if (e.trigger === "DamageOnTurn") {
        e.turns = (e.turns as number) - 1;
        const dotStats = copyTable(e.stats);
        dotStats.atk = dotStats.atk ?? 0;
        dotStats.matk = dotStats.matk ?? 0;
        dotStats.crit = dotStats.crit ?? 0;
        dotStats.isDot = true;
        if (hooks.calc) calcState.tick = { name: e.name, from: dotStats.attacker };
        this.receiveAttack(dotStats);
        calcState.tick = undefined;
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
    // U40 (tracing only): what the skill sent, before the attacker's on-attack effects.
    const send: Any = hooks.calc
      ? { from: this, target, src: params?.damageSource ?? calcState.effects[calcState.effects.length - 1] ?? this._did,
        stat: statsOf(this), base: parts3(attackParams), onAttack: [] }
      : undefined;
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
            attackParams = runDmgFunc(effect, attackParams);
          } else {
            for (const key of Object.keys(effect.stats)) attackParams[key] = attackParams[key] + effect.stats[key];
          }
          if (send) send.onAttack.push({ name: effect.name, after: attackParams ? parts3(attackParams) : null });
        }
        if (!truthy(effect.turns)) effect.remove = true;
      }
    }
    if (attackParams) {
      if (send) {
        calcState.sends.push(send);
        try {
          result = target.receiveAttack(attackParams);
        } finally {
          calcState.sends.pop();
        }
      } else result = target.receiveAttack(attackParams);
    }
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
    if (e && hooks.calc) hooks.calc.effect(this, e);
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
    let totalHeal: number;
    if (hooks.calc) {
      calcState.heals.push({ from: this, src: calcState.effects[calcState.effects.length - 1] ?? this._did, stat: statsOf(this) });
      try {
        totalHeal = target.receiveHeal(amount, revive, overload, isPercent);
      } finally {
        calcState.heals.pop();
      }
    } else totalHeal = target.receiveHeal(amount, revive, overload, isPercent);
    this.combatStatistics.recordHealingDone(totalHeal);
  }

  receiveHeal(amount: number, revive?: boolean, overload?: boolean, isPercent?: boolean): number {
    if (this.isDead && !revive) return 0;
    const hpBefore = this.questHP;
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
    if (hooks.calc) {
      const ctx = calcState.heals[calcState.heals.length - 1], tick = calcState.tick;
      hooks.calc.heal({ seq: calcState.seq++, to: this, from: tick ? tick.from : ctx?.from,
        src: tick ? tick.name : ctx ? ctx.src : calcState.effects[calcState.effects.length - 1], tick: Boolean(tick),
        stat: tick ? null : ctx?.stat ?? null, amount, isPercent: Boolean(isPercent), revive: Boolean(revive), overload: Boolean(overload),
        maxHP: this.maxHP, total: totalHeal, hpBefore, hpAfter: this.questHP });
    }
    return totalHeal;
  }

  receiveAttack(attack: Any): Any {
    // U40 (tracing only): the hit's calculation, stage by stage, with the values the game really used.
    let rec: Any;
    if (hooks.calc) {
      const top = calcState.sends[calcState.sends.length - 1], tick = calcState.tick;
      const send = !tick && top && (top.target === this || (top.target?.name === "Party" && this.partyLocation)) ? top : undefined;
      rec = { seq: calcState.seq++, to: this, from: attack.attacker, src: tick ? tick.name : send ? send.src : attack.damageSource ?? attack.attacker?._did,
        tick: Boolean(tick), stat: send?.stat ?? null, base: send?.base ?? null, onAttack: send?.onAttack ?? [], arrived: parts3(attack),
        onDamage: [], received: [], hpBefore: this.questHP };
    }
    if (attack.damageRatio) {
      const mod = attack.damageRatio[this.partyLocation];
      if (mod === 0) return { totalDamage: 0, atk: 0, matk: 0, crit: false, zeroRatio: true };
      attack.atk = attack.atk * mod;
      attack.matk = attack.matk * mod;
      attack.dmg = attack.dmg * mod;
      if (rec) rec.ratio = mod;
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
            attack = runDmgFunc(effect, attack);
          } else if (effect.stats) {
            for (const key of Object.keys(effect.stats)) {
              if (truthy(attack[key])) attack[key] = attack[key] * effect.stats[key];
            }
          }
          if (rec) rec.onDamage.push({ name: effect.name, after: parts3(attack), hitChance: attack.hitChance });
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
      if (rec) hooks.calc!.attack(Object.assign(rec, { missed: true, hitChance, total: 0, hpAfter: this.questHP }));
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
    if (rec) {
      Object.assign(rec, { hitChance, crit: isCrit, luck: isLuck, critChance: attack.crit, dmgMod, used: parts3(attack), def: this.def,
        defPen: attack.defPen ?? 0, defRed: defReduction, mdef: this.mdef, mdefPen: attack.mdefPen ?? 0, mdefRed: mdefReduction, raw: dmg3(attack) });
    }
    if (0 < attack.totalDamage) {
      for (let n = this.effectList.length - 1; n >= 0; n--) {
        const effect = this.effectList[n];
        if (effect.trigger === "DamageReceived" && !effect.remove) {
          const doRemove = !truthy(effect.turns);
          if (doRemove) effect.remove = true;
          if (effect.dmgFunc) {
            attack = runDmgFunc(effect, attack);
          } else {
            for (const key of Object.keys(effect.stats)) attack[key] = attack[key] * effect.stats[key];
          }
          if (rec) rec.received.push({ name: effect.name, after: dmg3(attack) });
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
    if (rec) hooks.calc!.attack(Object.assign(rec, { total: attack.totalDamage, final: dmg3(attack), hpAfter: this.questHP }));
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
