/**
 * Heroes built from catalog data only (inventory/gamedata.json), no save file: for the
 * CI-safe regression snapshots (test/snapshots.test.ts). Call loadGameData first.
 *
 * Gear: per slot, the catalog item of the class's subtype with the highest item level
 * <= the hero's level (lowest id on ties), crafted fresh by makeItem with a fixed seed.
 */
import { equipItem, makeItem, newHero, setSkills } from "../../src/sim/api.ts";
import type { Hero } from "../../src/sim/api.ts";
import { G } from "../../src/sim/data.ts";
import { seq } from "../../src/sim/lua.ts";

const HEAVY = ["Helm", "Platemail", "Gauntlets", "Sabatons"];
const MEDIUM = ["Hood", "Tunic", "Gloves", "Boots"];
const CLOTH = ["Hat", "Robe", "Mitts", "Crakows"];

/** class id -> [weapon subtype, armour set (slots 2-5)]; slot 6 is always a Ring. */
const KIT: Record<number, [string, string[]]> = {
  1: ["Longsword", HEAVY], // Warrior
  2: ["Dagger", MEDIUM], // Rogue
  3: ["Stave", CLOTH], // Mage
  4: ["Axe", HEAVY], // Berserker
  5: ["Wand", CLOTH], // Cleric
  6: ["Knife", MEDIUM], // Assassin
  7: ["Sword", HEAVY], // Paladin
  8: ["Cudgel", HEAVY], // Dark Knight
  9: ["Club", MEDIUM], // Bard
};

/** Best catalog equipment of a subtype for a level (highest itemLevel <= level, lowest id on ties). */
export function catalogItemId(subType: string, level: number): number {
  let best: [number, number] | undefined;
  for (const [id, it] of Object.entries(G.itemData.equipment) as [string, { subType: string; itemLevel: number }][]) {
    if (it.subType !== subType || it.itemLevel > level) continue;
    const cand: [number, number] = [it.itemLevel, Number(id)];
    if (!best || cand[0] > best[0] || (cand[0] === best[0] && cand[1] < best[1])) best = cand;
  }
  if (!best) throw new Error(`no ${subType} at level <= ${level}`);
  return best[1];
}

export interface CatalogHeroSpec {
  cls: number;
  level: number;
  /** Hero ascension (1-3, default 1). */
  prestige?: number;
  /** Crafting grade of every item (default 3). */
  grade?: number;
  /** Item ascension (default 0). */
  itemAsc?: number;
  /** 5 skill names or class-skill indices; default: class skills 1-3 interleaved with Basic. */
  rotation?: (string | number)[];
  passive?: string;
}

/** A hero with catalog gear; deterministic (each item's roll has its own seed). */
export function catalogHero(spec: CatalogHeroSpec): Hero {
  const { cls, level } = spec;
  const hd = G.heroList[cls];
  const hero = newHero({
    id: cls, heroID: cls, name: `${hd.name} L${level}`, class: cls, level, exp: 0,
    prestigeLevel: spec.prestige ?? 1, attackList: [0, 0, 0, 0, 0], heroInventory: [],
  });
  const [weapon, armour] = KIT[cls];
  [weapon, ...armour, "Ring"].forEach((sub, i) => {
    const item = makeItem(catalogItemId(sub, level), spec.grade ?? 3, spec.itemAsc ?? 0, level, cls * 100 + i + 1);
    equipItem(hero, i + 1, item);
  });
  const skills = seq<string>(hd.skillList);
  setSkills(hero, spec.rotation ?? [skills[0], "Basic", skills[1], "Basic", skills[2]],
    spec.passive ?? seq<string>(hd.passiveList)[0]);
  hero.hp = hero.maxHP;
  hero.questHP = hero.maxHP;
  return hero;
}
