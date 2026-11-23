/** obj.Hero: the combat parts (stats from class, level, gear, enchants, passive, skills). */
import { Combatant } from "./combatant.ts";
import { G } from "./data.ts";
import { consumableStat, D, heroAttackList, heroMaxActionPoints, heroPassive, heroSkillSet } from "./defaults.ts";
import { Equipment } from "./equipment.ts";
import { len, truthy } from "./lua.ts";
import { calculatePercentStats } from "./stats.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const bonusStatNames: Record<string, string> = {
  str: "str", int: "int", dex: "dex", lckMod: "lckMod", expMod: "expMod", speed: "speed",
  atk: "atkBns", matk: "matkBns", acc: "accBns", crit: "critBns", def: "defBns", mdef: "mdefBns",
  maxHP: "hpBns", apMod: "apMod", hpPct: "hpPct", atkPct: "atkPct", matkPct: "matkPct", accPct: "accPct",
  defPct: "defPct", mdefPct: "mdefPct", critMod: "critMod",
};

const resetStats = ["str", "dex", "int", "atk", "matk", "acc", "crit", "def", "mdef", "acc", "speed", "lckMod",
  "expMod", "hpBns", "maxHP", "defPen", "mdefPen"];

/** A Lua sequence from a save (JSON array, 0-based) or a Lua-shaped object -> value at Lua index i. */
function at(t: Any, i: number): Any {
  if (Array.isArray(t)) return t[i - 1];
  return t?.[i];
}
function seqLen(t: Any): number {
  if (Array.isArray(t)) {
    let n = 0;
    while (t[n] !== undefined && t[n] !== null) n++;
    return n;
  }
  return len(t);
}

export class Hero extends Combatant {
  /** params: a save entry (compact item strings, skill indices); arrays are JSON (0-based) sequences. */
  constructor(params: Any, isNew = false) {
    super(params);
    this.heroInventory = [undefined];
    this.id = params.id;
    this.heroID = params.heroID ?? 0;
    this.class = params.class;
    const hd = G.heroList[this.class];
    this.name = params.name ?? hd.name;
    this.exp = params.exp ?? 0;
    this.level = params.level ?? 1;
    this.prestigeLevel = Math.min(params.prestigeLevel ?? 1, 3);
    this.maxHP = params.maxHP ?? hd.hp;
    this.hp = params.hp ?? this.maxHP;
    this.questHP = params.questHP ?? this.hp;
    for (const k of ["hpPlv", "atkPlv", "matkPlv", "accPlv", "defPlv", "mdefPlv", "critPlv"]) {
      this[k] = params[k] ?? hd[k][this.prestigeLevel];
    }
    for (const k of ["atk", "matk", "acc", "crit", "def", "mdef", "str", "int", "dex"]) this[k] = params[k] ?? 0;
    this.apMod = 0;
    this.eva = 0;
    this.strMod = hd.strMod[this.prestigeLevel];
    this.intMod = hd.intMod[this.prestigeLevel];
    this.dexMod = hd.dexMod[this.prestigeLevel];
    this.lckMod = hd.lckMod;
    this.expMod = hd.expMod;
    this.critMod = 2;
    this.boost = params.boost ?? false;
    this.timeDied = params.timeDied ?? false;
    if (this.hp > 0) this.timeDied = false;
    this.totalDeath = params.totalDeath ?? 0;
    this.totalQuests = params.totalQuests ?? 0;
    this.totalHits = params.totalHits ?? 0;
    this.totalMagicDmgTaken = params.totalMagicDmgTaken ?? 0;
    this.totalPhysicalDmgTaken = params.totalPhysicalDmgTaken ?? 0;
    this.totalMagicDmgDealt = params.totalMagicDmgDealt ?? 0;
    this.totalPhysicalDmgDealt = params.totalPhysicalDmgDealt ?? 0;
    this.enchantsUsed = params.enchantsUsed ?? 0;
    this.enchantList = [];
    const el = params.enchantList;
    if (el && at(el, 1) !== undefined) {
      if (typeof at(el, 1) === "number") {
        const n = seqLen(el);
        for (let i = 1; i <= n; i++) {
          const enchantID = at(el, i);
          const prestigeLevel = params.enchantPrestige ? (at(params.enchantPrestige, i) ?? 0) : 0;
          this.applyEnchant(enchantID, consumableStat(enchantID, prestigeLevel), prestigeLevel, true);
        }
      } else {
        this.enchantList = Array.isArray(el) ? el : Object.values(el);
      }
    }
    this.maxEnchants = 8 + (this.prestigeLevel - 1) * 4;
    this.questStatus = params.questStatus ?? 0;
    this.questListID = params.questListID ?? -1;
    this.campaignID = params.campaignID ?? -1;
    const ss = params.skillSet;
    if (ss && seqLen(ss) > 1) {
      this.currentSkillSet = params.currentSkillSet ?? 1;
      const s1 = at(ss, 1);
      const s2 = at(ss, 2);
      this.skillSet = [undefined,
        { passive: s1.passive ?? heroPassive(this), attackList: this.loadSkillList(s1.attackList) },
        { passive: s2.passive ?? heroPassive(this), attackList: this.loadSkillList(s2.attackList) }];
      this.attackList = this.skillSet[this.currentSkillSet].attackList;
      this.passiveSelect = this.skillSet[this.currentSkillSet].passive;
    } else {
      this.attackList = this.loadSkillList(params.attackList);
      this.passiveSelect = params.passiveSelect ?? heroPassive(this);
      this.currentSkillSet = 1;
      this.skillSet = heroSkillSet(this);
    }
    if (isNew) throw new Error("new heroes (starting gear) are not supported");
    const inv = params.heroInventory ?? [];
    const n = seqLen(inv);
    for (let i = 1; i <= n; i++) this.heroInventory[i] = new Equipment(at(inv, i));
    this.determineStats();
  }

