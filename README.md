# Merchant RPG Simulator

Unofficial balancing tools for **Merchant**, a Solar2D (Corona) shop-keeper RPG:
crafting profit, essence sources, save-file viewer and a battle simulator that runs the game's own combat rules.

Website: https://titanitechuck.github.io/merchant-rpg-simulator/ (work in progress)

> Fan project, not affiliated with the game's developers. This repository contains **no game files**:
> no bytecode, no decompiled Lua, no assets. The tools read them from your own local copy of the game.

## Repository layout

| Path | Content |
|---|---|
| `web/` | TypeScript for the website: the combat engine (`src/sim/`, a port of the game's combat rules), libraries (`src/tools/`: save decoding, combat searches, profit model, game-data export) and page scripts (`src/ui/`). |
| `tools/` | [Development reference](tools/README.md); the decompiler `unluac.jar` (local only). |
| `inventory/` | `gamedata.json`, the game data the website loads (`npm run export:gamedata`); `inventory.json` and CSVs are frozen reference tables. |
| `docs/` | Knowledge base: game rules, tooling design, balancing findings. Start at [docs/index.md](docs/index.md). |
| `site/` | Static website published with GitHub Pages ([.github/workflows/pages.yml](.github/workflows/pages.yml)). |

Local-only folders, ignored by git: `merchant/` (game build), `decompiled/`, `saves/`, `reports/`, `tools/unluac.jar`, `web/test/fixtures/`.

## Setup

Requirements: Node 24+ (`cd web && npm ci`), Java 11+ (decompiler only).

1. Copy the game's compiled Lua files (`*.lu`, from the game install) into `merchant/`.
2. Download [unluac](https://sourceforge.net/projects/unluac/) as `tools/unluac.jar`, then decompile:
   ```bash
   mkdir -p decompiled
   for f in merchant/*.lu; do java -jar tools/unluac.jar "$f" > "decompiled/$(basename "$f" .lu).lua"; done
   ```

## Usage

Everything is on the website: open your save in the save viewer, simulate fights and map runs in the battle simulator.
To run it locally:

```bash
cd web
npm run site && npx --yes serve ../_site    # build and preview the site
npm test                                    # unit tests + engine parity with the game's Lua (local fixtures)
```

Development reference: [tools/README.md](tools/README.md).

## Website

`site/` is deployed to GitHub Pages on every push to `main`. The workflow adds `inventory/gamedata.json`
(as `data/`) and the TypeScript pages bundled from `web/src/ui/` (as `js/`).
Design and roadmap: [docs/tooling/website/website.md](docs/tooling/website/website.md).

## License

[MIT](LICENSE) for the code and docs in this repository. The game, its code, data and names belong to its developers.
