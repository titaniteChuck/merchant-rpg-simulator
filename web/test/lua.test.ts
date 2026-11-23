import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, mathRound, round } from "../src/sim/lua.ts";

// Values drawn from the LCG in tools/sim/harness.lua (real Lua 5.1, via lupa).
const EXPECTED: Record<number, number[]> = {
  1: [1.5652272864852355e-05, 27, 52, 6, 0, 1, -3],
  42: [0.0003365334126507243, 66, 50, 5, 7, 1, -3],
  797947651: [0.03297424319477216, 20, 69, 6, 1, 2, -3],
};

test("Rng matches the Lua harness generator", () => {
  for (const [seed, want] of Object.entries(EXPECTED)) {
    const r = new Rng(Number(seed));
    const got = [r.random(), r.random(100), r.random(1, 100), r.random(1, 6), r.random(0, 7), r.random(2.9), r.random(-3, 3.7)];
    assert.deepEqual(got, want, `seed ${seed}`);
    assert.equal(r.calls, 7);
  }
});

test("rounding helpers follow Solar2D / Utilities.lua", () => {
  assert.equal(mathRound(2.5), 3);
  assert.equal(mathRound(-2.5), -2);
  assert.equal(round(1.2345, 2), 1.23);
});
