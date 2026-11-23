/**
 * Levelling and prestige economics: how many hours a hero needs to reach its tier's max level on the best XP source
 * at each level band, and what a prestige tier gives against what it costs.
 *
 * Game rules (obj.Quest, obj.Hero, data.Default):
 * - A won quest gives every living hero round(exp / heroes) x amount (expB for the rare variant), then
 *   x (1 + expMod / 100) x questXpMod (Hero:addExperience). A lost quest kills the party (revive: level x 10 x tier gold).
 * - heroLevelRequirement[tier][level] = XP to reach `level`; max level 50 / 50 / 60 (maxHeroLevel).
 * - A hero may take a quest when level > min(levelReq - 5, 0.75 x levelReq) (default.heroPartyLevelReq) and its
 *   region is open: regionLevelReqs[region] <= level + 2 x (tier - 1) (default.regionUnlockLevelMet).
 * - Prestige (Hero:prestigeUp, default.canHeroPrestige): needs heroPrestigeLevelRequirement[tier + 1] and
 *   heroPrestigeCost[tier] gold; the hero goes back to level 1 with 0 XP, loses its potion and enchants, gets the new
 *   tier's growth and max level, 4 more enchant slots and a quest amount cap of 2 x tier - 1.
 * Pure, worker-safe; progress and cancel through SearchControl.
 */
import { G } from "../sim/data.ts";
import { D } from "../sim/defaults.ts";
import { maxQuestAmount, SearchCancelled, type SearchControl } from "./combat.ts";
import type { FightResult, Hero, Row, Sim } from "./engine.ts";
import { reviveGold } from "./farming.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** XP to go from `from` to `to` (same tier). */
export function xpBetween(tier: number, from: number, to: number): number {
  const req = G.heroLevelRequirement[tier];
  let total = 0;
  for (let l = from + 1; l <= to; l++) total += req[l] ?? 0;
  return total;
}

export const maxLevel = (tier: number): number => D.maxHeroLevel[tier];

/** Quests a hero of this level and tier may take (heroPartyLevelReq + regionUnlockLevelMet), with an enemy to fight. */
export function availableQuests(level: number, tier: number): number[] {
  const out: number[] = [];
  for (const [k, q] of Object.entries<Any>(G.questData)) {
    if (!q?.enemyHp || !q.attackList || q.levelReq === undefined) continue;
    if (!(level > Math.min(q.levelReq - 5, q.levelReq * 0.75))) continue;
    const req = D.regionLevelReqs?.[q.region];
    if (req === undefined || req > level + 2 * (tier - 1)) continue;
    out.push(Number(k));
  }
  return out.sort((a, b) => a - b);
}

export interface XpSource {
  quest: number;
  amount: number;
  win: number;
  /** Per run, for the levelling hero: XP (with its expMod), hours (quest time) and revive gold. */
  xpPerRun: number;
  hoursPerRun: number;
  reviveGold: number;
  xpPerHour: number;
}

/**
 * XP per hour of one quest at one amount for `hero` in this party (same seeds 1..n). The hero must be in `front`
 * or `back`; XP is the hero's own (its share of the party's split).
 */
export function questXpRate(sim: Sim, hero: Hero, front: Row, back: Row, quest: number, amount = 1, n = 30): XpSource {
  const q = G.questData[quest];
  const members = [...front, ...back].filter((h): h is Hero => Boolean(h));
  const share = Math.round((q.exp ?? 0) / Math.max(members.length, 1)) * amount;
  const mult = (1 + (hero.expMod ?? 0) / 100) * D.questXpMod;
  let xp = 0, secs = 0, wins = 0, revive = 0;
  for (let k = 0; k < n; k++) {
    const res: FightResult = sim.fight(quest, front, back, { seed: 1 + k, amount });
    secs += res.questTime;
    const me = res.heroes.find((h) => h.name === hero.name && h.class === hero.class)!;
    if (res.won) {
      wins++;
      if (!me.dead && hero.level < maxLevel(hero.prestigeLevel)) xp += share * mult;
    }
    for (const h of res.heroes) if (!res.won || h.dead) revive += reviveGold(h);
  }
  const hoursPerRun = secs / n / 3600;
  return { quest, amount, win: wins / n, xpPerRun: xp / n, hoursPerRun, reviveGold: revive / n,
    xpPerHour: hoursPerRun > 0 ? xp / n / hoursPerRun : 0 };
}

export interface LevelStep {
  fromLevel: number;
  toLevel: number;
  /** Best source at fromLevel (the hero is rebuilt at that level, gear above it ignored as in game). */
  source: XpSource;
  xpNeeded: number;
  runs: number;
  hours: number;
  reviveGold: number;
}

export interface LevellingOptions {
  /** Target level (default the tier's max). */
  to?: number;
  /** Levels per step (default 5): the source is re-chosen at the start of each band. */
  band?: number;
  /** Other heroes fighting alongside (raw save records), front row first; default solo. */
  companions?: Any[];
  /** Fights per candidate (default 30); quest ids to consider (default every quest the hero may take). */
  n?: number;
  quests?: number[];
  /** Amounts to try (default 1 and the party's max). */
  amounts?: "one" | "max" | "all";
  /** Only sources won at least this often (default 0.5). */
  minWin?: number;
  /** Extra expMod (XP Boost potions: +30 / +60 / +100) for the whole plan. */
  expModBonus?: number;
}

export interface LevellingPlan {
  tier: number;
  from: number;
  to: number;
  steps: LevelStep[];
  hours: number;
  runs: number;
  reviveGold: number;
  /** Bands with no source won often enough (the plan stops there). */
  stuckAt?: number;
}

