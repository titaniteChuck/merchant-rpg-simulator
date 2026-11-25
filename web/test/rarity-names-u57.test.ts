// U57: rarity names ("Epic") in place of numbers, on the fake DOM: the helper, the chip (colour class still keyed by
// the number), a Rarity column that still sorts by the number, the items list filter matching the name, the save CSV.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const { loadGameData } = await import("../src/sim/api.ts");
const { RARITY_NAMES, rarityName } = await import("../src/ui/names.ts");
const { rarityChip, rarityTip } = await import("../src/ui/wiki-items.ts");
const { table } = await import("../src/ui/dom.ts");
const { parseSave } = await import("../src/tools/save.ts");
const { inventoryRows, toCsv } = await import("../src/ui/save-tables.ts");

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

test("rarityName: the user's names for 1–7, 'Rarity N' for the rest", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(rarityName),
    ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Legendary+1", "Mythical"]);
  assert.deepEqual(Object.keys(RARITY_NAMES).map(Number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(rarityName(8), "Rarity 8");
  assert.equal(rarityName(10), "Rarity 10");
  assert.equal(rarityName(0), "Rarity 0");
  assert.equal(rarityName("4"), "Epic"); // a CSV / row value
  assert.equal(rarityName(undefined), "Rarity ?");
  assert.equal(rarityName(""), "Rarity ?");
});

test("the chip shows the name and keeps the colour class of the number", () => {
  const c = rarityChip(4) as unknown as FakeElement;
  assert.equal(c.textContent, "Epic");
  assert.match(c.getAttribute("class")!, /\brar-chip rar-4\b/);
  assert.equal(c.getAttribute("title"), "Epic: rarity 4 (the game's colour for it)");
  assert.equal((rarityChip(undefined) as unknown as FakeElement).getAttribute("class"), "rar-chip rar-x");
  assert.match(rarityTip(11), /^Rarity 11: the game draws it in the colour of Epic \(rarity 4\)$/);
});

test("a Rarity column shows names but sorts by the number, not alphabetically", () => {
  const rows = [3, 1, 7, 5, 2, 6, 4].map((r, i) => ({ id: i, rarity: r }));
  const t = table(rows, [{ key: "rarity", label: "Rarity", num: true, render: (r) => rarityChip(r.rarity) }], undefined,
    { sort: { key: "rarity", asc: true } }) as unknown as FakeElement;
  const shown = () => t.querySelectorAll("tr").slice(1).map((tr) => tr.textContent);
  assert.deepEqual(shown(), ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Legendary+1", "Mythical"]);
});

test("the wiki items list filters on the rarity name; the save CSV carries both the number and the name", () => {
  const wiki = readFileSync(new URL("../src/ui/wiki.ts", import.meta.url), "utf8");
  assert.match(wiki, /\$\{r\.regionName\} \$\{rarityName\(r\.rarity\)\}`/);
  const sv = parseSave({ version: 1.21, gameMode: "Standard", gold: 0, mapSlotsUnlocked: 3, inventory: ["1|1|25|3"], mapInventory: [], sales: [0], crafter: [], hero: [] });
  const [row] = inventoryRows(sv);
  const keys = Object.keys(row);
  assert.equal(keys.indexOf("rarity_name"), keys.indexOf("rarity") + 1, "the name right after the number");
  assert.equal(typeof row.rarity, "number"); // the colour class and the sort
  assert.equal(row.rarity_name, rarityName(row.rarity));
  assert.match(toCsv([row]).split("\n")[0], /,rarity,rarity_name/);
});
