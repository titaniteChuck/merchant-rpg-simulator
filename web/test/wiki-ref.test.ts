// Wiki reference pages (U25, U31): Stats and Battle. Anchors, cross-links, the worked-example formulas against the
// port, and the game-code references behind every section against the decompiled game (when ../decompiled is there:
// it is local only, not in CI). Since U31 those references live here only: the site never shows them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as api from "../src/sim/api.ts";
import { determineBattleGrade } from "../src/sim/battle.ts";
import { G } from "../src/sim/data.ts";
import { heroMaxActionPoints, itemStat } from "../src/sim/defaults.ts";
import { Rng, setRng } from "../src/sim/lua.ts";
import { calculateReduction } from "../src/sim/stats.ts";
import { Game } from "../src/tools/gamedata.ts";
import { BATTLE_SECTIONS } from "../src/ui/wiki-battle.ts";
import { BATTLE_TOPICS, battleHref, type RefSection, STAT_TOPICS, statHref } from "../src/ui/wiki-ref.ts";
import { ascendEssence, baseStatRange, battleGrade, hitChance, maxAp, reduction, STATS_SECTIONS } from "../src/ui/wiki-stats.ts";

const gamedata = JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8"));
api.loadGameData(gamedata);

/** Where a rule is in the game's decompiled Lua: [file, line, text expected on that line]. */
type Src = [file: string, line: number, needle: string];

/**
 * The game code behind each section of the reference pages, by "page/topic". Not rendered anywhere (the pages cite no
 * code); the last test checks every line against the decompiled game. Update a line here when a section's rule moves.
 */
