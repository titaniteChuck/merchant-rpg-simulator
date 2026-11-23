/**
 * Game data tables (inventory/gamedata.json, written by tools/export_gamedata.py).
 * Tables keep their Lua keys, so `G.heroList[cls].hpPlv[prestigeLevel]` reads like the game.
 */

// deno-lint-ignore no-explicit-any
type Table = any;

export interface GameData {
  itemData: Table;
  abilityData: Table;
  passiveData: Table;
  heroList: Table;
  questData: Table;
  parcelData: Table;
  prefixList: Table;
  suffixList: Table;
  rarityMod: Table;
  gradeBonus: Table;
  gradeParcelBonus: Table;
  gradeTime: Table;
  heroLevelRequirement: Table;
  itemFormula: Table;
  default: Table;
  currentQuestType: Table;
  defaultLocals: Table;
}

export const G = {} as GameData;

export function loadGameData(json: GameData): void {
  Object.assign(G, json);
}
