/**
 * Writes inventory/timelines.json: what every hero and enemy skill does (effect tags, durations) and every enemy's
 * 5-slot timeline, measured by the skill probe (skill-probe.ts) on inventory/gamedata.json.
 * Run after export:gamedata: `npm run export:timelines`. test/schedule.test.ts checks the file is up to date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../sim/api.ts";
import { Sim } from "./engine.ts";
import { buildTimelines } from "./skill-probe.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
api.loadGameData(JSON.parse(readFileSync(resolve(ROOT, "inventory/gamedata.json"), "utf8")));
const data = buildTimelines(new Sim("Standard"));
const out = resolve(ROOT, "inventory/timelines.json");
writeFileSync(out, JSON.stringify(data, null, 1) + "\n");
console.log(`${out}: ${Object.keys(data.heroSkills).length} hero skills, ${Object.keys(data.enemySkills).length} enemy skills, ` +
  `${Object.keys(data.timelines).length} timelines`);