const SOURCES: Record<string, Src[]> = {
  "stats/hero-stats": [["obj.Hero.lua", 178, "function Hero:determineStats"], ["obj.Hero.lua", 209, "#self.enchantList"], ["obj.Hero.lua", 217, "self.lckMod = heroData.lckMod"],
    ["obj.Hero.lua", 283, "item.itemLevel > self.level"], ["obj.Hero.lua", 243, "self.str * self.strMod"], ["obj.Hero.lua", 254, "heroData.atk + self.atkPlv * self.level"],
    ["obj.Hero.lua", 270, "calculatePercentStats"], ["obj.combat.statsService.lua", 20, "pctMinValue"], ["obj.Hero.lua", 401, "function Hero:applyBoost"],
    ["obj.combat.Campaign.lua", 127, "hero:reduceBoost()"], ["data.Default.lua", 1182, "heroBoostLevelReq"], ["obj.Hero.lua", 450, "8 + (self.prestigeLevel - 1) * 4"],
    ["data.Default.lua", 273, "local potionStat"]],
  "stats/max-hp": [["obj.Hero.lua", 260, "heroData.hp + self.hpPlv * self.level"], ["obj.Hero.lua", 264, "if self.maxHP < 1 then"], ["obj.Hero.lua", 346, "self.hp = self.maxHP"],
    ["obj.Quest.lua", 220, "math.min(hero.questHP, hero.hp)"], ["data.Default.lua", 1203, "heroReviveCost"], ["obj.Enemy.lua", 77, "self.maxHP * self.amount"]],
  "stats/damage": [["obj.Combatant.lua", 120, "if params.dmg then"], ["obj.Combatant.lua", 388, "attack.atk * currentCombatantMod"], ["obj.Combatant.lua", 397, "\"OnDamage\""],
    ["obj.Combatant.lua", 459, "math.round(defReduction * attack.atk * dmgMod)"], ["obj.Combatant.lua", 461, "isLuck and dmgMod or 1"], ["obj.Combatant.lua", 466, "\"DamageReceived\""]],
  "stats/defence": [["obj.combat.statsService.lua", 41, "function service.calculateReduction"], ["obj.combat.statsService.lua", 43, "def * 0.01 * (100 - penetration)"],
    ["obj.Combatant.lua", 104, "defPen = self.defPen or 0"], ["obj.Combatant.lua", 112, "if value < attackParams[key] then"], ["data.AbilityFunc.lua", 324, "attack.mdefPen = 60"]],
  "stats/hit-chance": [["obj.Combatant.lua", 421, "math.round(200 * attack.acc / (attack.acc + self.eva))"], ["obj.Combatant.lua", 424, "if 100 < hitChance then"],
    ["obj.Combatant.lua", 428, "hitChance >= math.random(1, 100)"], ["obj.Hero.lua", 60, "self.eva = 0"], ["obj.Enemy.lua", 78, "self.acc = 100"]],
  "stats/crit": [["obj.Combatant.lua", 435, "math.random(1, 100)"], ["obj.Combatant.lua", 439, "critChance <= attack.crit and notTrueAttack"],
    ["obj.Combatant.lua", 451, "1.6 * attack.luck"], ["obj.Combatant.lua", 453, "dmgMod = 1.35"], ["obj.Hero.lua", 220, "self.critMod = 2"], ["obj.Enemy.lua", 79, "self.crit = 0"]],
  "stats/ap": [["data.Default.lua", 1192, "function default.heroMaxActionPoints"], ["data.Default.lua", 1188, "heroStartingAP = 5"], ["obj.Hero.lua", 313, "apSpent > self.maxActionPoints"],
    ["data.Default.lua", 1129, "math.floor((hero.level - diff) / diff)"]],
  "stats/luck": [["obj.Hero.lua", 217, "self.lckMod = heroData.lckMod"], ["obj.combat.Battle.lua", 148, "function Battle:getSumOfStat"], ["obj.Combatant.lua", 451, "1.6 * attack.luck"],
    ["obj.combat.lootService.lua", 30, "questParams.partyLuck) / 10), 0, 5)"], ["obj.combat.lootService.lua", 56, "- questParams.partyLuck, 1)"],
    ["data.Default.lua", 855, "math.min(luck * 4, 200) / 100"], ["data.Default.lua", 757, "(1 + partyLuck / 100)"], ["obj.Map.lua", 190, "self.mapStats.lckMod * 0.1"],
    ["obj.Hero.lua", 325, "self.expMod / 100"]],
  "stats/grade": [["obj.combat.questService.lua", 171, "round(1.3 + (averageLvl + questInfo.region * 5) / (questInfo.levelReq + questInfo.region * 5), 2)"],
    ["obj.combat.questService.lua", 172, "clamp(grade, 1, 4.5)"], ["obj.combat.questService.lua", 183, "(8 + questInfo.region * 3 - turns) / 4"],
    ["obj.combat.questService.lua", 194, "clamp(round(grade), 1, 5)"], ["data.Default.lua", 815, "gradeBonus = {"], ["data.Default.lua", 823, "gradeParcelBonus = {"],
    ["data.Default.lua", 830, "gradeTime = {"], ["obj.combat.Campaign.lua", 244, "math.floor(grade / #combats)"]],
  "stats/time": [["obj.Quest.lua", 153, "questData[self.questID].time * self.enemyAmount * gradeTime[self.grade]"], ["obj.Quest.lua", 160, "math.min(questBonusSpeed, 0.75)"],
    ["obj.combat.questService.lua", 218, "getBattleTime(battle) * gradeTime[grade]"], ["obj.combat.Campaign.lua", 51, "self.mapBaseTime / #self.combats"],
    ["data.GameModsData.lua", 12, "default.timePerTurn = 5"]],
  "stats/quest-size": [["data.Default.lua", 861, "hero.prestigeLevel * 2 - 1"], ["data.GameModsData.lua", 73, "hero.prestigeLevel * 3 + 1"], ["obj.combat.questService.lua", 25, "currentQuestType[questId] == 2"], ["obj.Enemy.lua", 77, "self.maxHP * self.amount"],
    ["obj.GameClass.lua", 327, "currentQuestArray[newQuestNumber].gold * amount"], ["obj.Quest.lua", 210, "math.round(self.exp / self.battle.heroCount) * self.enemyAmount"],
    ["obj.combat.lootService.lua", 32, "quantity * questParams.enemyAmount"], ["obj.combat.lootService.lua", 58, "parcel.itemList[n].odds * questParams.enemyAmount"],
    ["obj.combat.lootService.lua", 87, "itemFromList.amount[1] * questParams.enemyAmount"]],
  "stats/xp": [["obj.Quest.lua", 210, "math.round(self.exp / self.battle.heroCount)"], ["obj.Hero.lua", 325, "(1 + self.expMod / 100) * default.questXpMod"],
    ["obj.Quest.lua", 221, "hero.hp > 0"], ["obj.combat.Campaign.lua", 170, "self.mapStats._mod * 0.2 / battle.heroCount"], ["obj.Hero.lua", 338, "levelReq[self.level + 1]"]],
  "stats/item-stats": [["data.Default.lua", 199, "local function baseStatFunc"], ["data.Default.lua", 205, "0.04 * charLevelDiff"], ["data.Default.lua", 213, "math.ceil((baseValue + level * plvlValue) * minGrade)"],
    ["obj.Item.lua", 96, "default.prestigeLevelBonus[self.prestigeLevel]"], ["data.Default.lua", 557, "prestigeLevelBonus = {40, 80}"], ["data.GameModsData.lua", 22, "default.gradeMin"],
    ["data.Default.lua", 316, "function default.getStatRange"], ["data.Default.lua", 335, "statMax * 0.92"], ["data.Default.lua", 250, "local ascStat"],
    ["obj.Item.lua", 197, "math.ceil(self[key] * (1 + value))"], ["obj.Item.lua", 184, "math.min(self.rarity + 1, 6)"], ["obj.Item.lua", 188, "1 + prefixList[self.prefix].sell"]],
  "stats/sell": [["obj.Item.lua", 245, "math.round(self.value * rarityMod[self.rarity][1])"], ["obj.Item.lua", 243, "round((self.sell[1] + self.sell[2]) / 2) * amount"],
    ["data.Default.lua", 113, "return value * (prestige * 2)"], ["data.Default.lua", 801, "rarityMod[1] = {1, 1.2}"], ["obj.Customer.lua", 318, "(1 + (location - 3) / 10)"]],
  "stats/craft": [["obj.Crafter.lua", 99, "params.cost * numberOfCraftItems"], ["obj.Craft.lua", 82, "default.craftGradeSpeed[self.grade]) * self.amount"], ["obj.Craft.lua", 69, "#self.matGradeLevel * 0.25"],
    ["obj.Craft.lua", 76, "round((self.grade + matGradeAverage) / 2)"], ["data.Default.lua", 129, "round(1 + (craftLevel - itemLevel) / 4, 2), 1, 4.5"],
    ["obj.Crafter.lua", 117, "item.prestigeLevel == self.ascLevel"], ["data.GameModsData.lua", 36, "default.craftGradeSpeed"], ["obj.Item.lua", 85, "if self.grade > 2 then"],
    ["data.Default.lua", 1577, "local gradeBonus = grade * 2 - 4"], ["data.Default.lua", 1567, "(effectiveLevel - itemLevel) * 2, 40"], ["data.Default.lua", 618, "params.itemLevel * 60"]],
  "stats/essence": [["data.Default.lua", 574, "function default.prestigeItemMaterial"], ["data.Default.lua", 580, "math.modf((level - 1) / 10)"], ["data.Default.lua", 587, "20 + levelDiff * 50"],
    ["data.Default.lua", 590, "round(rarityMod[item.rarity][1] * prestigeAmount)"], ["data.Default.lua", 593, "local mod = 4"], ["data.Default.lua", 610, "2 + levelDiff * 10"]],
  "stats/enchant": [["data.Default.lua", 1696, "local goldCost = item.itemLevel * 40"], ["data.Default.lua", 1717, "clamp(round(combinedOdds), 10, 80)"], ["data.Default.lua", 1715, "item.enchantAttempt[2] * 4, 0, 40"],
    ["data.Default.lua", 1751, "effectiveLevel + 10 + 2 * attempts + gradeBonus"], ["data.Default.lua", 1759, "(effectiveLevel - newSuffixLevel) * 2, 10, 95"], ["data.Default.lua", 1760, "math.min(attempts * 4, 100)"],
    ["data.Default.lua", 1669, "item.itemLevel * 20 + item.enchantAttempt[1] * 20"], ["data.Default.lua", 1678, "item.enchantAttempt[1] * 0.4"], ["data.Default.lua", 1644, "local fibo"],
    ["obj.Enchant.lua", 57, "prefixOdds > math.random(1, 100)"], ["obj.Enchant.lua", 73, "breakChance > math.random(1, 100)"], ["data.Default.lua", 1764, "function default.enchantTime"]],
  "stats/map-essence": [["data.Default.lua", 757, "math.round(gradeBonus[grade] * essenceRewards[i + essenceTypes] * mapStats.essenceBase * (1 + partyLuck / 100))"],
    ["obj.Map.lua", 105, "self.mapStats.essenceBase * (1 + sAmount)"], ["obj.Map.lua", 118, "self.mapStats.essenceBase * (1 + sAmount)"], ["obj.combat.Campaign.lua", 210, "if self.isFinished and self.isWin then"],
    ["data.Default.lua", 644, "local mapPrestigeMod = {2, 3}"], ["data.Default.lua", 670, "elseif map.grade < 3 then"], ["data.Default.lua", 677, "mod * (1 + sAmount)"],
    ["data.Default.lua", 686, "function default.statModFromMap"], ["obj.Enemy.lua", 73, "statValue = statValue * mapStats[k]"], ["data.Default.lua", 621, "function default.mapRoomQuantity"],
    ["obj.Map.lua", 170, "treasurePerRoomPerGradeChance"], ["obj.Map.lua", 93, "math.ceil(self.levelReq / 10)"]],
  "battle/quests-and-maps": [["data.Default.lua", 861, "hero.prestigeLevel * 2 - 1"], ["obj.Enemy.lua", 77, "self.maxHP = self.maxHP * self.amount"],
    ["obj.combat.questService.lua", 178, "if questInfo.questType == 1 then"], ["obj.combat.Campaign.lua", 210, "if self.isFinished and self.isWin then"],
    ["obj.Map.lua", 186, "function Map:generateTreasure"], ["obj.Map.lua", 193, "treasureId[math.ceil(self.levelReq / 10)]"],
    ["obj.combat.Battle.lua", 27, "currentHp = hero.questHP"], ["obj.combat.Campaign.lua", 70, "math.min(hero.questHP, hero.hp)"]],
  "battle/setup": [["obj.combat.Battle.lua", 46, "self:setupHero(self.backRow[n], n * 2 - 1)"], ["obj.combat.Battle.lua", 62, "if 0 < currentHp then"], ["obj.combat.Battle.lua", 63, "hero:resetStats()"],
    ["obj.Enemy.lua", 75, "math.round(statValue * default.enemyMods[k])"], ["obj.Enemy.lua", 78, "self.acc = 100"]],
  "battle/turn-order": [["obj.combat.Battle.lua", 129, "function Battle:determineTurnOrder"], ["obj.combat.enemiesService.lua", 11, "return enemyType == 6"],
    ["obj.combat.Battle.lua", 109, "self.turnOrder[actionNum].questHP > 0"], ["obj.combat.Battle.lua", 112, "self.actions = self.actions + 1"]],
  "battle/rotation": [["obj.combat.Battle.lua", 110, "determineAction((self.turns - 1) % 5 + 1)"], ["obj.Combatant.lua", 24, "local actionName = self.attackList[turnNumber]"],
    ["obj.Enemy.lua", 25, "default.enemyAttackList(self.questID, isRare)"]],
  "battle/targeting": [["obj.Enemy.lua", 99, "function Enemy:getDamageRatio"], ["obj.Party.lua", 208, "function Party:getFirstRowRatio"], ["obj.Combatant.lua", 147, "damRatio == \"mid\""],
    ["obj.Combatant.lua", 156, "damRatio == \"midline\""], ["obj.Party.lua", 11, "function Party:getHeroByStat"], ["data.AbilityFunc.lua", 2032, "getHeroByStat(\"questHP\", false)"],
    ["data.AbilityFunc.lua", 487, "function abilityFunc:Taunt"], ["data.AbilityFunc.lua", 847, "local frontID = (self.partyLocation + 1) / 2"], ["obj.Party.lua", 71, "unknown string for damage ratio"]],
  "battle/attack": [["obj.Combatant.lua", 376, "function Combatant:receiveAttack"], ["obj.Combatant.lua", 397, "\"OnDamage\""], ["obj.Combatant.lua", 421, "math.round(200 * attack.acc"],
    ["obj.Combatant.lua", 457, "calculateReduction(self.def, attack.defPen)"], ["obj.Combatant.lua", 466, "\"DamageReceived\""], ["obj.Combatant.lua", 489, "if 0 >= self.questHP then"]],
  "battle/effects": [["obj.Combatant.lua", 27, "0 >= self.effectList[n].turns"], ["obj.Combatant.lua", 35, "self:determineStats(true)"], ["obj.Combatant.lua", 61, "currentEffect.trigger == \"OnTurn\""],
    ["obj.Combatant.lua", 212, "atk = \"atkPct\""], ["obj.Combatant.lua", 262, "elseif params.reversible then"], ["obj.Combatant.lua", 265, "elseif params.stacks then"],
    ["obj.Combatant.lua", 282, "self.effectList[effectID].trigger = \"OnTurn\""], ["obj.Party.lua", 83, "moreOptions.adjustTurns"], ["obj.Combatant.lua", 492, "self.effectList[n].remove = true"]],
  "battle/buffs-debuffs": [["obj.Combatant.lua", 308, "function Combatant:removeAllEffects"], ["obj.Combatant.lua", 319, "effect.cannotDispell"], ["data.AbilityFunc.lua", 836, "self.party:removeAllEffects(true, true)"],
    ["data.AbilityFunc.lua", 840, "target:removeAllEffects(false, true)"], ["data.AbilityFunc.lua", 844, "target:removeAllEffects(nil, true)"], ["data.AbilityFunc.lua", 1616, "function abilityFunc:Pulverize"],
    ["data.AbilityFunc.lua", 2254, "return \"Basic\""], ["data.AbilityFunc.lua", 2451, "cannotDispell = true"], ["data.AbilityFunc.lua", 538, "stats = {atk = 0.22}"], ["data.AbilityFunc.lua", 1446, "attack.hitChance = 50"]],
  "battle/heals": [["obj.Combatant.lua", 337, "function Combatant:receiveHeal"], ["obj.Combatant.lua", 338, "if self.isDead and not revive then"], ["obj.Combatant.lua", 359, "if self.questHP > self.maxHP then"],
    ["obj.Combatant.lua", 364, "math.min(self.questHP, self.maxHP)"], ["obj.Combatant.lua", 369, "self.questHP = self.questHP + totalHeal"], ["data.AbilityFunc.lua", 1150, "self.def * 1, false, true"],
    ["data.AbilityFunc.lua", 848, "0.3 * (self.matk + self.acc) + 2 * self.level"], ["data.AbilityFunc.lua", 856, "0.11 * (self.matk + self.acc) + self.level"]],
  "battle/revives": [["data.AbilityFunc.lua", 819, "hero.isDead and hero.reviveCooldown == 0"], ["data.AbilityFunc.lua", 820, "hero:receiveHeal(0.5, true, false, true)"], ["obj.Combatant.lua", 356, "self.reviveCooldown = 2"],
    ["obj.Combatant.lua", 21, "math.max(0, self.reviveCooldown - 1)"], ["data.ScrollsData.lua", 41, "target.questHP = target.maxHP"], ["data.ScrollsData.lua", 84, "charges = 3"]],
  "battle/death": [["obj.Combatant.lua", 489, "if 0 >= self.questHP then"], ["obj.Party.lua", 161, "0 < hero.questHP"], ["obj.Quest.lua", 226, "not isWin then"], ["obj.combat.Campaign.lua", 71, "not (self.isWin or self.isEscape)"]],
  "battle/battle-end": [["obj.combat.Battle.lua", 86, "if self:areHeroesFainted() then"], ["obj.combat.Battle.lua", 91, "if 0 >= self.enemy.questHP then"], ["obj.combat.Battle.lua", 95, "if self.turns >= 200 then"],
    ["obj.combat.questService.lua", 157, "if battle.hasWon == false then"]],
  "battle/map-runs": [["obj.combat.GameCampaigns.lua", 39, "campaign.backRow[i].questHP = campaign.backRow[i].hp"], ["obj.combat.Campaign.lua", 156, "useQuestHp = true"],
    ["obj.combat.Battle.lua", 27, "currentHp = hero.questHP"], ["obj.combat.Campaign.lua", 119, "math.ceil(math.min(hero.questHP, hero.maxHP))"], ["obj.combat.Campaign.lua", 200, "checkEscape(self)"],
    ["data.ScrollsData.lua", 13, "dead / total >= scrollData.deadPart"], ["data.ScrollsData.lua", 37, "math.min(oldHp + stats.hp, target.maxHP)"], ["obj.combat.Campaign.lua", 70, "math.min(hero.questHP, hero.hp)"],
    ["obj.combat.GameCampaigns.lua", 59, "putIntoPlayerInventory"], ["obj.Hero.lua", 238, "campaign.battleBuff"]],
  "battle/quest-size": [["obj.Enemy.lua", 77, "self.maxHP = self.maxHP * self.amount"], ["obj.combat.questService.lua", 183, "(8 + questInfo.region * 3 - turns) / 4"]],
};

