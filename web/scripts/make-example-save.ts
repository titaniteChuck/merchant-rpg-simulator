/**
 * Builds the site's example save (site/data/example-save.txt, "Try with an example save" on the pages) from a real
 * PlayerData.txt, anonymised. Re-run it when the source save changes; never commit the source.
 *
 *   cd web && node scripts/make-example-save.ts [../saves/snapshot/PlayerData.txt]
 *
 * Changes (everything else is kept as the game wrote it):
 * - userID: the player's account id → "example";
 * - enteredPurchase, boostPotionPurchase, xpPotionPurchase (in-app purchase flags) → false.
 * The result is re-encoded in the game's own format (encodeSaveText), so the pages read it like a real save.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeSaveText, encodeSaveText } from "../src/tools/save.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const src = process.argv[2] ?? join(ROOT, "saves/snapshot/PlayerData.txt");
const out = join(ROOT, "site/data/example-save.txt");

const raw = decodeSaveText(readFileSync(src, "utf8"));
const changes: Record<string, [unknown, unknown]> = {};
const set = (key: string, value: unknown) => {
  if (key in raw && raw[key] !== value) changes[key] = [key === "userID" ? "(the player's id)" : raw[key], value];
  raw[key] = value;
};
set("userID", "example");
for (const k of ["enteredPurchase", "boostPotionPurchase", "xpPotionPurchase"]) set(k, false);

const text = encodeSaveText(raw);
// The page loader must read it back unchanged.
if (JSON.stringify(decodeSaveText(text)) !== JSON.stringify(raw)) throw new Error("round-trip failed");
writeFileSync(out, text);
console.log(`wrote ${out} (${text.length} chars, ${raw.hero?.length ?? 0} heroes)`);
for (const [k, [a, b]] of Object.entries(changes)) console.log(`  ${k}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
