# Update Log

[Root](../index.md) > [Tooling](./index.md) > Update Log

## 2026-11-23
- **Website**: U28 expansion-aware site: content of unowned expansions hidden by default, badges everywhere, manual ownership toggles, wiki Expansions page.
- **Inventory export**: Game translations exported (E19): `npm run export:i18n` → `inventory/i18n/`, runtime `web/src/tools/i18n.ts`.
- **Update**: Python tools removed after byte-identical TypeScript ports; then the TypeScript command lines were dropped too: the website is the only product (local: `npm test`, `npm run site`, `npm run export:gamedata`). Engine reference fixtures frozen.
- **Website**: Added the website sub-concept (public repo, GitHub Pages).
- **Combat simulator**: Added the combat-simulator sub-concept.
- **Creation**: Decompilation, inventory export and profit calculator documented.
- **Update**: Save loader added (`tools/savegame.py`, `profit.py --from-save`).