const pages: [string, Record<string, readonly [string, string]>, RefSection[]][] = [
  ["stats", STAT_TOPICS, STATS_SECTIONS],
  ["battle", BATTLE_TOPICS, BATTLE_SECTIONS],
];

test("reference pages: one section per topic, in catalog order, stable hrefs", () => {
  for (const [page, topics, sections] of pages) {
    assert.deepEqual(sections.map((s) => s.id), Object.keys(topics), page);
    for (const id of Object.keys(topics)) assert.match(id, /^[a-z]+(-[a-z]+)*$/, `${page}/${id}: anchor is lowercase-hyphenated`);
  }
  assert.equal(statHref("hit-chance"), "wiki.html#/stats/hit-chance");
  assert.equal(battleHref("turn-order"), "wiki.html#/battle/turn-order");
  // the topics the roadmap asks for are all there
  for (const t of ["hero-stats", "max-hp", "damage", "defence", "hit-chance", "crit", "ap", "luck", "grade", "quest-size", "xp", "item-stats", "sell", "craft", "essence", "enchant", "map-essence"]) {
    assert.ok(t in STAT_TOPICS, t);
  }
  for (const t of ["quests-and-maps", "setup", "turn-order", "rotation", "targeting", "attack", "effects", "buffs-debuffs", "heals", "revives", "death", "battle-end", "map-runs", "quest-size"]) {
    assert.ok(t in BATTLE_TOPICS, t);
  }
  // U31: "Two kinds of battle" comes first on the Battle page
  assert.equal(Object.keys(BATTLE_TOPICS)[0], "quests-and-maps");
});

