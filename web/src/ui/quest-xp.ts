/**
 * XP, time and XP per minute of a quest or a map run, as the pages show them (U33): the wiki enemy page's "XP and time"
 * section and the battle page's result tiles. Pure figures on top of tools/quest-stats.ts (questStats, mapRunStats,
 * mapsWithQuest) and the engine's party rules (partyRules); node tests import this file (no DOM here).
 *
 * - A quest-board quest is fought on its own: XP per hero, quest time and XP per minute at a grade, for quest sizes ×1
 *   and the hero-tier maxima ×3 / ×5 (rare variant always ×1), for one hero or the quest's full party.
 * - A map-only enemy (map bosses 91-98, Treasure Bushes 99-104) costs a whole map: the maps it is fought in, each with
 *   its craft time, run time and XP per hero for the whole run.
 */
import { G } from "../sim/data.ts";
import { type FightEval, maxQuestAmount, partyRules } from "../tools/combat.ts";
import { isBoardQuest, isCraftableMap, isMapOnlyQuest, mapEnemyPool, mapRunStats, mapsWithQuest, questStats } from "../tools/quest-stats.ts";
import { seq } from "../sim/lua.ts";
import { isVisible } from "./expansion-state.ts";

/** Default grade of the wiki figures (B) and the letters of the switcher. */
export const XP_DEFAULT_GRADE = 3;
/** Seconds per action and per turn of a fight (default.timePerAction / timePerTurn). */
const SECONDS_PER_ACTION = 5, SECONDS_PER_TURN = 5;

/** Party sizes the page offers for a quest: one hero, and the most the quest takes (one for a solo quest). */
export function partySizes(quest: number): number[] {
  const max = partyRules({ quest }).maxSize;
  return max > 1 ? [1, max] : [1];
}

/** Quest sizes by hero tier (standard mode: ×1, ×3 at tier 2, ×5 at tier 3), from the engine's cap. */
export function questSizes(mode = "Standard"): { amount: number; tier: number }[] {
  return [1, 2, 3].map((tier) => ({ amount: maxQuestAmount([{ prestigeLevel: tier } as never], false, mode), tier }))
    .filter((s, i, all) => all.findIndex((t) => t.amount === s.amount) === i);
}

export interface QuestXpRow {
  amount: number;
  /** Hero tier that unlocks this size (1 for ×1). */
  tier: number;
  rare: boolean;
  xpPerHero: number;
  seconds: number;
  xpPerMin: number;
}

/** One row per quest size (and the rare variant at ×1): XP per hero, quest time (no fight) and XP per minute. */
export function questXpRows(quest: number, o: { grade?: number; heroes?: number; mode?: string } = {}): QuestXpRow[] {
  if (!isBoardQuest(quest)) return [];
  const grade = o.grade ?? XP_DEFAULT_GRADE, heroes = o.heroes ?? 1;
  const q = G.questData[quest];
  const row = (amount: number, tier: number, rare: boolean): QuestXpRow => {
    const s = questStats(quest, { grade, amount, heroes, rare, mode: o.mode });
    return { amount, tier, rare, xpPerHero: s.xpPerHero, seconds: s.seconds, xpPerMin: s.xpPerMin };
  };
  const rows = questSizes(o.mode).map((s) => row(s.amount, s.tier, false));
  if (q.enemyHpB !== undefined && q.attackListB !== undefined) rows.push(row(1, 1, true));
  return rows;
}

export interface MapXpRow {
  map: number;
  role: "boss" | "room" | "treasure";
  /** Expected fights against the enemy per run. */
  perRun: number;
  craftSeconds: number;
  runSeconds: number;
  /** XP per hero for the whole run (every room won). */
  xpPerHero: number;
  /** XP per hero per minute, craft included. */
  xpPerMin: number;
}

/**
 * The maps a map-only enemy is fought in, at map grade `grade` (= its craft grade) and ascension `asc`, with the run's
 * craft time, run time (walking; the fights add to it) and XP per hero. Maps the visitor hides (expansions) are left
 * out; `hidden` counts them. `uncraftable` lists the visible maps that hold the enemy (boss or room) but that no crafter
 * can make (R1 F42: the level-70 maps, dormant data), so the page can say why they are not in the rows.
 */
export function mapXpRows(quest: number, o: { grade?: number; asc?: number; heroes?: number; mode?: string } = {}): { rows: MapXpRow[]; hidden: number; uncraftable: number[] } {
  if (!isMapOnlyQuest(quest)) return { rows: [], hidden: 0, uncraftable: [] };
  const grade = o.grade ?? XP_DEFAULT_GRADE;
  const all = mapsWithQuest(quest, grade);
  const shown = all.filter((a) => isVisible("map", a.map));
  const rows = shown.map((a): MapXpRow => {
    const s = mapRunStats(a.map, { grade, asc: o.asc ?? 0, heroes: o.heroes ?? 1, mode: o.mode });
    return { map: a.map, role: a.role, perRun: a.perRun, craftSeconds: s.craftSeconds, runSeconds: s.runSeconds, xpPerHero: s.xpPerHero, xpPerMin: s.xpPerMin };
  });
  return { rows, hidden: all.length - shown.length, uncraftable: uncraftableMapsWith(quest).filter((m) => isVisible("map", m)) };
}

