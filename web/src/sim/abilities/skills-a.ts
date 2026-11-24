/**
 * Skills, first half of data.AbilityFunc (Basic … Shadow Strike).
 * Literal transcription: same operations, order, rounding and random draws.
 * passiveData (all literal) is read from gamedata.json, not ported here.
 */
import { mathRound } from "../lua.ts";
import {
  type AbilityFn,
  type Combatant,
  DMG_AOE,
  DMG_BACK,
  DMG_FRONT,
  DMG_MID,
  DMG_MIDLINE,
  ratioFromAttackResult,
} from "./common.ts";

/** The trailing basic attack several skills add ("damageSource = Basic"). */
const basicFollowUp = (self: Combatant) =>
  self.sendAttack({ atk: self.atk, matk: self.matk, damageSource: "Basic" });

export const skillsA: Record<string, AbilityFn> = {
  Basic(self) {
    self.sendAttack();
  },

  Slash(self) {
    self.sendAttack({ atk: self.atk * 1.6, matk: 0 });
  },
  "Slash II"(self) {
    self.sendAttack({ atk: self.atk * 2.4, matk: 0 });
  },
  "Slash & Bash"(self) {
    self.sendAttack({ atk: (self.atk + self.def) * 1.8, matk: 0 });
  },
  "Cheap Shot"(self) {
    self.sendAttack({ dmg: 0.9 * (self.atk + self.acc) });
  },
  "Cheap Shot II"(self) {
    self.sendAttack({ dmg: (self.atk + self.acc) * 1.4 });
  },
  "Kidney Shot"(self) {
    self.sendAttack({ atk: self.acc * 1.45, matk: 0 });
    basicFollowUp(self);
  },
  "Kidney Shot II"(self) {
    self.sendAttack({ atk: self.acc * 2.2, matk: 0 });
  },
  Puncture(self) {
    self.sendAttack({ dmg: self.acc * 1.1 });
  },
  "Puncture II"(self) {
    self.sendAttack({ dmg: self.acc * 1.7 });
  },
  "Expose Weakness"(self) {
    self.sendAttack({ atk: self.acc * 1.4, matk: 0 });
    self.party.addEffect({ name: "Expose Weakness", turns: 3, stats: { crit: 25 } });
    basicFollowUp(self);
  },
  Stab(self) {
    self.sendAttack({ atk: self.atk * 1.6, matk: 0, critMod: self.critMod + 0.5 });
  },
  "Stab II"(self) {
    self.sendAttack({ atk: self.atk * 2.3, matk: 0, critMod: self.critMod + 1 });
  },
  "Fatal Stab"(self) {
    self.sendAttack({ atk: self.acc * 2.3, matk: 0, critMod: self.critMod + 1 });
    basicFollowUp(self);
  },
  "Mind Blast"(self) {
    self.sendAttack({ atk: 0, matk: self.matk * 1.6 });
  },
  "Mind Blast II"(self) {
    self.sendAttack({ atk: 0, matk: self.matk * 2.4 });
  },
  "Dark Slash"(self) {
    self.sendAttack({ atk: self.atk * 1.3, matk: self.matk * 1.3 });
  },
  "Unholy Slash"(self) {
    const result = self.sendAttack({ atk: self.atk * 1.5, matk: self.matk * 1.5 });
    if (result && !result.missed) self.sendHeal(self, result.totalDamage * 0.07);
  },
  "Unholy Slash II"(self) {
    const result = self.sendAttack({ atk: self.atk * 2.2, matk: self.matk * 2.2 });
    if (result && !result.missed) self.sendHeal(self, result.totalDamage * 0.1);
  },
  "Divine Strike"(self) {
    self.sendAttack({ atk: self.atk * 1.4, matk: self.matk * 1.4 });
    self.sendHeal(self, self.matk * 0.2);
  },
  "Divine Strike II"(self) {
    self.sendAttack({ atk: self.atk * 1.8, matk: 0 });
    self.sendHeal(self, self.matk * 0.5);
  },
  "Twilight Strike"(self) {
    self.sendAttack({ dmg: (self.matk + self.atk) * 1.05 });
  },
  "Divine Smite"(self) {
    self.sendAttack({ atk: 0, matk: (self.matk + self.acc) * 1.3 });
    self.party.addEffect({ name: "Divine Smite", turns: 4, stats: { acc: 0.15, matk: 0.15 } });
  },
  "Templar Shield"(self) {
    self.sendAttack({ matk: self.mdef * 2 });
  },
  "Fortune Strike"(self) {
    const c = 1.4;
    self.sendAttack({ atk: self.atk * c, matk: self.matk * c });
    self.addEffect({ name: "Fortune Strike", stats: { lckMod: 1 }, trigger: "Permanent", stacks: true });
  },
  "Vicious Strike"(self) {
    self.sendAttack({ atk: self.atk * 1.6, matk: 0 });
    self.addEffect({ name: "Vicious Strike", turns: 3, stats: { atk: 0.3 } });
  },
  "Vicious Strike II"(self, target) {
    const result = self.sendAttack({ atk: self.atk * 2, matk: 0 });
    if (result && result.crit) {
      target.addEffect({
        name: "Bleeding",
        trigger: "DamageOnTurn",
        turns: 2,
        debuff: true,
        stats: { matk: 0, atk: self.atk, crit: self.crit, attacker: self },
      });
    }
  },
  "Magic Missile"(self) {
    self.sendAttack({ matk: self.matk * 1.6, atk: 0 });
    self.addEffect({ name: "Magic Missile", turns: 3, stats: { matk: 0.3 } });
  },
  "Magic Missile II"(self) {
    self.sendAttack({ matk: self.matk * 2, atk: 0 });
    self.addEffect({
      name: "Magic Missile II",
      trigger: "OnAttack",
      dmgFunc: (attack: any) => {
        attack.mdefPen = 60;
        return attack;
      },
    });
  },
  "Shield Slam"(self) {
    self.sendAttack({ atk: self.def * 1.4, matk: 0 });
    self.addEffect({ name: "Shield Slam", turns: 3, stats: { def: 0.4 } });
  },
  "Shield Slam II"(self) {
    self.sendAttack({ atk: self.def * 2, matk: 0 });
    // Same effect name as Shield Slam in the game.
    self.addEffect({ name: "Shield Slam", turns: 4, stats: { def: 0.6 } });
  },
  Enrage(self) {
    self.addEffect({ name: "Enraged", turns: 4, stats: { atk: 0.6 } });
    self.addEffect({
      name: "Enrage",
      turns: 4,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        self.addEffect({ name: "Enraged", stats: { atk: 0.1 }, stacks: true });
        return attack;
      },
    });
  },
  Protect(self) {
    self.addEffect({ name: "Protect", turns: 4, stats: { mdef: 0.5 } });
  },
  "Holy Blessing"(self) {
    self.party.addEffect({ name: "Holy Blessing", turns: 5, stats: { mdef: 0.4, atk: 0.15 } });
  },
  "Light's Grace"(self) {
    self.party.addEffect({
      name: "Light's Grace",
      turns: 5,
      trigger: "HealingOnTurn",
      heal: 0.05 * (self.mdef + self.matk),
      caster: self,
    });
  },
  Overwhelm(self) {
    self.party.addEffect({ name: "Overwhelm", turns: 4, stats: { atk: 0.25, matk: 0.25 } });
  },
  "Blind Fury"(self) {
    self.addEffect({ name: "Blind Fury", turns: 5, stats: { crit: 40, critMod: 0.3, acc: -0.3 } });
  },
  "Mortal Wound"(self, target) {
    const result = self.sendAttack({ atk: self.acc * 2.3, matk: 0 });
    if (result && !result.missed) {
      const c = 1.25;
      target.addEffect({
        name: "Mortal Wound",
        trigger: "DamageReceived",
        debuff: true,
        turns: 0,
        stats: { physicalDamage: c, magicDamage: c, trueDamage: c },
      });
    }
    basicFollowUp(self);
  },
  Ambush(self, target) {
    const result = self.sendAttack({ atk: (self.atk + self.acc) * 1.45, matk: 0 });
    if (result && !result.missed) {
      target.addEffect({ name: "Ambush", turns: 1, debuff: true, stats: { atk: -0.35 } });
    }
  },
  "Ambush II"(self, target) {
    const result = self.sendAttack({ atk: (self.atk + self.acc) * 3.3, matk: 0 });
    if (result && !result.missed) {
      target.addEffect({ name: "Ambush", turns: 1, debuff: true, stats: { atk: -0.6 } });
    }
  },
  "Sunder II"(self, target) {
    const result = self.sendAttack({ atk: (self.atk + self.acc) * 2, matk: 0 });
    if (result && !result.missed) {
      target.addEffect({ name: "Sunder", turns: 3, debuff: true, stats: { def: -0.49 } });
    }
  },
  Taunt(self, target) {
    const location = [0, 0, 0, 0, 0, 0, 0];
    const party = self.party;
    for (let n = 1; n <= 3; n++) {
      if (party.frontRow[n] === self) location[n * 2] = 1;
      if (party.backRow[n] === self) location[n * 2 - 1] = 1;
    }
    target.addEffect({
      name: "Taunt",
      trigger: "OnAttack",
      debuff: true,
      dmgFunc: (attack: any) => {
        attack.damageRatio = location;
        return attack;
      },
    });
  },
  "Berserk Smash"(self, target) {
    const result = self.sendAttack({ atk: self.atk * 2, matk: 0 });
    if (result && result.crit) {
      const dmg = mathRound(target.questHP * 0.03);
      if (0 < dmg) self.sendAttack({ dmg, hitChance: 100, damageSource: "Critical Smash" });
    }
  },
  Block(self) {
    self.addEffect({ name: "Block", turns: 1, trigger: "OnDamage", stats: { atk: 0.22 } });
  },
  Shield(self) {
    self.addEffect({ name: "Shield", turns: 1, trigger: "OnDamage", stats: { matk: 0.22 } });
  },
  "Holy Shield"(self) {
    const mdef = self.mdef * 1.3;
    self.party.addEffect(
      {
        name: "Holy Shield",
        turns: 1,
        statFunc: (combatant: any) => {
          let mdefMod = (combatant.mdefPct ?? 0) + 1;
          if (mdefMod < 1) mdefMod = 1;
          combatant.mdef = mdef / mdefMod;
        },
      },
      undefined,
      { adjustTurns: true, caster: self },
    );
  },
  Evade(self) {
    self.addEffect({ name: "Evade", trigger: "OnDamage", stats: { atk: 0.22, matk: 0.22, dmg: 0.22 } });
  },
  Terrify(self, target) {
    self.sendAttack({ atk: self.atk * 1.8, matk: self.matk * 1.8 });
    target.addEffect({ name: "Terrify", turns: 3, debuff: true, stats: { mdef: -0.49 } });
  },
  Rend(self, target) {
    target.addEffect({ name: "Rend", turns: 2, debuff: true, stats: { def: -0.25 } });
  },
  Slow(self, target) {
    target.addEffect({ name: "Slow", turns: 3, debuff: true, stats: { eva: -0.7 } });
    target.addEffect({
      name: "Slow Poison",
      trigger: "DamageOnTurn",
      turns: 3,
      debuff: true,
      stats: { matk: self.matk * 0.6, atk: 0, crit: self.crit, attacker: self },
    });
  },
  Poison(self, target) {
    // The location argument only matters when the target is the Party.
    target.addEffect(
      {
        name: "Poison",
        trigger: "DamageOnTurn",
        turns: 3,
        debuff: true,
        stats: { matk: self.matk * 0.7, atk: 0, crit: 0, attacker: self },
      },
      DMG_FRONT,
    );
  },
  "Crypt Poison"(self, target) {
    target.addEffect({
      name: "Crypt Poison",
      trigger: "DamageOnTurn",
      turns: 3,
      debuff: true,
      stats: { matk: 1.15 * self.matk, atk: 1.15 * self.atk, crit: self.crit, attacker: self },
    });
  },
  Sunder(self, target) {
    const result = self.sendAttack({ atk: (self.atk + self.acc) * 1.5, matk: 0 });
    if (result && !result.missed) {
      target.addEffect({ name: "Sunder", turns: 2, debuff: true, stats: { def: -0.4 } });
    }
  },
  Serenade(self, target) {
    self.addEffect({ name: "Serenade Def Drop", turns: 1, debuff: true, stats: { def: -0.9 } });
    target.addEffect({ name: "Serenade Atk Drop", turns: 1, debuff: true, stats: { atk: -0.4 } });
  },
  "Song of Courage"(self) {
    self.party.addEffect({
      name: "Song of Courage",
      stacks: true,
      trigger: "Permanent",
      stats: { atk: 0.12, matk: 0.12 },
    });
  },
  "Song of Defense"(self) {
    self.party.addEffect({
      name: "Song of Defense",
      trigger: "DamageReceived",
      dmgFunc: (attack: any) => {
        const c = 0.4;
        self.sendAttack({
          atk: attack.atk * c,
          matk: attack.matk * c,
          dmg: attack.trueDamage * c,
          hitChance: 100,
          crit: 0,
          luck: 0,
          damageSource: "Song of Defense",
        });
        attack.physicalDamage = attack.physicalDamage * (1 - c);
        attack.magicDamage = attack.magicDamage * (1 - c);
        attack.trueDamage = attack.trueDamage * (1 - c);
        return attack;
      },
    });
  },
  "Peaceful Respite"(self, target) {
    self.party.addEffect({ name: "Peaceful Respite", turns: 1, stats: { atk: -0.5, matk: -0.5 } });
    target.addEffect({ name: "Peaceful Respite", turns: 1, debuff: true, stats: { atk: -0.5, matk: -0.5 } });
  },
  "Poem of Focus"(self) {
    self.party.addEffect({ name: "Poem of Focus", turns: 1, stats: { critMod: 2.75 + self.lckMod * 0.01 } });
  },
  "Master Decoy"(self) {
    self.addEffect({ name: "Master Decoy Debuff", debuff: true, turns: 2, stats: { def: -0.5, mdef: -0.5 } });
    self.addEffect({
      name: "Master Decoy Heal",
      trigger: "DamageReceived",
      dmgFunc: (attack: any) => {
        self.party.receiveHeal(attack.totalDamage * 0.5);
        return attack;
      },
    });
  },
  Recharge() {},
  "Inspirational Song"(self) {
    let toBuff: Combatant = undefined;
    let useNext = false;
    for (let n = 1; n <= 3; n++) {
      let hero = self.party.backRow[n];
      if (hero && !hero.isDead) {
        if (useNext) {
          toBuff = hero;
          break;
        }
        if (toBuff === undefined) toBuff = hero;
        if (hero === self) useNext = true;
      }
      hero = self.party.frontRow[n];
      if (hero && !hero.isDead) {
        if (useNext) {
          toBuff = hero;
          break;
        }
        if (toBuff === undefined) toBuff = hero;
        if (hero === self) useNext = true;
      }
    }
    if (toBuff) {
      const mod = 1 + self.lckMod * 0.01;
      let atkTargetMod = 1 + (toBuff.atkPct ?? 0);
      let matkTargetMod = 1 + (toBuff.matkPct ?? 0);
      let accTargetMod = 1 + (toBuff.accPct ?? 0);
      if (atkTargetMod < 1) atkTargetMod = 1;
      if (matkTargetMod < 1) matkTargetMod = 1;
      if (accTargetMod < 1) accTargetMod = 1;
      const atkBns = mathRound((self.atk * mod) / atkTargetMod);
      const matkBns = mathRound((self.matk * mod) / matkTargetMod);
      const accBns = mathRound((self.acc * mod) / accTargetMod);
      let turns = 1;
      if (toBuff === self) turns = 2;
      toBuff.addEffect({ name: "Inspiration", stats: { atkBns, matkBns, accBns }, turns });
    }
  },
  Revive(self) {
    for (let n = 1; n <= 3; n++) {
      let hero = self.party.frontRow[n];
      if (hero && hero.isDead && hero.reviveCooldown === 0) {
        hero.receiveHeal(0.5, true, false, true);
        return true;
      }
      hero = self.party.backRow[n];
      if (hero && hero.isDead && hero.reviveCooldown === 0) {
        hero.receiveHeal(0.5, true, false, true);
        return true;
      }
    }
    return undefined;
  },
  Unbreakable(self) {
    self.removeAllEffects(true, true);
  },
  Cleanse(self) {
    self.party.removeAllEffects(true, true);
  },
  Silence(self, target) {
    target.removeAllEffects(false, true);
  },
  "Song of Negation"(self, target) {
    target.removeAllEffects(undefined, true);
  },
  "Lesser Heal"(self) {
    // For a front-row caster (even location) frontID is fractional: no hero there, so it heals itself.
    const frontID = (self.partyLocation + 1) / 2;
    const healing = 0.3 * (self.matk + self.acc) + 2 * self.level;
    if (self.party.frontRow[frontID] && self.party.frontRow[frontID].questHP > 0) {
      self.sendHeal(self.party.frontRow[frontID], healing);
    } else {
      self.sendHeal(self, healing);
    }
  },
  "Greater Heal"(self) {
    const healing = 0.11 * (self.matk + self.acc) + self.level;
    self.sendHeal(self.party, healing);
  },
  "Mana Shield"(self) {
    // addEffect stores a shallow copy; dmgFunc keeps updating `absorb` on this original object, as in Lua.
    const effect: any = {
      name: "Mana Shield",
      trigger: "DamageReceived",
      turns: 6,
      absorb: mathRound(self.matk * 0.6),
    };
    effect.dmgFunc = (attack: any) => {
      if (attack.magicDamage <= 0) return attack;
      const absorbed = Math.min(effect.absorb, attack.magicDamage);
      attack.magicDamage = attack.magicDamage - absorbed;
      effect.absorb = effect.absorb - absorbed;
      if (0 >= effect.absorb) {
        self.addEffect({ name: "Mana Shield", reversible: true, stats: {} });
      }
      return attack;
    };
    // Read by the battle page's trace only (U40): the copy in the effect list points here for the shield left.
    effect._live = effect;
    self.addEffect(effect);
    self.logger?.shield?.(effect.absorb);
  },
  "Amplify Magic"(self, target) {
    const debuffCount = target.amplifyEffects(true, 2);
    const damage = Math.max(debuffCount, 1) * 0.8 * self.matk;
    self.sendAttack({ matk: damage });
  },
  Streamline(self) {
    self.sendAttack({ atk: self.atk * 1.2, matk: 0 });
    self.addEffect({ name: "Streamline", turns: 4, stats: { eva: 0.25 } });
  },
  "Piercing strike"(self, target) {
    self.sendAttack({ atk: self.atk * 1.5, matk: 0 });
    target.addEffect({ name: "Piercing strike", turns: 3, stats: { def: -0.3 } });
  },
  "Tail Swipe"(self) {
    self.sendAttack({ damageRatio: DMG_FRONT, atk: 0.8 * self.atk });
  },
  Weaken(self, target) {
    self.sendAttack({ atk: 0, matk: self.matk * 1.2 });
    target.addEffect({ name: "Weaken", turns: 3, debuff: true, stats: { matk: -0.25 } });
  },
  Charge(self) {
    self.sendAttack({ atk: self.atk * 1.6, matk: 0 });
  },
  Cleave(self) {
    self.sendAttack({ damageRatio: DMG_FRONT, atk: self.atk });
  },
  "Savage Charge"(self) {
    self.sendAttack({ damageRatio: DMG_MID, atk: 2.5 * self.atk });
  },
  "Iron Hide"(self) {
    self.addEffect({ name: "Iron Hide", turns: 4, stats: { atk: 0.5, def: 0.5 } });
    self.addEffect({ name: "Block", trigger: "OnDamage", stats: { atk: 0, matk: 0 } });
  },
  "Shadow Dance"(self) {
    self.addEffect({ name: "Shadow Dance", turns: 4, stats: { atk: 0.25, eva: 0.5 } });
  },
  "Swift Strike"(self) {
    self.sendAttack({ dmg: self.atk, atk: 0, matk: 0 });
  },
  Harden(self) {
    self.addEffect({ name: "Harden", turns: 4, stats: { def: 0.5, mdef: 0.5 } });
    self.addEffect({ name: "Block", trigger: "OnDamage", stats: { atk: 0, matk: 0 } });
  },
  "Deadly Venom"(self, target) {
    target.addEffect(
      {
        name: "Deadly Venom",
        trigger: "DamageOnTurn",
        turns: 3,
        debuff: true,
        stats: { matk: self.matk * 0.7, atk: 0, crit: 0, attacker: self },
      },
      DMG_BACK,
    );
  },
  "Unholy Cleave"(self, target) {
    const result = self.sendAttack({ atk: self.atk * 1.8 });
    target.addEffect(
      { name: "Unholy Cleave", turns: 4, debuff: true, stats: { def: -0.5 } },
      ratioFromAttackResult(result),
    );
  },
  "Flame Breath"(self, target) {
    self.sendAttack({ atk: 1.2 * self.atk, matk: 1.2 * self.matk, damageRatio: DMG_AOE });
    target.addEffect(
      { name: "Flame Breath", turns: 4, debuff: true, stats: { def: -0.25, mdef: -0.25 } },
      DMG_FRONT,
    );
  },
  "Dragon Scales"(self) {
    self.addEffect({ name: "Dragon Scales", turns: 4, stats: { atk: 0.5, mdef: 0.5 } });
  },
  "Lava Whip"(self) {
    self.sendAttack({ atk: self.atk * 2 });
  },
  "Dark Power"(self) {
    self.addEffect({ name: "Dark Power", turns: 4, stats: { atk: 0.5, matk: 0.25 } });
  },
  "Demon Slash"(self) {
    self.sendAttack({ atk: self.atk * 1.8, matk: self.matk * 1.2 });
  },
  "Terrify II"(self, target) {
    self.sendAttack({ atk: 0, matk: 1 * self.matk, damageRatio: DMG_AOE });
    target.addEffect({ name: "Terrify II", turns: 3, debuff: true, stats: { mdef: -0.5 } }, DMG_AOE);
  },
  "Shadow Flame"(self) {
    self.sendAttack({ damageRatio: DMG_AOE, matk: 0.8 * self.matk });
  },
  "Heat Wave"(self, target) {
    target.addEffect({ name: "Heat Wave", turns: 3, debuff: true, stats: { atk: -0.25, mdef: -0.5 } }, DMG_AOE);
  },
  "Phoenix Strike"(self) {
    self.sendAttack({ damageRatio: DMG_AOE, matk: 0.8 * self.matk });
  },
  Restore(self) {
    self.sendHeal(self, self.matk * 2);
    self.removeAllEffects(true, true);
  },
  "Ferocious Bite"(self) {
    self.sendAttack({ damageRatio: DMG_FRONT, atk: self.atk * 1.6 });
  },
  "Cerberus Claw"(self) {
    self.sendAttack({ atk: self.atk * 2.4, defPen: 32 });
  },
  "Tail Swipe II"(self) {
    self.sendAttack({ damageRatio: DMG_FRONT, atk: 1.2 * self.atk });
  },
  "Hydro Slash"(self) {
    self.sendAttack({ atk: self.atk * 1.2, matk: self.matk * 1.2 });
  },
  "Inner Fire"(self) {
    self.addEffect({ name: "Inner Fire", turns: 4, stats: { atk: 0.5, matk: 0.5 } });
  },
  "Fatal Gaze"(self) {
    self.sendAttack({ damageRatio: DMG_MIDLINE, matk: 2.5 * self.matk });
  },
  "Perish Song"(self, target) {
    target.addEffect(
      {
        name: "Perish Song",
        trigger: "DamageOnTurn",
        turns: 3,
        debuff: true,
        stats: { matk: self.matk * 0.7, atk: 0, crit: 0, attacker: self },
      },
      DMG_AOE,
    );
  },
  "Earth Shield"(self) {
    self.sendHeal(self, self.def * 1, false, true);
  },
  Earthquake(self) {
    self.sendAttack({ damageRatio: DMG_AOE, atk: 0.8 * self.atk });
  },
  "Aqua Shield"(self) {
    self.sendHeal(self, self.matk * 0.8, false, true);
  },
  "8 Arm Smash"(self) {
    self.sendAttack({ damageRatio: DMG_AOE, matk: 0.8 * self.matk });
  },
  "Shadow Dance II"(self) {
    self.addEffect({ name: "Shadow Dance II", turns: 4, stats: { atk: 0.5, eva: 0.8 } });
  },
  "Shadow Strike"(self) {
    self.sendAttack({ damageRatio: DMG_MIDLINE, atk: 2.5 * self.atk, matk: 2.5 * self.matk });
  },
};
