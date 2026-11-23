/**
 * Potions and permanent hero enchants in combat: which ones help a hero most in a given fight, and per class.
 *
 * Game rules (obj.Hero, scene.hero.HeroPotionOverlay, data.Default):
 * - A potion ("Boost" consumable) adds flat stats for `duration` quests (default 3; one map run counts as one, through
 *   Campaign -> reduceBoost); one potion at a time, the same one again extends it. A hero can drink it from level
 *   itemLevel - 5 - 4 x (prestige - 1) (default.heroBoostLevelReq).
 * - An enchant ("Enchant" consumable) is permanent: flat stats (+3 atk...) or growth per level ("Plv": +0.1 atk per
 *   level). A hero holds 8 + 4 x (prestige - 1) of them (maxEnchants).
 * - Ascended potions and enchants multiply their stats (default.consumablePrestigeStat: x2 at asc 1, x3 at asc 2 for
 *   most stats).
 * Every candidate is evaluated on the same seeds as the baseline, so the gains are comparable. Pure, worker-safe.
 */
import { G } from "../sim/data.ts";
import { consumableStat } from "../sim/defaults.ts";
import { type ClassMatrixOptions, standardHero } from "./classes.ts";
import {
  evaluateTarget, type FightEval, type MapEval, type MapTarget, type QuestTarget, SearchCancelled, type SearchControl,
} from "./combat.ts";
import type { Hero, Row, Sim } from "./engine.ts";
import type { Solver } from "./profit.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type ConsumableKind = "boost" | "enchant";

export interface ConsumableOption {
  id: number;
  name: string;
  kind: ConsumableKind;
  asc: number;
  stats: Record<string, number>;
  /** Quests a potion lasts (enchants: permanent). */
  duration: number;
}

const SUBTYPE: Record<ConsumableKind, string> = { boost: "Boost", enchant: "Enchant" };

/** Potions or enchants `hero` can use now (level requirement, free enchant slots), at the given ascension levels. */
export function consumableOptions(hero: Hero, kind: ConsumableKind, ascs: number[] = [0, 1, 2]): ConsumableOption[] {
  if (kind === "enchant" && hero.enchantList.length >= hero.maxEnchants) return [];
  const out: ConsumableOption[] = [];
  for (const [k, it] of Object.entries<Any>(G.itemData.consumable)) {
    if (!it || it.subType !== SUBTYPE[kind] || !it.stat) continue;
    if (kind === "boost" && hero.level < (it.itemLevel ?? 1) - 5 - (hero.prestigeLevel - 1) * 4) continue;
    for (const asc of ascs) {
      if (asc > 0 && it.lockPrestige) continue;
      out.push({ id: Number(k), name: it.name, kind, asc, stats: consumableStat(Number(k), asc), duration: it.duration ?? 3 });
    }
  }
  return out;
}

/** Applies one potion or one more enchant to `hero`; returns the undo. */
export function applyConsumable(hero: Hero, o: ConsumableOption): () => void {
  if (o.kind === "boost") {
    const prev = hero.boost, keep = hero._keepBoost;
    hero.boost = false;
    hero.applyBoost(o.id, o.stats, o.asc, o.duration);
    hero._keepBoost = true;
    return () => {
      hero.boost = prev;
      hero._keepBoost = keep;
      hero.determineStats();
    };
  }
  hero.applyEnchant(o.id, o.stats, o.asc, false);
  return () => {
    hero.enchantList.pop();
    hero.enchantsUsed = hero.enchantList.length;
    hero.determineStats();
  };
}

export interface ConsumableRank {
  option: ConsumableOption;
  ev: FightEval | MapEval;
  /** Score change vs no potion / no extra enchant (same seeds); win rate and lowest-enemy-HP changes. */
  gain: number;
  winDelta: number;
  peakDelta: number;
  /** Crafted cost from the Solver (if given) and score gain per 1000 g. */
  cost?: number;
  gainPerKGold?: number;
}

export interface ConsumableRanking {
  base: FightEval | MapEval;
  ranked: ConsumableRank[];
  /** Enchants: free slots, and the gain of filling all of them with the best enchant. */
  freeSlots?: number;
  fillGain?: number;
}

const peakOf = (ev: FightEval | MapEval) => ("enemy_dmg_peak" in ev ? ev.enemy_dmg_peak : ev.cleared);

