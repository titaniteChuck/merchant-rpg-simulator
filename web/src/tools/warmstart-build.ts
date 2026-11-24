/**
 * Builds the warm-start table (warmstart.ts): for every class × tier × enemy (normal and rare), a standard hero
 * (classes.ts standardHero: the tier's max level, the "best" catalog gear at grade 5) alone against the enemy, and
 * searchSkills' best rotation and passive (with the schedule pre-filter when timelines are loaded).
 * Pure; export-warmstart.ts runs it in worker threads and writes inventory/warmstart.json.
 */
import { G } from "../sim/data.ts";
import { D } from "../sim/defaults.ts";
import { standardHero } from "./classes.ts";
import { searchSkills, soloRows } from "./combat.ts";
import type { Sim } from "./engine.ts";
import { enemyQuests } from "./skill-probe.ts";
import { type WarmEntry, warmKey } from "./warmstart.ts";

export const WARM_PARAMS = { gear: "best", itemGrade: 5, itemAsc: 0, crafterLevel: 60, nQuick: 10, nFinal: 30, top: 3 } as const;

export interface WarmJob {
  classId: number;
  tier: number;
  quest: number;
  rare: boolean;
}

/** Every job: classes × tiers 1-3 × enemy quests (normal and rare). */
export function warmJobs(classes = Object.keys(G.heroList).map(Number).sort((a, b) => a - b)): WarmJob[] {
  const jobs: WarmJob[] = [];
  for (const classId of classes) {
    for (const tier of [1, 2, 3]) for (const { quest, rare } of enemyQuests()) jobs.push({ classId, tier, quest, rare });
  }
  return jobs;
}

export function warmStartEntry(sim: Sim, j: WarmJob, o: Partial<typeof WARM_PARAMS> = {}): [string, WarmEntry] {
  const p = { ...WARM_PARAMS, ...o };
  const level = D.maxHeroLevel[j.tier];
  const h = standardHero(sim, j.classId, level, j.tier, p.gear, { itemGrade: p.itemGrade, itemAsc: p.itemAsc, crafterLevel: p.crafterLevel });
  const r = searchSkills(sim, h, ...soloRows({ quest: j.quest }, h), { quest: j.quest, rare: j.rare }, { nQuick: p.nQuick, nFinal: p.nFinal, top: p.top, warmStart: false });
  const best = r.ranked[0] ?? r.current;
  const ev = best.ev as { win: number; enemy_dmg_peak: number; turns: number };
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return [warmKey(j.classId, j.tier, j.quest, j.rare),
    { rotation: best.rotation, passive: best.passive, win: round(ev.win), peak: round(ev.enemy_dmg_peak), turns: round(ev.turns) }];
}
