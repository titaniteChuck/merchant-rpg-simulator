/**
 * U78: the save viewer's hero edits as changes to a raw hero (save format), pure (Node tests import it). Each change
 * returns a new raw hero; the page shows it through the same engine as every tool (save-tables heroViews: api.newHero,
 * api.heroStats), so the stats are the simulator's.
 *
 * Rules (decompiled obj.Hero, data.Default; the site's expansion gates):
 * - Level 1 … the tier's top (#heroLevelRequirement[prestige]: 50, 50, 60); the ascension (prestigeLevel 1–3) sets the
 *   tier, ascension 2 is the Frozen Tome's (expansion-state "prestige"), so levels 51–60 need it. Another ascension
 *   clamps the level. A changed level restarts its XP (exp 0).
 * - Class: a class change starts from the class's defaults (defaultAttackList, first passive), gear kept.
 * - Passive: "None" below heroLevelUnlockSkills (10), else one of the class's passiveList.
 * - Rotation: 5 slots of Basic or the class's unlocked skills (api.skillInfo unlocked), the AP within the budget
 *   (battle-edit skillFits, the Simulator's rule). After a level, class, passive or gear change, a skill no longer
 *   unlocked becomes Basic and, over the budget, the costliest last skills too (fitRotation), so the hero never falls
 *   back to the game's default rotation (Hero.calculateAPRemainder).
 * - Written like the game writes it: attackList as class-skill indices (0 = Basic) and the passive, in the current
 *   skillSet too when the hero has two.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { D } from "../sim/defaults.ts";
import { seq } from "../sim/lua.ts";
import { type ApBudget, apUsed } from "./battle-edit.ts";
import { startingGear } from "./hero-gear.ts";
import { tierMaxLevel } from "./wiki-classes.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** The game's class ids (heroList order). */
export const classIds = (): number[] => Object.keys(G.heroList ?? {}).map(Number).filter((k) => G.heroList[k]?.name).sort((a, b) => a - b);
export const classSkills =(cls: number): string[] => seq<string>(G.heroList?.[cls]?.skillList ?? {});
export const classPassives = (cls: number): string[] => seq<string>(G.heroList?.[cls]?.passiveList ?? {});
const unlockSkillsLevel = () => Number(D.heroLevelUnlockSkills) || 10;

/** Skill names → the save's indices into the class's skillList (0 = Basic, an unknown name too). */
export const skillIndices = (cls: number, names: string[]): number[] => {
  const list = classSkills(cls);
  return names.map((n) => Math.max(0, list.indexOf(n) + 1));
};

/** The rotation (5 names) and passive the hero plays (its current skill set). */
export function skillsOf(raw: Any): { rotation: string[]; passive: string } {
  const h = api.newHero(raw);
  return { rotation: h.attackList.slice(1, 6).map((s: unknown) => String(s ?? "Basic")), passive: String(h.passiveSelect ?? "None") };
}

/** A raw hero with this rotation and passive, written in its attackList / passiveSelect and current skill set. */
export function withSkills(raw: Any, rotation: string[], passive: string): Any {
  const attackList = skillIndices(raw.class, rotation);
  const out = { ...raw, attackList, passiveSelect: passive };
  if (Array.isArray(raw.skillSet) && raw.skillSet.length > 1) {
    const k = Math.max(1, Math.min(raw.skillSet.length, Number(raw.currentSkillSet) || 1)) - 1;
    out.skillSet = raw.skillSet.map((s: Any, i: number) => (i === k ? { ...s, attackList, passive } : s));
  }
  return out;
}

/** The hero's AP budget: each skill's cost, its limit (gear and passive count). */
export function budgetOf(raw: Any): ApBudget {
  const info = api.skillInfo(api.newHero(raw));
  const cost: Record<string, number> = Object.fromEntries(info.skills.map((x: Any) => [x.name, Number(x.ap) || 0]));
  return { cost: (s) => cost[s] ?? 0, max: Number(info.maxAP) || 0 };
}

/** Basic and the skills the hero has unlocked (in the class's order). */
export function unlockedSkills(raw: Any): string[] {
  const info = api.skillInfo(api.newHero(raw));
  return ["Basic", ...info.skills.slice(0, info.unlocked).map((x: Any) => String(x.name))];
}