/**
 * Every potion (or enchant) `hero` can use, evaluated in this fight against the hero without it, best gain first.
 * Potions: the hero's own potion is removed for the baseline. Enchants: one more enchant on top of the existing ones.
 */
export function rankConsumables(sim: Sim, hero: Hero, front: Row, back: Row, target: QuestTarget | MapTarget,
  o: { kind?: ConsumableKind; n?: number; ascs?: number[]; solver?: Solver } = {}, ctl: SearchControl = {}): ConsumableRanking {
  const kind = o.kind ?? "boost";
  const n = o.n ?? ("map" in target ? 10 : 100);
  if (!front.includes(hero) && !back.includes(hero)) front = [hero, ...front];
  const options = consumableOptions(hero, kind, o.ascs);
  const prevBoost = hero.boost, prevKeep = hero._keepBoost;
  if (kind === "boost") {
    hero.boost = false;
    hero.determineStats();
  }
  ctl.onProgress?.(0, options.length, kind);
  try {
    const base = evaluateTarget(sim, target, front, back, n);
    const ranked: ConsumableRank[] = [];
    options.forEach((opt, i) => {
      if (ctl.shouldStop?.()) throw new SearchCancelled();
      const undo = applyConsumable(hero, opt);
      const ev = evaluateTarget(sim, target, front, back, n);
      undo();
      const cost = o.solver ? o.solver.get("consumable", opt.id, opt.asc) : undefined;
      const gain = ev.score - base.score;
      ranked.push({ option: opt, ev, gain, winDelta: ev.win - base.win, peakDelta: peakOf(ev) - peakOf(base),
        ...(cost !== undefined && Number.isFinite(cost) ? { cost, gainPerKGold: cost > 0 ? (1000 * gain) / cost : undefined } : {}) });
      ctl.onProgress?.(i + 1, options.length, kind);
    });
    ranked.sort((a, b) => b.gain - a.gain);
    const res: ConsumableRanking = { base, ranked };
    if (kind === "enchant") {
      res.freeSlots = hero.maxEnchants - hero.enchantList.length;
      const best = ranked[0];
      if (best && res.freeSlots > 0) {
        const undos = Array.from({ length: res.freeSlots }, () => applyConsumable(hero, best.option));
        res.fillGain = evaluateTarget(sim, target, front, back, n).score - base.score;
        undos.reverse().forEach((u) => u());
      }
    }
    return res;
  } finally {
    if (kind === "boost") {
      hero.boost = prevBoost;
      hero._keepBoost = prevKeep;
      hero.determineStats();
    }
  }
}

export interface ConsumableMatrixRow {
  classId: number;
  className: string;
  base: FightEval | MapEval;
  /** The `top` best options for this class, best first. */
  best: ConsumableRank[];
}

/**
 * Best potions (or enchants) per class on equal footing: one standard hero per class (classes.ts standardHero,
 * game-default rotation unless `rotation` is given in skillsFor), alone against `target`, same seeds.
 */
export function consumableMatrix(sim: Sim, target: QuestTarget | MapTarget,
  o: Pick<ClassMatrixOptions, "classes" | "level" | "prestige" | "gearPolicy" | "itemGrade" | "itemAsc" | "crafterLevel"> &
    { kind?: ConsumableKind; n?: number; ascs?: number[]; top?: number; solver?: Solver } = {},
  ctl: SearchControl = {}): ConsumableMatrixRow[] {
  const classes = o.classes ?? Object.keys(G.heroList).map(Number).sort((a, b) => a - b);
  const rows: ConsumableMatrixRow[] = [];
  classes.forEach((c, i) => {
    const h = standardHero(sim, c, o.level ?? 60, o.prestige ?? 3, o.gearPolicy ?? "best",
      { itemGrade: o.itemGrade, itemAsc: o.itemAsc, crafterLevel: o.crafterLevel });
    const r = rankConsumables(sim, h, [h], [], target, { kind: o.kind, n: o.n, ascs: o.ascs, solver: o.solver },
      { shouldStop: ctl.shouldStop });
    rows.push({ classId: c, className: G.heroList[c].name, base: r.base, best: r.ranked.slice(0, o.top ?? 3) });
    ctl.onProgress?.(i + 1, classes.length, "classes");
  });
  return rows;
}
