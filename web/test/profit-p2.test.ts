// Profit page second batch (review-profit, findings outside B1–B12 and D1–D7): precomputed default answer and bounded
// rendering (F16), cost breakdown (F22), hero time (F21), the ascension badge by the name on a phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as api from "../src/sim/api.ts";
import { gold } from "../src/ui/dom.ts";
import { expandProfit } from "../src/tools/profit-compact.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const gamedata = read("inventory/gamedata.json");
api.loadGameData(JSON.parse(gamedata));
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/profit-worker.js" } };
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
const { DEFAULT_REQUEST, isDefaultRequest, runProfit } = await import("../src/ui/profit-worker.ts");
const { costKey, howText, itemColumns, MORE_STEP } = await import("../src/ui/profit-tables.ts");

const BASE = { id: 1, ...DEFAULT_REQUEST };
const res = await runProfit(BASE);
assert.ok(res.ok);
const G = JSON.parse(gamedata);

test("F16: the build writes the default answer; the page uses it for the default settings only", () => {
  const dir = mkdtempSync(join(tmpdir(), "profit-default-"));
  const out = join(dir, "profit-default.json");
  execFileSync(process.execPath, [new URL("../src/tools/export-profit-default.ts", import.meta.url).pathname, out], { stdio: "pipe" });
  const pre = expandProfit(JSON.parse(readFileSync(out, "utf8"))); // review F12: stored compact
  assert.equal(pre.ok, true);
  const json = (x: unknown) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(pre.items, json(res.items), "same rows as a solve in the worker");
  assert.deepEqual(pre.orbs, json(res.orbs));
  assert.deepEqual(pre.costs, json(res.costs));
  assert.match(read("web/scripts/assemble-site.sh"), /node src\/tools\/export-profit-default\.ts "\$OUT\/data\/profit-default\.json"/);

  assert.ok(isDefaultRequest({ ...BASE, id: 7 }));
  assert.ok(isDefaultRequest({ ...BASE, heroHourCost: undefined }), "no hero time = 0");
  assert.ok(!isDefaultRequest({ ...BASE, grade: 4 }));
  assert.ok(!isDefaultRequest({ ...BASE, heroHourCost: 100 }));
  assert.ok(!isDefaultRequest({ ...BASE, essenceFrom: [[1, 2, 0]] }));
  const html = read("site/profit.html");
  // the form's defaults are the precomputed ones
  assert.match(html, /id="luck" type="number"[^>]*value="0"/);
  assert.match(html, /id="crafter" type="number"[^>]*value="60"/);
  assert.match(html, /id="enchanter" type="number"[^>]*value="60"/);
  assert.match(html, /id="herohour" type="number"[^>]*value="0"/);
  const page = read("web/src/ui/profit.ts");
  assert.match(page, /fetch\("data\/profit-default\.json"\)/);
  assert.match(page, /\.then\(firstView\)/);
});

test("F16: tables grow by 300 rows, never all at once", () => {
  assert.equal(MORE_STEP, 300);
  const src = read("web/src/ui/profit-tables.ts") + read("web/src/ui/profit.ts");
  assert.doesNotMatch(src, /Show all|Infinity/);
  assert.match(src, /state\.limit\[tab\] \+= MORE_STEP/);
});

test("F22: every priced unit has a breakdown whose parts add up to its cost", () => {
  const costs = res.costs;
  for (const r of res.items) assert.ok(costs[costKey(r)], `breakdown for ${costKey(r)}`);
  let crafted = 0, ascended = 0;
  for (const [key, e] of Object.entries(costs)) {
    if (!e.parts) continue;
    const sum = (e.gold ?? 0) + e.parts.reduce((s, [t, i, p, a]) => s + a * costs[`${t}|${i}|${p}`].cost, 0);
    const slack = 0.01 + 0.005 * e.parts.reduce((s, [, , , a]) => s + a, 0); // each unit cost is rounded to 0.01
    assert.ok(Math.abs(sum - e.cost) <= slack + 1e-9 * e.cost, `${key}: ${sum} vs ${e.cost}`);
    if (e.how.startsWith("craft")) crafted++;
    else ascended++;
  }
  assert.ok(crafted > 1000 && ascended > 10, `${crafted} crafted, ${ascended} ascended`);
  // an ascended craft names its orbs; an ascension starts from the item one level below
  const asc = Object.entries(costs).find(([k, e]) => k.endsWith("|1") && e.how.startsWith("ascend"))!;
  const [t, i] = asc[0].split("|");
  assert.deepEqual(asc[1].parts![0], [t, Number(i), 0, 1]);
  assert.equal(asc[1].parts![1][0], "material");
  const cost = itemColumns(false).find((c) => c.key === "cost")!;
  assert.ok(cost.render, "Cost to make opens the breakdown");
  assert.equal(cost.show!(94983, {}), gold(94983));
});

test("F22: map runs and orb maps are named in words", () => {
  const run = Object.values(res.costs).find((e) => e.how.startsWith("map run "))!;
  assert.ok(run.ref !== null, run.how);
  assert.match(howText(run.how, run.ref), /^Map run: .+, [\d.,]+ per run$/);
  const orb = Object.values(res.costs).find((e) => / essence\/run\)/.test(e.how))!;
  assert.ok(orb.ref !== null, orb.how);
  assert.match(howText(orb.how, orb.ref), /^Map: .+, [\d,]+ per run$/);
  assert.equal(howText("map Tuvale Map asc1 enchanted +2 suffix (63 essence/run)"), "Map: Tuvale Map (ascension 1), enchanted +2 suffix, 63 per run");
  assert.equal(howText("map run Gnoll Vendetta Map (0.300/run; run cost 14217 g, 2.50 h craft + run)"), "Map run: Gnoll Vendetta Map, 0.3 per run");
});

test("F21: hero time is a setting, 0 by default; a price on it raises quest-sourced costs", async () => {
  const paid = await runProfit({ ...BASE, id: 2, heroHourCost: 1000 });
  assert.ok(paid.ok);
  const quest = Object.entries(res.costs).find(([, e]) => e.how.startsWith("quest "))!;
  assert.ok(paid.costs[quest[0]].cost > quest[1].cost, `${quest[0]} costs more with hero time`);
  assert.match(read("web/src/ui/profit.ts"), /heroHourCost: num\("#herohour", 0, 1_000_000, 0\)/);
  assert.doesNotMatch(read("site/profit.html"), /Not counted: hero time/);
  assert.ok(G.itemData, "game data loaded");
});

test("ascension badge by the name on a phone, in the profit p2 block", () => {
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* profit p2"), css.indexOf("/* end profit p2 */"));
  assert.match(block, /\.pf-asc-badge \{ display: none;/);
  assert.match(block, /@media \(max-width: 600px\) \{ \.pf-asc-badge \{ display: inline-grid; \} \}/);
  const tables = read("web/src/ui/profit-tables.ts");
  assert.match(tables, /if \(!\(Number\(asc\) > 0\)\) return null;/, "no badge on a plain item");
  assert.match(tables, /\.\.\.\[ascBadge\(r\.asc\)\]/);
});
