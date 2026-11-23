/**
 * CI-safe regression snapshots of the profit model (profitReport), from committed game data only.
 * Each snapshot keeps the top 30 rows by best_profit in full plus a hash of every table.
 * Snapshots: test/snapshots/profit-*.json; regenerate with UPDATE_SNAPSHOTS=1 npm test.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/data.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import { profitReport } from "../src/tools/profit.ts";
import type { ProfitOptions } from "../src/tools/profit.ts";
import { matchSnapshot, sha256 } from "./helpers/snapshot.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const g = gameFromData();

const VARIANTS: [string, ProfitOptions][] = [
  ["profit-default", {}],
  ["profit-g5-crafter40", { grade: 5, crafterLevel: 40 }],
];

for (const [name, opts] of VARIANTS) {
  test(`profitReport ${name} matches its snapshot`, () => {
    const r = profitReport(g, { ...opts, sort: "best_profit" });
    matchSnapshot(name, {
      options: opts,
      summary: r.lines[0],
      rowCount: r.rows.length,
      rowsSha256: sha256(r.rows),
      essenceSha256: sha256(r.essence),
      ascendModdedSha256: sha256(r.ascendModded),
      enchantSha256: sha256(r.enchant),
      essence: r.essence,
      top30: r.rows.slice(0, 30),
    });
  });
}
