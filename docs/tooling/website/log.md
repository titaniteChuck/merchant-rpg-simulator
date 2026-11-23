# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Website](./index.md) > Update Log

## 2026-11-23
- **Update**: Battle page search tabs (best rotation, gear, party, scrolls) on the combat search API, with progress and Cancel; lowest enemy HP shown when the enemy heals.
- **Update**: Ascension shown as a metallic outline (silver 1, gold 2) on items, maps, crafters and hero avatars instead of "asc N" text.
- **Update**: Profit page (`profit.html`, web worker): item ranking, enchanting, orb sources, options; owned items from the save.
- **Update**: Wiki page (skills, passives, items, maps, classes; links and tooltips from every page), top bar with the GitHub link, save kept in the browser across pages, hero stats as radar charts, rotation rows, grade stacks as "14 × C".
- **Creation**: Public repo set up, `.gitignore` rules, Pages workflow and site skeleton.
- **Update**: Cost of putting battle simulation in the browser (port vs Lua in WebAssembly).
- **Update**: TypeScript combat engine ported; fights, map runs and item rolls match the game (difftests).
- **Update**: Save viewer page (`save.html`); site built by `web/scripts/assemble-site.sh` (esbuild).
- **Update**: Battle simulator page (`battle.html`, web worker); same results as the CLI.
- **Update**: Final reference fixtures recorded and frozen (3000 fights, 400 map runs incl. map modifiers, 1949 items); all match.
- **Update**: CI-safe regression snapshots (fights, map runs, Feast heal, profit report) in `web/test/snapshots/`.
