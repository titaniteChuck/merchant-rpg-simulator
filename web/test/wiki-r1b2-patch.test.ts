// R1-B2, the part in wiki-data.ts (applied with the wiki.ts patch): essences' region reason, rare sources' detail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/sim/api.ts";
import { dropSources, items, regionOf } from "../src/ui/wiki-data.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

test("F39: an essence's region comes from map runs, a quest drop's from its win", () => {
  const essence = items("material").find(([, it]) => it.name === "Forest Essence")![0];
  assert.equal(regionOf("material", essence)!.why, "Where a map run gives it");
  const moss = items("material").find(([, it]) => it.name === "Tuvale Moss")![0];
  assert.equal(regionOf("material", moss)!.why, "Where it drops every win");
});

test("F11: a rare source's detail has no \"(rare)\": the page shows the rare pill", () => {
  const all = items("material").flatMap(([id]) => dropSources(id));
  assert.ok(all.some((s) => s.rare));
  assert.ok(all.every((s) => !s.detail.includes("(rare)")));
});
