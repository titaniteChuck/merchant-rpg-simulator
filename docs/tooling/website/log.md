# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Website](./index.md) > Update Log

## 2026-11-23
- **Update**: Save viewer heroes as a sortable table with a page per hero (`#hero=<id>`); crafters show their level per ascension (`getEffectiveLevelForItem`); the loaded save moves to one top-bar button (Reload, Choose another file, Forget); battle quest size capped at the party's max (enemy HP ×1 to ×5).
- **Update**: Farming planner (`farming.html`, `farming-worker.ts`): quests and map runs simulated with the party, ranked by value per hour; Profit and Farming in every top bar; essence per run in the save viewer's maps table; ascension outlines on the profit page.
- **Update**: Profit page (`profit.html`, web worker): item ranking, enchanting, orb sources, options; owned items from the save.
- **Update**: Battle page search tabs (best rotation, gear, party, scrolls) on the combat search API, with progress and Cancel; lowest enemy HP shown when the enemy heals.
- **Update**: Ascension shown as a metallic outline (silver 1, gold 2) on items, maps, crafters and hero avatars instead of "asc N" text.
- **Update**: Wiki page (skills, passives, items, maps, classes; links and tooltips from every page), top bar with the GitHub link, save kept in the browser across pages, hero stats as radar charts, rotation rows, grade stacks as "14 × C".
- **Creation**: Public repo set up, `.gitignore` rules, Pages workflow and site skeleton.
- **Update**: Cost of putting battle simulation in the browser (port vs Lua in WebAssembly).
- **Update**: TypeScript combat engine ported; fights, map runs and item rolls match the game (difftests).
- **Update**: Save viewer page (`save.html`); site built by `web/scripts/assemble-site.sh` (esbuild).
- **Update**: Battle simulator page (`battle.html`, web worker); same results as the CLI.
- **Update**: Final reference fixtures recorded and frozen (3000 fights, 400 map runs incl. map modifiers, 1949 items); all match.
- **Update**: CI-safe regression snapshots (fights, map runs, Feast heal, profit report) in `web/test/snapshots/`.
