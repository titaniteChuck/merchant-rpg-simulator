/**
 * Command line for the TypeScript combat tools (port of `python3 tools/combat.py`).
 * Same commands and options; run from web/:
 *
 *   node src/tools/cli.ts roster [--save ../saves/snapshot/PlayerData.txt]
 *   node src/tools/cli.ts fight  --quest 80 --front 1,9 --back 6,2 [-n 500] [--rare]
 *   node src/tools/cli.ts damage --hero 5 --quest 80 [-n 300]
 *   node src/tools/cli.ts solo   [--heroes all] [--quests 1-104] [-n 100]        # -> reports/solo.csv
 *   node src/tools/cli.ts skills --hero 5 --quest 80 [--front ... --back ...]
 *   node src/tools/cli.ts gear   --hero 5 --quest 80 [--pool owned|catalog] [--item-grade 5] [--asc 0]
 *   node src/tools/cli.ts party  --quest 80 [--size 6] [--heroes all]
 *   node src/tools/cli.ts map    --map 22 [--asc 1] --front 1,9,12 --back 6,2,5 [-n 100] [--scrolls 62,63,69]
 *   node src/tools/cli.ts party  --map 22 --n-quick 15 --n-final 100
 *   node src/tools/cli.ts maps   --front 1,9,12 --back 6,2,5 [-n 20]             # -> reports/maps_survey.csv
 *   node src/tools/cli.ts scrolls --map 22 --front ... --back ...
 *
 * The save is read as-is (no snapshot): point --save at a copy, e.g. the one
 * `python3 tools/savegame.py` puts in saves/snapshot/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadGameData } from "../sim/data.ts";
import * as C from "./combat.ts";
import { Sim } from "./engine.ts";
import { loadSaveText } from "./save.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const OPTIONS = {
  save: { type: "string", default: join(ROOT, "saves/snapshot/PlayerData.txt") },
  gamedata: { type: "string", default: join(ROOT, "inventory/gamedata.json") },
  reports: { type: "string", default: join(ROOT, "reports") },
  quest: { type: "string" }, rare: { type: "boolean" }, amount: { type: "string" }, n: { type: "string", short: "n" },
  hero: { type: "string" }, front: { type: "string" }, back: { type: "string" },
  heroes: { type: "string" }, quests: { type: "string" }, threshold: { type: "string" },
  "n-quick": { type: "string" }, "n-final": { type: "string" }, top: { type: "string" },
  pool: { type: "string" }, "item-grade": { type: "string" }, asc: { type: "string" },
  "crafter-level": { type: "string" }, "level-window": { type: "string" }, passes: { type: "string" },
  map: { type: "string" }, "map-grade": { type: "string" }, prefix: { type: "string" }, suffix: { type: "string" },
  scrolls: { type: "string" }, "scroll-asc": { type: "string" }, "include-70": { type: "boolean" }, size: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

const COMMANDS = ["roster", "fight", "damage", "solo", "skills", "gear", "party", "map", "maps", "scrolls"];

function usage(): never {
  const doc = readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0];
  console.error(doc.replace(/^\/\*\*\n?/, "").replace(/^ \* ?/gm, ""));
  process.exit(2);
}

export function main(argv = process.argv.slice(2)): void {
  const { values: v, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const cmd = positionals[0];
  if (v.help || !cmd || !COMMANDS.includes(cmd)) usage();
  const int = (k: keyof typeof v, dflt?: number): number | undefined => {
    const x = v[k];
    if (x === undefined) return dflt;
    const n = Number(x);
    if (!Number.isInteger(n)) throw new Error(`--${k}: not an integer: ${x}`);
    return n;
  };
  const need = (k: keyof typeof v) => {
    if (v[k] === undefined) throw new Error(`${cmd}: --${k} is required`);
    return v[k];
  };

  loadGameData(JSON.parse(readFileSync(v.gamedata, "utf8")));
  const save = loadSaveText(readFileSync(v.save, "utf8"));
  const sim = new Sim(save.raw.gameMode || "Standard");
  const roster = new C.Roster(sim, save);
  const fightOpts = () => ({ quest: int("quest")!, rare: v.rare ?? false, amount: int("amount", 1), front: v.front, back: v.back });
  const mapOpts = () => ({ map: v.map!, asc: int("asc", 0), mapGrade: int("map-grade", 3), prefix: int("prefix", 0),
    suffix: int("suffix", 0), scrolls: v.scrolls, front: v.front, back: v.back });
  const writeCsv = (res: { csv: Record<string, unknown>[]; csvName: string; floats?: string[] }) => {
    if (!res.csv.length) return;
    mkdirSync(v.reports, { recursive: true });
    const out = join(v.reports, res.csvName);
    writeFileSync(out, C.toCsv(res.csv, res.floats));
    console.log(`\n${res.csvName === "maps_survey.csv" ? "Full table" : "Full matrix"}: ${out}`);
  };

  switch (cmd) {
    case "roster":
      C.cmdRoster(sim, roster);
      break;
    case "fight":
      need("quest");
      C.cmdFight(sim, roster, { ...fightOpts(), n: int("n", 500) });
      break;
    case "damage":
      need("quest"), need("hero");
      C.cmdDamage(sim, roster, { ...fightOpts(), hero: int("hero")!, n: int("n", 300) });
      break;
    case "solo":
      writeCsv(C.cmdSolo(sim, roster, { heroes: v.heroes ?? "all", quests: v.quests, n: int("n", 100), rare: v.rare,
        threshold: v.threshold !== undefined ? Number(v.threshold) : 90 }));
      break;
    case "skills":
      need("quest"), need("hero");
      C.cmdSkills(sim, roster, { ...fightOpts(), hero: int("hero")!, nQuick: int("n-quick", 30), nFinal: int("n-final", 300),
        top: int("top", 8) });
      break;
    case "gear": {
      need("quest"), need("hero");
      const pool = v.pool ?? "owned";
      if (pool !== "owned" && pool !== "catalog") throw new Error("--pool: owned or catalog");
      C.cmdGear(sim, roster, { ...fightOpts(), hero: int("hero")!, n: int("n", 60), pool, itemGrade: int("item-grade", 5),
        asc: int("asc", 0), crafterLevel: int("crafter-level", 60), levelWindow: int("level-window", 15), passes: int("passes", 2) });
      break;
    }
    case "map":
      need("map");
      C.cmdMap(sim, roster, { ...mapOpts(), n: int("n", 100) });
      break;
    case "maps":
      writeCsv(C.cmdMaps(sim, roster, { front: v.front, back: v.back, n: int("n", 20), mapGrade: int("map-grade", 3),
        scrolls: v.scrolls, include70: v["include-70"] }));
      break;
    case "scrolls":
      need("map");
      C.cmdScrolls(sim, roster, { ...mapOpts(), pool: v.pool, scrollAsc: int("scroll-asc", 0), nQuick: int("n-quick", 10),
        nFinal: int("n-final", 100), top: int("top", 8) });
      break;
    case "party":
      if (!v.map) need("quest");
      C.cmdParty(sim, roster, { ...(v.map ? mapOpts() : {}), quest: int("quest"), rare: v.rare, amount: int("amount", 1),
        heroes: v.heroes ?? "all", size: int("size", 6), nQuick: int("n-quick", 40), nFinal: int("n-final", 500) });
      break;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}
