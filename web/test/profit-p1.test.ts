// Profit page first batch (review-profit B1–B12): no level-70 rows, shared formatters, names through names.ts, the orb
// and map UI gone with Scribe hidden, the page's own save panel and emoji tab labels gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { duration, gold, pct } from "../src/ui/dom.ts";
import { isHidden, noteSave, setOwned, setShowAll } from "../src/ui/expansion-state.ts";
import { crafterName, enemyName, ITEM_TYPE_LABELS, itemName } from "../src/ui/names.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const gamedata = read("inventory/gamedata.json");
api.loadGameData(JSON.parse(gamedata));
(globalThis as Record<string, unknown>).self = { location: { href: "http://localhost/js/profit-worker.js" } };
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
const { MAX_LEVEL, runProfit } = await import("../src/ui/profit-worker.ts");
const { enchantColumns, essenceColumns, goldCell, howText, itemColumns, minutes, percent, profitTabs, signedGold, TAB_LABELS } =
  await import("../src/ui/profit-tables.ts");

const BASE = { id: 1, grade: 3, luck: 0, crafterLevel: 60, enchanterLevel: 60, mapMods: true, alloc: "value" as const, essenceFrom: [] };
const res = await runProfit(BASE);
assert.ok(res.ok);
const G = JSON.parse(gamedata);

test("B1: no level-70 rows (items, enchanting, orb sources); the level filter stops at 60", () => {
  assert.equal(MAX_LEVEL, 60);
  for (const rows of [res.items, res.enchant]) assert.ok(rows.every((r) => r.level === null || Number(r.level) <= 60));
  assert.ok(res.items.some((r) => Number(r.level) === 60), "level 60 stays");
  assert.ok(res.essence.length > 50);
  assert.ok(res.essence.every((r) => Number(G.itemData.map[String(r.map_id)].itemLevel) <= 60), "no Boss Rush map");
  assert.ok(res.orbs.every((o) => o.mapId === null || Number(G.itemData.map[String(o.mapId)].itemLevel) <= 60));
  const page = read("web/src/ui/profit.ts");
  assert.match(page, /const MAX_LEVEL = 60;/);
  assert.doesNotMatch(page, /\b70\b/);
});

