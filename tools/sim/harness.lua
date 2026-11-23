-- Headless loader for Merchant's combat code.
--
-- Runs the game's own decompiled Lua (decompiled/*.lua) inside Lua 5.1 with
-- stubs for the Corona/Solar2D engine (display, system, native, ...), so the
-- simulator uses the exact battle, stat and skill rules of the game.
--
-- Expects the global SRC (path to decompiled/) to be set before loading.
-- Exposes the global table `sim` (see the end of this file).

assert(SRC, "SRC (decompiled folder) must be set")

---------------------------------------------------------------- stubs
-- A stub accepts any field access, call or arithmetic and returns another stub
-- (or 0 / false), so engine calls made by game code are harmless no-ops.
local stubMeta
local function makeStub(name)
  return setmetatable({__stubName = name}, stubMeta)
end
stubMeta = {
  __index = function(t, k)
    if k == "__stubName" then return rawget(t, k) end
    local v = makeStub(rawget(t, "__stubName") .. "." .. tostring(k))
    rawset(t, k, v)
    return v
  end,
  __call = function(t) return makeStub(rawget(t, "__stubName") .. "()") end,
  __tostring = function(t) return rawget(t, "__stubName") end,
  __concat = function(a, b) return tostring(a) .. tostring(b) end,
  __add = function() return 0 end, __sub = function() return 0 end,
  __mul = function() return 0 end, __div = function() return 0 end,
  __unm = function() return 0 end, __lt = function() return false end,
  __le = function() return false end,
}
sim_makeStub = makeStub

for _, name in ipairs({"display", "system", "native", "graphics", "timer", "transition", "Runtime",
                       "media", "audio", "network", "store", "analytics", "gameNetworkWrapper",
                       "composer", "widget", "UIObject", "audioManager", "adManager", "steamworks",
                       "crashlytics"}) do
  _G[name] = makeStub(name)
end

-- Corona/Solar2D extensions to the Lua standard library.
-- math.round follows JavaScript's Math.round: floor(x + 0.5).
math.round = function(x) return math.floor(x + 0.5) end
table.indexOf = table.indexOf or function(t, v)
  for i = 1, #t do if t[i] == v then return i end end
  return nil
end
table.copy = table.copy or function(...)
  local out = {}
  for _, t in ipairs({...}) do for i = 1, #t do out[#out + 1] = t[i] end end
  return out
end

-- Plain values the game reads as configuration.
IS_DEBUG = false
MOD_MODE = true          -- set again by data.Default from platformInfo
screenWidth, screenHeight = 640, 1136
TEXT = setmetatable({}, {__index = function() return "" end})
UI = setmetatable({}, {__index = function() return 0 end})

-- Game singleton: only what combat touches, everything else a no-op.
Game = setmetatable({campaigns = {}, saveFileName = "sim"}, {
  __index = function() return function() end end,
})

---------------------------------------------------------------- deterministic RNG
-- Park-Miller LCG with Lua 5.1 math.random argument handling. The TypeScript
-- port (web/src/sim/lua.ts) uses the same generator, so both engines draw the
-- same rolls and fights can be compared action by action.
local LCG_MOD = 2147483647
local lcgState, lcgCalls = 1, 0
local function trunc(v) if v >= 0 then return math.floor(v) end return math.ceil(v) end
local function lcgSeed(x)
  lcgState = math.floor(math.abs(tonumber(x) or 0)) % (LCG_MOD - 1) + 1
end
local function lcgRandom(m, n)
  lcgState = (lcgState * 16807) % LCG_MOD
  lcgCalls = lcgCalls + 1
  local r = (lcgState - 1) / (LCG_MOD - 1)
  if m == nil then return r end
  if n == nil then return math.floor(r * trunc(m)) + 1 end
  m, n = trunc(m), trunc(n)
  return math.floor(r * (n - m + 1)) + m
end

-- USE_LCG (set before this file runs): install the LCG before any game file is
-- loaded, so modules that keep a local copy (data.Default: local random =
-- math.random) also draw from it.
if USE_LCG then
  math.random = lcgRandom
  math.randomseed = lcgSeed
end