test("reference pages: bodies render, every cross-link points to a real section, no code cited", () => {
  for (const [page, , sections] of pages) {
    for (const s of sections) {
      const html = s.html();
      assert.ok(html.length > 200, `${page}/${s.id}: body`);
      assert.doesNotMatch(html, /undefined|NaN|\[object /, `${page}/${s.id}`);
      for (const [, p, t] of html.matchAll(/href="wiki\.html#\/(stats|battle)\/([a-z-]+)"/g)) {
        assert.ok(t in (p === "stats" ? STAT_TOPICS : BATTLE_TOPICS), `${page}/${s.id} links to missing ${p}/${t}`);
      }
      // the site shows no game-code references: no Lua file names, no file:line, no module paths
      assert.doesNotMatch(html, /\.lua\b|\b(obj|data|scene)\.[A-Z]\w*|\w:\d+\b|[Ss]ource/, `${page}/${s.id} cites code`);
    }
  }
  // the quest and map overview links to the detailed sections
  const kinds = BATTLE_SECTIONS[0].html();
  for (const href of ["#/battle/quest-size", "#/battle/map-runs"]) assert.ok(kinds.includes(href), href);
  // Stats and Battle link to each other
  assert.ok(STATS_SECTIONS.some((s) => s.html().includes("#/battle/")));
  assert.ok(BATTLE_SECTIONS.some((s) => s.html().includes("#/stats/")));
});

test("every section has its game-code references (kept here, not on the page)", () => {
  const keys = pages.flatMap(([page, , sections]) => sections.map((s) => `${page}/${s.id}`));
  assert.deepEqual(Object.keys(SOURCES).sort(), [...keys].sort());
  for (const k of keys) assert.ok(SOURCES[k].length > 0, `${k}: has references`);
});

test("worked-example formulas match the port", () => {
  for (const def of [0, 1, 37, 100, 250, 999]) {
    for (const pen of [0, 40]) assert.equal(reduction(def, pen), calculateReduction(def, pen));
  }
  for (let level = 1; level <= 60; level++) {
    for (const apMod of [0, 2]) assert.equal(maxAp(level, apMod), heroMaxActionPoints({ level, apMod }), `AP at ${level}`);
  }
  assert.equal(maxAp(40), 20);
  assert.equal(hitChance(100, 100), 100);
  assert.equal(hitChance(100, 150), 80);
  assert.equal(hitChance(150, 300), 67);

  // grade: against the port's determineBattleGrade on real quests
  const quests = Object.entries<any>(G.questData).filter(([, q]) => q?.questType && q.levelReq).slice(0, 60);
  for (const [id, q] of quests) {
    for (const [lvl, turns, rare] of [[q.levelReq, 3, false], [q.levelReq + 7, 12, false], [Math.max(1, q.levelReq - 6), 25, true]] as const) {
      const battle: any = { hasWon: true, frontRow: { 1: { level: lvl } }, backRow: { 1: { level: lvl } }, heroCount: 2, turns };
      assert.equal(battleGrade(lvl, q.region, q.levelReq, q.questType, turns, rare), determineBattleGrade(battle, Number(id), rare), `quest ${id}`);
    }
  }

  // essence: against the tools' prestigeItemMaterial port (plain items, base rarity)
  const gd = new Game(G);
  for (const [id, it] of Object.entries<any>(G.itemData.equipment).filter(([, it]) => it?.itemLevel && it.rarity).slice(0, 80)) {
    for (const up of [false, true]) {
      assert.equal(ascendEssence(it.itemLevel, it.rarity, "equipment", up), gd.essenceForAscension("equipment", Number(id), 1, up)[1], `equipment ${id}`);
    }
  }

  // item base stats: the range is exactly what the port's random roll covers
  for (const [lvl, grade, asc, d] of [[20, 3, 0, 0], [20, 5, 1, 0], [40, 1, 0, 10], [55, 4, 2, 30]]) {
    const [lo, hi] = baseStatRange(G.itemFormula.Sword.atkBase, G.itemFormula.Sword.atkLvl, lvl, grade, asc, d);
    setRng(new Rng(7));
    const rolls = Array.from({ length: 3000 }, () => itemStat.atk(lvl + [0, 40, 80][asc], "Sword", false, grade, d));
    assert.equal(Math.min(...rolls), lo, `Sword ${lvl} g${grade} a${asc} d${d}`);
    assert.equal(Math.max(...rolls), hi);
  }
});

/** The decompiled game, when present: <repo>/decompiled, or the main checkout's when this is a worktree. */
function findDecompiled(): string | undefined {
  let dir = resolve(import.meta.dirname, "../..");
  for (let i = 0; i < 6; i++) {
    const d = join(dir, "decompiled");
    if (existsSync(join(d, "obj.Hero.lua"))) return d;
    dir = dirname(dir);
  }
  return process.env.DECOMPILED;
}

test("game-code references point at the right lines of the decompiled game", { skip: !findDecompiled() && "no decompiled/ here" }, () => {
  const root = findDecompiled()!;
  const cache = new Map<string, string[]>();
  for (const [key, srcs] of Object.entries(SOURCES)) {
    for (const [file, line, needle] of srcs) {
      if (!cache.has(file)) cache.set(file, readFileSync(join(root, file), "utf8").split("\n"));
      const text = cache.get(file)![line - 1] ?? "";
      assert.ok(text.includes(needle), `${key}: ${file}:${line} is “${text.trim()}”, expected “${needle}”`);
    }
  }
});
