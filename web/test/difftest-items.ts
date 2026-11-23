/**
 * Differential test for api.makeItem against rolls recorded from the game's code
 * (frozen test/fixtures/items.json, from the former Lua harness with the shared LCG
 * installed before the game loaded).
 *
 *   node test/difftest-items.ts [--fixtures test/fixtures/items.json] [--verbose]
 */
import { readFileSync } from "node:fs";
import { loadGameData, makeItem, setMode } from "../src/sim/api.ts";
import { rng } from "../src/sim/lua.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fixtures = opt("--fixtures") ?? new URL("./fixtures/items.json", import.meta.url).pathname;
const verbose = args.includes("--verbose");

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const { items } = JSON.parse(readFileSync(fixtures, "utf8"));

let ok = 0;
const fails: string[] = [];
for (const it of items) {
  setMode(it.mode);
  const before = rng.calls;
  let got: Record<string, unknown>;
  try {
    got = makeItem(it.id, it.grade, it.prestige, it.charLevel, it.seed) as unknown as Record<string, unknown>;
  } catch (e) {
    fails.push(`id ${it.id} g${it.grade} asc${it.prestige} cl${it.charLevel}: threw ${(e as Error).message}`);
    continue;
  }
  const diffs: string[] = [];
  for (const [k, want] of Object.entries(it.stats)) {
    const have = got[k] ?? (typeof want === "number" ? 0 : undefined);
    if (have !== want) diffs.push(`${k}: lua ${want} ts ${have}`);
  }
  const calls = rng.calls - before;
  if (calls !== it.rngCalls) diffs.push(`rng draws: lua ${it.rngCalls} ts ${calls}`);
  if (diffs.length === 0) ok++;
  else fails.push(`id ${it.id} (${it.stats.name}) g${it.grade} asc${it.prestige} cl${it.charLevel}: ${diffs.join(", ")}`);
}
console.log(`${ok}/${items.length} items match`);
for (const f of fails.slice(0, verbose ? fails.length : 15)) console.log("  " + f);
process.exitCode = ok === items.length ? 0 : 1;
