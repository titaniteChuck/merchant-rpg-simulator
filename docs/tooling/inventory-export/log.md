# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Inventory Export](./index.md) > Update Log

## 2026-11-23
- **Translations** (E19): `export-i18n.ts` writes `inventory/i18n/<lc>.json` (8 languages, names and descriptions) and `index.json` (coverage); `i18n.ts` gives `tr()`.
- **TypeScript**: `luadata.py` + `export_gamedata.py` ported (`luadata.ts`, `export-gamedata.ts`, output byte-identical) and deleted; the inventory exporter was dropped, its files kept frozen.
- **Creation**: Parser and export written; counts match the raw files.
