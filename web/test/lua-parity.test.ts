/**
 * The TypeScript engine must give exactly the output of the game's own Lua code.
 *
 * The reference outputs are the frozen fixtures in test/fixtures/ (recorded from the
 * game's code, see src/sim/PORTING.md). They embed the player's heroes, so they only
 * exist on the machine that recorded them: there the comparisons run with every
 * `npm test`; elsewhere (CI) they are skipped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const CHECKS = [
  ["fights", "difftest.ts", "fights.json"],
  ["map runs", "difftest-maps.ts", "maps.json"],
  ["item rolls", "difftest-items.ts", "items.json"],
] as const;

for (const [what, script, fixture] of CHECKS) {
  const path = `${here}fixtures/${fixture}`;
  test(`${what} match the game's Lua code`, { skip: existsSync(path) ? false : `no ${fixture} on this machine` }, () => {
    let out = "";
    try {
      out = execFileSync(process.execPath, [`${here}${script}`], { encoding: "utf8", maxBuffer: 64 << 20 });
    } catch (e) {
      const err = e as { stdout?: string };
      assert.fail(`${script} reported differences:\n${(err.stdout ?? "").split("\n").slice(-25).join("\n")}`);
    }
    const m = out.match(/(\d+)\/(\d+) \S+( \S+)? match/);
    assert.ok(m && m[1] === m[2], out.slice(-500));
  });
}
