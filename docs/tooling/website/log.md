# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Website](./index.md) > Update Log

## 2026-11-23
- **Creation**: Public repo set up, `.gitignore` rules, Pages workflow and site skeleton.
- **Update**: Cost of putting battle simulation in the browser (port vs Lua in WebAssembly).
- **Update**: TypeScript combat engine ported; fights, map runs and item rolls match the game (difftests).
- **Update**: Save viewer page (`save.html`); site built by `web/scripts/assemble-site.sh` (esbuild).
- **Update**: Battle simulator page (`battle.html`, web worker); same results as the CLI.
- **Update**: Final reference fixtures recorded and frozen (3000 fights, 400 map runs incl. map modifiers, 1949 items); all match.
- **Update**: CI-safe regression snapshots (fights, map runs, Feast heal, profit report) in `web/test/snapshots/`.