test("B2: tables use the shared formatters (gold, goldNumber, duration, pct)", () => {
  assert.equal(goldCell(1234), gold(1234));
  assert.equal(goldCell(12.34, 1), gold(12.34, 1));
  assert.equal(goldCell("x"), "—");
  assert.equal(signedGold(-1234), `−${gold(1234)}`);
  assert.equal(signedGold(5), "+5 g");
  assert.equal(percent(12.34), pct(0.1234));
  assert.equal(minutes(469), duration(469 * 60));
  assert.equal(minutes(469), "7 h 49 min");
  const craft = itemColumns(false).find((c) => c.key === "craft_min")!;
  assert.equal(craft.show!(45, {}), "45 min");
  const cost = itemColumns(false).find((c) => c.key === "cost")!;
  assert.equal(cost.show!(94983, {}), gold(94983));
  assert.equal(enchantColumns().find((c) => c.key === "suffix_cost")!.show!(10, {}), gold(10));
  assert.equal(essenceColumns().find((c) => c.key === "cost_per_essence")!.show!(40.89, {}), gold(40.89, 1));
  const src = read("web/src/ui/profit-tables.ts") + read("web/src/ui/profit.ts");
  assert.doesNotMatch(src, /const (gold|signed|mins) =/, "no local gold / signed / mins helpers");
  assert.doesNotMatch(src, /format\([^)]*\)\} g`/, "no hand-built \"… g\"");
});

test("B7: crafter, orb, enemy and type names through names.ts", () => {
  const crafted = res.items.find((r) => String(r.how).startsWith("craft"))!;
  const cid = G.itemData[String(crafted.type)][String(crafted.id)].crafterID;
  assert.equal(crafted.how_id, cid);
  assert.equal(howText(String(crafted.how), cid), `Craft (${crafterName(cid)})`);
  const quest = res.items.find((r) => String(r.how).startsWith("quest"))!;
  assert.ok(typeof quest.how_id === "number");
  assert.ok(howText(String(quest.how), quest.how_id).startsWith(`Quest: ${enemyName(quest.how_id, / \[rare\]/.test(String(quest.how)))}`));
  const asc = res.items.find((r) => String(r.how).startsWith("ascend"))!;
  assert.ok(howText(String(asc.how), Number(asc.how_id)).endsWith(`× ${itemName("material", Number(asc.how_id))})`));
  assert.ok(res.items.filter((r) => /^(craft|ascend|quest)/.test(String(r.how))).every((r) => typeof r.how_id === "number"));
  const type = itemColumns(false).find((c) => c.key === "type")!;
  assert.equal(type.show!("consumable", {}), ITEM_TYPE_LABELS.consumable);
  assert.match(read("web/src/ui/profit.ts"), /regionName\(/);
});

test("B4: with Scribe hidden, no Orbs tab, orb tile, orb sources, map-modifier chip or ascension filter", async () => {
  await noteSave(null);
  setShowAll(false);
  setOwned("Scribe", false);
  assert.equal(isHidden("Scribe"), true);
  assert.deepEqual(profitTabs(isHidden("Scribe")), ["Items", "Enchanting"]);
  setOwned("Scribe", true);
  assert.deepEqual(profitTabs(isHidden("Scribe")), ["Items", "Enchanting", "Orbs"]);
  setOwned("Scribe", false);
  const page = read("web/src/ui/profit.ts");
  assert.match(page, /export const orbsHidden = \(\): boolean => isHidden\("Scribe"\);/);
  assert.match(page, /for \(const id of \["#orb-sources", "#mapmods-box", "#orb-note"\]\)/);
  assert.match(page, /\.\.\.\(orbsHidden\(\) \? \[\] : \[tile\("No orbs"/);
  assert.match(page, /if \(!orbsHidden\(\)\) \{\s+kids\.push\(segField\("Ascension"/);
  assert.match(page, /if \(type === "map" && orbsHidden\(\)\) continue;/);
  const html = read("site/profit.html");
  for (const id of ["orb-sources", "mapmods-box", "orb-note"]) assert.match(html, new RegExp(`id="${id}"`));
});

test("B3, B5, B6, B8, B12: controls, tiles, text, tabs and the save panel", () => {
  const html = read("site/profit.html");
  const page = read("web/src/ui/profit.ts");
  assert.doesNotMatch(html, /mode-switch|<select id="grade"|id="mapmods" type="checkbox"/, "B3: segmented and chip, not the old controls");
  assert.match(page, /segmented\("pf-grade"/);
  assert.match(page, /segmented\("pf-alloc"/);
  assert.match(page, /chipToggle\("Count map modifiers"/);
  assert.doesNotMatch(page, /Items priced|Cheapest orb/, "B5");
  assert.doesNotMatch(page, /worth what it costs to farm|Adding one modifier|prices \(each item|countLine|are not listed/, "B6");
  assert.doesNotMatch(html, /Force where an orb comes from/, "B6");
  assert.deepEqual(Object.values(TAB_LABELS), ["What to make", "Enchanting", "Orbs"], "B8");
  assert.doesNotMatch(html, /Mark the items you own|Drop your save file here/, "B12");
  assert.match(html, /<div hidden><label id="drop" class="drop"><input id="file"/, "B12: hidden picker for initSaveSource");
  assert.match(page, /can't come from \$\{mapLabel\(.*\)\} alone: a run yields fewer than its recipe uses\./, "B10");
});

test("B11: Enchanting \"Only gains\" is on by default and keeps rows where a suffix or prefix pays", () => {
  const page = read("web/src/ui/profit.ts");
  assert.match(page, /gainsOnly: true/);
  const gains = res.enchant.filter((r) => Number(r.suffix_net) > 0 || Number(r.prefix_net) > 0);
  assert.ok(gains.length > 0 && gains.length < res.enchant.length);
});

test("B9: options at two columns on a phone, sticky first column, all in the profit p1 block", () => {
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* profit p1"), css.indexOf("/* end profit p1 */"));
  assert.match(block, /\.pf-options \{ grid-template-columns: repeat\(auto-fill, minmax\(min\(150px, 42vw\), 1fr\)\); \}/);
  assert.match(block, /@media \(max-width: 600px\)[\s\S]*\.pf-table td:first-child[\s\S]*position: sticky; left: 0/);
});