/** The passives the hero can pick: "None" below lvl 10, else the class's list. */
export const passiveChoices = (raw: Any): string[] =>
  (Number(raw.level) < unlockSkillsLevel() ? ["None"] : classPassives(raw.class));

/**
 * A rotation the hero can play: skills it hasn't unlocked become Basic, then, while over the budget, the last skill
 * that costs AP becomes Basic.
 */
export function fitRotation(rotation: string[], unlocked: string[], b: ApBudget): string[] {
  const out = Array.from({ length: 5 }, (_, i) => (unlocked.includes(rotation[i]) ? rotation[i] : "Basic"));
  for (let i = 4; i >= 0 && apUsed(out, b) > b.max; i--) if (out[i] !== "Basic" && b.cost(out[i]) > 0) out[i] = "Basic";
  return out;
}

/** The hero after a change of level, class, ascension or gear: passive and rotation made valid again. */
export function settle(raw: Any): Any {
  const { rotation, passive } = skillsOf(raw);
  const passives = passiveChoices(raw);
  const p = passives.includes(passive) ? passive : passives[0] ?? "None";
  const withP = withSkills(raw, rotation, p);
  return withSkills(withP, fitRotation(rotation, unlockedSkills(withP), budgetOf(withP)), p);
}

/** Levels the hero's tier allows. */
export const levelOptions = (prestige: number): number[] => Array.from({ length: tierMaxLevel(prestige) }, (_, i) => i + 1);

export const withLevel = (raw: Any, level: number): Any =>
  settle({ ...raw, level: Math.max(1, Math.min(tierMaxLevel(Number(raw.prestigeLevel) || 1), Math.trunc(level) || 1)), exp: 0 });

/** Another ascension (prestigeLevel 1–3): the level clamped to its tier's top. */
export function withPrestige(raw: Any, prestige: number): Any {
  const p = Math.max(1, Math.min(3, Math.trunc(prestige) || 1));
  const level = Math.min(Number(raw.level) || 1, tierMaxLevel(p));
  return settle({ ...raw, prestigeLevel: p, level, exp: level === raw.level ? raw.exp : 0 });
}

/** Another class: the class's default rotation and first passive (its skills differ), gear kept. */
export function withClass(raw: Any, cls: number): Any {
  const defaults = seq<string>(G.heroList?.[cls]?.defaultAttackList ?? {});
  const rotation = defaults.length ? defaults : ["Basic", "Basic", "Basic", "Basic", "Basic"];
  const passive = Number(raw.level) < unlockSkillsLevel() ? "None" : classPassives(cls)[0] ?? "None";
  const base = { ...raw, class: cls };
  // both skill sets hold the old class's skill indices: each one starts from the new class's defaults
  if (Array.isArray(raw.skillSet)) base.skillSet = raw.skillSet.map(() => ({ attackList: skillIndices(cls, rotation), passive }));
  return settle(withSkills(base, rotation, passive));
}

/** One gear slot (1–6) replaced by a compact string (empty slots before it get the class's starting item: no gaps). */
export function withGearSlot(raw: Any, slot: number, compact: string): Any {
  const inv = [...(raw.heroInventory ?? [])];
  for (let i = 0; i < slot - 1; i++) if (typeof inv[i] !== "string") inv[i] = startingGear(raw.class)[i];
  inv[slot - 1] = compact;
  return settle({ ...raw, heroInventory: inv });
}

/** The default name of a created hero. */
export const NEW_HERO_NAME = "New hero";

/**
 * A new hero as the game hires one (Hero:new isNew): level 1, ascension 0, the class's starting gear, default
 * rotation and passive, idle; `id` from hero-overlay nextHeroId.
 */
export function newHeroRaw(cls: number, id: number, name = NEW_HERO_NAME): Any {
  const raw: Any = {
    id, heroID: id, name, class: cls, level: 1, exp: 0, prestigeLevel: 1, campaignID: -1, questListID: -1, questStatus: 0,
    totalQuests: 0, totalDeath: 0, enchantsUsed: 0, heroInventory: startingGear(cls),
  };
  return withClass(raw, cls);
}
