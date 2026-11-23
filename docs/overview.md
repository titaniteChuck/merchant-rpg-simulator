---
type: Overview
title: Merchant balancing project
description: Balancing tools for the Merchant game, built from its compiled Lua bytecode.
timestamp: 2026-11-23
---

# Merchant balancing project

[Root](./index.md) > Merchant balancing project

Goal: balancing tools for Merchant, a Corona/Solar2D game written in Lua.
Only the compiled build is available, so everything starts from decompiled bytecode.

## Table of contents

- [Folder layout](#folder-layout)
- [Pipeline](#pipeline)
- [Where to start](#where-to-start)

## Folder layout

| Folder | Content | Edit? | In git? |
|---|---|---|---|
| `merchant/` | Original build: `.lu` bytecode, `build.settings` | Never | No (game files) |
| `decompiled/` | One `.lua` per `.lu` (see [decompilation](./tooling/decompilation/decompilation.md)) | Regenerate only | No (game files) |
| `tools/` | Python tools; `unluac.jar` and `_vendor/` are local only | Yes | Yes |
| `inventory/` | Exported game data, JSON + CSV | Regenerate only | Yes (website data) |
| `reports/` | Profit and essence-source tables | Regenerate only | No |
| `saves/` | `snapshot/` = local copies of the player's save files; `*.csv` = parsed tables (`savegame.py --export`) | Regenerate only | No (personal) |
| `site/` | GitHub Pages website, see [website](./tooling/website/website.md) | Yes | Yes |
| `docs/` | This knowledge folder | Yes | Yes |

Public repo: `git@github.com:titaniteChuck/merchant-rpg-simulator.git`. `.gitignore` keeps every game file
(`*.lu`, `*.lua` except `tools/sim/harness.lua`), saves, reports and third-party binaries out.

## Pipeline

```mermaid
flowchart LR
  A[merchant/*.lu] -->|unluac| B[decompiled/*.lua]
  B -->|luadata.py + gamedata.py| C[game model]
  C -->|export_inventory.py| D[inventory/]
  C -->|profit.py| E[reports/]
```

## Where to start

- Game rules: [game-economy](./game-economy/game-economy.md).
- Running or changing the tools: [tooling](./tooling/tooling.md).
- Battle rules and hero stats: [combat](./combat/combat.md).
- Current balancing results: [findings](./findings/findings.md).