---------------------------------------------------------------- module loader
-- require("obj.combat.Battle") -> SRC/obj.combat.Battle.lua ; unknown -> stub.
local STUB_MODULES = {
  ["obj.common.platformInfo"] = function()
    return {isPC = true, isAndroid = false, isIOS = false, isMobile = false, platform = "win32"}
  end,
  ["obj.combat.combatLogManager"] = function()
    -- No log files: every log call is a no-op.
    return setmetatable({createNewLog = function() return makeStub("log") end},
                        {__index = function() return function() end end})
  end,
  ["obj.common.localizationService"] = function()
    return setmetatable({getTextByKey = function() return nil end}, {__index = function() return function() end end})
  end,
  ["json"] = function() return makeStub("json") end,
}

local function fileExists(path)
  local f = io.open(path, "r")
  if f then f:close() return true end
  return false
end

table.insert(package.loaders, 2, function(name)
  if STUB_MODULES[name] then
    return STUB_MODULES[name]
  end
  local path = SRC .. "/" .. name .. ".lua"
  if fileExists(path) then
    local chunk, err = loadfile(path)
    if not chunk then error("cannot load " .. path .. ": " .. err) end
    return chunk
  end
  return function() return makeStub(name) end
end)

---------------------------------------------------------------- game code
class = require("MiddleClass")
require("Utilities")