  addToTotals(): void {
    const s = this.combatStatistics;
    this.totalHits = this.totalHits + s.hits;
    this.totalQuests = this.totalQuests + 1;
    this.totalMagicDmgTaken = this.totalMagicDmgTaken + s.magicDmgTaken;
    this.totalPhysicalDmgTaken = this.totalPhysicalDmgTaken + s.physicalDmgTaken;
    this.totalMagicDmgDealt = this.totalMagicDmgDealt + s.magicDmgDealt;
    this.totalPhysicalDmgDealt = this.totalPhysicalDmgDealt + s.physicalDmgDealt;
  }

  reduceBoost(): void {
    if (this.boost) {
      this.boost.amount = this.boost.amount - 1;
      if (this.boost.amount <= 0) this.removeBoost();
    }
  }

  /** Hero:applyBoost: a potion for `potionDuration` quests (default 3); the same potion again extends it. */
  applyBoost(id: number, stats: Any, prestigeLevel: number, potionDuration = 3): void {
    if (this.boost) {
      if (this.boost.id === id && this.boost.prestigeLevel === prestigeLevel) {
        this.boost.amount = this.boost.amount + potionDuration;
        return;
      }
      this.removeBoost();
    }
    this.boost = { id, stats, prestigeLevel, amount: potionDuration };
    this.determineStats();
  }

  removeBoost(): boolean | void {
    if (!this.boost) return false;
    for (const k of Object.keys(this.boost.stats)) this[k] = this[k] - this.boost.stats[k];
    this.boost = undefined;
    this.determineStats();
  }

  /** Hero:addExperience: returns true when the hero levelled up. */
  addExperience(expToAdd: number): boolean | void {
    if (this.level !== D.maxHeroLevel[this.prestigeLevel]) {
      // XP actually gained, for reports (map runs restore exp and level afterwards)
      this._xpGained = (this._xpGained ?? 0) + expToAdd * (1 + this.expMod / 100) * D.questXpMod;
      this.exp = Math.floor(this.exp + expToAdd * (1 + this.expMod / 100) * D.questXpMod);
      if (this.levelUp()) return true;
    } else {
      this.exp = 1;
    }
  }

  levelUp(): boolean {
    const maxLevel = D.maxHeroLevel[this.prestigeLevel];
    const levelReq = G.heroLevelRequirement[this.prestigeLevel];
    let levelsUp = 0;
    while (this.level !== maxLevel && this.exp >= levelReq[this.level + 1]) {
      const leftOverExp = this.exp - levelReq[this.level + 1];
      this.level = this.level + 1;
      this.exp = leftOverExp;
      levelsUp = levelsUp + 1;
    }
    if (0 < levelsUp) {
      this.determineStats();
      this.hp = this.maxHP;
      if (this.level === maxLevel) this.exp = 1;
    }
    return 0 < levelsUp;
  }

  die(): void {
    this.hp = 0;
    this.timeDied = Date.now() / 1000;
    this.totalDeath = this.totalDeath + 1;
  }

  /** Hero:setSkillSet(id): switch between the two saved rotations (no id = the other one). */
  setSkillSet(id?: number): void {
    if (id === undefined) id = this.currentSkillSet === 1 ? 2 : 1;
    if (id === this.currentSkillSet) return;
    if (!this.skillSet[id]) return;
    this.attackList = this.skillSet[id].attackList;
    this.passiveSelect = this.skillSet[id].passive;
    this.currentSkillSet = id;
    this.determineStats();
    this.calculateAPRemainder();
  }

  resetStats(): void {
    this.combatStatistics.reset();
    this.actionNumber = 1;
    this.removeAllEffects();
    this.effectList = [];
    this.determineStats();
  }

  resetStatsAndStatus(): void {
    this.resetStats();
    this.questStatus = 0;
    this.questListID = -1;
    this.campaignID = -1;
  }

