---
type: Tool
title: Combat simulator
description: The combat tools (web/src/tools, on the TypeScript port of the game's combat code) simulate fights and search skills, gear and parties.
timestamp: 2026-11-23
---

# Combat simulator

[Root](../../index.md) > [Tooling](../index.md) > [Combat Simulator](./index.md) > Combat simulator

Exact fights: the engine (`web/src/sim/`) is a port of the game's combat Lua, checked roll by roll against the game's own
output. Heroes come from the save opened on the battle page (`save.ts`).
Rules being simulated: [combat](../../combat/combat.md), [heroes](../../combat/heroes/heroes.md).

## Table of contents

- [How it works](#how-it-works)
  - [Map runs](#map-runs)
- [Commands](#commands)
- [Search API](#search-api)
- [Search methods](#search-methods)
- [Potions and enchants in combat](#potions-and-enchants-in-combat)
- [Class balance on equal gear](#class-balance-on-equal-gear)
- [Levelling and prestige](#levelling-and-prestige)
- [Validation](#validation)
- [Limits](#limits)
- [From Python to TypeScript](#from-python-to-typescript)
- [Code](#code)

## How it works

```mermaid
flowchart LR
  S[save file] --> P[save.ts]
  G[inventory/gamedata.json] --> A[sim/api.ts]
  P --> E[tools/engine.ts]
  A --> E
  E --> C[tools/combat.ts]
  C --> W[battle page]
```

- `web/src/sim/` ports the game's `Item`, `Equipment`, `Combatant`, `Hero`, `Party`, `Enemy`, `Battle`, `Map`,
  `Campaign` and the skill functions; data tables come from `inventory/gamedata.json`. Porting rules: `web/src/sim/PORTING.md`.
- Random numbers come from the LCG the reference recordings used, so a seed gives the same fight as in the game code.
- Corona extras kept: `math.round` = `floor(x + 0.5)`; combat logs and `print` are dropped.
- Game mode defaults applied as on load (`default.setMode`, save's `gameMode`).
- Heroes are built with `Hero:new` from the raw save entry, gear from its compact item strings.
- Per-skill damage: damage dealt during a combatant's own action is credited to the skill in that rotation slot.
- About 2 ms per solo fight, 5 ms per 4-hero fight, 70 ms per full map run.

### Map runs

- `api.mapRun` builds the game's `Campaign` from a `Map` (save compact string, or id + asc + grade + prefix +
  suffix) the way `GameCampaigns:addNew` does: heroes start at full HP, `campaignID` set so scroll buffs apply.
- `runCombat()` until finished: rooms in order, HP carried over, loot per won room, essence at the end.
- The seed fixes the layout (rooms, enemies, rares, boss) and the fights; each run uses a new seed.
- Per-run hero damage/taken from the change in lifetime totals (`addToTotals`), healing via a hook; hero
  level, XP and totals restored after each run.
- Progress score = rooms cleared + share of the last enemy's HP removed, so "almost beat the boss" ranks higher.
- Scrolls are passed as `Game:startMap` builds them (`{id, amount = 1, chargesUsed = 0, prestigeLevel}`); the game's
  `ScrollsComponent` applies buffs (via the hero's `campaignID`), map stats, post-battle effects and escape.
  Skill sets swapped by the Swap scroll are restored after each run.
- `Map:determineSeedBasedStats` ends with `math.randomseed(os.time())`; `api.mapRun` re-seeds after building the
  map, so a seed gives the same run every time.

## Commands

`web/src/tools/combat.ts` functions. The battle page runs `evaluate` (quest fights) and `evaluateMap` (map runs, with
scrolls). The searches are pure functions (see [Search API](#search-api)); the `cmd*` functions below are text reports
built on them, kept from the former command line.

| Command | What it answers |
|---|---|
| `roster` | Every hero's computed stats, AP use, rotation and passive |
| `fight --quest Q --front ids --back ids` | Win %, turns, grade, damage/taken/heal/death per hero, damage per skill |
| `damage --hero H --quest Q` | Solo damage per fight, per turn, per skill use |
| `solo [--heroes] [--quests]` | Win % of every hero alone vs every quest → `reports/solo.csv` + class table |
| `skills --hero H --quest Q [--front --back]` | Best 5-slot rotation and passive within the AP budget |
| `gear --hero H --quest Q --pool owned\|catalog` | Best item per slot from your items, or from the craftable catalog |
| `party --quest Q [--size 6]` | Best heroes and row positions from your roster |
| `map --map ID\|inv:N [--asc 1] --front --back` | Full map runs: win %, progress, grade, time, loot and essence per run, where it fails |
| `party --map ID` | Best party for a map run |
| `maps --front --back` | Every map (asc 0 and 1) with one party → `reports/maps_survey.csv` (essence/h, loot/h) |
| `map … --scrolls 61,63,69@1` | Map runs with up to 3 scrolls (`ID@ASC` for ascended); charges used and escapes reported |
| `scrolls --map ID --front --back` | Best loadout of up to 3 scrolls (all 286 combinations), with each scroll's crafted cost |

Options: `--rare` (rare variant), `--amount` (quest amount), `-n` (fights per evaluation).

- **Quest amount**: one enemy with its max HP × amount (`obj.Enemy`), loot and quest time scaled with it; not several
  enemies. The game offers 1 to `prestigeLevel × 2 − 1` (1, 3 or 5) for the hero the quest is opened with
  (`default.enemyAmount`; Quick mode `× 3 + 1`, Legendary `× 2 + 1`), less if gold is short; a rare quest is 1.
  `maxQuestAmount(heroes, rare, mode)` takes the party's highest prestige; `evaluate` and the farming report refuse
  an amount outside it.

## Search API

Pure functions for pages and web workers: typed results, no output, no Node APIs. They take engine heroes, not save ids.

| Function | Returns |
|---|---|
| `soloMatrix(sim, [[id, hero]], quests, {n, rare}, ctl)` + `soloSummary(rows, threshold)` | `SoloRow[]` (solo.csv); per-hero and per-class summary |
| `searchSkills(sim, hero, front, back, {quest, rare, amount}, {nQuick, nFinal, top}, ctl)` | `current` and `ranked` `{rotation, passive, ev}` |
| `searchGear(sim, hero, front, back, quest, candidates, {n, passes}, ctl)` | `base`, `final`, `gear[{slot, item, from}]` |
| `catalogGearCandidates(sim, hero, {itemGrade, asc, …})`, `ownedGearCandidates(save, heroId)` | candidates by slot for `searchGear` |
| `surveyMaps(sim, front, back, {n, mapGrade, scrolls, include70}, ctl)` | per map and asc: `MapSurveyRow` + `MapEval`, or the game error |
| `searchScrolls(sim, mapSpec, front, back, {pool, scrollAsc, nQuick, nFinal, top, prices}, ctl)` | `ranked {loadout, ev, cost}` |
| `searchParty(sim, Map<id, hero>, questOrMapTarget, {size, nQuick, nFinal}, ctl)` | `party {front, back}` (ids), `ev`, greedy steps |
| `evaluateTarget(sim, questOrMapTarget, front, back, n)` | `FightEval` for a quest, `MapEval` for a map run (both have `score`) |
| `optimiseFight(sim, Map<id, hero>, questOrMapTarget, {save, size, startParty, lock, nQuick, nFinal, maxRounds, minGain, timeBudgetMs, steps}, ctl)` (`optimise.ts`) | `config {party, skills, gear, scrolls}`, final `ev`, `firstPartyEv`, per-step `trace {round, step, before, after, change, ms}` |

- `ctl: SearchControl = {onProgress(done, total, stage), shouldStop()}`. Totals are per stage; a stopped search
  throws `SearchCancelled`. Heroes are always put back as they were (rotation, gear).
- Same results as the former commands for the same seeds: checked on a real save for all six searches (return values
  and every output line). `web/test/search.test.ts` covers them on made-up heroes, so CI runs it.

## Search methods

- Every candidate is evaluated on the same seeds (common random numbers), so differences aren't noise.
- Seeds: fight k of an evaluation uses `fightSeed(seed0, k)`, a 32-bit hash of (seed0, k), in `evaluate`,
  `evaluateMap` (so every search), the farming report and levelling. Plain seeds 1, 2, 3... gave a first Park-Miller
  roll of 1 for every seed up to ~1,270, so the first hit check of every fight always landed. The Lua difftests and
  engine snapshots call the engine with their own seeds and are unchanged.
- Score (`score`):
  - Win rate first.
  - Won fights: fewer turns (−10 per turn), then party HP left.
  - Lost fights: how far the enemy's HP was brought down at its lowest point (`enemy_dmg_peak`, 1 % = 100). Then the damage it took (`enemy_dmg_total_frac`, 1 % = 10; it counts when the enemy heals back). Then surviving longer, a small bonus (+0.5 per turn).
  - Before, every turn cost 10 points, won or lost, which rewarded a lost fight that ended sooner.
- Healing enemies: `enemy_dmg` is the share of HP removed at the end of the fight. An enemy that heals (Archon's
  Aeon Lash, Goblin Warlord's Feast) can end a lost fight near full HP, so each fight also records the lowest enemy
  HP after any action (`enemyMinHP`) and all damage it took (`enemyDmgTaken`, overkill on the killing blow included).
  Example, the save's best six heroes vs Archon: 0.0% at the end, 0.5% at the lowest, ~1,700 of 200,000 HP per fight.
  `enemy_dmg` can be negative when an enemy shields itself above its max HP (Murlok Monarch).
- `skills`: every skill multiset within AP (one order, quick), then all orderings of the best ones,
  then each passive with more fights. AP budgets are per passive (Wisdom: +2 AP): multisets go up to the largest
  budget and are scored with a passive that affords them; a rotation the game would replace with its default
  (`Hero:calculateAPRemainder`) is never scored. The current rotation is always a finalist, so the result is never
  worse than what the hero plays.
  - Schedule pre-filter (default for quests once `loadTimelines` ran; `prefilter: k`, default 15, `false` = off).
    Every ordering of every AP-legal multiset is ranked twice, by the counter-schedule score and by damage only
    ([schedule](./schedule.md)). Only the union of both top-k lists plus the current rotation is simulated, then
    the usual finalists × passives. Map runs and quests without a timeline use the full search.
- `gear`: coordinate descent, slot by slot, repeated `--passes` times.
  - `owned`: inventory, sale slots and gear worn by other heroes.
  - `catalog`: every equipment item within `--level-window` levels, built by the game at `--item-grade`,
    `--asc`, `--crafter-level`, with modifier odds forced to 0 (plain item).
- `party`: greedy add (hero × slot) while it helps, then swaps and moves until no improvement.
- `searchSkills` and `searchGear` take a quest or a map target (typed overloads: a quest still returns `FightEval`).
- **Joint optimiser** (`optimiseFight`, `web/src/tools/optimise.ts`): coordinate descent over party and rows (round 1),
  the layout steps below, each member's rotation and passive, the layout steps again, each member's gear (owned items:
  inventory, sale slots, gear of heroes outside the party; never one item for two heroes), then scrolls for a map run.
  A step is kept only if the score rises by `minGain` (default 5: half a turn or 1 % HP); another round runs while
  a step other than the party still improves (`maxRounds` 2). Defaults: 10 fights / 4 map runs per candidate, 200 / 30
  for the final evaluation, 2-minute budget (`timeBudgetMs`, the layout steps included), after which the best
  configuration so far is returned. Heroes are restored; apply `config`.
- **Layout steps** (`steps.order`, `steps.swap`, `steps.phase`, all on by default). The turn order is back 1, front 1,
  back 2, front 2, back 3, front 3, then the enemy ([combat](../../combat/combat.md#battle-loop)), and slot k of every
  rotation, the enemy's included, plays on turns k, k + 5, …, so who acts first and when each skill lands both matter.

| Step | Candidates (same seeds as the current layout) | Trace step name |
|---|---|---|
| Order within rows | the 3! × 3! = 36 orders of the front and back rows, empty slots included | `Order within rows` |
| Row swaps | one front slot exchanged with one back slot (9 pairs; a hero may move to an empty slot); if kept, the order step again | `Swap rows: A ↔ B`, then `Order within rows (after swap)` |
| Phase shift | each member's rotation shifted cyclically by 1-4 slots, passive unchanged | `Phase of X: +s` |

  - The pass runs after the party step and again after the skill steps, and is skipped when nothing changed since the
    last pass (same seeds, same result). A pass scores up to about 110 candidates (35 orders, 9 swaps, 35 more orders
    after a kept swap, 4 shifts per hero) at `nQuick` each: 3-10 s on Odin, Archon or a map run.
  - A shift keeps the AP total, the only rule the game puts on a rotation (`Hero:calculateAPRemainder`; slot order is
    free), so every shift is valid; a shift the engine would replace is still skipped.
- **Starting party and locks**: `startParty {front, back}` (hero ids) is the layout to start from when the party
  step is off, and the candidate the party search must beat when it is on. `lock: [ids]` keeps heroes in the party:
  the party step places them first (their `startParty` slot, else the best free slot) and never swaps them out; the
  layout steps may still move them.
- **Quest amount**: with `amount` > 1 the party must contain a hero whose prestige allows it (`maxQuestAmount`); a
  candidate party that doesn't scores −∞ (skipped) instead of throwing, and the party step uses the constrained search
  (as with locks). If no party of the pool is valid, `optimiseFight` throws "no party could be formed".
- **Gear and AP**: a gear candidate that lowers the hero's AP below its rotation's cost makes the game swap in the
  default rotation and passive. `searchGear` now scores every candidate with the hero's rotation put back and
  restores it at the end. The gear step still re-applies the rotation after equipping, and re-scores the kept gear
  with the rotation the game would really play. Before this fix, one hero's gear search could silently reset that
  hero's rotation (Archon: score 801 → 423 between two gear steps).
- **Schedule pre-filter** (`prefilter`, default 15): the skill step's `searchSkills` uses it. The phase step
  simulates only the 2 best shifts by schedule score and the best by damage only, instead of all 4.

| Target (save's 17 heroes) | `searchParty` alone | `optimiseFight` (2 min) | Unbounded |
|---|---|---|---|
| Desolation Wolf (quest 81) | 100 % win, 2.9 turns | same (59 s, nothing to gain) | same |
| Odin (quest 72) | 0 %, 8.9 % HP removed at lowest | 0 %, 19.8 % (rotations of 5 heroes) | 0 %, 33.5 % (288 s, + gear, round 2) |
| Gnoll Vendetta map asc 1 (boss Gnoll Khan) | 93.3 % win, grade 5 | same (budget spent on party and 2 rotation searches) | — |

  The rotation search is the costly step on long fights (Odin: 15-19 turns) and on map runs; a page should let the
  player raise the budget.

  With and without the layout steps (E14a), same save; gear AP fix in both columns. "HP removed" is the enemy's lowest
  point, 200 fights (30 map runs) in the final evaluation:

| Target | 2 min, without | 2 min, with | Unbounded, without | Unbounded, with | Steps that gained (unbounded trace) |
|---|---|---|---|---|---|
| Odin (72) | 0 %, 31.0 %, 19 turns | 0 %, 31.9 %, 15 turns | 0 %, 33.5 % (249 s) | 0 %, 35.1 % (243 s) | Mage phase +1 (score 791 → 918, before any rotation search), Paladin phase +1 (+22), order in round 2 (Paladin to front 1, Berserker to back 1: +232) |
| Archon (97) | 0 %, 6.3 % | 0 %, 10.1 % | 0 %, 6.3 % (183 s) | 0 %, 9.9 % (205 s) | order (177 → 243), front-back swap (+7), Rogue phase +3 (+18); after the rotations, swap back and re-order (+19) |
| Demon Mage (50) | 100 %, 1 turn | same | same | same | none (already won in one turn) |
| Gnoll Vendetta asc 1 | 93.3 %, grade 5 | same | same | same | none at 4 runs per candidate |

  - The gains come from timing more than from rows: a phase shift is a 0.1-0.5 s step that can be worth more than a
    20 s rotation search (Odin's Mage: Silence one turn earlier). Rotations found by the skill search are already
    best among their own orderings, so the phase step gains mostly before it, or after the order changes.
  - These figures used the former `score`, where losing fights scored fewer turns as better, so Odin's 15 vs 19
    turns was not a gain in itself; the higher lowest-HP point is. Lost fights now count survival as a small bonus.

## Potions and enchants in combat

`web/src/tools/consumables.ts` (rules: [heroes](../../combat/heroes/heroes.md#potions-and-enchants)). Browser-safe.

```ts
consumableOptions(hero, "boost" | "enchant", ascs = [0, 1, 2]): ConsumableOption[]   // what the hero may use now
applyConsumable(hero, option): undo                                                  // a potion survives fights (_keepBoost)
rankConsumables(sim, hero, front, back, questOrMapTarget, { kind, n, ascs, solver }, ctl): { base, ranked, freeSlots, fillGain }
consumableMatrix(sim, target, { classes, level, prestige, gearPolicy, kind, n, ascs, top, solver }, ctl): rows per class
```

- Each option is evaluated against the hero without it on the same seeds: score gain, win and lowest-enemy-HP change,
  Solver cost and gain per 1,000 g. Enchants: one more on top of the hero's; `fillGain` = all free slots with the best.
- `api.fight` / `mapRun` drop potions before a fight (as the reference harness did) unless the hero has `_keepBoost`.

| Case (n = 40-50, asc 0 and 2) | Result |
|---|---|
| Save's Odin party (quest 72), per hero | Best potion +2.2 points of Odin's HP (Berserker: Dex / Acc Boost +1 asc 2); no win. The save's heroes use 0 of 16 enchant slots |
| Standard level-60 heroes vs Demon Mage (quest 50) | Potions flip borderline fights: Mage 14 % → 100 % and Cleric 4 % → 100 % with HP Boost asc 2, Bard 96 % → 100 % with Atk Boost +1 asc 2; winners gain only noise |
| vs Arkyos (55), Region 5 (60): no class wins | Atk / Str Boost +1 asc 2 (Arkyos) and HP Boost asc 2 (Region 5) rank first for every class |

- Gains of a few score points are noise: an extra stat shifts which random rolls land. With class-blind `best` gear,
  Mage and Cleric gain from Atk Boost (they carry a physical weapon).

## Class balance on equal gear

`web/src/tools/classes.ts` compares classes, not the player's heroes: every class is built the same way and fights
the same quests alone on the same seeds. Browser-safe (no console, no `node:*`), for the class balance page (U4).

```ts
standardHero(sim, classId, level, prestige, gearPolicy = "best", { itemGrade, itemAsc, crafterLevel, rotation, passive }): Hero
classMatrix(sim, { classes, quests, level, prestige, gearPolicy, skills, searchQuest, searchN, searchNFinal, n, seed0,
  rare, onProgress, shouldStop }): ClassMatrixRow[]
searchSkills(sim, hero, quest, { n, nFinal, top, rare, shouldStop }): { rotation, passive, ev }   // combat.ts searchSkills, solo
summarizeByClass(rows, threshold = 0.9): ClassSummary[]
```

- **Hero**: a raw hero record (class, level, prestige, no gear) through `Sim.hero`, as save heroes are built; the
  game's new-hero path (starting gear) is not supported by the engine. Level is capped per prestige
  (`maxHeroLevel`: 50, 50, 60), so level 60 needs prestige 3.
- **Gear candidates**: catalog equipment of the slot with itemLevel ≤ hero level, not `locked`, with a stat formula
  (drops the "30+ Items" placeholders); crafted plain (no prefix/suffix) at grade 5, asc 0, crafter level 60 by default.
- **Gear policies**:

| Policy | Rule |
|---|---|
| `best` | Same items for every class: per slot, highest itemLevel, then highest catalog `value`, then lowest id. Class-blind (at level 60 a Mage gets Gungnir, an atk axe). |
| `fit` | Per slot, weapon first: the item giving the most offense (`atk` if the class's atk growth ≥ matk growth, `matk` if matk ≥ atk, both for hybrids) × expected crit multiplier `1 + min(crit, 100)/100 × (critMod − 1)`; ties by max HP, def + mdef, then the `best` rule. |
| `none` | No gear. |

- **Skills** (`skills`): `"default"` = the game's default for the level (`defaultAttackList` is all Basic for every
  class, first passive from level 10); `"search"` = the combat.ts `searchSkills` (see [Search methods](#search-methods);
  defaults 10 fights per candidate, 30 per finalist, top 3), once per class on `searchQuest` (default the toughest
  quest of the list, `"each"` = a new search per quest); or an explicit `{ rotation, passive }`. All 9 classes at
  level 60: about 30 s of searching in Node. On a quest no class can win alone the rotation is chosen for damage only
  (lowest enemy HP), so prefer a reference quest the classes can win.
- **Rows** (one per class × quest): win rate, mean turns (and of won fights), grade, damage dealt / taken / healing
  per fight, death rate, enemy HP removed at the end and at its lowest point (`enemyHpRemovedPeak`; the end value
  goes negative when an enemy regenerates above max HP, e.g. Protector of the Forest), HP left, plus the rotation,
  passive and gear used. `summarizeByClass` breaks win-rate ties on the lowest-point value.
- `onProgress(done, total)` after every cell and every rotation search; `shouldStop()` returns the rows done so far.
- Caveats: solo fights only (no party roles: a healer or tank counts only for what it does alone); the `default`
  rotation hides skills, so compare classes with `search`; a rotation searched on one quest is not the best on
  another; `fit` is a stat proxy, not a fight-tested gear search.

## Levelling and prestige

`web/src/tools/levelling.ts` (pure, worker-safe, progress and cancel through `SearchControl`). XP rules:
[heroes](../../combat/heroes/heroes.md#experience).

```ts
xpBetween(tier, from, to): number          // XP from level `from` to `to`
availableQuests(level, tier): number[]      // quests with an enemy the hero may take
questXpRate(sim, hero, front, back, quest, amount = 1, n = 30): XpSource   // win, xpPerRun, hoursPerRun, reviveGold, xpPerHour
levellingPlan(sim, raw, { from, to, band = 5, companions, n, quests, amounts, minWin = 0.5, expModBonus }, ctl): LevellingPlan
prestigePayoff(sim, raw, { quest, n }, levellingOptions, ctl): PrestigePayoff
```

- **XP rate**: the hero's own share over seeds 1..n, wins only, nothing at max level; hours = quest time.
- **Plan**: every `band` levels the hero is rebuilt at that level and the quest × amount (1 and the party's max by
  default) with the best XP/h among those won at least `minWin` is kept; runs = XP needed / XP per run. `stuckAt`
  marks a band with no usable source.
- **Prestige payoff**: stats, enchant slots, amount cap and a solo reference fight at each tier's max level (the next
  tier without enchants), plus level required, gold, enchants lost and the hours to level back up (`relevel`).
- **Farming report**: rows add `xp_per_run` and `xp_per_hour` (per hero) and `revive_gold`; map runs report the XP
  each hero earned (`heroes[].xp`, TypeScript only, ignored by the Lua difftest).
- Example (real save, tier-3 Berserker, solo 1 → 60): 34 h, 334 quests, from Forest Gathering ×5 (~6k XP/h) to
  Murlok Monarch ×5 (~41k XP/h). Prestige 2 → 3 for that hero: HP 823 → 1183, atk 919 → 1159, enchant slots 12 → 16,
  amount cap 3 → 5, for 50,000 g and 34 h of levelling.
- Limits: quests only (map runs are not candidates); a fixed party per plan; gear is kept as is, whatever its level.

## Validation

- Computed max HP equals saved HP for the 7 heroes at full health; the 10 wounded ones are all below it.
- Fight outcomes look right against known difficulty: level-60 heroes one-shot region-1 enemies, Odin and
  Archon stay out of reach.
- Not yet compared with a real combat log (`quest_*.clog2` in the save folder).

## Limits

- Loot value counts everything at sell price, including essence; time is the game's map time (battles + walking).
- Level-70 maps (ids 27–32) are skipped by `maps` unless `--include-70`: crafters cap at 60, and generating
  them crashes at grade ≥ 3 (see [maps](../../game-economy/maps/maps.md#level-70-maps)).
- `gear` and `skills` optimise one hero at a time; a full joint search would be much bigger.
- Hero campaign buffs are ignored (`campaignID` forced to -1); potion boosts removed before each fight.
- `solo` results depend on your heroes' gear: its class table compares your heroes; use
  [class balance on equal gear](#class-balance-on-equal-gear) for classes.

## From Python to TypeScript

The first version (2026-11-23) ran the game's decompiled Lua through `lupa` from Python (`tools/combat.py`,
`tools/sim/harness.lua`). It was ported to `web/src/tools/` and deleted the same day.

| Former Python | TypeScript |
|---|---|
| `tools/combat.py` (evaluate, optimisers, commands) | `web/src/tools/combat.ts` |
| `tools/sim/engine.py` (`Sim`), `harness.lua` | `web/src/tools/engine.ts` over `web/src/sim/api.ts` |
| `tools/savegame.py` (decoding) | `web/src/tools/save.ts` |

- Before deletion, both sides ran on the shared LCG with the same seeds and gave identical output (screen and CSV) for
  `roster`, `fight`, `damage`, `solo`, `skills`, `gear` (owned and catalog), `party`, `map`, `maps`, `scrolls`, `party --map`.
  The only difference was the order of skills that dealt 0 damage (Python followed Lua's table order).
- Python number formatting is kept: ties to even (`{:.0f}` of 3066.5 is 3066), `100.0` for float CSV columns.
- Bugs of `combat.py` fixed in the port: `solo --quests 1-60` filtered quest ranges by hero ids; `party` options were
  registered on `maps`, so `party` always crashed; `--rare` on a quest without a rare variant is refused up front
  (`solo --rare` skips those quests).
- Commands write lines through an `io` callback and return their data, so a page can run them. The TypeScript command
  line (`cli.ts`) was dropped with the move to a website-only project.

## Code

- `web/src/tools/combat.ts`, `engine.ts`; engine in `web/src/sim/`; page: `web/src/ui/battle*.ts`.
- `web/src/tools/classes.ts` (equal-gear class balance).
- `web/src/tools/levelling.ts` (levelling and prestige), tests in `web/test/levelling.test.ts`.
- Tests: `web/test/tools.test.ts`, `web/test/search.test.ts`, `web/test/classes.test.ts` (catalog data only, runs in CI); Lua parity: `web/test/lua-parity.test.ts` with the local fixtures.
