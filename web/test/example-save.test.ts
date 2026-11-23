// U20: "Try with an example save" (web/src/ui/save-source.ts) fetches site/data/example-save.txt and loads it like a
// picked file. The file must read as a real save, stay anonymised, and a failed download must give a readable error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { decodeSaveText, loadSaveText } from "../src/tools/save.ts";
import { EXAMPLE_NAME, EXAMPLE_URL, fetchExample } from "../src/ui/save-source.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const text = readFileSync(join(ROOT, "site", EXAMPLE_URL), "utf8");

test("the example save is served at data/example-save.txt and reads like a real save", () => {
  assert.equal(EXAMPLE_URL, "data/example-save.txt");
  assert.equal(EXAMPLE_NAME, "Example save");
  const sv = loadSaveText(text);
  assert.ok(Array.isArray(sv.raw.hero) && sv.raw.hero.length > 0, "has heroes");
});

test("the example save is anonymised", () => {
  const raw = decodeSaveText(text);
  assert.equal(raw.userID, "example");
  for (const k of ["enteredPurchase", "boostPotionPurchase", "xpPotionPurchase"]) if (k in raw) assert.equal(raw[k], false, k);
});

test("fetchExample returns the file's text", async () => {
  let asked = "";
  const fake = (async (url: string) => {
    asked = url;
    return new Response(text, { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await fetchExample(fake), text);
  assert.equal(asked, EXAMPLE_URL);
});

test("fetchExample: offline, HTTP error and empty file give a readable message", async () => {
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  await assert.rejects(fetchExample(offline), /could not be downloaded \(are you offline\?\)/);
  const missing = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(fetchExample(missing), /could not be downloaded \(HTTP 404\)/);
  const empty = (async () => new Response("  ", { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(fetchExample(empty), /is empty/);
});
