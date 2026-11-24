/**
 * Equal-gear class balance: every class built the same way (same level, prestige, gear rule and
 * rotation rule), then fought solo against the same quests on the same seeds, so the differences
 * come from the class and not from the player's gear.
 *
 *   const h = standardHero(sim, 3, 60, 3, "best")            // a level-60 P3 Mage in the best catalog gear
 *   const rows = classMatrix(sim, { quests: [53, 84, 87], level: 60, prestige: 3, n: 50 })
 *
 * Browser-safe (runs in the battle web worker): no console output, no node:* imports.
 * Heroes are built like save heroes (`Sim.hero(raw)` on a raw hero record), never through the
 * game's new-hero path (starting gear), which the engine does not support.
 */
import { D } from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { evaluate, type FightEval, SearchCancelled, searchSkills as searchRotation, soloRows } from "./combat.ts";
import type { Hero, Sim } from "./engine.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * How a standard hero is geared. Candidates for a slot: catalog equipment of that slot with
 * itemLevel <= hero level, no `locked` flag (special unlocks) and a stat formula for its type
 * (drops the "30+ Items" placeholders), crafted plain (no prefix/suffix) at `itemGrade`,
 * `itemAsc`, `crafterLevel` (as the gear search's catalog pool).
 * - "best": the same items for every class. Per slot, the highest itemLevel, then the highest
 *   catalog `value`, then the lowest id. Class-blind, so a caster may get an atk weapon.
 * - "fit": per slot (weapon first, then 2..6, each choice kept for the next), the item giving the
 *   class the most offense: `atk` for classes whose atk growth >= matk growth, `matk` for those whose
 *   matk growth >= atk growth (both for hybrids), times the expected crit multiplier
 *   `1 + min(crit, 100)/100 x (critMod - 1)`; ties by maxHP, then def + mdef, then the "best" rule.
 * - "none": no gear at all.
 */
export type GearPolicy = "best" | "fit" | "none";

/**
 * Rotation and passive of a standard hero.
 * - "default": the game's default for its level (`defaultAttackList`, all Basic for every class,
 *   and the first passive of the class from level 10).
 * - "search": the best rotation and passive found by `searchSkills` on a reference quest.
 * - an explicit rotation (5 skill names or class-skill indices, 0 = Basic) and passive.
 */
export type SkillsPolicy = "default" | "search" | { rotation: (string | number)[]; passive?: string };

export interface StandardHeroOptions {
  /** Craft grade of catalog items, 1-5 (default 5). */
  itemGrade?: number;
  /** Ascension of catalog items (default 0). */
  itemAsc?: number;
  /** Crafter level the items are made at (default 60). */
  crafterLevel?: number;
  /** Rotation (5 skill names or class-skill indices, 0 = Basic); default: the game's default. */
  rotation?: (string | number)[];
  passive?: string;
}

export interface GearPick {
  slot: number;
  id: number;
  name: string;
  itemLevel: number;
  value: number;
}

const SLOTS = [1, 2, 3, 4, 5, 6];

/** Throws on a class, level or prestige the game can't have (max level per prestige: D.maxHeroLevel). */
export function checkHeroSpec(classId: number, level: number, prestige: number): void {
  if (!G.heroList[classId]) throw new Error(`unknown class ${classId}`);
  if (!Number.isInteger(prestige) || prestige < 1 || prestige > 3) throw new Error(`prestige must be 1-3, not ${prestige}`);
  const max = D.maxHeroLevel[prestige];
  if (!Number.isInteger(level) || level < 1 || level > max) {
    throw new Error(`level must be 1-${max} at prestige ${prestige}, not ${level}`);
  }
}

/** Class ids in heroList order (1..9). */
export function classIds(): number[] {
  return Object.keys(G.heroList).map(Number).filter((k) => G.heroList[k]?.name).sort((a, b) => a - b);
}

/** Catalog equipment usable at `level` in `slot`, best first by the "best" rule. */
export function catalogCandidates(slot: number, level: number): number[] {
  const out: number[] = [];
  for (const [iid, it] of Object.entries<Any>(G.itemData.equipment)) {
    if (!it || typeof it !== "object" || it.itemSlot !== slot || it.locked) continue;
    if ((it.itemLevel ?? 99) > level) continue;
    if (slot !== 6 && !G.itemFormula[it.subType]) continue; // placeholders ("30+ Items"): no base stats

    out.push(Number(iid));
  }
  const eq = G.itemData.equipment;
  return out.sort((a, b) => (eq[b].itemLevel - eq[a].itemLevel) || ((eq[b].value ?? 0) - (eq[a].value ?? 0)) || a - b);
}

function pick(id: number, slot: number): GearPick {
  const it = G.itemData.equipment[id];
  return { slot, id, name: it.name, itemLevel: it.itemLevel, value: it.value ?? 0 };
}

/** The hero's offense for the "fit" rule. */
function fitScore(sim: Sim, h: Hero): number[] {
  const s = sim.stats(h);
  const hd = G.heroList[h.class];
  const a = hd.atkPlv[h.prestigeLevel], m = hd.matkPlv[h.prestigeLevel];
  const offense = (a >= m ? s.atk : 0) + (m >= a ? s.matk : 0);
  const critX = 1 + Math.min(Math.max(s.crit, 0), 100) / 100 * (s.critMod - 1);
  return [offense * critX, s.maxHP, s.def + s.mdef];
}

/** A raw hero record, as a save stores it (no gear: items are equipped afterwards). */
function rawHero(classId: number, level: number, prestige: number, o: StandardHeroOptions): Any {
  const raw: Any = {
    id: 0, class: classId, name: G.heroList[classId].name, level, prestigeLevel: prestige, exp: 0, heroInventory: [],
  };
  if (o.rotation) raw.attackList = o.rotation;
  if (o.passive) raw.passiveSelect = o.passive;
  return raw;
}

/**
 * A hero of class `classId` at `level` and `prestige`, geared by `gearPolicy` (see GearPolicy),
 * with the given rotation/passive or the game's default for its level.
 * The chosen items are in `hero._standardGear` (GearPick[]).
 */
export function standardHero(sim: Sim, classId: number, level: number, prestige: number,
  gearPolicy: GearPolicy = "best", o: StandardHeroOptions = {}): Hero {
  checkHeroSpec(classId, level, prestige);
  const h = sim.hero(rawHero(classId, level, prestige, o));
  const grade = o.itemGrade ?? 5, asc = o.itemAsc ?? 0, crafter = o.crafterLevel ?? 60;
  const make = (id: number) => sim.makeItem(id, grade, asc, crafter, 1);
  const gear: GearPick[] = [];
  if (gearPolicy !== "none") {
    // Slots are filled in order 1..6: the hero's inventory must have no holes (Hero:determineStats).
    for (const slot of SLOTS) {
      const cands = catalogCandidates(slot, level);
      if (!cands.length) break; // never happens: every slot has a level-0 "Worn" item
      let best = cands[0];
      if (gearPolicy === "fit") {
        let bestKey: number[] | undefined;
        for (const id of cands) {
          sim.equipItem(h, slot, make(id));
          const key = fitScore(sim, h);
          if (!bestKey || cmpDesc(key, bestKey) < 0) [best, bestKey] = [id, key];
        }
      } else if (gearPolicy !== "best") throw new Error(`unknown gear policy '${gearPolicy}'`);
      sim.equipItem(h, slot, make(best));
      gear.push(pick(best, slot));
    }
  }
  h._standardGear = gear;
  h.hp = h.maxHP;
  h.questHP = h.maxHP;
  return h;
}

/** Descending tuple order: < 0 when a ranks before b. Candidates come in "best" order, so the first of equals wins. */
function cmpDesc(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

export interface SearchOptions {
  /** Fights per candidate in the quick stages (default 10). */
  n?: number;
  /** Fights per finalist (best orderings x passives; default 30). */
  nFinal?: number;
  /** Skill sets whose orderings are tried, and orderings kept for the final stage (default 3). */
  top?: number;
  rare?: boolean;
  shouldStop?: () => boolean;
}

export interface SkillChoice {
  rotation: string[];
  passive: string;
  ev: FightEval;
}

/**
 * Best solo rotation and passive of `hero` against `quest`; the hero is left with them. Runs the combat.ts
 * searchSkills (every skill set within the AP budget, the orderings of the best, then every passive at nFinal
 * fights; AP budgets per passive respected). Throws SearchCancelled when `shouldStop` returns true.
 */
export function searchSkills(sim: Sim, hero: Hero, quest: number, o: SearchOptions = {}): SkillChoice {
  const res = searchRotation(sim, hero, ...soloRows({ quest }, hero), { quest, rare: o.rare ?? false },
    { nQuick: o.n ?? 10, nFinal: o.nFinal ?? 30, top: o.top ?? 3 }, { shouldStop: o.shouldStop });
  const best = res.ranked[0] ?? res.current;
  if (best.ev.score < res.current.ev.score) return applied(sim, hero, res.current);
  return applied(sim, hero, best);
}

function applied(sim: Sim, hero: Hero, c: SkillChoice): SkillChoice {
  sim.setSkills(hero, c.rotation, c.passive);
  return c;
}

export interface ClassMatrixOptions {
  /** Class ids (default: all 9). */
  classes?: number[];
  /** Quest ids (questData). */
  quests: number[];
  level?: number;
  prestige?: number;
  gearPolicy?: GearPolicy;
  skills?: SkillsPolicy;
  /**
   * Quest the rotation is searched on when skills = "search": a quest id, "each" (a new search for
   * every quest: fairest, quests + 1 times slower), or by default the toughest quest of `quests`
   * (enemy HP x (atk + matk)).
   */
  searchQuest?: number | "each";
  /** Fights per candidate of the rotation search's quick stages (default 10) and per finalist (default 30). */
  searchN?: number;
  searchNFinal?: number;
  /** Fights per (class, quest) cell (default 100). */
  n?: number;
  seed0?: number;
  rare?: boolean;
  itemGrade?: number;
  itemAsc?: number;
  crafterLevel?: number;
  /** Called after every cell and every rotation search. */
  onProgress?: (done: number, total: number) => void;
  /** Checked before every cell and during rotation searches: when true, the rows done so far are returned. */
  shouldStop?: () => boolean;
}

export interface ClassMatrixRow {
  classId: number;
  className: string;
  quest: number;
  questName: string;
  questLevel: number;
  level: number;
  prestige: number;
  gearPolicy: GearPolicy;
  rotation: string[];
  passive: string;
  gear: string[];
  n: number;
  /** 0-1 */
  win: number;
  turns: number;
  turnsWin: number | null;
  /** mean grade of won fights (0 without a win) */
  grade: number;
  /** per fight */
  dmgDealt: number;
  dmgTaken: number;
  healing: number;
  deathRate: number;
  /** share of the enemy's HP removed at the end (0-1; negative when it shields above max HP, e.g. Protector of the Forest) */
  enemyHpRemoved: number;
  /** share of the enemy's HP removed at its lowest point (>= enemyHpRemoved; what to compare against healing enemies) */
  enemyHpRemovedPeak: number;
  /** share of the hero's HP left (0-1) */
  hpLeft: number;
}

function enemyThreat(q: number): number {
  const d = G.questData[q];
  return (d.enemyHp || 0) * ((d.enemyAtk || 0) + (d.enemyMatk || 0));
}

/**
 * Every class alone against every quest, on equal footing: one standard hero per class
 * (standardHero with the same level, prestige and gear policy), n fights per cell on the same
 * seeds (seed0..seed0+n-1) for every class. Pure: returns the rows, class by class.
 */
export function classMatrix(sim: Sim, o: ClassMatrixOptions): ClassMatrixRow[] {
  const classes = o.classes ?? classIds();
  const level = o.level ?? 60, prestige = o.prestige ?? 3, policy = o.gearPolicy ?? "best";
  const n = o.n ?? 100, seed0 = o.seed0 ?? 1, skills = o.skills ?? "default";
  for (const q of o.quests) {
    const d = G.questData[q];
    if (!d?.enemyHp || !d.attackList) throw new Error(`quest ${q} has no enemy to fight`);
  }
  if (!o.quests.length) throw new Error("no quest selected");
  for (const c of classes) checkHeroSpec(c, level, prestige);
  const each = o.searchQuest === "each";
  const searchQuest = typeof o.searchQuest === "number" ? o.searchQuest
    : [...o.quests].sort((a, b) => enemyThreat(b) - enemyThreat(a))[0];
  const searches = skills !== "search" ? 0 : each ? o.quests.length : 1;
  const total = classes.length * (o.quests.length + searches);
  let done = 0;
  const rows: ClassMatrixRow[] = [];
  const search = (h: Hero, q: number): boolean => {
    try {
      searchSkills(sim, h, q, { n: o.searchN ?? 10, nFinal: o.searchNFinal ?? 30, rare: o.rare, shouldStop: o.shouldStop });
    } catch (e) {
      if (e instanceof SearchCancelled) return false;
      throw e;
    }
    o.onProgress?.(++done, total);
    return true;
  };
  for (const c of classes) {
    if (o.shouldStop?.()) break;
    const explicit = typeof skills === "object" ? skills : undefined;
    const h = standardHero(sim, c, level, prestige, policy, {
      itemGrade: o.itemGrade, itemAsc: o.itemAsc, crafterLevel: o.crafterLevel,
      rotation: explicit?.rotation, passive: explicit?.passive,
    });
    if (skills === "search" && !each && !search(h, searchQuest)) return rows;
    const gear = (h._standardGear as GearPick[]).map((g) => g.name);
    for (const q of o.quests) {
      if (o.shouldStop?.()) return rows;
      if (skills === "search" && each && !search(h, q)) return rows;
      if (o.shouldStop?.()) return rows;
      const ev = evaluate(sim, q, ...soloRows({ quest: q }, h), n, o.rare ?? false, 1, seed0);
      const he = Object.values(ev.heroes)[0];
      rows.push({
        classId: c, className: G.heroList[c].name, quest: q, questName: G.questData[q].name,
        questLevel: G.questData[q].levelReq, level, prestige, gearPolicy: policy,
        rotation: sim.rotation(h), passive: h.passiveSelect, gear,
        n, win: ev.win, turns: ev.turns, turnsWin: ev.turns_win, grade: ev.grade,
        dmgDealt: he.dmg, dmgTaken: he.taken, healing: he.heal, deathRate: he.death_rate,
        enemyHpRemoved: ev.enemy_dmg, enemyHpRemovedPeak: ev.enemy_dmg_peak, hpLeft: ev.hp_left,
      });
      o.onProgress?.(++done, total);
    }
  }
  return rows;
}

export interface ClassSummary {
  classId: number;
  className: string;
  quests: number;
  /** mean win rate over the quests (0-1) */
  win: number;
  /** quests won at least `threshold` of the time */
  soloable: number;
  enemyHpRemoved: number;
  enemyHpRemovedPeak: number;
  dmgDealt: number;
  dmgTaken: number;
}

/** One line per class, best mean win rate first (then most enemy HP removed at its lowest point). */
export function summarizeByClass(rows: ClassMatrixRow[], threshold = 0.9): ClassSummary[] {
  const by = new Map<number, ClassMatrixRow[]>();
  for (const r of rows) by.set(r.classId, [...(by.get(r.classId) ?? []), r]);
  const avg = (rs: ClassMatrixRow[], f: (r: ClassMatrixRow) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
  return [...by].map(([classId, rs]) => ({
    classId, className: rs[0].className, quests: rs.length, win: avg(rs, (r) => r.win),
    soloable: rs.filter((r) => r.win >= threshold).length, enemyHpRemoved: avg(rs, (r) => r.enemyHpRemoved),
    enemyHpRemovedPeak: avg(rs, (r) => r.enemyHpRemovedPeak),
    dmgDealt: avg(rs, (r) => r.dmgDealt), dmgTaken: avg(rs, (r) => r.dmgTaken),
  })).sort((a, b) => (b.win - a.win) || (b.enemyHpRemovedPeak - a.enemyHpRemovedPeak));
}

