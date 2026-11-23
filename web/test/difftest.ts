/**
 * Differential test: replay fights recorded from the game's own code
 * (tools/sim/fixtures.py -> test/fixtures/fights.json) and compare action by action.
 *
 *   node test/difftest.ts [--only N] [--verbose] [--fixtures path]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fight, loadGameData, newHero, setMode, setSkills, traceStart, traceStop } from "../src/sim/api.ts";
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
const fixturesPath = opt("--fixtures") ?? resolve(here, "fixtures/fights.json");

loadGameData(JSON.parse(readFileSync(resolve(here, "../../inventory/gamedata.json"), "utf8")));
const fights: Any[] = JSON.parse(readFileSync(fixturesPath, "utf8")).fights;

const near = (a: Any, b: Any) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-6);

function diffEntry(exp: Any, got: TraceEntry | undefined, rngOffset: number): string | undefined {
  if (!got) return "missing action";
  for (const k of ["turn", "who", "act"] as const) if (exp[k] !== got[k]) return `${k}: game ${exp[k]} vs ts ${got[k]}`;
  if (exp.rng !== got.rng + rngOffset) return `rng draws: game ${exp.rng - rngOffset} vs ts ${got.rng}`;
  if (!near(exp.enemyHP, got.enemyHP)) return `enemyHP: game ${exp.enemyHP} vs ts ${got.enemyHP}`;
  for (let i = 0; i < 6; i++) {
    if (!near(exp.hp[i], got.hp[i])) return `hp[${i + 1}]: game ${exp.hp[i]} vs ts ${got.hp[i]}`;
  }
  const ee = (exp.effects ?? []).join(","), ge = got.effects.join(",");
  if (ee !== ge) return `effects: game [${ee}] vs ts [${ge}]`;
  return undefined;
}

function diffResult(exp: Any, got: Any): string | undefined {
  for (const k of ["won", "turns", "actions", "enemyHP", "grade"]) if (!near(exp[k], got[k])) return `${k}: game ${exp[k]} vs ts ${got[k]}`;
  const eh = exp.heroes ?? [];
  if (eh.length !== got.heroes.length) return `hero count ${eh.length} vs ${got.heroes.length}`;
  for (let i = 0; i < eh.length; i++) {
    for (const k of ["slot", "physicalDmgDealt", "magicDmgDealt", "dmgTaken", "healingDone", "hits", "misses", "crits", "hp", "maxHP"]) {
      if (!near(eh[i][k], got.heroes[i][k])) return `${eh[i].slot}.${k}: game ${eh[i][k]} vs ts ${got.heroes[i][k]}`;
    }
  }
  return undefined;
}

let pass = 0;
const groups = new Map<string, string[]>();
const fail = (key: string, msg: string) => {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(msg);
};

for (let idx = 0; idx < fights.length; idx++) {
  const fx = fights[idx];
  const rngOffset = idx === 0 ? 0 : fights[idx - 1].result.rngCalls;
  if (only !== undefined && idx !== only) continue;
  setMode(fx.mode);
  const rng = new Rng(1);
  setRng(rng);
  let res: Any;
  let tr: TraceEntry[];
  try {
    const heroes = fx.heroes.map((raw: Any, i: number) => {
      const h = newHero(raw);
      const s = fx.skills[i];
      if (s) setSkills(h, s.attackList, s.passive ?? undefined);
      return h;
    });
    const row = (r: (number | null)[]) => r.map((i) => (i === null ? null : heroes[i]));
    traceStart();
    res = fight(fx.quest, row(fx.front), row(fx.back), { seed: fx.seed, isRare: fx.isRare, amount: fx.amount });
    tr = traceStop();
  } catch (e) {
    traceStop();
    const msg = String((e as Error).message ?? e);
    fail(`error: ${msg.split("\n")[0]}`, `#${idx} quest ${fx.quest}: ${msg}`);
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
      // The divergence is caused by this action, or by the previous one's after-effects.
      key = e.act;
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
      const d = diffResult(fx.result, res);
      if (d) {
        bad = `result: ${d}`;
        key = "result";
      }
    }
  }
  if (bad) fail(key, `#${idx} quest ${fx.quest}${fx.isRare ? " rare" : ""} x${fx.amount}: ${bad}`);
  else pass++;
}

const total = only !== undefined ? 1 : fights.length;
console.log(`${pass}/${total} fights match`);
const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [key, msgs] of sorted) {
  console.log(`\n[${msgs.length}] ${key}`);
  for (const m of msgs.slice(0, verbose ? msgs.length : 3)) console.log("  " + m);
}
process.exitCode = pass === total ? 0 : 1;
