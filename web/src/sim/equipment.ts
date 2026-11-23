/** obj.Item / obj.Equipment / obj.ItemCompact: the parts heroes' combat stats need. */
import { G } from "./data.ts";
import { bonusStat, D, itemStat } from "./defaults.ts";
import { clamp, random, round, toNumber, truthy } from "./lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const itemTypeToString = [undefined, "material", "consumable", "equipment", "map"];
const equipBonusStat = [undefined, "atkBns", "matkBns", "accBns", "critBns", "defBns", "mdefBns", "hpBns",
  "str", "int", "dex", "UNUSED", "lckMod", "expMod", "speed", "atkPct", "matkPct", "defPct", "mdefPct",
  "accPct", "critMod", "hpPct", "apMod"];
const bonusID = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const bonusStatNames = ["str", "int", "dex", "lckMod", "expMod", "speed", "atkBns", "matkBns", "accBns",
  "critBns", "defBns", "mdefBns", "hpBns", "atkPct", "matkPct", "defPct", "mdefPct", "accPct", "apMod",
  "critMod", "hpPct"];

/** itemCompact.readCompact for an equipment string ("3|2FC|5|1|9|5|A132B8C130D1|B8H11M29|A4B11C1|1"). */
export function readEquipmentCompact(compact: string): Any {
  const data: Any = {};
  const fields = ["itemType", "id", "grade", "itemSlot", "prefix", "suffix", "stats", "bns", "enchantAttempt", "prestigeLevel"];
  const words = compact.match(/[A-Za-z0-9.\-]+/g) ?? [];
  for (let i = 0; i < words.length && i < fields.length; i++) {
    const word = words[i];
    const f = fields[i];
    if (f === "id") {
      data.id = /^[0-9a-fA-F]+$/.test(word) ? parseInt(word, 16) : undefined;
    } else if (f === "stats") {
      if (data.itemSlot === 1) {
        const wep: Record<string, string> = { A: "atk", B: "matk", C: "acc", D: "crit" };
        for (const m of word.match(/[A-Za-z]\d+/g) ?? []) {
          const k = wep[m[0]];
          if (k !== undefined) data[k] = toNumber(m.slice(1));
        }
      } else if (data.itemSlot !== 6) {
        const arm: Record<string, string> = { A: "def", B: "mdef" };
        for (const m of word.match(/[A-Za-z][\d.]+/g) ?? []) {
          const k = arm[m[0]];
          if (k !== undefined) data[k] = toNumber(m.slice(1));
        }
      }
    } else if (f === "bns") {
      if (word[0] !== "0") {
        for (const m of word.match(/[A-Za-z][\d.\-]+/g) ?? []) {
          const idx = bonusID.indexOf(m[0]) + 1;
          const k = equipBonusStat[idx];
          if (k !== undefined) data[k] = toNumber(m.slice(1));
        }
      }
    } else if (f === "itemType") {
      data.itemType = itemTypeToString[Number(word)];
    } else if (f === "enchantAttempt") {
      data.enchantAttempt = [undefined, 0, 0, 0];
      let j = 1;
      for (const m of word.matchAll(/[A-Za-z]([\d.]+)/g)) data.enchantAttempt[j++] = toNumber(m[1]);
    } else {
      data[f] = toNumber(word);
    }
  }
  return data;
}

export class Equipment {
  [k: string]: Any;

  /** From a compact save string, or {id, grade, prestigeLevel, isNew, charLevel} like Equipment:new. */
  constructor(params: Any) {
    if (typeof params === "string") params = readEquipmentCompact(params);
    params.itemType = "equipment";
    // Item:initialize
    if (params.id === undefined) {
      if (params.name === undefined) throw new Error("Unable to create item, name or ID/Type needed");
      this.id = findEquipmentByName(params.name);
    } else {
      this.id = params.id;
    }
    this.itemType = "equipment";
    const data = G.itemData.equipment[this.id];
    if (!data) throw new Error(`unknown equipment id ${this.id}`);
    this.subType = data.subType;
    this.name = data.name;
    this.itemLevel = data.itemLevel;
    this.prestigeLevel = params.prestigeLevel ?? 0;
    this.cost = data.cost; // default.itemCost
    this.rarity = data.rarity;
    this.grade = params.grade;
    this.runTime = params.runTime ?? data.runTime;
    // Equipment:initialize
    const isNew = params.isNew ?? false;
    this.itemSlot = params.itemSlot ?? data.itemSlot;
    this.grade = params.grade ?? this.grade;
    this.isBound = params.isBound ?? undefined;
    if (this.name.includes("Worn")) {
      this.suffix = -1;
      this.isBound = true;
      this.grade = 1;
      this.rarity = 0;
    }
    if (isNew) this.determineStats(params.charLevel);
    else this.loadStats(params);
  }

