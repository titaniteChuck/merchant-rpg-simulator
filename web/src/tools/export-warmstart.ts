/**
 * Writes inventory/warmstart.json, the offline warm-start table (warmstart.ts, warmstart-build.ts): every class ×
 * tier × enemy, searched in worker threads (one per core, at most 8). About 1 s per entry, so roughly 10 minutes on
 * 7 cores for the 3,800 entries. Run after export:timelines: `npm run export:warmstart [-- --classes 1,5]`.
 * Re-running with --classes replaces those classes' entries and keeps the others.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import * as api from "../sim/api.ts";
import { Sim } from "./engine.ts";
import { loadTimelines } from "./schedule.ts";
import { WARM_PARAMS, type WarmJob, warmJobs, warmStartEntry } from "./warmstart-build.ts";
import { type WarmEntry, WARMSTART_VERSION, type WarmStartData } from "./warmstart.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(ROOT, "inventory/warmstart.json");

function setup(): Sim {
  api.loadGameData(JSON.parse(readFileSync(resolve(ROOT, "inventory/gamedata.json"), "utf8")));
  loadTimelines(JSON.parse(readFileSync(resolve(ROOT, "inventory/timelines.json"), "utf8")));
  return new Sim("Standard");
}

if (!isMainThread) {
  const sim = setup();
  for (const j of workerData.jobs as WarmJob[]) parentPort!.postMessage(warmStartEntry(sim, j));
} else {
  setup();
  const arg = process.argv.indexOf("--classes");
  const classes = arg >= 0 ? process.argv[arg + 1].split(",").map(Number) : undefined;
  const jobs = warmJobs(classes);
  const keep: Record<string, WarmEntry> = {};
  if (classes && existsSync(OUT)) {
    const old = JSON.parse(readFileSync(OUT, "utf8")) as WarmStartData;
    for (const [k, v] of Object.entries(old.entries)) if (!classes.includes(Number(k.split(":")[0]))) keep[k] = v;
  }
  const n = Math.max(1, Math.min(8, availableParallelism() - 1));
  const entries: Record<string, WarmEntry> = { ...keep };
  let done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: n }, (_, w) => new Promise<void>((ok, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: jobs.filter((_, i) => i % n === w) } });
    worker.on("message", ([k, e]: [string, WarmEntry]) => {
      entries[k] = e;
      if (++done % 200 === 0 || done === jobs.length) {
        console.log(`${done}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
      }
    });
    worker.on("error", fail);
    worker.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`worker exited with ${code}`))));
  })));
  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => {
    const [ca, ta, qa] = a.split(":"), [cb, tb, qb] = b.split(":");
    return Number(ca) - Number(cb) || Number(ta) - Number(tb) || parseInt(qa) - parseInt(qb) || qa.localeCompare(qb);
  }));
  const data: WarmStartData = {
    version: WARMSTART_VERSION,
    params: { ...WARM_PARAMS, hero: "standardHero at the tier's max level, alone", prefilter: "schedule (timelines.json)" },
    entries: sorted,
  };
  writeFileSync(OUT, JSON.stringify(data).replace(/,"(\d+:\d+:\d+B?)":/g, ',\n"$1":') + "\n");
  console.log(`${OUT}: ${Object.keys(sorted).length} entries, ${n} workers, ${Math.round((Date.now() - t0) / 1000)} s`);
}
