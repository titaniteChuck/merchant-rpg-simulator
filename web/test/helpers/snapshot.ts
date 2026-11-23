/**
 * Committed JSON snapshots (test/snapshots/*.json) for the CI-safe regression tests.
 *
 *   UPDATE_SNAPSHOTS=1 npm test     # rewrite every snapshot from the current code
 *
 * Without UPDATE_SNAPSHOTS a missing or different snapshot fails the test: nothing is
 * regenerated silently.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../snapshots/", import.meta.url));
export const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

/** The value as it is stored (JSON round trip: no undefined, class instances as their toJSON). */
const normalize = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

export function sha256(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

/** First path where two JSON values differ, or undefined. */
function firstDiff(exp: unknown, got: unknown, path = "$"): string | undefined {
  if (exp === got) return undefined;
  if (exp && got && typeof exp === "object" && typeof got === "object" && Array.isArray(exp) === Array.isArray(got)) {
    const e = exp as Record<string, unknown>, g = got as Record<string, unknown>;
    if (Array.isArray(exp) && exp.length !== (got as unknown[]).length) {
      return `${path}.length: snapshot ${exp.length}, now ${(got as unknown[]).length}`;
    }
    for (const k of new Set([...Object.keys(e), ...Object.keys(g)])) {
      const d = firstDiff(e[k], g[k], `${path}.${k}`);
      if (d) return d;
    }
    return undefined;
  }
  return `${path}: snapshot ${JSON.stringify(exp)}, now ${JSON.stringify(got)}`;
}

/** Compare `value` with test/snapshots/<name>.json (or write it when UPDATE_SNAPSHOTS=1). */
export function matchSnapshot(name: string, value: unknown): void {
  const file = `${DIR}${name}.json`;
  const got = normalize(value);
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(got, null, 1)}\n`);
    return;
  }
  if (!existsSync(file)) assert.fail(`no snapshot test/snapshots/${name}.json: run UPDATE_SNAPSHOTS=1 npm test`);
  const exp = JSON.parse(readFileSync(file, "utf8"));
  const diff = firstDiff(exp, got);
  if (diff) {
    assert.fail(`${name} differs from its snapshot at ${diff}\n` +
      "If the change is intended, regenerate with UPDATE_SNAPSHOTS=1 npm test and commit test/snapshots/.");
  }
}
