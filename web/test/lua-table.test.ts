import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LuaTable } from "../src/sim/lua-table.ts";

// Reference cases recorded once from real Lua 5.1 (via lupa): random sequences of t[k] = v,
// t[k] = nil, table.insert(t, pos, v / nil), on `{}` or a presized constructor.
// Each case checks `#t` after every operation and the final pairs() order.
const cases = JSON.parse(readFileSync(new URL("./data/lua-table-cases.json", import.meta.url), "utf8"));

test("LuaTable matches Lua 5.1 for # and pairs() order", () => {
  for (const c of cases) {
    const t = new LuaTable(c.narr, c.nrec);
    // the recorded constructor was filled, then cleared
    for (let i = 1; i <= c.narr; i++) t.set(i, 0);
    for (let i = 1; i <= c.nrec; i++) t.set("_r" + i, 0);
    for (let i = 1; i <= c.narr; i++) t.set(i, undefined);
    for (let i = 1; i <= c.nrec; i++) t.set("_r" + i, undefined);
    const lens: number[] = [];
    for (const op of c.ops) {
      if (op[0] === "set") t.set(op[1], op[2]);
      else if (op[0] === "nil") t.set(op[1], undefined);
      else if (op[0] === "ins") t.insert(op[1], op[2]);
      else if (op[0] === "insnil") t.insert(op[1], undefined);
      lens.push(t.len());
    }
    assert.deepEqual(lens, c.lens, JSON.stringify(c.ops));
    assert.deepEqual(t.keys(), c.keys, JSON.stringify(c.ops));
  }
});

test("constructor tables iterate in Lua's order", () => {
  // measured on Lua 5.1: {atkBns=..., matkBns=...} and {str=..., critBns=..., accBns=...}
  assert.deepEqual(LuaTable.fromRecord([["atkBns", 1], ["matkBns", 1]]).keys(), ["matkBns", "atkBns"]);
  assert.deepEqual(LuaTable.fromRecord([["str", 1], ["critBns", 1], ["accBns", 1]]).keys(), ["str", "accBns", "critBns"]);
});