/** Hours from the hero's level (or `from`) to `to`, choosing the best XP/h quest at every band. */
export function levellingPlan(sim: Sim, raw: Any, o: LevellingOptions & { from?: number } = {}, ctl: SearchControl = {}): LevellingPlan {
  const tier = raw.prestigeLevel ?? 1;
  const from = o.from ?? raw.level ?? 1, to = Math.min(o.to ?? maxLevel(tier), maxLevel(tier));
  const band = o.band ?? 5, n = o.n ?? 30, minWin = o.minWin ?? 0.5;
  const steps: LevelStep[] = [];
  const bands: number[] = [];
  for (let l = from; l < to; l += band) bands.push(l);
  let done = 0;
  let stuckAt: number | undefined;
  for (const l of bands) {
    if (ctl.shouldStop?.()) throw new SearchCancelled();
    const hero = sim.hero({ ...structuredClone(raw), level: l, exp: 0 });
    if (o.expModBonus) hero.expMod = (hero.expMod ?? 0) + o.expModBonus;
    const companions = (o.companions ?? []).map((c) => sim.hero(structuredClone(c)));
    const front: Row = [hero, ...companions.slice(0, 2)], back: Row = companions.slice(2, 5);
    const maxAmt = maxQuestAmount([...front, ...back], false, sim.mode);
    const amounts = o.amounts === "one" ? [1] : o.amounts === "max" ? [maxAmt] : [...new Set([1, maxAmt])];
    let best: XpSource | null = null;
    const quests = (o.quests ?? availableQuests(l, tier)).filter((q) => availableQuests(l, tier).includes(q));
    for (const q of quests) {
      for (const a of amounts) {
        if (ctl.shouldStop?.()) throw new SearchCancelled();
        const s = questXpRate(sim, hero, front, back, q, a, n);
        if (s.win >= minWin && (!best || s.xpPerHour > best.xpPerHour)) best = s;
      }
    }
    ctl.onProgress?.(++done, bands.length, `level ${l}`);
    if (!best || best.xpPerRun <= 0) {
      stuckAt = l;
      break;
    }
    const top = Math.min(l + band, to);
    const need = xpBetween(tier, l, top);
    const runs = Math.ceil(need / best.xpPerRun);
    steps.push({ fromLevel: l, toLevel: top, source: best, xpNeeded: need, runs, hours: runs * best.hoursPerRun,
      reviveGold: runs * best.reviveGold });
  }
  const sum = (f: (s: LevelStep) => number) => steps.reduce((a, s) => a + f(s), 0);
  return { tier, from, to, steps, hours: sum((s) => s.hours), runs: sum((s) => s.runs), reviveGold: sum((s) => s.reviveGold),
    ...(stuckAt !== undefined ? { stuckAt } : {}) };
}

export interface TierView {
  tier: number;
  maxLevel: number;
  stats: Record<string, number>;
  enchantSlots: number;
  questAmountCap: number;
  /** Solo result on the reference quest at the tier's max level (same seeds). */
  ref: { win: number; enemyPeak: number; score: number };
}

export interface PrestigePayoff {
  current: TierView;
  next: TierView;
  /** Requirement and cost of prestiging now. */
  levelRequired: number;
  gold: number;
  enchantsLost: number;
  /** Levelling back from 1 to the new tier's max. */
  relevel: LevellingPlan;
}

/**
 * What the next prestige tier gives and costs for this hero: stats and a reference fight at each tier's max level
 * (current gear and enchants; the new tier without enchants, as after prestiging), against the gold, the lost
 * enchants and the hours to level back up.
 */
export function prestigePayoff(sim: Sim, raw: Any, ref: { quest: number; n?: number }, o: LevellingOptions = {},
  ctl: SearchControl = {}): PrestigePayoff {
  const tier = raw.prestigeLevel ?? 1;
  if (tier >= (G.heroMaxPrestigeLevel ?? 3)) throw new Error(`${raw.name} is already at the last tier (${tier})`);
  const view = (t: number, keepEnchants: boolean): TierView => {
    const r = { ...structuredClone(raw), prestigeLevel: t, level: maxLevel(t), exp: 0 };
    if (!keepEnchants) (delete r.enchantList, delete r.enchantPrestige, r.enchantsUsed = 0);
    const h = sim.hero(r);
    const st = sim.stats(h);
    let wins = 0, peak = 0, score = 0;
    const n = ref.n ?? 50;
    for (let k = 0; k < n; k++) {
      const res = sim.fight(ref.quest, [h], [], { seed: 1 + k });
      if (res.won) wins++;
      peak += 1 - Math.max(res.enemyMinHP ?? res.enemyHP, 0) / res.enemyMaxHP;
    }
    score = wins / n * 1e6 + peak / n * 1e4;
    return { tier: t, maxLevel: maxLevel(t), stats: st, enchantSlots: 8 + 4 * (t - 1), questAmountCap: maxQuestAmount([h], false, sim.mode),
      ref: { win: wins / n, enemyPeak: peak / n, score } };
  };
  const current = view(tier, true), next = view(tier + 1, false);
  const relevel = levellingPlan(sim, { ...structuredClone(raw), prestigeLevel: tier + 1, level: 1, exp: 0, enchantList: undefined },
    { ...o, from: 1 }, ctl);
  return {
    current, next,
    levelRequired: G.heroPrestigeLevelRequirement[tier + 1], gold: G.heroPrestigeCost[tier],
    enchantsLost: (raw.enchantList ?? []).length, relevel,
  };
}
