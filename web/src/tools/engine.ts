/**
 * Front-end to the TypeScript combat engine (web/src/sim/api.ts), port of
 * the former tools/sim/engine.py. Every call into the engine goes through here, so the
 * runners in combat.ts do not depend on the engine's exact signatures.
 *
 *   loadGameData(json)            // inventory/gamedata.json
 *   const sim = new Sim("Standard")
 *   const h = sim.hero(save.raw.hero[0])
 *   const r = sim.fight(80, [h], [], { seed: 1 })
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { mathRound, seq } from "../sim/lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export type Hero = Any;
/** Up to 3 heroes by slot (0-based), null/undefined for an empty slot. */
export type Row = (Hero | null | undefined)[];

export interface Scroll {
  id: number;
  prestigeLevel: number;
}
/** A compact map string from the save, or a map built from its id. */
export type MapSpec = string | { id: number; prestigeLevel?: number; grade?: number; prefix?: number | null; suffix?: number | null };

export interface FightResult {
  won: boolean;
  turns: number;
  enemyHP: number;
  enemyMaxHP: number;
  /** Lowest enemy HP after any action (lower than enemyHP when the enemy healed). */
  enemyMinHP: number;
  /** All damage the enemy took during the fight. */
  enemyDmgTaken: number;
  /** Seconds the fight takes as a quest (battle time + quest time x amount x grade factor, speed bonus). */
  questTime: number;
  /** Sum of the party's luck (lckMod), used by the quest's loot rolls. */
  partyLuck: number;
  grade: number;
  heroes: HeroResult[];
}
export interface HeroResult {
  slot: string;
  name: string;
  class: number;
  level: number;
  prestige: number;
  /** Map runs: XP gained over the run (rooms won while alive), before the engine restores the hero. */
  xp?: number;
  hp: number;
  maxHP: number;
  dead: boolean;
  physicalDmgDealt: number;
  magicDmgDealt: number;
  dmgTaken: number;
  healingDone: number;
  skillDmg: Record<string, number>;
  skillUses: Record<string, number>;
}
export interface MapRunResult {
  won: boolean;
  escaped: boolean;
  rooms: number;
  cleared: number;
  lastEnemyRemoved?: number;
  time: number;
  grade: number;
  scrollsUsed?: { id: number; chargesUsed: number }[];
  /** `turns`: how long the room's battle lasted (rooms never fought have none). */
  combats: { status: number; name: string; isRare: boolean; questId?: number; turns?: number }[];
  rewards: { itemType: string; itemID: number; amount: number; prestigeLevel?: number }[];
  heroes: HeroResult[];
}
export interface SkillInfo {
  unlocked: number;
  maxAP: number;
  skills: { name: string; ap: number }[];
  passives: string[];
}

const A = api as Any;

export class Sim {
  /** The save's game mode ("Standard", "Quick", "Legendary", ...). */
  readonly mode: string;

  constructor(gameMode = "Standard") {
    if (!G.heroList) throw new Error("game data not loaded: call loadGameData(inventory/gamedata.json) first");
    api.setMode(gameMode);
    this.mode = gameMode;
  }

  // ---------------------------------------------------------------- heroes
  /** Hero from a raw save entry (compact item strings, skill indices). */
  hero(raw: Any): Hero {
    return api.newHero(raw);
  }

  /** attackList: 5 skill names or class-skill indices (0 = Basic). */
  setSkills(hero: Hero, attackList: (string | number)[], passive?: string | null): string[] {
    return api.setSkills(hero, attackList, passive ?? undefined);
  }

  stats(hero: Hero): Record<string, number> {
    return api.heroStats(hero);
  }

  skillInfo(hero: Hero): SkillInfo {
    return api.skillInfo(hero);
  }

  /** The hero's rotation as skill names (attackList is 1-based, like Lua). */
  rotation(hero: Hero): string[] {
    const list = hero.attackList ?? [];
    return Array.isArray(list) ? list.slice(1).filter((x: unknown) => x !== undefined) as string[] : seq<string>(list);
  }

  equip(hero: Hero, slot: number, compact: string): void {
    api.equip(hero, slot, compact);
  }

  equipItem(hero: Hero, slot: number, item: Any): void {
    api.equipItem(hero, slot, item);
  }

  makeItem(id: number, grade: number, prestige = 0, charLevel = 60, seed?: number): Any {
    return api.makeItem(id, grade, prestige, charLevel, seed);
  }

  // ---------------------------------------------------------------- fights
  /** One battle. front/back: up to 3 heroes each (null for an empty slot). */
  fight(questID: number, front: Row = [], back: Row = [], opts: { seed?: number; isRare?: boolean; amount?: number } = {}): FightResult {
    return api.fight(questID, front, back, { seed: opts.seed, isRare: opts.isRare ?? false, amount: opts.amount ?? 1 });
  }

  // ---------------------------------------------------------------- map runs
  makeMap(spec: MapSpec, seed = 1): Any {
    if (typeof A.makeMap !== "function") throw new Error("map runs are not ported to the TypeScript engine yet (api.makeMap)");
    return A.makeMap(spec, seed);
  }

  /** One full map run (game Campaign). The seed fixes the layout and the fights. */
  mapRun(spec: MapSpec, front: Row = [], back: Row = [], seed = 1, scrolls?: Scroll[] | null): MapRunResult {
    if (typeof A.mapRun !== "function") throw new Error("map runs are not ported to the TypeScript engine yet (api.mapRun)");
    const opts: Any = { seed };
    if (scrolls && scrolls.length) opts.scrolls = scrolls.map((s) => ({ ...s }));
    // Same 0-based slot rows as api.fight.
    return A.mapRun(spec, front, back, opts);
  }
}

// ---------------------------------------------------------------- economy (as the former tools/gamedata.py)
const STACKABLE = new Set(["material", "consumable"]);

export function itemName(itype: string, iid: number): string {
  return G.itemData[itype]?.[iid]?.name ?? `${itype}#${iid}?`;
}

/** Item rarity after `mods` modifiers (Item:applyPrefix / applySuffix). */
export function rarity(itype: string, iid: number, mods = 0): number {
  let r = G.itemData[itype][iid].rarity ?? 1;
  for (let i = 0; i < mods; i++) r = r < 7 ? Math.min(r + 1, 6) : Math.min(r + 1, 8);
  return r;
}

/** Base price a customer pays (Item:getSellValue). Undefined when the item does not exist. */
export function sellValue(itype: string, iid: number, prestige = 0, mods = 0): number | undefined {
  const it = G.itemData[itype]?.[iid];
  if (!it) return undefined;
  const mult = prestige > 0 ? prestige * 2 : 1;
  if (STACKABLE.has(itype)) {
    const s = it.sell ?? { 1: 0, 2: 0 };
    return mathRound((s[1] * mult + s[2] * mult) / 2);
  }
  const value = (it.value ?? it.cost ?? 0) * mult;
  return mathRound(value * (G.rarityMod[rarity(itype, iid, mods)]?.[1] ?? 1));
}