  /** Item:determineStats for a freshly crafted item (rolls stats). */
  determineStats(charLevel?: number): void {
    const data = G.itemData.equipment[this.id];
    if (charLevel === undefined) charLevel = this.itemLevel - 6;
    const cl = charLevel as number;
    if (this.grade > 2) {
      if (!truthy(this.prefix)) this.determinePrefix(cl);
      if (this.itemSlot !== 6 && !truthy(this.suffix)) this.determineSuffix(cl);
    }
    this.grade = clamp(round(this.grade), 1, 5);
    let itemLevel = this.itemLevel;
    if (this.prestigeLevel && this.prestigeLevel !== 0) itemLevel = this.itemLevel + D.prestigeLevelBonus[this.prestigeLevel];
    this.determineBaseStats(itemLevel, cl - this.itemLevel);
    for (const k of bonusStatNames) if (this[k] !== undefined && this[k] !== 0) delete this[k];
    const bs = bonusStat(this.id, this.grade, this.prestigeLevel, cl - this.itemLevel);
    for (const k of Object.keys(bs)) this[k] = bs[k];
    this.name = data.name;
    this.rarity = data.rarity; // default.rarity
    this.cost = data.cost; // default.itemCost
    this.runTime = data.runTime;
    if (this.prefix && this.prefix !== 0) this.applyPrefix(true);
    if (this.suffix && this.suffix !== 0) this.applySuffix(true);
  }

  /** End of Item:applyPrefix / applySuffix: each modifier raises rarity and scales cost and run time. */
  private bumpForModifier(sell: number): void {
    this.rarity = this.rarity < 7 ? Math.min(this.rarity + 1, 6) : Math.min(this.rarity + 1, 8);
    this.cost = Math.floor(this.cost * (1 + sell));
    this.runTime = Math.floor(this.runTime * (1 + sell));
  }

  determinePrefix(charLevel: number): void {
    const [odds] = D.craftPrefixOdds(charLevel, this.grade, this.itemLevel, this._prefixBoost);
    if (odds > random(1, 100)) throw new Error("prefix rolls are not supported (odds forced to 0)");
  }

  determineSuffix(charLevel: number): void {
    const [odds] = D.craftSuffixOdds(charLevel, this.grade, this.itemLevel, this._suffixBoost);
    if (odds > random(1, 100)) throw new Error("suffix rolls are not supported (odds forced to 0)");
  }

  determineBaseStats(itemLevel: number, charLevelDiff: number): void {
    if (this.itemSlot === 1) {
      this.atk = itemStat.atk(itemLevel, this.subType, false, this.grade, charLevelDiff);
      this.matk = itemStat.matk(itemLevel, this.subType, false, this.grade, charLevelDiff);
      this.acc = itemStat.acc(itemLevel, this.subType, false, this.grade, charLevelDiff);
      this.crit = itemStat.crit(itemLevel, this.subType);
    } else if (this.itemSlot !== 6) {
      this.def = itemStat.def(itemLevel, this.subType, false, this.grade, charLevelDiff);
      this.mdef = itemStat.mdef(itemLevel, this.subType, false, this.grade, charLevelDiff);
    }
  }

  applyPrefix(isNew: boolean): void {
    const p = G.prefixList[this.prefix];
    if (isNew) for (const k of Object.keys(p.stats)) this[k] = this[k] !== undefined ? this[k] + p.stats[k] : p.stats[k];
    this.bumpForModifier(p.sell);
    this.name = `${p.name} ${this.name}`;
  }

  applySuffix(isNew: boolean): void {
    const s = G.suffixList[this.suffix];
    if (isNew) for (const k of Object.keys(s.stats)) if (this[k] !== undefined) this[k] = Math.ceil(this[k] * (1 + s.stats[k]));
    this.bumpForModifier(s.sell);
    this.name = `${this.name} ${s.name}`;
  }

  /** Item:loadStats: stats as saved. */
  loadStats(params: Any): void {
    const data = G.itemData.equipment[this.id];
    this.rarity = data.rarity; // default.rarity
    for (const k of bonusStatNames) if (params[k] !== undefined && params[k] !== 0) this[k] = params[k];
    if (this.itemSlot === 1) {
      this.atk = params.atk ?? itemStat.atk(this.itemLevel, this.subType, false, this.grade);
      this.matk = params.matk ?? itemStat.matk(this.itemLevel, this.subType, false, this.grade);
      this.acc = params.acc ?? itemStat.acc(this.itemLevel, this.subType, false, this.grade);
      this.crit = params.crit ?? itemStat.crit(this.itemLevel, this.subType);
    } else if (this.itemSlot !== 6) {
      this.def = params.def ?? itemStat.def(this.itemLevel, this.subType, false, this.grade);
      this.mdef = params.mdef ?? itemStat.mdef(this.itemLevel, this.subType, false, this.grade);
    }
    this.prefix = params.prefix ?? undefined;
    this.suffix = params.suffix ?? undefined;
    if (this.prefix && this.prefix !== 0) this.applyPrefix(false);
    if (this.suffix && this.suffix !== 0) this.applySuffix(false);
  }
}

function findEquipmentByName(name: string): number {
  for (const [id, it] of Object.entries(G.itemData.equipment as Record<string, Any>)) if (it.name === name) return Number(id);
  throw new Error(`unknown equipment ${name}`);
}
