/**
 * Skills, second half of data.AbilityFunc (from `Snap` to the end of the file).
 * Literal transcription: same operations, same order, same random draws.
 */
import { mathRound, random, truthy } from "../lua.ts";
import {
  type AbilityFn,
  DMG_AOE,
  DMG_BACK,
  DMG_FRONT,
  DMG_MID,
  ratioFromAttackResult,
} from "./common.ts";

/**
 * A Lua table constructor drops fields whose value is nil. Strip `undefined`
 * fields the same way, so `sendAttack` never sees a key Lua would not have.
 */
function tbl<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Shared by the two identical `Reflect` definitions in the Lua (the second overwrites the first). */
const reflect: AbilityFn = (self, _target) => {
  self.addEffect({
    name: "Reflect",
    trigger: "DamageReceived",
    turns: 1,
    dmgFunc: (attack: any) => {
      const reflectAmount = 0.5;
      if (attack.magicDamage <= 0) {
        return attack;
      }
      self.sendAttack({
        matk: attack.matk * reflectAmount,
        damageSource: "Reflect",
      });
      attack.matk = attack.matk * (1 - reflectAmount);
      return attack;
    },
  });
};

const swapAtkMatk = (hero: any) => {
  const atk = hero.atk;
  hero.atk = hero.matk;
  hero.matk = atk;
};

