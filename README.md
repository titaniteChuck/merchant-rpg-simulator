# Merchant RPG Simulator

Unofficial balancing tools for **Merchant**, a Solar2D (Corona) shop-keeper RPG:
crafting profit, essence sources, save-file viewer and a battle simulator that runs the game's own combat rules.

Website: https://titanitechuck.github.io/merchant-rpg-simulator/ (work in progress)

> Fan project, not affiliated with the game's developers. This repository contains **no game files**:
> no bytecode, no decompiled Lua, no assets. The tools read them from your own local copy of the game.

## Repository layout

| Path | Content |
|---|---|
| `tools/` | Python tools (data parser, profit calculator, save loader, combat simulator). See [tools/README.md](tools/README.md). |
| `tools/sim/` | Headless harness that runs the game's combat code in Lua 5.1 (our code; the game code is loaded from your copy). |
| `inventory/` | Game data tables exported by `tools/export_inventory.py` (JSON + CSV), used by the website. |
| `docs/` | Knowledge base: game rules, tooling design, balancing findings. Start at [docs/index.md](docs/index.md). |
| `site/` | Static website published with GitHub Pages ([.github/workflows/pages.yml](.github/workflows/pages.yml)). |

Local-only folders, ignored by git: `merchant/` (game build), `decompiled/`, `saves/`, `reports/`, `tools/_vendor/`, `tools/unluac.jar`.

## Setup

Requirements: Python 3.10+, Java 11+ (decompiler only).

1. Copy the game's compiled Lua files (`*.lu`, from the game install) into `merchant/`.
2. Download [unluac](https://sourceforge.net/projects/unluac/) as `tools/unluac.jar`, then decompile:
   ```bash
   mkdir -p decompiled
   for f in merchant/*.lu; do java -jar tools/unluac.jar "$f" > "decompiled/$(basename "$f" .lu).lua"; done
   ```
3. Combat simulator only: `python3 -m pip install -r requirements.txt` (or `--target tools/_vendor`).

## Usage

```bash
python3 tools/export_inventory.py     # game data -> inventory/
python3 tools/profit.py               # profit tables -> reports/
python3 tools/savegame.py             # find and summarise your save
python3 tools/combat.py --save saves/snapshot/PlayerData.txt roster
```

Full command reference: [tools/README.md](tools/README.md).

## Website

`site/` is deployed to GitHub Pages on every push to `main`. The workflow adds `inventory/inventory.json`
(as `data/`) and the Python tools (as `py/`) so pages can run them in the browser.
Design and roadmap: [docs/tooling/website/website.md](docs/tooling/website/website.md).

## License

[MIT](LICENSE) for the code and docs in this repository. The game, its code, data and names belong to its developers.