  override determineStats(isQuest?: boolean): void {
    for (const k of resetStats) this[k] = 0;
    const hd = G.heroList[this.class];
    for (const k of ["hpPlv", "atkPlv", "matkPlv", "accPlv", "defPlv", "mdefPlv", "critPlv"]) this[k] = hd[k][this.prestigeLevel];
    for (const e of this.enchantList) for (const k of Object.keys(e.stat)) this[k] = this[k] + e.stat[k];
    this.strMod = hd.strMod[this.prestigeLevel];
    this.intMod = hd.intMod[this.prestigeLevel];
    this.dexMod = hd.dexMod[this.prestigeLevel];
    this.lckMod = hd.lckMod;
    this.expMod = hd.expMod;
    this.apMod = 0;
    this.critMod = 2;
    this.atkPct = 0;
    this.matkPct = 0;
    this.defPct = 0;
    this.mdefPct = 0;
    this.accPct = 0;
    this.hpPct = 0;
    if (this.boost) for (const k of Object.keys(this.boost.stats)) this[k] = this[k] + this.boost.stats[k];
    const n = len(this.heroInventory);
    for (let i = 1; i <= n; i++) this.addItemStats(i);
    if (this.campaignID !== -1 && this.campaign?.battleBuff) {
      for (const k of Object.keys(this.campaign.battleBuff)) this[k] = this[k] + this.campaign.battleBuff[k];
    }
    this.atk = this.atk + this.str * this.strMod;
    this.matk = this.matk + this.int * this.intMod;
    this.acc = this.acc + this.dex * this.dexMod;
    let passive = G.passiveData[this.passiveSelect];
    if (passive === undefined) {
      this.passiveSelect = heroPassive(this);
      passive = G.passiveData[this.passiveSelect];
    }
    for (const k of Object.keys(passive.stats)) this[k] = this[k] + passive.stats[k];
    this.atk = this.atk + hd.atk + this.atkPlv * this.level;
    this.matk = this.matk + hd.matk + this.matkPlv * this.level;
    this.acc = this.acc + hd.acc + this.accPlv * this.level;
    this.def = this.def + hd.def + this.defPlv * this.level;
    this.mdef = this.mdef + hd.mdef + this.mdefPlv * this.level;
    this.crit = this.crit + hd.crit + this.critPlv * this.level;
    this.maxHP = this.maxHP + hd.hp + this.hpPlv * this.level;
    if (isQuest) this.determineEffectStats();
    if (this.maxHP < 1) this.maxHP = 1;
    if (this.crit < 0) this.crit = 0;
    calculatePercentStats(this);
    this.maxActionPoints = heroMaxActionPoints(this);
    this.calculateAPRemainder();
    this.hp = Math.min(this.hp, this.maxHP);
  }

  addItemStats(slot: number): boolean | void {
    const item = this.heroInventory[slot];
    if (item.itemLevel > this.level) return false;
    if (slot === 1) {
      this.atk = this.atk + item.atk;
      this.matk = this.matk + item.matk;
      this.acc = this.acc + item.acc;
      this.crit = this.crit + item.crit;
    } else if (slot !== 6) {
      this.def = this.def + item.def;
      this.mdef = this.mdef + item.mdef;
    }
    for (const [key, value] of Object.entries(bonusStatNames)) {
      if (truthy(item[value]) && item[value] !== 0) this[key] = this[key] + item[value];
    }
  }

  override getTarget(): Any {
    return this._enemy;
  }

  calculateAPRemainder(): void {
    let apSpent = 0;
    for (let n = 1; n <= len(this.attackList); n++) apSpent = apSpent + G.abilityData[this.attackList[n]].apCost;
    if (apSpent > this.maxActionPoints) {
      this.attackList = heroAttackList(this.class);
      this.passiveSelect = heroPassive(this);
      this.currentSkillSet = 1;
      this.skillSet = heroSkillSet(this);
      apSpent = 0;
    }
    this.actionPoints = this.maxActionPoints - apSpent;
  }

  applyEnchant(id: number, tbl: Any, prestigeLevel: number, isStatic: boolean): void {
    this.enchantList.push({ id, prestigeLevel, stat: tbl });
    this.enchantsUsed = this.enchantList.length;
    if (!isStatic) this.determineStats();
  }

  /**
   * Hero:loadSkillList. attackList: 5 skill names, or 5 class-skill indices (0 = Basic),
   * as a 0-based JSON array or a 1-based array. Returns a 1-based array (index 0 unused).
   */
  loadSkillList(attackList: Any): Any[] {
    const classSkills = G.heroList[this.class].skillList;
    if (attackList) {
      const src = Array.isArray(attackList) && attackList[0] === undefined && attackList.length === 6
        ? attackList.slice(1) : (Array.isArray(attackList) ? attackList.slice() : Object.values(attackList));
      if (typeof src[0] === "string") {
        const out: Any[] = [undefined];
        for (let i = 1; i <= 5; i++) {
          const s = src[i - 1];
          if (s === "Basic" || s === undefined || s === null) out[i] = "Basic";
          else {
            let found = false;
            for (let j = 1; j <= len(classSkills); j++) if (s === classSkills[j]) { found = true; break; }
            out[i] = found ? s : "Basic";
          }
        }
        return out;
      } else if (seqLen(src) === 5) {
        const out: Any[] = [undefined];
        for (let i = 1; i <= src.length; i++) {
          const id = src[i - 1];
          out[i] = id === 0 || id === undefined || id === null ? "Basic" : classSkills[id];
        }
        return out;
      }
    }
    return heroAttackList(this.class);
  }
}

export { D };
