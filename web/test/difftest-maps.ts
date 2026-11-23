/**
 * Differential test for map runs: replay runs recorded from the game's own code
 * (frozen test/fixtures/maps.json, from the former Lua harness) and compare every
 * action of every room, then the whole result.
 *
 *   node test/difftest-maps.ts [--only N] [--verbose] [--fixtures path]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameData, mapRun, newHero, setMode, traceStart, traceStop } from "../src/sim/api.ts";
import type { TraceEntry } from "../src/sim/api.ts";
import { Rng, setRng } from "../src/sim/lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt("--only") !== undefined ? Number(opt("--only")) : undefined;
const verbose = args.includes("--verbose");
const fixturesPath = opt("--fixtures") ?? resolve(here, "fixtures/maps.json");

loadGameData(JSON.parse(readFileSync(resolve(here, "../../inventory/gamedata.json"), "utf8")));
const runs: Any[] = JSON.parse(readFileSync(fixturesPath, "utf8")).runs;

const near = (a: Any, b: Any) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-6);

function diffEntry(exp: Any, got: TraceEntry | undefined, rngOffset: number): string | undefined {
  if (!got) return "missing action";
  for (const k of ["turn", "who", "act"] as const) if (exp[k] !== got[k]) return `${k}: game ${exp[k]} vs ts ${got[k]}`;
  if (exp.rng !== got.rng + rngOffset) return `rng draws: game ${exp.rng - rngOffset} vs ts ${got.rng}`;
  if (!near(exp.enemyHP, got.enemyHP)) return `enemyHP: game ${exp.enemyHP} vs ts ${got.enemyHP}`;
  for (let i = 0; i < 6; i++) if (!near(exp.hp[i], got.hp[i])) return `hp[${i + 1}]: game ${exp.hp[i]} vs ts ${got.hp[i]}`;
  const ee = (exp.effects ?? []).join(","), ge = got.effects.join(",");
  if (ee !== ge) return `effects: game [${ee}] vs ts [${ge}]`;
  return undefined;
}

/** Result fields the TypeScript engine adds and the Lua recorder never produced (nothing to compare). */
const TS_ONLY = new Set(["xp"]);

/** Deep compare of the whole result (lists in order, numbers with a float tolerance). */
function deepDiff(exp: Any, got: Any, path: string): string | undefined {
  if (Array.isArray(exp) || (exp && typeof exp === "object")) {
    // Lua tables recorded as [] can be empty objects in TS (skillDmg of a hero that never acted)
    const ek = Object.keys(exp), gk = got && typeof got === "object" ? Object.keys(got) : [];
    if (ek.length === 0 && gk.length === 0) return undefined;
    if (got === undefined || got === null || typeof got !== "object") return `${path}: game ${JSON.stringify(exp)} vs ts ${got}`;
    if (Array.isArray(exp) && Array.isArray(got) && exp.length !== got.length) return `${path}.length: game ${exp.length} vs ts ${got.length}`;
    for (const k of ek) {
      const d = deepDiff(exp[k], got[k], `${path}.${k}`);
      if (d) return d;
    }
    for (const k of gk) if (!(k in exp) && !TS_ONLY.has(k) && got[k] !== undefined && got[k] !== false) return `${path}.${k}: missing in game, ts ${JSON.stringify(got[k])}`;
    return undefined;
  }
  return near(exp, got) ? undefined : `${path}: game ${JSON.stringify(exp)} vs ts ${JSON.stringify(got)}`;
}

let pass = 0;
const groups = new Map<string, string[]>();
const fail = (key: string, msg: string) => {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(msg);
};

for (let idx = 0; idx < runs.length; idx++) {
  if (only !== undefined && idx !== only) continue;
  const fx = runs[idx];
  const rngOffset = fx.rngStart;
  const label = `#${idx} map ${fx.map.id} asc${fx.map.prestigeLevel} g${fx.map.grade}${fx.scrolls.length ? ` scrolls ${fx.scrolls.map((s: Any) => s.id).join(",")}` : ""}`;
  setMode(fx.mode);
  const rng = new Rng(1);
  setRng(rng);
  let res: Any;
  let tr: TraceEntry[];
  try {
    const heroes = fx.heroes.map((raw: Any) => newHero(raw));
    const row = (r: (number | null)[]) => r.map((i) => (i === null ? null : heroes[i]));
    traceStart();
    res = mapRun(fx.map, row(fx.front), row(fx.back), { seed: fx.seed, scrolls: fx.scrolls.length ? fx.scrolls : undefined });
    tr = traceStop();
  } catch (e) {
    traceStop();
    const msg = String((e as Error).message ?? e);
    fail(`error: ${msg.split("\n")[0]}`, `${label}: ${msg}`);
    if (verbose) console.error(e);
    continue;
  }
  let bad: string | undefined;
  let key = "";
  const exp: Any[] = fx.trace;
  for (let i = 0; i < Math.max(exp.length, tr.length); i++) {
    const e = exp[i];
    if (!e) {
      bad = `extra ts action ${JSON.stringify(tr[i])}`;
      key = `extra action ${tr[i].act}`;
      break;
    }
    const d = diffEntry(e, tr[i], rngOffset);
    if (d) {
      bad = `action ${i} (turn ${e.turn}, who ${e.who}, ${e.act}): ${d}`;
      key = i === 0 ? "first action (map layout)" : e.turn === 1 && exp[i - 1].turn > 1 ? "room start" : e.act;
      if (verbose) {
        bad += `\n    game: ${JSON.stringify({ ...e, rng: e.rng - rngOffset })}\n    ts:   ${JSON.stringify(tr[i])}`;
        if (i > 0) bad += `\n    prev: ${JSON.stringify({ ...exp[i - 1], rng: exp[i - 1].rng - rngOffset })}`;
      }
      break;
    }
  }
  if (!bad) {
    if (fx.result.rngCalls - rngOffset !== rng.calls) {
      bad = `rngCalls: game ${fx.result.rngCalls - rngOffset} vs ts ${rng.calls}`;
      key = "rng total";
    } else {
      const { rngCalls: _ignored, ...expResult } = fx.result; // rngCalls is fixture bookkeeping
      const d = deepDiff(expResult, res, "result");
      if (d) {
        bad = d;
        key = `result ${d.split(":")[0].replace(/\.\d+/g, "[]")}`;
      }
    }
  }
  if (bad) fail(key, `${label}: ${bad}`);
  else pass++;
}

const total = only !== undefined ? 1 : runs.length;
console.log(`${pass}/${total} map runs match`);
const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [key, msgs] of sorted) {
  console.log(`\n[${msgs.length}] ${key}`);
  for (const m of msgs.slice(0, verbose ? msgs.length : 3)) console.log("  " + m);
}
process.exitCode = pass === total ? 0 : 1;
