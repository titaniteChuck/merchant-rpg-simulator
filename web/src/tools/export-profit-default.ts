/**
 * Writes the profit page's answer for its default settings (profit-worker.ts DEFAULT_REQUEST) to the file given as
 * the first argument (the site build writes _site/data/profit-default.json), so a first visit shows the tables
 * without solving the economy in the browser. About 4 s. Run by web/scripts/assemble-site.sh.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameData } from "../sim/data.ts";
import { gameFromData } from "./gamedata.ts";
import { DEFAULT_REQUEST, profitResponse } from "../ui/profit-worker.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = process.argv[2];
if (!out) throw new Error("usage: node src/tools/export-profit-default.ts <out.json>");
loadGameData(JSON.parse(readFileSync(resolve(ROOT, "inventory/gamedata.json"), "utf8")));
const res = profitResponse(gameFromData(), { id: 0, ...DEFAULT_REQUEST });
writeFileSync(out, JSON.stringify({ ...res, ms: 0 }));
console.log(`profit default: ${res.items.length} items, ${Object.keys(res.costs).length} costs -> ${out}`);