local loadErrors = {}
local function try(name)
  local ok, err = pcall(require, name)
  if not ok then loadErrors[#loadErrors + 1] = name .. ": " .. tostring(err) end
  return ok
end

itemData = {}
for _, name in ipairs({"data.EquipmentData", "data.MaterialData", "data.ConsumableData", "data.MapData",
                       "data.PrefixData", "data.SuffixData", "data.HeroData", "data.AbilityData",
                       "data.AbilityFunc", "data.QuestData", "data.ParcelData", "data.FormulaData",
                       "data.Default"}) do
  try(name)
end
for _, name in ipairs({"obj.Item", "obj.Equipment", "obj.Map", "obj.Combatant", "obj.Hero", "obj.Party", "obj.Enemy"}) do
  try(name)
end
local Battle = require("obj.combat.Battle")
local Campaign = require("obj.combat.Campaign")

-- Remember the last battle so a map run can report how far the last fight got.
local origLoop = Battle.combatLoop
Battle.combatLoop = function(self)
  sim_lastBattle = self
  return origLoop(self)
end

-- The game prints a lot during combat: keep the console quiet.
sim_print = print
print = function() end

-- Per-skill damage tracking: damage a combatant deals during its own action is
-- credited to the skill in its rotation slot; the rest (damage-over-time ticks
-- on the enemy's turn, reflects...) shows up as "effects".
local function dealt(c)
  local s = c.combatStatistics
  return (s.physicalDmgDealt or 0) + (s.magicDmgDealt or 0)
end
local function wrapAction(cls)
  local orig = cls.determineAction
  cls.determineAction = function(self, turnNumber)
    local name = self.attackList and self.attackList[turnNumber] or "?"
    local before = dealt(self)
    local result = orig(self, turnNumber)
    if self._skillDmg then
      self._skillDmg[name] = (self._skillDmg[name] or 0) + dealt(self) - before
      self._skillUses[name] = (self._skillUses[name] or 0) + 1
    end
    if sim_trace then sim_traceAction(self, name) end
    return result
  end
end
wrapAction(Hero)
wrapAction(Enemy)

-- Map runs reset combat statistics after every room; Hero:addToTotals folds
-- them into lifetime totals first. Also keep healing, which totals don't track.
local origAddToTotals = Hero.addToTotals
Hero.addToTotals = function(self)
  self._runHeal = (self._runHeal or 0) + (self.combatStatistics.healingDone or 0)
  return origAddToTotals(self)
end

-- Game mode defaults (enemyMods, time/xp mods...), as GameObject does on load.
function sim_setMode(mode)
  default.setMode(mode or "Standard")
end
sim_setMode(GAME_MODE)

-- GameObject:generatePrefixWeights / generateSuffixWeights (needed by Item code).
prefixWeightTable, suffixWeightTable = {}, {}
for n = 1, #prefixList do prefixWeightTable[n] = prefixList[n].weight end
for n = 1, #suffixList do suffixWeightTable[n] = suffixList[n].weight end
crafterArray = crafterArray or {}

-- Trace of every action (differential tests): who acted, the skill in its
-- rotation slot, RNG draws so far, and every HP after the action.
function sim_traceAction(c, name)
  local b = sim_lastBattle
  if not b then return end
  local hp = {}
  for i = 1, 3 do
    hp[i * 2 - 1] = b.backRow[i] and b.backRow[i].questHP or false
    hp[i * 2] = b.frontRow[i] and b.frontRow[i].questHP or false
  end
  local fx = {}
  for i, e in ipairs(c.effectList or {}) do fx[i] = e.name or "?" end
  sim_trace[#sim_trace + 1] = {turn = b.turns, who = c.partyLocation or 0, act = name, rng = lcgCalls,
                               enemyHP = b.enemy.questHP, hp = hp, effects = fx}
end

---------------------------------------------------------------- simulator API
sim = {loadErrors = loadErrors, setMode = sim_setMode}

-- Switch math.random to the shared LCG (for the rest of this Lua state).
-- Prefer USE_LCG at load time: local copies taken by game files keep C rand otherwise.
function sim.useLcg()
  math.random = lcgRandom
  math.randomseed = lcgSeed
end
function sim.rngCalls() return lcgCalls end
-- Start / stop recording sim_traceAction entries; stop returns the trace.
function sim.traceStart() sim_trace = {} end
function sim.traceStop() local t = sim_trace or {} ; sim_trace = nil ; return t end

-- Build a Hero exactly as the game loads one from a save entry
-- (heroInventory = compact item strings, skillSet/attackList = skill indices).
function sim.newHero(params)
  params.campaignID = -1          -- no campaign buffs outside a map
  params.boost = params.boost or false
  local hero = Hero:new(params, false)
  hero.hp = hero.maxHP
  hero.questHP = hero.maxHP
  return hero
end

-- Re-apply skill choices on an existing hero (5 skill names or indices + passive).
function sim.setSkills(hero, attackList, passive)
  hero.attackList = hero:loadSkillList(attackList)
  if passive then hero.passiveSelect = passive end
  hero:determineStats()
  return hero.attackList
end

local function heroSummary(h)
  local s = h.combatStatistics or {}
  return {
    name = h.name, class = h.class, level = h.level, prestige = h.prestigeLevel,
    hp = h.questHP, maxHP = h.maxHP, dead = h.isDead or (h.questHP or 0) <= 0,
    physicalDmgDealt = s.physicalDmgDealt or 0, magicDmgDealt = s.magicDmgDealt or 0,
    dmgTaken = (s.physicalDmgTaken or 0) + (s.magicDmgTaken or 0),
    skillDmg = h._skillDmg or {}, skillUses = h._skillUses or {},
    healingDone = s.healingDone or 0, hits = s.hits or 0, misses = s.misses or 0, crits = s.crits or 0,
  }
end

-- One fight. front/back: Lua arrays of heroes indexed 1..3 (holes allowed).
-- opts: isRare, amount (enemy count), seed, mapStats.
function sim.fight(questID, front, back, opts)
  opts = opts or {}
  if opts.seed then math.randomseed(opts.seed) end
  for i = 1, 3 do
    for _, row in ipairs({front, back}) do
      local h = row[i]
      if h then
        h._skillDmg, h._skillUses = {}, {}
        h.boost = false
        h:determineStats()
        h.hp = h.maxHP
        h.questHP = h.maxHP
      end
    end
  end
  local battle = Battle:new({
    questID = questID, frontRow = front, backRow = back,
    isRare = opts.isRare or false, amount = opts.amount or 1, mapStats = opts.mapStats,
  })
  battle:setup()
  battle:combatLoop()
  local result = {
    won = battle.hasWon and true or false, turns = battle.turns, actions = battle.actions,
    enemyHP = battle.enemy.questHP, enemyMaxHP = battle.enemy.maxHP, heroes = {},
  }
  for i = 1, 3 do
    if back[i] then result.heroes[#result.heroes + 1] = heroSummary(back[i]) ; result.heroes[#result.heroes].slot = "back" .. i end
    if front[i] then result.heroes[#result.heroes + 1] = heroSummary(front[i]) ; result.heroes[#result.heroes].slot = "front" .. i end
  end
  if result.won then
    result.grade = require("obj.combat.questService").determineBattleGrade(battle, questID, opts.isRare)
  else
    result.grade = 0
  end
  return result
end

-- Put an item (compact save string) in a hero's slot 1..6.
function sim.equip(hero, slot, compact)
  hero.heroInventory[slot] = Equipment:new(compact)
  hero:determineStats()
end

-- A fresh catalog item as the game crafts it: given grade, ascension level and
-- crafter level, no prefix/suffix. Base stats roll within the grade's range, so
-- `seed` fixes that roll. Returns the item object (usable with equipItem).
function sim.makeItem(id, grade, prestige, charLevel, seed)
  if seed then math.randomseed(seed) end
  -- Item:initialize ignores params.prefix, so a new item would roll modifiers:
  -- force the roll odds to 0 while it is created.
  local pOdds, sOdds = default.craftPrefixOdds, default.craftSuffixOdds
  default.craftPrefixOdds = function(c) return 0, c end
  default.craftSuffixOdds = function(c) return 0, c end
  local ok, item = pcall(Equipment.new, Equipment, {id = id, itemType = "equipment", grade = grade,
                         prestigeLevel = prestige or 0, isNew = true, charLevel = charLevel or 60})
  default.craftPrefixOdds, default.craftSuffixOdds = pOdds, sOdds
  if not ok then error(item) end
  item.grade = grade
  return item
end

function sim.equipItem(hero, slot, item)
  hero.heroInventory[slot] = item
  hero:determineStats()
end

-- Number of class skills unlocked at the hero's level, and their AP costs.
function sim.skillInfo(hero)
  local skills = heroList[hero.class].skillList
  local out = {unlocked = default.attackListUnlocked(hero), maxAP = default.heroMaxActionPoints(hero), skills = {}}
  for i = 1, #skills do
    out.skills[i] = {name = skills[i], ap = abilityData[skills[i]] and abilityData[skills[i]].apCost or 0,
                     desc = abilityData[skills[i]] and abilityData[skills[i]].desc or ""}
  end
  out.passives = heroList[hero.class].passiveList
  return out
end

-- A map item: from a compact save string, or {id, prestigeLevel, grade, prefix,
-- suffix, seed}. The seed fixes rooms, enemies, rares and boss (Map:determineSeedBasedStats).
function sim.makeMap(spec, seed)
  local map
  if type(spec) == "string" then
    map = Map:new(spec)
    if seed then
      map.seed = seed
      map:determineSeedBasedStats()
    end
  else
    map = Map:new({id = spec.id, prestigeLevel = spec.prestigeLevel or 0, grade = spec.grade or 3,
                   prefix = spec.prefix, suffix = spec.suffix, seed = seed or spec.seed or 1})
  end
  return map
end

-- One full map run with the game's Campaign: rooms in order, HP carried over,
-- loot per won fight, essence at the end. Hero level/exp are restored afterwards.
function sim.mapRun(mapSpec, front, back, opts)
  opts = opts or {}
  if opts.seed then math.randomseed(opts.seed) end
  local map = sim.makeMap(mapSpec, opts.mapSeed or opts.seed)
  -- Map:determineSeedBasedStats ends with math.randomseed(os.time()): re-seed so
  -- the fights are reproducible (same seed = same run, in any process).
  if opts.seed then math.randomseed(opts.seed * 7919 + 17) end
  local saved = {}
  for i = 1, 3 do
    for _, h in pairs({front[i] or false, back[i] or false}) do
      if h then
        saved[h] = {exp = h.exp, level = h.level, totalQuests = h.totalQuests, totalHits = h.totalHits,
                    attackList = h.attackList, passiveSelect = h.passiveSelect, currentSkillSet = h.currentSkillSet,
                    dealt = h.totalPhysicalDmgDealt + h.totalMagicDmgDealt,
                    taken = h.totalPhysicalDmgTaken + h.totalMagicDmgTaken,
                    tP = {h.totalPhysicalDmgDealt, h.totalMagicDmgDealt, h.totalPhysicalDmgTaken, h.totalMagicDmgTaken}}
        h._runHeal = 0
        h._skillDmg, h._skillUses = {}, {}
        h.boost = false
        h.campaignID = -1
        h:resetStatsAndStatus()
        h.hp = h.maxHP
        h.questHP = h.maxHP
        h.isDead = false
        h.timeDied = false
      end
    end
  end
  -- Scrolls as Game:startMap builds them: one entry per slot (max 3 in the UI).
  local scrolls
  if opts.scrolls then
    scrolls = {}
    for i, sc in ipairs(opts.scrolls) do
      scrolls[i] = {id = sc.id, amount = 1, chargesUsed = 0, prestigeLevel = sc.prestigeLevel or 0}
    end
  end
  local camp = Campaign:new({map = map, frontRow = front, backRow = back, scrolls = scrolls})
  Game.campaigns.campaigns = {camp}
  for h in pairs(saved) do
    h.campaignID = 1
    h.questHP = h.hp
    h:determineStats()
  end
  local guard = 0
  while not camp.isFinished and guard < 100 do
    camp:runCombat()
    guard = guard + 1
  end
  local out = {won = camp.isWin and true or false, escaped = camp.isEscape and true or false,
               rooms = #camp.combats, mapName = map.name, mapAsc = map.prestigeLevel,
               enemyMod = map.enemyMod, combats = {}, rewards = {}, heroes = {}, time = 0}
  local cleared = 0
  for i, c in ipairs(camp.combats) do
    out.combats[i] = {questId = c.questId, name = questData[c.questId].name, isRare = c.isRare and true or false,
                      status = c.status, grade = c.grade or 0}
    if c.status == 1 then cleared = cleared + 1 end
    out.time = out.time + (c.timeTaken or 0) + (c.walkTime or 0)
  end
  out.cleared = cleared
  out.scrollsUsed = {}
  for i, sc in ipairs(scrolls or {}) do
    out.scrollsUsed[i] = {id = sc.id, chargesUsed = sc.chargesUsed}
  end
  out.lastEnemyRemoved = 0
  if not out.won and sim_lastBattle and sim_lastBattle.enemy.maxHP > 0 then
    out.lastEnemyRemoved = 1 - math.max(sim_lastBattle.enemy.questHP, 0) / sim_lastBattle.enemy.maxHP
  end
  out.grade = camp:getGrade()
  for _, r in ipairs(camp.lootInventory.rewards) do
    out.rewards[#out.rewards + 1] = {itemType = r.itemType, itemID = r.itemID, amount = r.amount or 1,
                                     prestigeLevel = r.prestigeLevel or 0}
  end
  for i = 1, 3 do
    for slot, h in pairs({["back" .. i] = back[i], ["front" .. i] = front[i]}) do
      if h then
        local s = heroSummary(h)
        local st = saved[h]
        s.slot = slot
        s.physicalDmgDealt = h.totalPhysicalDmgDealt - st.tP[1]
        s.magicDmgDealt = h.totalMagicDmgDealt - st.tP[2]
        s.dmgTaken = h.totalPhysicalDmgTaken + h.totalMagicDmgTaken - st.taken
        s.healingDone = h._runHeal or 0
        s.hp = h.questHP
        s.dead = (h.questHP or 0) <= 0
        out.heroes[#out.heroes + 1] = s
      end
    end
  end
  for h, st in pairs(saved) do
    h.exp, h.level = st.exp, st.level
    h.totalQuests, h.totalHits = st.totalQuests, st.totalHits
    h.attackList, h.passiveSelect, h.currentSkillSet = st.attackList, st.passiveSelect, st.currentSkillSet
    h.totalPhysicalDmgDealt, h.totalMagicDmgDealt, h.totalPhysicalDmgTaken, h.totalMagicDmgTaken =
      st.tP[1], st.tP[2], st.tP[3], st.tP[4]
    h.campaignID = -1
    h:determineStats()
  end
  Game.campaigns.campaigns = {}
  return out
end

-- Current combat stats of a hero (after determineStats), for reports.
function sim.heroStats(h)
  h:determineStats()
  local out = {}
  for _, k in ipairs({"maxHP", "atk", "matk", "acc", "crit", "critMod", "def", "mdef", "eva", "str", "int",
                      "dex", "speed", "lckMod", "defPen", "mdefPen", "maxActionPoints", "actionPoints"}) do
    out[k] = h[k]
  end
  return out
end
