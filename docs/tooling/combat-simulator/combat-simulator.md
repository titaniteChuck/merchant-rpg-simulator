---
type: Tool
title: Combat simulator
description: tools/combat.py runs the game's own decompiled combat code to simulate fights and search skills, gear and parties.
timestamp: 2026-11-23
---

# Combat simulator

[Root](../../index.md) > [Tooling](../index.md) > [Combat Simulator](./index.md) > Combat simulator

Exact fights: no port, the game's own Lua runs. Heroes come from your save (`tools/savegame.py`).
Rules being simulated: [combat](../../combat/combat.md), [heroes](../../combat/heroes/heroes.md).

## Table of contents

- [How it works](#how-it-works)
  - [Map runs](#map-runs)
- [Commands](#commands)
- [Search methods](#search-methods)
- [Validation](#validation)
- [Limits](#limits)
- [TypeScript port](#typescript-port)
- [Code](#code)

## How it works

```mermaid
flowchart LR
  S[save file] --> P[savegame.py]
  P --> E[sim/engine.py]
  D[decompiled/*.lua] --> H[sim/harness.lua]
  H --> E
  E --> C[combat.py]
  C --> R[reports/solo.csv, console]
```

- `lupa` (vendored in `tools/_vendor`) embeds Lua 5.1. `harness.lua` loads `MiddleClass`, `Utilities`, the data files
  and `Item`, `Equipment`, `Combatant`, `Hero`, `Party`, `Enemy`, `Battle` from `decompiled/`.
- Engine APIs (`display`, `system`, analytics…) are auto-stubs; combat logs are disabled; `print` is silenced.
- Corona extras added: `math.round` = `floor(x + 0.5)`, `table.indexOf`, `table.copy`.
- Game mode defaults applied as on load (`default.setMode`, save's `gameMode`).
- Heroes are built with `Hero:new` from the raw save entry, gear from its compact item strings.
- Per-skill damage: damage dealt during a combatant's own action is credited to the skill in that rotation slot.
- About 2 ms per solo fight, 5 ms per 4-hero fight, 70 ms per full map run.

### Map runs

- `sim.mapRun` builds the game's `Campaign` from a `Map` (save compact string, or id + asc + grade + prefix +
  suffix) the way `GameCampaigns:addNew` does: heroes start at full HP, `campaignID` set so scroll buffs apply.
- `runCombat()` until finished: rooms in order, HP carried over, loot per won room, essence at the end.
- The seed fixes the layout (rooms, enemies, rares, boss) and the fights; each run uses a new seed.
- Per-run hero damage/taken from the change in lifetime totals (`addToTotals`), healing via a hook; hero
  level, XP and totals restored after each run.
- Progress score = rooms cleared + share of the last enemy's HP removed, so "almost beat the boss" ranks higher.

## Commands

Run with `--save saves/snapshot/PlayerData.txt` (or `--save-dir` / `--slot`).

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

Options: `--rare` (rare variant), `--amount` (enemy count), `-n` (fights per evaluation).

## Search methods

- Every candidate is evaluated on the same seeds (common random numbers), so differences aren't noise.
- Score: win rate first, then fewer turns, then party HP left; for losses, enemy HP removed.
- `skills`: every skill multiset within AP (one order, quick), then all orderings of the best ones,
  then each passive with more fights.
- `gear`: coordinate descent, slot by slot, repeated `--passes` times.
  - `owned`: inventory, sale slots and gear worn by other heroes.
  - `catalog`: every equipment item within `--level-window` levels, built by the game at `--item-grade`,
    `--asc`, `--crafter-level`, with modifier odds forced to 0 (plain item).
- `party`: greedy add (hero × slot) while it helps, then swaps and moves until no improvement.

## Validation

- Computed max HP equals saved HP for the 7 heroes at full health; the 10 wounded ones are all below it.
- Fight outcomes look right against known difficulty: level-60 heroes one-shot region-1 enemies, Odin and
  Archon stay out of reach.
- Not yet compared with a real combat log (`quest_*.clog2` in the save folder).

## Limits

- Map runs: no scrolls passed yet (the game's scroll code is loaded, the CLI has no option for them).
- Loot value counts everything at sell price, including essence; time is the game's map time (battles + walking).
- Level-70 maps (ids 27–32) are skipped by `maps` unless `--include-70`: crafters cap at 60, and generating
  them crashes at grade ≥ 3 (see [maps](../../game-economy/maps/maps.md#level-70-maps)).
- `gear` and `skills` optimise one hero at a time; a full joint search would be much bigger.
- Hero campaign buffs are ignored (`campaignID` forced to -1); potion boosts removed before each fight.
- Results depend on your heroes' gear: the class table compares your heroes, not classes on equal gear.

## TypeScript port

Runners and optimisers ported to `web/src/tools/` for the GitHub Pages site, on the TypeScript engine (`web/src/sim/`).

```mermaid
flowchart LR
  save[PlayerData.txt text] --> s[save.ts] --> c[combat.ts]
  gd[inventory/gamedata.json] --> e[engine.ts] --> api[sim/api.ts]
  c --> e
  c --> cli[cli.ts / page]
```

| Python | TypeScript |
|---|---|
| `tools/combat.py` (evaluate, optimisers, commands) | `web/src/tools/combat.ts` |
| `tools/sim/engine.py` (`Sim`) | `web/src/tools/engine.ts` |
| `tools/gamedata.py` `sell_value`, `rarity` | `web/src/tools/engine.ts` |
| `tools/savegame.py` decoding, `parse_item`, `parse_save` | `web/src/tools/save.ts` |
| `combat.py` argparse `main` | `web/src/tools/cli.ts` (`npm run combat -- fight --quest 80 ...`) |

- Commands write lines through an `io` callback and return their data; CSV rows come back to the caller (CLI writes `reports/`).
- Browser-safe: no `fs` outside `cli.ts`; the save is passed as text.
- Not ported: locating/snapshotting the save folder (stays in `savegame.py`); `fixtures.py` (needs the Lua game code by design).
  Scroll prices come from the ported profit solver (`profit.ts`).
- Parity, both sides on the shared LCG (`Sim(use_lcg=True)`), same seeds: identical output (screen and CSV) for
  `roster`, `fight`, `damage`, `solo`, `skills`, `gear` (owned and catalog), `party`, `map`, `maps`, `scrolls`, `party --map`.
  - Only difference: skills that dealt 0 damage (buffs, heals) are listed in another order; Python follows Lua's table order.
  - Python number formatting kept: ties to even (`{:.0f}` of 3066.5 is 3066), `100.0` for float CSV columns.
- Fixed in the port, still present in `combat.py`:
  - `solo --quests 1-60` filtered quest ranges by hero ids (empty matrix, crash).
  - `party` options (`--heroes`, `--size`, `--n-quick`, `--n-final`) were registered on `maps`: `party` always crashed.
  - `--rare` on a quest without a rare variant: refused up front (the game code crashes; the TS engine fights a NaN enemy).
    `solo --rare` skips those quests.

## Code

- `tools/combat.py`, `tools/sim/engine.py`, `tools/sim/harness.lua`, `tools/savegame.py` (parallel session).
- `web/src/tools/` (TypeScript port), tests in `web/test/tools.test.ts`.
