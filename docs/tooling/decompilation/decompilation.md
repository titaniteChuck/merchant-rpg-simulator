---
type: Procedure
title: Decompilation
description: The build is standard Lua 5.1 bytecode with debug info, decompiled with unluac.
timestamp: 2026-11-23
resource: https://sourceforge.net/projects/unluac/
---

# Decompilation

[Root](../../index.md) > [Tooling](../index.md) > [Decompilation](./index.md) > Decompilation

## Table of contents

- [Bytecode format](#bytecode-format)
- [Decompiler](#decompiler)
- [Output quality](#output-quality)
- [File naming](#file-naming)

## Bytecode format

- Header `1B 4C 75 61 51`: Lua 5.1 (`luac`), not LuaJIT.
- Little-endian, 4-byte int and size_t, 8-byte double numbers.
- Debug info kept: source paths (`C:\Retora\OG Merchant\...`), local names, line numbers.
- No obfuscation. Engine: Corona/Solar2D (`build.settings`, `plugin_*` files).

## Decompiler

- `tools/unluac.jar`, unluac build 2025-12-23 from SourceForge (Unstable folder).
- `java -jar tools/unluac.jar file.lu > file.lua`.

## Output quality

- 224/224 files, no errors.
- Data files come out as clean literal tables with the original field names.
- Only `plugin.coronium-core.{auth,utils,users}` contain `goto` constructs. They aren't game logic.
- Known oddity: `Player:removeItemForCrafting` shows `isValid = isValid and false` for ascendable types.
  The tools assume the intent is "ingredient ascension must match".

## File naming

Dotted module path: `obj.combat.lootService.lu` is `require("obj.combat.lootService")`.

| Prefix | Content |
|---|---|
| `data.` | Static tables and formula functions (`data.Default`) |
| `obj.` | Game classes (Item, Map, Crafter, Quest…) |
| `scene.` | UI screens |
| `plugin*`, `Corona*` | Engine and third-party plugins |
