# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Website](./index.md) > Update Log

## 2026-11-23
- **Update**: Enemy timelines (U11): 5-turn strip with effect windows on the battle opponent card and wiki enemy pages, the party's 5-turn plan with schedule notes under the battle party, notes in Best rotation and Optimise results; Optimise keeps the step-2 party when its party step is off, lock chips for Best party and Optimise, quest size above ×1 for both.
- **Update**: Levelling page (`levelling.html`, U12): best XP quest per level band with hours, runs and revive gold (gathering quests labelled), and the next ascension's gains against gold, lost enchants and relevel hours; Levelling in every top bar and on the home page; top bar labels shortened to Save and Battle.
- **Update**: Battle page "Best potion / enchant" mode (U9, `rankConsumables`): ranked potions or one more enchant for a hero, free enchant slots shown first, crafted cost and gain per 1,000 g; ascension legend helper removed.
- **Update**: Battle page rework (U8): mode first (simulate, best rotation / gear / party / scrolls, optimise everything with a time budget), party in back/front columns, opponent card on the right (enemy radar and skills, map card), quest size ×1 to ×5; static Enemies link in the wiki nav; ascension legend removed from wiki item pages.
- **Update**: Wiki enemy pages (U6c): Enemies list and one page per enemy (stats normal/rare, rotation, drops, maps with multiplier); enemy names link there everywhere; gathering quests and placeholders excluded via the static `NON_ENEMY_QUEST_IDS`.
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
