# Update Log

[Root](./index.md) > Update Log

## 2026-11-23
- **Tooling**: Game translations (E19): `inventory/i18n/<lc>.json` for EN FR DE ES BR RU IT PL (item, skill, enemy, class, prefix, crafter, region names and descriptions), `index.json` with coverage; `web/src/tools/i18n.ts` `tr()`.
- **Website**: Battle page order (U26): Results (progress, then the outcome) moved to step 2, right under the Run button; party and opponent are step 3 with the 5-turn plan below; a run scrolls the Results into view once on phones. Numbers in tables centred site-wide (`num` columns of the table helper and `.num` cells).
- **Website**: Wiki reference pages (U25): "Stats" and "Battle", one anchored section per topic (formulas, variables, worked examples, game source lines), checked against the decompiled game and the port; link helpers `statLink` / `battleLink`.
- **Website**: Wiki (U21, part 2): skill "Good against" as a table with a ✓ on the enemy turns it answers (reasons in the tooltips); wiki list pages lose their title and intro, the descriptions moved to the wiki home cards.
- **Website**: Wiki v4 (U21): full-width section banners on wiki detail pages; enemy drops as tables (every win and each loot roll, "Nothing" row, exact chances per battle grade from lootService); map Skills column counts the real rotation ("Basic attack only" where the game data has no skill).
- **Website**: Battle page v3 (U23): mode, options and Run in step 1 (no step 3); party left, opponent right, 5-turn plan below, results last; equal-size hero slots with passive before rotation as clickable ability rows, AP badges, "x / y AP" and in-place ⇄ editing; gear results in two columns (`gearGrid`). Page titles and leads removed everywhere but the home page and the wiki (visually-hidden h1 kept). The battle worker loads the E15 warm-start table (`data/warmstart.json`); Best rotation shows the suggested start.
- **Website**: Save viewer hero page (U22): passive before rotation, both as the wiki's clickable ability rows with AP badges; rotation AP budget ("18 / 20 AP used", remaining, over-budget warning) from the engine rule; gear in two columns via the reusable `gearGrid` helper.
- **Website**: Wiki crafting chains (U19 follow-up): equipment boxes only; crafted materials (ingots…) hidden but counted in the totals.
- **Website**: Wiki v3 (U19): crafting-chain diagrams, "+NaN" bonus stats fixed (ranges), placeholder items removed, rarity chips in the game colours, class page level/ascension picker with tier caps and unlock marks, "Good against" enemies on hero skill pages.
- **Website**: Save viewer (U10): summary tiles replaced by a compact Overview tab (first, default); ascension legend removed; tabs deep-linkable by hash.
- **Website**: Wiki review (U6a): enemy names on the Skills list; class page radar, growth curves, passives-then-skills table with AP badges and clickable rows.
- **Website**: CI-safe regression snapshots for the engine and the profit model.
- **Public repo**: Repo published without game files; website sub-concept under tooling.
- **Combat**: Added the combat bundle (battle rules, heroes) and the combat simulator under tooling.
- **Creation**: Knowledge folder created with the game-economy, tooling and findings bundles.