/** Maps whose boss list or room pool holds `quest` but that no crafter can make (isCraftableMap), in id order. */
export function uncraftableMapsWith(quest: number): number[] {
  return Object.keys(G.itemData?.map ?? {}).map(Number).sort((a, b) => a - b).filter((k) => !isCraftableMap(k)
    && (seq<number>(G.itemData.map[k]?.bossList ?? {}).includes(quest) || mapEnemyPool(k).includes(quest)));
}

/**
 * Battle seconds of a simulated fight (5 s per action, 5 s per turn), from the averages a FightEval has (it has no
 * action count of its own): the heroes' actions are their skill uses; the enemy acts once a turn, except in the last
 * turn of a win when it acts after the heroes (it is dead by then). `enemyFirst`: an enemy that acts before the heroes
 * (event bosses) acts every turn.
 */
export function fightBattleSeconds(ev: Pick<FightEval, "turns" | "heroes" | "win">, enemyFirst = false): number {
  const heroActions = Object.values(ev.heroes ?? {}).reduce((s, h) => s + Object.values(h.skillUses ?? {}).reduce((a, b) => a + b, 0), 0);
  const enemyActions = Math.max(0, ev.turns - (enemyFirst ? 0 : ev.win));
  return (heroActions + enemyActions) * SECONDS_PER_ACTION + ev.turns * SECONDS_PER_TURN;
}

/** The enemy acts before the heroes every turn (questType 6, the event bosses; timeline.ts turn order). */
const enemyActsFirst = (quest: number) => G.questData[quest]?.questType === 6;

export interface QuestRunContext {
  quest: number;
  rare: boolean;
  amount: number;
  heroes: number;
  /** Sum of the party's speed (%), capped at 75 by questStats. */
  speed?: number;
  mode?: string;
}

/** XP per hero, simulated quest time and XP per minute of a Simulate result (grade: the average grade when won, else B). */
export function questResultXp(ev: Pick<FightEval, "turns" | "heroes" | "grade" | "win">, c: QuestRunContext) {
  const grade = ev.win > 0 ? Math.min(5, Math.max(1, Math.round(ev.grade))) : XP_DEFAULT_GRADE;
  const battleSeconds = fightBattleSeconds(ev, enemyActsFirst(c.quest));
  const s = questStats(c.quest, { grade, amount: c.amount, heroes: c.heroes, rare: c.rare, speed: c.speed, battleSeconds, mode: c.mode });
  return { grade, battleSeconds: s.battleSeconds, questSeconds: s.questSeconds, seconds: s.seconds, xpPerHero: s.xpPerHero, xpPerMin: s.xpPerMin };
}

export interface MapRunContext {
  map: number;
  grade: number;
  asc: number;
  heroes: number;
  mode?: string;
}

/**
 * Craft time, simulated run time and XP per hero per run of a map Simulate result. A room's XP is given only when it
 * is won (campaign.ts resetHero), so the XP is the full run's (`xpFull`, every room won) times the share of rooms
 * cleared on average (`cleared`, R1 F06): a run lost in room 3 doesn't count the rooms after it. `xpPerHero` is null
 * when no room is ever won (the page shows "—"). Without `cleared` every room counts (the wiki's figure).
 */
export function mapResultXp(ev: { time_h: number; cleared?: number }, c: MapRunContext) {
  const s = mapRunStats(c.map, { grade: c.grade, asc: c.asc, heroes: c.heroes, runSeconds: ev.time_h * 3600, mode: c.mode });
  const share = Math.max(0, Math.min(1, ev.cleared ?? 1));
  const won = share * s.xpPerHero;
  const none = share < 5e-4;
  return {
    craftSeconds: s.craftSeconds, runSeconds: s.runSeconds, seconds: s.seconds, xpFull: s.xpPerHero, cleared: share,
    xpPerHero: none ? null : won, xpPerMin: none ? null : s.xpPerMin * share,
  };
}

/** "45 s", "1 min 40 s" (under 10 min), "12 min", "1 h 57 min", "2 d 3 h". */
export function timeText(sec: number): string {
  if (!Number.isFinite(sec)) return "?";
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  if (s < 600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** XP figures: whole numbers, one decimal under 10 (XP per minute of a long quest). */
export function xpText(x: number): string {
  if (!Number.isFinite(x)) return "?";
  const r = Math.abs(x) < 10 ? Math.round(x * 10) / 10 : Math.round(x);
  return r.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
