# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Save Loader](./index.md) > Update Log

## 2026-11-25
- **Update**: Phones section: the bug report mail (Options, "Bug Report") attaches the current slot's save, its backups and the `.usr` file (`SupportEmailer.getGameFiles`); the website's "Open your save" wizard uses it for phones.

## 2026-11-23
- **Removed**: `savegame.py` deleted (its TypeScript command-line port was checked byte-identical, then dropped too); saves are read by the website (`save.ts`).
- **Creation**: `tools/savegame.py` written (OS detection, local snapshot, decoding, compact item parser);
  `profit.py --from-save` added. Checked against a real Windows save read from WSL.
- **Update**: Named inventory, map, hero and gear tables; `--show` sections; `--export` to `saves/*.csv`.