export const skillsB: Record<string, AbilityFn> = {
  Snap: (self, _target) => {
    self.sendAttack({
      atk: self.atk * 1.8,
    });
  },

  "Charge II": (self, _target) => {
    self.sendAttack({
      atk: self.atk * 2,
      matk: 0,
    });
  },

  Stomp: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: 0.7 * self.atk,
    });
  },

  "Skorge Slash": (self, _target) => {
    self.sendAttack({
      atk: self.atk * 2.5,
      matk: self.matk * 2.5,
    });
  },

  "Fire Shield": (self, _target) => {
    self.sendHeal(self, self.matk * 5, false, true);
  },

  "Dragon Lash": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_FRONT,
      atk: 3 * self.atk,
    });
  },

  "Dragon Breath": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: 0.5 * self.atk,
      matk: 0.5 * self.matk,
    });
  },

  Pyroblast: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_MID,
      matk: 3 * self.matk,
    });
  },

  Hellfire: (self, target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: 0.8 * self.matk,
    });
    target.addEffect({
      name: "Hellfire",
      trigger: "DamageOnTurn",
      turns: 3,
      debuff: true,
      stats: {
        matk: self.matk * 0.2,
        atk: 0,
        crit: 0,
        attacker: self,
      },
    });
  },

  "Fire Shield II": (self, _target) => {
    self.sendHeal(self, self.matk * 5, false, true);
  },

  "Ground Slam": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.def,
    });
  },

  "Dark Flame": (self, target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      dmg: 0.5 * self.matk,
    });
    target.addEffect({
      name: "Dark Flame",
      turns: 3,
      debuff: true,
      stats: { def: -0.5 },
    }, DMG_AOE);
  },

  Devour: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_MID,
      atk: 5 * self.atk,
    });
  },

  "Colossal Stomp": (self, _target) => {
    self.sendAttack({
      atk: self.atk * 3,
      matk: 0,
      defPen: 37,
    });
  },

  "Earthquake II": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: self.atk,
    });
  },

  "Battering Ram": (self, target) => {
    const result = self.sendAttack({
      atk: self.atk * 2,
      matk: 0,
    });
    target.addEffect({
      name: "Battering Ram",
      turns: 3,
      debuff: true,
      stats: { def: -0.7 },
    }, ratioFromAttackResult(result));
  },

  "Desolate Howl": (self, _target) => {
    self.addEffect({
      name: "Desolate Howl",
      turns: 3,
      stats: { atk: 0.5, eva: 0.5 },
    });
    self.sendAttack({
      damageRatio: DMG_AOE,
      dmg: 0.2 * self.atk,
    });
  },

  "Savage Bite": (self, _target) => {
    self.sendAttack({
      atk: self.atk * 3,
      matk: 0,
      defPen: 40,
    });
  },

  Terror: (self, target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: 1.2 * self.matk,
    });
    target.addEffect({
      name: "Terror",
      turns: 5,
      debuff: true,
      stats: { mdef: -0.6 },
    }, DMG_AOE);
  },

  Nightmare: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk * 1.5,
    });
  },

  Corruption: (self, target) => {
    target.addEffect({
      name: "Corruption",
      trigger: "DamageOnTurn",
      turns: 3,
      debuff: true,
      stats: {
        matk: self.matk * 2,
        atk: 0,
        crit: 0,
        attacker: self,
      },
    }, DMG_AOE);
  },

  "Titanic Slam": (self, _target) => {
    self.sendAttack({
      atk: self.atk * 3,
      matk: 0,
    });
  },

  "Hungering Strike": (self, _target) => {
    const result = self.sendAttack({
      atk: self.atk * 3,
      matk: 0,
      defPen: 40,
    });
    if (truthy(result)) {
      let heal = 0;
      // `#result` is 0 for a single-target result table (no array part).
      if (Array.isArray(result)) {
        for (let n = 0; n < result.length; n++) {
          if (truthy(result[n].totalDamage) && 0 < result[n].totalDamage) {
            heal = heal + result[n].totalDamage * 1;
          }
        }
      }
      self.sendHeal(self, heal);
    }
  },

  Bulwark: (self, _target) => {
    self.sendHeal(self, self.def * 5, false, true);
    self.addEffect({
      name: "Bulwark",
      turns: 3,
      stats: { def: 0.8 },
    });
  },

  Undertow: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_FRONT,
      atk: (self.atk + self.def) * 1.5,
    });
  },

  Rampart: (self, _target) => {
    self.addEffect({
      name: "Rampart",
      stacks: true,
      trigger: "Permanent",
      stats: { def: 1, atk: 0.25 },
    });
  },

  "Earthquake III": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: 2 * self.atk,
    });
  },

  "Unstoppable Force": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_FRONT,
      atk: 3 * self.atk,
      defPen: 40,
    });
  },

  "Arctic Fury": (self, _target) => {
    self.addEffect({
      name: "Arctic Fury",
      stacks: true,
      trigger: "Permanent",
      stats: { atk: 0.5 },
    });
  },

  Malice: (self, _target) => {
    self.sendAttack({
      atk: self.atk * 4,
      matk: 0,
      defPen: 47,
    });
  },

  Elusion: (self, _target) => {
    self.addEffect({
      name: "Elusion",
      trigger: "OnDamage",
      turns: 3,
      dmgFunc: (attack: any) => {
        if (!truthy(attack.isDot)) {
          attack.hitChance = 50;
        }
        return attack;
      },
    });
  },

  "Anti Magic Shell": (self, _target) => {
    self.addEffect({
      name: "Anti Magic Shell",
      turns: 3,
      stats: { mdef: 100 },
    });
  },

  "Malific Vision": (self, _target) => {
    self.sendAttack({
      atk: 0,
      matk: self.matk * 4,
      mdefPen: 40,
    });
  },

  "Death Touch": (self, _target) => {
    const matk = 3.2 * self.matk;
    const result = self.sendAttack({
      // Lua {0, 0, 1, 0, 0, 0}: location 3 only.
      damageRatio: [0, 0, 0, 1, 0, 0, 0],
      matk: matk,
    });
    let needAoe = true;
    if (truthy(result) && Array.isArray(result)) {
      for (let n = 0; n < result.length; n++) {
        if (!truthy(result[n].zeroRatio)) {
          needAoe = false;
        }
      }
    }
    if (needAoe) {
      self.sendAttack({ damageRatio: DMG_AOE, matk: matk });
    }
  },

  "Ice Barrier": (self, target) => {
    self.sendHeal(self, self.matk * 5, false, true);
    target.addEffect({
      name: "Ice",
      turns: 2,
      stats: { acc: -0.5 },
      debuff: true,
    }, DMG_FRONT);
  },

  "Obsidian Shield": (self, _target) => {
    self.addEffect({
      name: "Obsidian Shield",
      turns: 3,
      stats: { def: 100 },
    });
  },

  "Undertow II": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_BACK,
      atk: 2 * self.atk,
    });
  },

  Reflect: reflect,

  Demolish: (self, _target) => {
    self.sendAttack({
      atk: self.atk * 4,
      matk: 0,
      defPen: 40,
    });
  },

  Absorb: (self, _target) => {
    self.addEffect({
      name: "Absorb",
      turns: 3,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const absorbAmount = 0.5;
        self.sendHeal(self, attack.matk * absorbAmount);
        attack.matk = attack.matk * (1 - absorbAmount);
        return attack;
      },
    });
  },

  Requiem: (self, target) => {
    target.addEffect({
      name: "Requiem",
      trigger: "DamageOnTurn",
      turns: 5,
      debuff: true,
      stats: {
        matk: self.matk * 1.2,
        atk: 0,
        crit: 0,
        attacker: self,
      },
    }, DMG_AOE);
  },

  Defile: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: 1.6 * self.matk,
      mdefPen: 45,
    });
  },

  "Siphon Soul": (self, _target) => {
    const result = self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk * 1.5,
    });
    if (truthy(result)) {
      let heal = 0;
      if (Array.isArray(result)) {
        for (let n = 0; n < result.length; n++) {
          if (truthy(result[n].matk)) {
            heal = heal + result[n].matk;
          }
        }
      }
      self.sendHeal(self, heal);
    }
  },

  Pulverize: (self, target) => {
    const result = self.sendAttack({
      atk: self.atk * 3,
      matk: 0,
      defPen: 45,
    });
    target.addEffect({
      name: "Stun",
      debuff: true,
      trigger: "OnDetermineAction",
      triggerFunc: (_combatant: any, _actionName: any) => {
        return false;
      },
    }, ratioFromAttackResult(result));
  },

  Cataclysm: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: 2.6 * self.atk,
    });
  },

  "Unbreakable Will": (self, _target) => {
    self.removeAllEffects(true, true);
    self.addEffect({
      name: "Unbreakable Will",
      turns: 3,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const reflectAmount = 0.75;
        self.sendAttack({
          atk: attack.atk * reflectAmount,
          matk: 0,
          hitChance: 100,
          damageSource: "Unbreakable Will",
        });
        attack.atk = attack.atk * (1 - reflectAmount);
        return attack;
      },
    });
  },

  "Oblivion Shield": (self, _target) => {
    self.sendHeal(self, self.atk * 1, false, true);
  },

  "Glacial Prism": (self, _target) => {
    self.addEffect({
      name: "Glacial Prism",
      turns: 3,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const reflectAmount = 0.5;
        self.sendAttack({
          atk: attack.atk * reflectAmount,
          matk: attack.matk * reflectAmount,
          hitChance: 100,
          damageSource: "Glacial Prism",
        });
        attack.atk = attack.atk * (1 - reflectAmount);
        attack.matk = attack.matk * (1 - reflectAmount);
        return attack;
      },
    });
  },

  "Winters Bite": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk * 3,
      mdefPen: 40,
    });
  },

  "Devouring Cold": (self, _target) => {
    self.addEffect({
      name: "Devouring Cold",
      turns: 3,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const absorbAmount = 0.5;
        const amount = (attack.atk + attack.matk) * absorbAmount;
        self.sendHeal(self, amount);
        attack.atk = attack.atk * (1 - absorbAmount);
        attack.matk = attack.matk * (1 - absorbAmount);
        return attack;
      },
    });
  },

  Oblivion: (self, _target) => {
    self.sendAttack({
      atk: self.atk * 3,
      matk: self.matk * 3,
    });
  },

  "Swap Attack": (self, _target) => {
    self.addEffect({
      name: "Swap Attack",
      reversible: true,
      statFunc: swapAtkMatk,
    });
  },

  "Swap Defense": (self, _target) => {
    self.addEffect({
      name: "Swap Defense",
      reversible: true,
      statFunc: (hero: any) => {
        const def = hero.def;
        hero.def = hero.mdef;
        hero.mdef = def;
      },
    });
  },

  "Double Image": (_self, target) => {
    target.addEffect({
      name: "Double Image",
      trigger: "OnAttack",
      debuff: true,
      turns: 1,
      dmgFunc: (attack: any) => {
        if (random(0, 1) === 1) {
          target.logger.actionChanged(false, "Double Image");
          return false;
        }
        return attack;
      },
    });
  },

  "Atk Immune": (self, _target) => {
    self.addEffect({
      name: "Atk Immune",
      trigger: "DamageReceived",
      stats: { physicalDamage: 0 },
    });
  },

  "Matk Immune": (self, _target) => {
    self.addEffect({
      name: "Matk Immune",
      trigger: "DamageReceived",
      stats: { magicDamage: 0 },
    });
  },

  "Def Growth": (self, _target) => {
    self.addEffect({
      name: "Def Growth",
      stacks: true,
      trigger: "Permanent",
      stats: { def: 0.1 },
    });
  },

  "Mdef Growth": (self, _target) => {
    self.addEffect({
      name: "Mdef Growth",
      stacks: true,
      trigger: "Permanent",
      stats: { mdef: 0.1 },
    });
  },

  "Atk Growth": (self, _target) => {
    self.addEffect({
      name: "Atk Growth",
      stacks: true,
      trigger: "Permanent",
      stats: { atk: 0.1 },
    });
  },

  "Matk Growth": (self, _target) => {
    self.addEffect({
      name: "Matk Growth",
      stacks: true,
      trigger: "Permanent",
      stats: { matk: 0.1 },
    });
  },

  Explode: (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk,
    });
    const attackParams = {
      attacker: self,
      atk: 0,
      matk: self.matk,
      acc: self.acc,
      crit: self.crit,
      critMod: self.critMod,
    };
    self.receiveAttack(attackParams);
  },

  // Drain skills: `result.atk` errors in Lua when sendAttack returned nil
  // (attack cancelled by Double Image); property access on undefined throws here too.
  "Atk Drain": (self, _target) => {
    const result = self.sendAttack({
      atk: self.atk * 0.5,
    });
    if (truthy(result.atk)) {
      self.sendHeal(self, result.atk);
    }
  },

  "Atk Drain II": (self, _target) => {
    const result = self.sendAttack({
      atk: self.atk * 0.8,
    });
    if (truthy(result.atk)) {
      self.sendHeal(self, result.atk);
    }
  },

  "Matk Drain": (self, _target) => {
    const result = self.sendAttack({
      matk: self.matk * 0.5,
    });
    if (truthy(result.matk)) {
      self.sendHeal(self, result.matk);
    }
  },

  "Matk Drain II": (self, _target) => {
    const result = self.sendAttack({
      matk: self.matk * 0.8,
    });
    if (truthy(result.matk)) {
      self.sendHeal(self, result.matk);
    }
  },

  "Vampire Blast": (self, _target) => {
    const result = self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk * 0.5,
    });
    if (truthy(result) && Array.isArray(result)) {
      for (let n = 0; n < result.length; n++) {
        if (truthy(result[n].matk)) {
          self.sendHeal(self, result[n].matk);
        }
      }
    }
  },

  "Absorb Atk": (self, _target) => {
    self.addEffect({
      name: "Absorb Atk",
      turns: 1,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const absorbAmount = 0.75;
        self.sendHeal(self, attack.atk * absorbAmount);
        attack.atk = attack.atk * (1 - absorbAmount);
        return attack;
      },
    });
  },

  "Absorb Matk": (self, _target) => {
    self.addEffect({
      name: "Absorb Matk",
      turns: 1,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const absorbAmount = 0.75;
        self.sendHeal(self, attack.matk * absorbAmount);
        attack.matk = attack.matk * (1 - absorbAmount);
        return attack;
      },
    });
  },

  "Absorb All": (self, _target) => {
    self.addEffect({
      name: "Absorb All",
      turns: 1,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const absorbAmount = 0.5;
        self.sendHeal(self, (attack.atk + attack.matk) * absorbAmount);
        attack.atk = attack.atk * (1 - absorbAmount);
        attack.matk = attack.matk * (1 - absorbAmount);
        return attack;
      },
    });
  },

  "Reflect Atk": (self, _target) => {
    self.addEffect({
      name: "Reflect Atk",
      turns: 1,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const reflectAmount = 0.8;
        self.sendAttack({
          atk: attack.atk * reflectAmount,
          matk: 0,
          hitChance: 100,
        });
        attack.atk = attack.atk * (1 - reflectAmount);
        return attack;
      },
    });
  },

  "Reflect Matk": (self, _target) => {
    self.addEffect({
      name: "Reflect Matk",
      turns: 1,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const reflectAmount = 0.8;
        self.sendAttack({
          matk: attack.matk * reflectAmount,
          atk: 0,
          hitChance: 100,
        });
        attack.matk = attack.matk * (1 - reflectAmount);
        return attack;
      },
    });
  },

  "Reflect All": (self, _target) => {
    const reflectAll = (attack: any) => {
      const reflectAmount = 0.5;
      self.sendAttack({
        atk: attack.atk * reflectAmount,
        matk: attack.matk * reflectAmount,
        hitChance: 100,
      });
      attack.atk = attack.atk * (1 - reflectAmount);
      attack.matk = attack.matk * (1 - reflectAmount);
      return attack;
    };
    self.addEffect({
      name: "Reflect All",
      turns: 1,
      trigger: "OnDamage",
      dmgFunc: reflectAll,
    });
  },

  Confuse: (_self, _target) => {},

  Obliterate: (self, _target) => {
    const randomKill = random(1, 6);
    const dmg = [0, 0, 0, 0, 0, 0, 0];
    dmg[randomKill] = 1;
    // `trueDmg` is not a key sendAttack copies, so the game ignores it: the attack
    // uses the full atk and matk of the caster. Kept as in the Lua.
    self.sendAttack({
      damageRatio: dmg,
      trueDmg: 2000,
      hitChance: 100,
    });
  },

  "Fury Storm": (self, _target) => {
    self.sendAttack({
      atk: self.atk * 0.7,
      matk: 0,
    });
    self.sendAttack({
      atk: self.atk * 0.7,
      matk: 0,
    });
    self.sendAttack({
      atk: self.atk * 0.7,
      matk: 0,
    });
    self.sendAttack({
      atk: self.atk * 0.7,
      matk: 0,
    });
  },

  Retaliation: (self, _target) => {
    self.addEffect({
      name: "Retaliation",
      turns: 1,
      trigger: "OnDamage",
      cannotDispell: true,
      dmgFunc: (attack: any) => {
        if (attack.atk > 0 && !truthy(attack.isDot)) {
          const attacker = attack.attacker;
          let ratio: number[] | undefined;
          if (truthy(attacker.partyLocation)) {
            ratio = [0, 0, 0, 0, 0, 0, 0];
            ratio[attacker.partyLocation] = 1;
          }
          self.sendAttack(tbl({
            atk: self.atk * 2,
            matk: 0,
            damageRatio: ratio,
            damageSource: "Retaliation",
          }));
        }
        return attack;
      },
    });
  },

  "Demon Slash II": (self, _target) => {
    self.sendAttack({
      atk: self.atk * 2.5,
      matk: self.matk * 1.5,
    });
  },

  Execute: (self, target) => {
    const location = target.getHeroByStat("questHP", false);
    const ratio = [0, 0, 0, 0, 0, 0, 0];
    // location 0 (no hero alive) writes ratio[0], which Lua never reads either.
    ratio[location] = 1;
    self.sendAttack({
      damageRatio: ratio,
      matk: self.matk * 2,
      atk: self.atk * 3,
    });
  },

  "Hellfire II": (self, target) => {
    const result = self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk * 1.5,
      atk: 0,
    });
    target.addEffect({
      name: "Hellfire II",
      trigger: "DamageOnTurn",
      turns: 2,
      debuff: true,
      stats: {
        matk: self.matk * 0.4,
        atk: 0,
        crit: 0,
        attacker: self,
      },
    }, ratioFromAttackResult(result));
  },

  "Burning Touch": (self, target) => {
    const result = self.sendAttack({
      matk: self.matk * 2,
    });
    target.addEffect({
      name: "Burning Touch",
      trigger: "DamageOnTurn",
      turns: 3,
      debuff: true,
      stats: {
        matk: self.matk * 0.7,
        atk: 0,
        crit: 0,
        attacker: self,
      },
    }, ratioFromAttackResult(result));
  },

  Disharmony: (self, target) => {
    self.addEffect({
      name: "Disharmony Buff",
      stacks: true,
      turns: 3,
      stats: { matk: 0.5 },
    });
    target.addEffect({
      name: "Disharmony Debuff",
      turns: 3,
      debuff: true,
      stats: { mdef: -0.6 },
    });
  },

  "Living Flame": (self, _target) => {
    self.sendHeal(self, self.matk * 3);
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk,
      atk: 0,
    });
  },

  "Grand Duel": (self, _target) => {
    self.addEffect({
      name: "Grand Duel",
      turns: 3,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        const reflectAmount = 1;
        self.sendAttack({
          atk: attack.atk * reflectAmount,
          matk: 0,
          hitChance: 100,
          damageSource: "Grand Duel",
        });
        attack.atk = attack.atk * (1 - reflectAmount);
        attack.matk = attack.matk;
        return attack;
      },
    });
  },

  Decimate: (self, _target) => {
    self.sendAttack({
      atk: self.atk * 4,
      matk: self.matk * 2,
    });
  },

  "Frozen Smite": (self, target) => {
    const result = self.sendAttack({
      damageRatio: DMG_BACK,
      atk: self.atk,
      matk: 0,
    });
    target.addEffect({
      name: "Frozen Smite",
      turns: 3,
      debuff: true,
      stats: { matk: -0.7 },
    }, ratioFromAttackResult(result));
  },

  "Rage of God": (self, _target) => {
    self.addEffect({
      name: "Rage of God",
      turns: 3,
      stats: { atk: 0.5 },
      cannotDispell: true,
    });
  },

  "Devour Soul": (self, target) => {
    const absorbAmount = 0.75;
    const absorbedMatk = mathRound(target.getTotalStat("matk") * absorbAmount);
    self.addEffect({
      name: "Devoured Souls Power",
      turns: 2,
      stats: { matkBns: absorbedMatk },
    });
    target.addEffect({
      name: "Devoured Soul Weakness",
      turns: 2,
      debuff: true,
      stats: {
        matk: -absorbAmount,
      },
    }, DMG_AOE);
  },

  "Spread Death": (self, target) => {
    target.addEffect({
      name: "Spread Death",
      trigger: "DamageOnTurn",
      turns: 5,
      debuff: true,
      stats: {
        matk: self.matk * 0.5,
        atk: 0,
        crit: 0,
        attacker: self,
      },
    }, DMG_AOE);
  },

  "Shadow Veil": (self, _target) => {
    self.addEffect({
      name: "Shadow Veil",
      turns: 2,
      trigger: "OnDamage",
      cannotDispell: true,
      dmgFunc: (attack: any) => {
        if (!truthy(attack.isDot)) {
          attack.hitChance = 0;
        }
        return attack;
      },
    });
  },

  "Shadow Blast": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      matk: self.matk * 3,
      atk: 0,
    });
  },

  Gluttony: (self, _target) => {
    self.addEffect({
      name: "Gluttony",
      stacks: true,
      trigger: "Permanent",
      stats: { def: 0.25, mdef: 0.25 },
    });
  },

  "Titanic Clap": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: self.atk * 1.5,
    });
  },

  Feast: (self, _target) => {
    self.sendHeal(self, self.atk * 2);
  },

  "Tidal Wave": (self, target) => {
    const dmgRatio = DMG_AOE;
    const result = self.sendAttack({
      damageRatio: dmgRatio,
      matk: self.matk * 1,
    });
    target.addEffect({
      name: "Tidal Wave",
      turns: 4,
      debuff: true,
      stats: { atk: -0.5 },
    }, ratioFromAttackResult(result));
  },

  "Aqua Shield II": (self, _target) => {
    self.sendHeal(self, self.matk * 1.2, false, true);
  },

  Drown: (_self, target) => {
    target.addEffect({
      name: "Drown",
      turns: 2,
      debuff: true,
      trigger: "OnDetermineAction",
      triggerFunc: (_combatant: any, _actionName: any) => {
        return "Basic";
      },
    }, DMG_AOE);
  },

  "Ancient Mist": (self, target) => {
    self.addEffect({
      name: "Ancient Mist Eva↑",
      turns: 4,
      stats: { eva: 0.5 },
    });
    target.addEffect({
      name: "Ancient Mist Acc↓",
      turns: 3,
      debuff: true,
      stats: { acc: -0.5 },
    }, DMG_AOE);
  },

  "Bulawa Strike": (self, target) => {
    self.sendAttack({
      atk: 1 * self.atk,
      matk: 0,
    });
    target.addEffect({
      name: "Bulawa Strike",
      turns: 3,
      debuff: true,
      stats: { matk: -0.5 },
    }, DMG_BACK);
  },

  "Stunning Blow": (self, target) => {
    self.sendAttack({
      atk: self.atk,
    });
    target.addEffect({
      name: "Stunning Blow",
      debuff: true,
      trigger: "OnDetermineAction",
      triggerFunc: (_combatant: any, _actionName: any) => {
        return false;
      },
    }, DMG_AOE);
  },

  "Crushing Blow": (self, _target) => {
    self.sendAttack({
      dmg: 0.8 * self.atk,
    });
  },

  Warhorn: (self, _target) => {
    self.addEffect({
      name: "Warhorn",
      stacks: true,
      trigger: "Permanent",
      stats: { def: 0.25, atk: 0.25 },
    });
  },

  Rampage: (self, _target) => {
    self.sendAttack({
      atk: 1.5 * self.atk,
    });
    self.addEffect({
      name: "Rampage",
      stacks: true,
      trigger: "Permanent",
      stats: { atk: 0.1 },
    });
  },

  "Fire Lance": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_MID,
      atk: 3 * self.atk,
    });
  },

  "Beastly Roar": (_self, target) => {
    target.addEffect({
      name: "Beastly Roar Atk↓",
      turns: 3,
      debuff: true,
      stats: { atk: -0.5 },
    });
  },

  "Fire Wall": (self, _target) => {
    self.addEffect({
      name: "Fire Wall",
      turns: 3,
      cannotDispell: true,
      trigger: "OnDamage",
      stats: { matk: 0 },
    });
  },

  "Nature's Veil": (self, _target) => {
    self.addEffect({
      name: "Nature's Veil",
      stacks: true,
      trigger: "Permanent",
      stats: { mdef: 0.25 },
    });
    self.sendHeal(self, self.matk * 1, false, true);
  },

  "Protector's Wrath": (self, _target) => {
    self.sendAttack({
      atk: 1.5 * self.atk,
      matk: 1.5 * self.matk,
    });
  },

  Regenerate: (self, _target) => {
    self.addEffect({
      name: "Regenerate",
      turns: 3,
      trigger: "HealingOnTurn",
      heal: 0.5 * self.matk,
      caster: self,
    });
  },

  "Ancient Spores": (_self, target) => {
    target.addEffect({
      name: "Ancient Spores",
      turns: 3,
      debuff: true,
      stats: { atk: -0.5, matk: -0.5 },
    });
  },

  "Mountain Guard": (self, _target) => {
    self.addEffect({
      name: "Mountain Guard",
      stacks: true,
      trigger: "Permanent",
      stats: { def: 0.75 },
    });
  },

  "Titanic Crush": (self, target) => {
    const result = self.sendAttack({
      atk: self.atk * 1.5,
    });
    target.addEffect({
      name: "Titanic Crush",
      turns: 3,
      debuff: true,
      stats: { def: -0.5 },
    }, ratioFromAttackResult(result));
  },

  "Titan Armor": (self, _target) => {
    self.addEffect({
      name: "Titan Armor",
      turns: 2,
      cannotDispell: true,
      trigger: "OnDamage",
      stats: {
        atk: 0,
        matk: 0,
        dmg: 0,
      },
    });
  },

  "Earthquake IV": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: self.atk,
    });
  },

  "Alternate Reality": (_self, target) => {
    target.addEffect({
      name: "Alternate Reality",
      debuff: true,
      reversible: true,
      turns: 2,
      statFunc: swapAtkMatk,
    });
  },

  "Aeon Lash": (self, _target) => {
    self.sendAttack({
      damageRatio: DMG_AOE,
      atk: self.atk * 1,
    });
    self.sendHeal(self, self.matk * 1);
  },

  "Unleashed Power": (self, _target) => {
    self.addEffect({
      name: "Unleashed Power",
      stacks: true,
      trigger: "Permanent",
      stats: { atk: 0.5, matk: 0.5 },
    });
  },

  "Soul Barrier": (self, _target) => {
    self.addEffect({
      name: "Soul Barrier",
      turns: 2,
      cannotDispell: true,
      trigger: "OnDamage",
      dmgFunc: (attack: any) => {
        // attack.dmg is nil for damage-over-time ticks: Lua then omits the key.
        self.sendAttack(tbl({
          matk: attack.matk,
          atk: attack.atk,
          dmg: attack.dmg,
          damageSource: "Soul Barrier",
          hitChance: 100,
        }));
        attack.matk = 0;
        attack.atk = 0;
        attack.dmg = 0;
        return attack;
      },
    });
  },
};
