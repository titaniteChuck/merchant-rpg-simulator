// The save encoder (used by scripts/make-example-save.ts) is the exact inverse of the decoder the pages use.
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseDecode, baseEncode, decodeSaveText, encodeSaveText } from "../src/tools/save.ts";

test("baseEncode / baseDecode round-trip, every padding length", () => {
  for (const n of [0, 1, 2, 3, 4, 5, 64, 1000]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
    assert.deepEqual(baseDecode(baseEncode(bytes)), bytes);
    assert.equal(baseEncode(bytes).length % 4, 0); // "=" padding like Utilities.baseEncode
  }
});

test("encodeSaveText → decodeSaveText gives back the same save", () => {
  const raw = {
    userID: "example", gold: 171946, version: 1.21, gameMode: "Standard", enteredPurchase: false,
    hero: [{ id: 1, name: "Héloïse ✨", level: 60, prestigeLevel: 3, attackList: { 1: "Basic", 2: "Slash" } }],
    inventory: ["1|2|3|4", null], nested: { a: [1, 2, { b: "c" }] },
  };
  const text = encodeSaveText(raw);
  assert.ok(!text.includes("{"), "encoded, not raw JSON");
  assert.deepEqual(decodeSaveText(text), raw);
});
