/**
 * Merchant combat simulator: parties, skills and gear against quest enemies and map runs.
 * TypeScript port of the former tools/combat.py (removed 2026-11-23), running on the TypeScript engine (web/src/sim).
 *
 * Every command takes the Sim, a Roster (heroes from the save) and its options,
 * writes its report through `io.out` (stdout in the CLI, the page in the browser),
 * progress through `io.progress`, and returns the data it printed. Commands that
 * write a CSV in Python return its rows in `csv`; the caller decides where they go.
 *
 * Every evaluation uses the same seeds for every candidate (common random numbers),
 * so comparisons are fair even with few fights.
 */
import { G } from "../sim/data.ts";
import { gameFromData, pyRound } from "./gamedata.ts";
import { Solver } from "./profit.ts";
import { itemName, type Hero, type MapSpec, type Row, type Scroll, sellValue, Sim } from "./engine.ts";
import type { Save } from "./save.ts";
import { hasWarmStart, warmStart } from "./warmstart.ts";
import { DAMAGE_ONLY, enemyTimeline, hasTimelines, type PartyMember, scheduleContext, scoreSchedule, type ScoreWeights } from "./schedule.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface IO {
  out: (line: string) => void;
  progress: (line: string) => void;
}
export const consoleIO: IO = { out: (s) => console.log(s), progress: (s) => console.error(s) };

// ---------------------------------------------------------------- formatting (Python format specs)
/** `{x:>w.df}`: Python rounds the exact value, ties to even (698.5 -> "698"), and prints -0 as "-0". */
export function fx(x: number, w = 0, d = 0): string {
  if (!Number.isFinite(x)) return (Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf").padStart(w);
  const r = pyRound(x, d);
  return ((Object.is(r, -0) ? "-" : "") + r.toFixed(d)).padStart(w);
}
/** `{s:w}` (left), `{s:>w}` with right = true */
export const fs = (s: unknown, w = 0, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));
const pct = (x: number, w = 5, d = 1) => fx(100 * x, w, d);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Python round(x, d) for reports (half-even differences are below CSV precision). */
const r = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
/** str() of a Python float: 100 -> "100.0". */
export const pf = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Python tuple ordering, descending: by score, then by the candidate (as Python's sort(reverse=True)). */
function byScoreDesc<T extends (string | number)[]>(a: [number, T], b: [number, T]): number {
  if (a[0] !== b[0]) return b[0] - a[0];
  return -cmpTuple(a[1], b[1]);
}

/** Python tuple comparison: element by element, a shorter prefix sorts first. */
export function cmpTuple(a: (string | number)[], b: (string | number)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length - b.length;
}

// ---------------------------------------------------------------- evaluation
interface HeroAcc {
  name: string;
  class?: number;
  dmg: number;
  taken: number;
  heal: number;
  deaths: number;
  skillDmg: Record<string, number>;
  skillUses: Record<string, number>;
}
export interface HeroEval extends HeroAcc {
  death_rate: number;
}

function heroAccumulator() {
  const perHero = new Map<string, HeroAcc>();
  return {
    add(h: Any, withClass: boolean) {
      let ph = perHero.get(h.slot);
      if (!ph) perHero.set(h.slot, ph = { name: h.name, dmg: 0, taken: 0, heal: 0, deaths: 0, skillDmg: {}, skillUses: {} });
      ph.name = h.name;
      if (withClass) ph.class = h.class;
      ph.dmg += h.physicalDmgDealt + h.magicDmgDealt;
      ph.taken += h.dmgTaken;
      ph.heal += h.healingDone;
      ph.deaths += h.dead ? 1 : 0;
      for (const [sk, v] of Object.entries(h.skillDmg ?? {})) ph.skillDmg[sk] = (ph.skillDmg[sk] ?? 0) + (v as number);
      for (const [sk, v] of Object.entries(h.skillUses ?? {})) ph.skillUses[sk] = (ph.skillUses[sk] ?? 0) + (v as number);
    },
    result(n: number): Record<string, HeroEval> {
      const out: Record<string, HeroEval> = {};
      const per = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, x / n]));
      for (const [slot, v] of perHero) {
        out[slot] = { ...v, dmg: v.dmg / n, taken: v.taken / n, heal: v.heal / n, death_rate: v.deaths / n,
          skillDmg: per(v.skillDmg), skillUses: per(v.skillUses) };
      }
      return out;
    },
  };
}

export interface FightEval {
  n: number;
  win: number;
  turns: number;
  turns_win: number | null;
  grade: number;
  /** Share of the enemy's HP removed at the end of the fight (0 when it healed back to full). */
  enemy_dmg: number;
  /** Share of the enemy's HP removed at its lowest point (>= enemy_dmg; higher against enemies that heal). */
  enemy_dmg_peak: number;
  /** Damage the enemy took per fight, in HP, and as a share of its max HP (can exceed 1 when it heals). */
  enemy_dmg_total: number;
  enemy_dmg_total_frac: number;
  hp_left: number;
  heroes: Record<string, HeroEval>;
  score: number;
}

/**
 * Seed of fight k of an evaluation starting at seed0: a 32-bit hash (murmur3 finaliser) of (seed0, k), in
 * 1..2^31-2. Plain small seeds (1, 2, 3...) make Park-Miller's first roll tiny (s x 16807 / (2^31 - 1)): random(1, 100)
 * is 1 for every seed up to ~1,270, so the first hit check of every fight always landed.
 */
export function fightSeed(seed0: number, k: number): number {
  let h = (Math.imul(seed0 | 0, 0x9e3779b1) + (k | 0)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) % 2147483646) + 1;
}

/** Monte-Carlo summary of n fights with seeds fightSeed(seed0, 0..n-1). Throws for a layout the game would not start
 * (checkParty), unless `mapRoom` (the quest fought as a map room, where the map's rules apply). `stop` is polled
 * before every fight: when it returns true the evaluation throws SearchCancelled (searches stop on time). */
export function evaluate(sim: Sim, quest: number, front: Row, back: Row, n = 200, rare = false, amount = 1, seed0 = 1,
  mapRoom = false, stop?: () => boolean): FightEval {
  const q = G.questData[quest];
  if (!q?.enemyHp || !q.attackList) throw new Error(`quest ${quest} has no enemy to fight`);
  // The game code fails on a rare fight without rare stats (obj.Enemy); the port would fight a NaN enemy.
  if (rare && (q.enemyHpB === undefined || q.attackListB === undefined)) throw new Error(`quest ${quest} has no rare variant`);
  if (!mapRoom) checkParty({ quest }, front, back);
  checkAmount(sim, front, back, rare, amount);
  let wins = 0;
  const turns: number[] = [], turnsWin: number[] = [], grades: number[] = [], enemyFrac: number[] = [], hpFrac: number[] = [];
  const peakFrac: number[] = [], dmgTotal: number[] = [], dmgFrac: number[] = [];
  const acc = heroAccumulator();
  for (let k = 0; k < n; k++) {
    if (stop?.()) throw new SearchCancelled();
    const res = sim.fight(quest, front, back, { seed: fightSeed(seed0, k), isRare: rare, amount });
    turns.push(res.turns);
    if (res.won) {
      wins++;
      turnsWin.push(res.turns);
      grades.push(res.grade);
    }
    enemyFrac.push(1 - Math.max(res.enemyHP, 0) / res.enemyMaxHP);
    peakFrac.push(1 - Math.max(res.enemyMinHP ?? res.enemyHP, 0) / res.enemyMaxHP);
    dmgTotal.push(res.enemyDmgTaken ?? 0);
    dmgFrac.push((res.enemyDmgTaken ?? 0) / res.enemyMaxHP);
    hpFrac.push(sum(res.heroes.map((h) => Math.max(h.hp, 0))) / sum(res.heroes.map((h) => h.maxHP)));
    for (const h of res.heroes) acc.add(h, true);
  }
  const out: FightEval = {
    n, win: wins / n, turns: mean(turns), turns_win: turnsWin.length ? mean(turnsWin) : null,
    grade: grades.length ? mean(grades) : 0, enemy_dmg: mean(enemyFrac), enemy_dmg_peak: mean(peakFrac),
    enemy_dmg_total: mean(dmgTotal), enemy_dmg_total_frac: mean(dmgFrac), hp_left: mean(hpFrac),
    heroes: acc.result(n), score: 0,
  };
  out.score = score(out);
  return out;
}

/** Throws when `amount` is not one the game offers to this party (see maxQuestAmount). */
export function checkAmount(sim: Sim, front: Row, back: Row, rare: boolean, amount: number): void {
  const max = maxQuestAmount([...front, ...back], rare, sim.mode);
  if (!Number.isInteger(amount) || amount < 1 || amount > max) {
    throw new Error(`quest amount ${amount} is not available to this party: 1 to ${max}` +
      (rare ? " (a rare quest is always 1)" : " (enemy HP x amount; the max comes from the highest hero prestige)"));
  }
}

/**
 * Win rate first. Won fights: faster is better (-10 per turn), then HP left. Lost fights: how far the enemy's HP was
 * brought down at its lowest (1 % = 100), then the total damage it took (1 % = 10, counts when it heals back), and
 * surviving longer is a small bonus (+0.5 per turn) — not a penalty, which rewarded dying sooner.
 */
export function score(ev: Pick<FightEval, "win" | "enemy_dmg" | "turns" | "hp_left"> &
  Partial<Pick<FightEval, "enemy_dmg_peak" | "enemy_dmg_total_frac" | "turns_win">>): number {
  const tw = ev.turns_win ?? ev.turns;
  const lostTurns = ev.win < 1 ? Math.max(0, (ev.turns - ev.win * tw) / (1 - ev.win)) : 0;
  return ev.win * 1e6 + (ev.enemy_dmg_peak ?? ev.enemy_dmg) * 1e4 - ev.win * tw * 10 + ev.hp_left * 5 +
    (1 - ev.win) * (Math.min(ev.enemy_dmg_total_frac ?? 0, 100) * 1e3 + Math.min(lostTurns, 200) * 0.5);
}

export function fmtEval(ev: FightEval): string {
  const tw = ev.turns_win !== null ? fx(ev.turns_win, 0, 1) : "-";
  const peak = ev.enemy_dmg_peak !== undefined && ev.enemy_dmg_peak > ev.enemy_dmg + 5e-4 ? ` (lowest ${pct(ev.enemy_dmg_peak)}%)` : "";
  return `win ${pct(ev.win)}%  turns ${fx(ev.turns, 5, 1)} (wins ${tw})  grade ${fx(ev.grade, 0, 2)}  ` +
    `enemy HP removed ${pct(ev.enemy_dmg)}%${peak}  party HP left ${pct(ev.hp_left)}%`;
}

export const SCROLL_IDS = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69]; // consumables with scrollsData behaviour (70 has no item)

/** '61,63,69@1' -> [{id: 61, prestigeLevel: 0}, ...] (max 3 slots, as in the game UI). */
export function parseScrolls(spec?: string | null): Scroll[] | null {
  if (!spec) return null;
  const out: Scroll[] = [];
  for (let part of String(spec).split(",")) {
    part = part.trim();
    if (!part) continue;
    const [sid, asc] = part.split("@");
    out.push({ id: toInt(sid), prestigeLevel: asc ? toInt(asc) : 0 });
  }
  if (out.length > 3) throw new Error("a map takes at most 3 scrolls");
  return out;
}

export function scrollNames(scrolls?: Scroll[] | null): string {
  if (!scrolls || !scrolls.length) return "none";
  return scrolls.map((sc) => G.itemData.consumable[sc.id].name + (sc.prestigeLevel ? ` asc${sc.prestigeLevel}` : "")).join(", ");
}

export interface MapEval {
  errors: number;
  error: string;
  escaped: number;
  /** [scroll id, charges per run] in first-use order (a Python dict) */
  charges_used: [number, number][];
  n: number;
  win: number;
  cleared: number;
  rooms: number;
  grade: number;
  time_h: number;
  hp_left: number;
  loot_value: number;
  essence: Record<string, number>;
  fail_room: Record<string, number>;
  heroes: Record<string, HeroEval>;
  score: number;
}

/** Monte-Carlo summary of n map runs (each seed = a new layout and new fights). `stop` is polled before every run
 * (SearchCancelled when it returns true). */
export function evaluateMap(sim: Sim, spec: MapSpec, front: Row, back: Row, n = 100, seed0 = 1, scrolls?: Scroll[] | null,
  stop?: () => boolean): MapEval {
  checkParty({ map: spec }, front, back);
  let wins = 0, escapes = 0;
  const cleared: number[] = [], grades: number[] = [], times: number[] = [], hpLeft: number[] = [], rooms: number[] = [];
  const lootValue: number[] = [], errors: string[] = [];
  const failRoom: Record<string, number> = {}, charges = new Map<number, number>(), essence: Record<string, number> = {};
  const acc = heroAccumulator();
  for (let k = 0; k < n; k++) {
    if (stop?.()) throw new SearchCancelled();
    let res;
    try {
      res = sim.mapRun(spec, front, back, fightSeed(seed0, k), scrolls);
    } catch (e) { // the game code itself failed (e.g. a map that can't be generated)
      if (String(e).includes("not ported")) throw e;
      errors.push(String((e as Error)?.message ?? e).split("\n")[0]);
      continue;
    }
    rooms.push(res.rooms);
    escapes += res.escaped ? 1 : 0;
    for (const sc of res.scrollsUsed ?? []) charges.set(sc.id, (charges.get(sc.id) ?? 0) + sc.chargesUsed);
    cleared.push((res.cleared + (res.lastEnemyRemoved ?? 0)) / res.rooms);
    times.push(res.time);
    if (res.won) {
      wins++;
      grades.push(res.grade);
    } else {
      const lost = res.combats.find((c) => c.status === 2);
      if (lost) {
        const key = lost.name + (lost.isRare ? " (rare)" : "");
        failRoom[key] = (failRoom[key] ?? 0) + 1;
      }
    }
    let value = 0;
    for (const it of res.rewards) {
      const v = sellValue(it.itemType, it.itemID, it.prestigeLevel || 0);
      if (v !== undefined) value += v * (it.itemType === "material" ? it.amount : 1);
      if (it.itemType === "material" && G.itemData.material[it.itemID]?.subType === "essence") {
        const name = itemName("material", it.itemID);
        essence[name] = (essence[name] ?? 0) + it.amount;
      }
    }
    lootValue.push(value);
    hpLeft.push(sum(res.heroes.map((h) => Math.max(h.hp, 0))) / sum(res.heroes.map((h) => h.maxHP)));
    for (const h of res.heroes) acc.add(h, false);
  }
  if (!rooms.length) throw new Error(`all ${n} runs failed in game code: ${errors[0]}`);
  const nOk = rooms.length;
  const per = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / nOk]));
  const out: MapEval = {
    errors: errors.length, error: errors[0] ?? "",
    escaped: escapes / nOk, charges_used: [...charges].map(([id, v]) => [id, v / nOk]),
    n: nOk, win: wins / nOk, cleared: mean(cleared), rooms: mean(rooms),
    grade: grades.length ? mean(grades) : 0, time_h: mean(times) / 3600,
    hp_left: mean(hpLeft), loot_value: mean(lootValue), essence: per(essence),
    fail_room: Object.fromEntries(Object.entries(failRoom).sort((a, b) => b[1] - a[1])),
    heroes: acc.result(nOk), score: 0,
  };
  // win first, then how far the party gets, then grade (more essence/loot), then HP left
  out.score = out.win * 1e6 + out.cleared * 1e4 + out.grade * 100 + out.hp_left * 5;
  return out;
}

export function fmtMap(ev: MapEval): string {
  const ess = Object.entries(ev.essence).map(([k, v]) => `${fx(v, 0, 0)} ${k}`).join(", ") || "none";
  return `win ${pct(ev.win)}%  progress ${pct(ev.cleared)}% of ${fx(ev.rooms, 0, 1)} rooms  ` +
    `grade ${fx(ev.grade, 0, 2)}  time ${fx(ev.time_h, 0, 2)} h  party HP left ${pct(ev.hp_left)}%\n` +
    `  per run: loot worth ${fx(ev.loot_value, 0, 0)} g (sell value), essence ${ess}`;
}

// ---------------------------------------------------------------- roster
function toInt(s: string): number {
  const t = s.trim();
  if (!/^[-+]?\d+$/.test(t)) throw new Error(`not an integer: '${s}'`);
  return Number.parseInt(t, 10);
}

/** '1-60,80' -> [1..60, 80]; `keep` filters the ids a range expands to. */
export function parseIds(spec: string | number, keep?: (id: number) => boolean): number[] {
  const out: number[] = [];
  for (let part of String(spec).split(",")) {
    part = part.trim();
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(toInt);
      for (let i = a; i <= b; i++) if (!keep || keep(i)) out.push(i);
    } else if (part) out.push(toInt(part));
  }
  return out;
}

export class Roster {
  readonly raw = new Map<number, Any>();
  private objs = new Map<number, Hero>();

  readonly sim: Sim;
  readonly save: Save;

  constructor(sim: Sim, save: Save) {
    this.sim = sim;
    this.save = save;
    for (const h of save.raw.hero ?? []) this.raw.set(h.id, h);
  }

  /** A hero for save id `hid` (cached; reset to the save state with reload()). */
  get(hid: number): Hero {
    if (!this.raw.has(hid)) throw new Error(`no hero #${hid} in the save (see the roster command)`);
    let h = this.objs.get(hid);
    if (!h) this.objs.set(hid, h = this.sim.hero(this.raw.get(hid)));
    return h;
  }

  reload(hid: number): Hero {
    this.objs.delete(hid);
    return this.get(hid);
  }

  ids(spec?: string | number | null): number[] {
    if (spec === undefined || spec === null || spec === "" || spec === "all") return [...this.raw.keys()].sort((a, b) => a - b);
    return parseIds(spec, (i) => this.raw.has(i));
  }

  label(hid: number): string {
    const h = this.get(hid);
    return `#${hid} ${h.name} (${G.heroList[h.class].name} L${h.level} P${h.prestigeLevel})`;
  }
}

/** Hero ids for the slots of each row ('1,0,9': 0 = empty slot). */
export function parseRows(roster: Roster, front?: string | null, back?: string | null): [Row, Row] {
  const row = (spec?: string | null) => (spec ? roster.ids(spec).map((i) => (i ? roster.get(i) : null)) : []);
  return [row(front), row(back)];
}

/** 'inv:N' = Nth map of your map inventory (1-based), else a map id. */
export function parseMap(roster: Roster, spec: string | number, asc = 0, grade = 3, prefix = 0, suffix = 0): [MapSpec, string] {
  const s = String(spec);
  if (s.startsWith("inv:")) {
    const m = roster.save.mapInventory[toInt(s.slice(4)) - 1];
    if (!m) throw new Error(`no map #${s.slice(4)} in the map inventory`);
    return [m.compact, `inventory map #${s.slice(4)}`];
  }
  return [{ id: toInt(s), prestigeLevel: asc, grade, prefix: prefix || null, suffix: suffix || null }, `map ${s}`];
}

/** Rough threat of a quest enemy: HP x (atk + matk), rare stats if asked. */
export function enemyPower(q: number, rare = false): number {
  const d = G.questData[q];
  const sfx = rare && d.enemyHpB ? "B" : "";
  return (d["enemyHp" + sfx] || 0) * ((d["enemyAtk" + sfx] || 0) + (d["enemyMatk" + sfx] || 0));
}

export const questName = (q: number): string => G.questData[q].name;

// ---------------------------------------------------------------- search API
// Pure searches for pages and web workers: typed results, no output, no Node APIs.
// Each takes engine heroes (not save ids) and a SearchControl for progress and
// cancellation. The cmd* functions below are text reports built on top of them.

export interface SearchControl {
  /** Called after every evaluated candidate: `done` of `total` in the current `stage`
   * (a stage also reports 0/total when it starts). Totals are per stage. */
  onProgress?: (done: number, total: number, stage: string) => void;
  /** Polled before every evaluation, and before every fight or map run within one (a search stops within a fight
   * or a run of the request); return true to cancel (the search throws SearchCancelled). */
  shouldStop?: () => boolean;
}

export class SearchCancelled extends Error {
  constructor() {
    super("search cancelled");
    this.name = "SearchCancelled";
  }
}

function stepper(ctl: SearchControl = {}) {
  let stage = "", done = 0, total = 0;
  return {
    stage(name: string, n: number) {
      stage = name;
      done = 0;
      total = n;
      ctl.onProgress?.(0, n, name);
    },
    check() {
      if (ctl.shouldStop?.()) throw new SearchCancelled();
    },
    tick() {
      ctl.onProgress?.(++done, total, stage);
    },
  };
}

/** A quest fight to optimise for. */
export interface QuestTarget {
  quest: number;
  rare?: boolean;
  /** Quest amount: one enemy with its max HP x amount (obj.Enemy), loot and quest time scaled too. 1 to
   * maxQuestAmount (prestige x 2 - 1 in the standard mode: 1, 3 or 5); a rare quest is always 1. */
  amount?: number;
  /** The fight is a map room (e.g. the map's boss, to tune rotations on): the quest's own party rules (partyRules)
   * don't apply, the map's do. */
  mapRoom?: boolean;
}

/**
 * Highest quest amount the game offers (questService.getCurrentAndMaxAmount, default.enemyAmount): from the prestige
 * of the hero the quest is opened with, here the party's highest; 1 for a rare quest. Your gold can lower it further
 * (changeMaxAccordingToGold), which a save-free tool can't know.
 */
export function maxQuestAmount(heroes: (Hero | null | undefined)[], rare = false, mode = "Standard"): number {
  if (rare) return 1;
  const p = Math.max(1, ...heroes.filter((h): h is Hero => Boolean(h)).map((h) => h.prestigeLevel ?? 1));
  if (mode === "Quick") return p * 3 + 1; // data.GameModsData: mods.Quick
  if (mode === "Legendary") return p * 2 + 1; // mods.Legendary
  return p * 2 - 1; // default.__enemyAmount
}

/** A map run to optimise for. */
export interface MapTarget {
  map: MapSpec;
  scrolls?: Scroll[] | null;
}

/** A party slot: row and index 0-2 (front 2 = { row: "front", i: 1 }, party location 4). */
export interface PartySlot {
  row: "front" | "back";
  i: number;
}

/** How the game lets a party be set up for a target (see partyRules). */
export interface PartyRules {
  /** Most heroes the game lets into the party. */
  maxSize: number;
  /** Slots that can never be empty. */
  required: PartySlot[];
  /** "solo": a solo quest (questData.party false), one hero in front 1; "party": a party quest; "map": a map run. */
  kind: "solo" | "party" | "map";
}

/**
 * The game's party rules for a target. They come from the screens that start a fight, not from the battle code (which
 * fights any layout):
 * - Solo quest (`questData.party` false): `startSoloQuest` puts the one hero in front 1 (obj.GameClass.lua:277-278).
 * - Party quest: the party screen opens with the hero the quest was opened from in front 2
 *   (scene.QuestAssignHeroMenu.lua:279-283), and a hero in front 2 can only be swapped with another hero, never moved
 *   to an empty slot (`switch`, :350). So front 2 is always filled. At most `questSize` heroes (:324).
 * - Map run: no required slot; up to the map's party size (`partySize or 6`, obj.Map.lua:26). The map screen has the
 *   same front-2 swap rule (scene.maps.MapAssignHeroMenu.lua:356), but its party starts empty, so any layout is possible.
 */
export function partyRules(t: QuestTarget | MapTarget): PartyRules {
  if ("map" in t || t.mapRoom) return { kind: "map", maxSize: 6, required: [] }; // map items never set partySize
  const q = G.questData[t.quest];
  if (!q?.party) return { kind: "solo", maxSize: 1, required: [{ row: "front", i: 0 }] };
  return { kind: "party", maxSize: Math.min(6, q.questSize ?? 6), required: [{ row: "front", i: 1 }] };
}

/** Slots the game never lets be empty for this target (for the UI: mark them as required). */
export function requiredSlots(t: QuestTarget | MapTarget): PartySlot[] {
  return partyRules(t).required;
}

/** Why the game would not start this layout (rows of heroes or ids, null = empty), or null when it would. */
export function partyProblem(t: QuestTarget | MapTarget, front: readonly unknown[], back: readonly unknown[]): string | null {
  const r = partyRules(t);
  // empty means null / undefined only: a hero id or index of 0 is a hero
  const empty = (x: unknown) => x === null || x === undefined;
  const size = [...front, ...back].filter((x) => !empty(x)).length;
  const what = "map" in t ? `map ${typeof t.map === "string" ? t.map : t.map.id}` : `quest ${t.quest}${G.questData[t.quest]?.name ? ` (${G.questData[t.quest].name})` : ""}`;
  if (size === 0) return `${what}: the party is empty`;
  if (r.kind === "solo" && (size > 1 || empty(front[0]))) return `${what} is a solo quest: one hero, in front 1`;
  if (size > r.maxSize) return `${what} takes at most ${r.maxSize} heroes, not ${size}`;
  for (const s of r.required) {
    const row = s.row === "front" ? front : back;
    if (empty(row[s.i])) {
      return `${what} needs a hero in ${s.row} ${s.i + 1}: the game starts the party there with the hero the quest is ` +
        `opened from, and never lets that slot be emptied`;
    }
  }
  return null;
}

/** Throws partyProblem's message for a layout the game would not start. */
export function checkParty(t: QuestTarget | MapTarget, front: readonly unknown[], back: readonly unknown[]): void {
  const p = partyProblem(t, front, back);
  if (p) throw new Error(p);
}

/** Rows for one hero alone, where the game would put it: front 1 in a solo quest, front 2 in a party quest. */
export function soloRows<H>(t: QuestTarget | MapTarget, h: H): [(H | null)[], (H | null)[]] {
  const s = partyRules(t).required[0] ?? { row: "front", i: 0 };
  const front: (H | null)[] = [null, null, null], back: (H | null)[] = [null, null, null];
  (s.row === "front" ? front : back)[s.i] = h;
  return [front, back];
}

/** evaluate (quest) or evaluateMap (map run) with seeds fightSeed(seed0, 0..n-1); both carry a comparable `score`.
 * `stop`: polled before every fight or run (SearchCancelled when true). */
export function evaluateTarget(sim: Sim, t: QuestTarget, front: Row, back: Row, n: number, seed0?: number, stop?: () => boolean): FightEval;
export function evaluateTarget(sim: Sim, t: MapTarget, front: Row, back: Row, n: number, seed0?: number, stop?: () => boolean): MapEval;
export function evaluateTarget(sim: Sim, t: QuestTarget | MapTarget, front: Row, back: Row, n: number, seed0?: number,
  stop?: () => boolean): FightEval | MapEval;
export function evaluateTarget(sim: Sim, t: QuestTarget | MapTarget, front: Row, back: Row, n: number, seed0 = 1,
  stop?: () => boolean): FightEval | MapEval {
  if ("map" in t) return evaluateMap(sim, t.map, front, back, n, seed0, t.scrolls ? t.scrolls.map((x) => ({ ...x })) : null, stop);
  return evaluate(sim, t.quest, front, back, n, t.rare, t.amount, seed0, Boolean(t.mapRoom), stop);
}

// ---------------------------------------------------------------- commands
export interface FightOpts {
  quest: number;
  rare?: boolean;
  amount?: number;
  n?: number;
  front?: string | null;
  back?: string | null;
}

export function cmdRoster(sim: Sim, roster: Roster, _opts: unknown = {}, io: IO = consoleIO) {
  io.out(`${fs("id", 3, true)} ${fs("name", 14)} ${fs("class", 12)} ${fs("lvl", 3, true)} ${fs("P", 2, true)} ${fs("HP", 6, true)} ` +
    `${fs("atk", 5, true)} ${fs("matk", 5, true)} ${fs("acc", 5, true)} ${fs("crit", 4, true)} ${fs("def", 5, true)} ` +
    `${fs("mdef", 5, true)} ${fs("AP", 5, true)}  rotation / passive`);
  const rows: Any[] = [];
  for (const hid of roster.ids("all")) {
    const h = roster.get(hid);
    const s = sim.stats(h);
    const rot = sim.rotation(h);
    rows.push({ id: hid, name: h.name, class: G.heroList[h.class].name, level: h.level, prestige: h.prestigeLevel, stats: s,
      rotation: rot, passive: h.passiveSelect });
    io.out(`${fs(hid, 3, true)} ${fs(String(h.name).slice(0, 14), 14)} ${fs(String(G.heroList[h.class].name).slice(0, 12), 12)} ` +
      `${fs(h.level, 3, true)} ${fs(h.prestigeLevel, 2, true)} ${fx(s.maxHP, 6)} ${fx(s.atk, 5)} ${fx(s.matk, 5)} ${fx(s.acc, 5)} ` +
      `${fx(s.crit, 4)} ${fx(s.def, 5)} ${fx(s.mdef, 5)} ${fs(s.maxActionPoints - s.actionPoints, 2, true)}/${fs(s.maxActionPoints, 2)}  ` +
      `${rot.join(", ")} / ${h.passiveSelect}`);
  }
  return rows;
}

export function printPartyDetail(ev: { heroes: Record<string, HeroEval> }, unit = "fight", io: IO = consoleIO): void {
  io.out(`  ${fs("slot", 7)} ${fs("hero", 16)} ${fs("dmg/" + unit, 10, true)} ${fs("taken", 8, true)} ${fs("heal", 7, true)} ` +
    `${fs("death%", 7, true)}  damage by skill (per ${unit})`);
  for (const slot of Object.keys(ev.heroes).sort()) {
    const v = ev.heroes[slot];
    const skills = Object.entries(v.skillDmg).sort((a, b) => b[1] - a[1]);
    const sk = skills.map(([k, x]) => `${k} ${fx(x, 0, 0)} (${fx((v.skillUses[k] ?? 0), 0, 1)}x)`).join(", ");
    io.out(`  ${fs(slot, 7)} ${fs(String(v.name).slice(0, 16), 16)} ${fx(v.dmg, 10)} ${fx(v.taken, 8)} ${fx(v.heal, 7)} ` +
      `${fx(100 * v.death_rate, 6, 1)}%  ${sk}`);
  }
}

export function cmdFight(sim: Sim, roster: Roster, o: FightOpts, io: IO = consoleIO): FightEval {
  const n = o.n ?? 500;
  const [front, back] = parseRows(roster, o.front, o.back);
  const ev = evaluate(sim, o.quest, front, back, n, o.rare, o.amount);
  io.out(`Quest ${o.quest} ${questName(o.quest)}${o.rare ? " (rare)" : ""}, ${n} fights`);
  io.out("  " + fmtEval(ev));
  printPartyDetail(ev, "fight", io);
  return ev;
}

export function cmdDamage(sim: Sim, roster: Roster, o: FightOpts & { hero: number }, io: IO = consoleIO): FightEval {
  const n = o.n ?? 300;
  const ev = evaluate(sim, o.quest, ...soloRows({ quest: o.quest }, roster.get(o.hero)), n, o.rare, o.amount);
  const v = Object.values(ev.heroes)[0];
  io.out(`${roster.label(o.hero)} vs ${questName(o.quest)}, ${n} fights: ${fmtEval(ev)}`);
  io.out(`  damage per fight ${fx(v.dmg, 0, 0)}, per turn ${fx((v.dmg / ev.turns), 0, 0)}`);
  io.out(`  ${fs("skill", 22)} ${fs("uses/fight", 10, true)} ${fs("dmg/fight", 10, true)} ${fs("dmg/use", 9, true)}`);
  for (const [k, x] of Object.entries(v.skillDmg).sort((a, b) => b[1] - a[1])) {
    const uses = v.skillUses[k] ?? 0;
    io.out(`  ${fs(k, 22)} ${fx(uses, 10, 2)} ${fx(x, 10)} ${fx(uses ? x / uses : 0, 9)}`);
  }
  return ev;
}

/** One hero alone against one quest (a row of the solo matrix and of solo.csv). */
export interface SoloRow {
  hero_id: number;
  hero: string;
  class: string;
  level: number;
  prestige: number;
  quest_id: number;
  quest: string;
  quest_level: number;
  enemy_power: number;
  "win%": number;
  turns: number;
  grade: number;
  "enemy_hp_removed%": number;
  "hp_left%": number;
}

/** Quest ids for the solo matrix: a list/range spec, or every quest; with `rare`, only quests with a rare variant. */
export function soloQuests(spec?: string | null, rare = false): number[] {
  const quests = (spec ? parseIds(spec, (q) => q in G.questData) : Object.keys(G.questData).map(Number).sort((a, b) => a - b))
    .filter((q) => !rare || (G.questData[q].enemyHpB !== undefined && G.questData[q].attackListB !== undefined));
  if (!quests.length) throw new Error(rare ? "no quest with a rare variant in the selection" : "no quest selected");
  return quests;
}

/** Every hero alone against every quest (`heroes`: [id, hero] pairs, in report order). */
export function soloMatrix(sim: Sim, heroes: [number, Hero][], quests: number[], o: { n?: number; rare?: boolean } = {},
  ctl: SearchControl = {}): SoloRow[] {
  const n = o.n ?? 100;
  const st = stepper(ctl);
  st.stage("solo", heroes.length * quests.length);
  const rows: SoloRow[] = [];
  for (const [hid, h] of heroes) {
    for (const q of quests) {
      st.check();
      const ev = evaluate(sim, q, ...soloRows({ quest: q }, h), n, o.rare);
      rows.push({ hero_id: hid, hero: h.name, class: G.heroList[h.class].name, level: h.level,
        prestige: h.prestigeLevel, quest_id: q, quest: questName(q), quest_level: G.questData[q].levelReq,
        enemy_power: enemyPower(q, o.rare), "win%": r(100 * ev.win, 1),
        turns: r(ev.turns, 1), grade: r(ev.grade, 2),
        "enemy_hp_removed%": r(100 * ev.enemy_dmg, 1), "hp_left%": r(100 * ev.hp_left, 1) });
      st.tick();
    }
  }
  return rows;
}

export interface SoloSummary {
  /** Per hero, in matrix order: quests won at >= threshold %, the toughest one beaten, the 3 weakest failed. */
  heroes: { heroId: number; soloable: number; quests: number; toughest: SoloRow | null; weakestFailed: SoloRow[] }[];
  /** Per class, best average win % first. */
  classes: { class: string; heroes: number; soloable: number; avgWin: number; avgTurnsWins: number }[];
}

export function soloSummary(rows: SoloRow[], threshold = 90): SoloSummary {
  const groupBy = <K extends keyof SoloRow>(key: K) => {
    const m = new Map<SoloRow[K], SoloRow[]>();
    for (const row of rows) m.set(row[key], [...(m.get(row[key]) ?? []), row]);
    return m;
  };
  const heroes = [...groupBy("hero_id")].map(([heroId, rs]) => {
    const ok = rs.filter((x) => x["win%"] >= threshold);
    return {
      heroId, soloable: ok.length, quests: rs.length,
      toughest: ok.length ? ok.reduce((a, b) => (b.enemy_power > a.enemy_power ? b : a)) : null,
      weakestFailed: rs.filter((x) => x["win%"] < threshold).sort((a, b) => a.enemy_power - b.enemy_power).slice(0, 3),
    };
  });
  const classes = [...groupBy("class")].sort((a, b) => mean(b[1].map((x) => x["win%"])) - mean(a[1].map((x) => x["win%"])))
    .map(([cls, rs]) => {
      const heroCount = new Set(rs.map((x) => x.hero_id)).size;
      const wins = rs.filter((x) => x["win%"] >= threshold).map((x) => x.turns);
      return { class: cls, heroes: heroCount, soloable: rs.filter((x) => x["win%"] >= threshold).length / heroCount,
        avgWin: mean(rs.map((x) => x["win%"])), avgTurnsWins: wins.length ? mean(wins) : 0 };
    });
  return { heroes, classes };
}

export function cmdSolo(sim: Sim, roster: Roster,
  o: { heroes?: string; quests?: string; n?: number; rare?: boolean; threshold?: number }, io: IO = consoleIO) {
  const n = o.n ?? 100, threshold = o.threshold ?? 90;
  const hids = roster.ids(o.heroes ?? "all");
  // Quest ids are not filtered by hero ids (the former combat.py did, through Roster.ids).
  // With --rare, quests without a rare variant are skipped (the game code fails on them).
  const quests = soloQuests(o.quests, o.rare);
  const rows = soloMatrix(sim, hids.map((hid) => [hid, roster.get(hid)]), quests, { n, rare: o.rare }, {
    onProgress: (done) => {
      if (done && done % quests.length === 0) io.progress(`  ${roster.label(hids[done / quests.length - 1])} done`);
    },
  });
  const sum_ = soloSummary(rows, threshold);
  io.out(`Solo viability (${n} fights each, win >= ${threshold}% counts as soloable; enemy power = HP x (atk + matk)):`);
  for (const hs of sum_.heroes) {
    io.out(`  ${fs(roster.label(hs.heroId), 44)} soloes ${fs(hs.soloable, 3, true)}/${hs.quests}` +
      (hs.toughest ? `; toughest beaten: ${hs.toughest.quest} (${pf(hs.toughest["win%"])}%)` : "") +
      (hs.weakestFailed.length ? `; weakest failed: ${hs.weakestFailed.map((x) => `${x.quest} (${pf(x["win%"])}%)`).join(", ")}` : ""));
  }
  io.out("\nBy class (average over its heroes):");
  io.out(`  ${fs("class", 12)} ${fs("heroes", 6, true)} ${fs("soloable", 9, true)} ${fs("avg win%", 9, true)} ${fs("avg turns (wins)", 17, true)}`);
  for (const c of sum_.classes) {
    io.out(`  ${fs(c.class, 12)} ${fs(c.heroes, 6, true)} ${fx(c.soloable, 9, 1)} ${fx(c.avgWin, 9, 1)} ${fx(c.avgTurnsWins, 17, 1)}`);
  }
  return { csv: rows, csvName: `solo${o.rare ? "_rare" : ""}.csv`, floats: ["win%", "enemy_hp_removed%", "hp_left%"] };
}

/** All 5-slot multisets of unlocked skills + Basic within the AP budget (Python combinations_with_replacement order). */
export function* rotations(names: string[], costs: number[], maxAP: number): Generator<string[]> {
  const options = ["Basic", ...names];
  const cost: Record<string, number> = { Basic: 0 };
  names.forEach((nm, i) => (cost[nm] = costs[i]));
  const idx = [0, 0, 0, 0, 0];
  const m = options.length;
  while (true) {
    const combo = idx.map((i) => options[i]);
    if (sum(combo.map((c) => cost[c])) <= maxAP) yield combo;
    let i = 4;
    while (i >= 0 && idx[i] === m - 1) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < 5; j++) idx[j] = idx[i];
  }
}

/** Distinct orderings of a list, in itertools.permutations order. */
export function uniquePermutations<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  const seen = new Set<string>();
  const rec = (rest: T[], acc: T[]) => {
    if (!rest.length) {
      const key = JSON.stringify(acc);
      if (!seen.has(key)) (seen.add(key), out.push(acc));
      return;
    }
    rest.forEach((x, i) => rec([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x]));
  };
  rec(xs, []);
  return out;
}

export interface RotationResult<E extends FightEval | MapEval = FightEval> {
  rotation: string[];
  passive: string;
  ev: E;
}

export interface SkillSearch<E extends FightEval | MapEval = FightEval> {
  /** The hero as loaded, at nFinal fights (or map runs). */
  current: RotationResult<E>;
  /** Final candidates (best orderings x every passive) at nFinal fights, best score first. */
  ranked: RotationResult<E>[];
  maxAP: number;
  unlocked: { name: string; ap: number }[];
  /**
   * Candidates per stage: skill multisets, their orderings, final evaluations. With the schedule pre-filter,
   * `orderings` is the number simulated and `prefiltered` the number of AP-legal orderings it ranked.
   */
  counts: { combos: number; orderings: number; final: number; prefiltered?: number };
  /** The warm-start rotation tried (warmstart.ts); `adapted` when skills had to become Basic to fit the hero. */
  warm?: { rotation: string[]; passive: string; adapted?: boolean };
}

/** Options of searchSkills (and optimiseFight's skill steps). */
export interface SkillSearchOptions {
  nQuick?: number;
  nFinal?: number;
  top?: number;
  /**
   * Schedule pre-filter (quests, timelines loaded): rank every ordering of every AP-legal skill multiset with the
   * counter-schedule score (schedule.ts) and simulate only its top `prefilter` plus the damage-only top `prefilter`
   * (and the current rotation), instead of simulating every multiset and the orderings of the best ones.
   * Default 15 (x4 when the current rotation wins under 50 %: the score ranks lost fights poorly); 0 or false = off.
   */
  prefilter?: number | false;
  /**
   * Warm start (quests, warmstart.json loaded): the table's rotation for the hero's class, tier and this enemy is
   * always simulated and kept as a finalist (when the hero has its skills and AP). Default true.
   */
  warmStart?: boolean;
}

/**
 * The schedule pre-filter: every ordering of every multiset in `combos`, ranked by the counter-schedule score and by
 * damage only (same code, utility weights 0); returns, for both rankings, the top k orderings and the best ordering of
 * the top k skill sets, plus `keep` (when legal).
 * Null when the quest has no timeline.
 */
export function prefilterRotations(sim: Sim, h: Hero, front: Row, back: Row, t: QuestTarget, combos: string[][], k: number,
  keep?: string[], stop?: () => boolean): { picked: string[][]; total: number } | null {
  let tl;
  try {
    tl = enemyTimeline(t.quest, t.rare ?? false);
  } catch {
    return null;
  }
  const ctx = scheduleContext(t.quest, front, back, { rare: t.rare, amount: t.amount });
  const seen = new Set<string>();
  const all: string[][] = [];
  for (const combo of combos) {
    for (const p of uniquePermutations(combo)) {
      const key = p.join("|");
      if (!seen.has(key)) (seen.add(key), all.push(p));
    }
  }
  // the top k orderings, plus the best ordering of each of the top k skill sets: many orderings of one set tie, and
  // without the second list the top k can be a single set. Orderings that play the same (a skill in a slot where an
  // enemy forces Basic, Drown) count once, by the one that plans what it plays: otherwise their ties fill the top k.
  const loc = [...front.map((x, i) => [x, 2 * i + 2] as const), ...back.map((x, i) => [x, 2 * i + 1] as const)].find(([x]) => x === h)![1];
  const rank = (w: Partial<ScoreWeights>) => {
    const byPlay = new Map<string, { sc: number; p: string[]; plays: string[] }>();
    all.forEach((p, i) => {
      // stop is polled every 64 orderings (a few ms): thousands of orderings take seconds
      if (i % 64 === 0 && stop?.()) throw new SearchCancelled();
      const r = scoreSchedule(scheduleParty(sim, front, back, h, p), tl, w, ctx);
      const plays = r.played[loc], key = plays.join("|"), old = byPlay.get(key);
      if (!old || (p.join("|") === key && old.p.join("|") !== key)) byPlay.set(key, { sc: r.total, p, plays });
    });
    const scored = [...byPlay.values()].sort((a, b) => b.sc - a.sc);
    const bySet = new Map<string, string[]>();
    for (const { p, plays } of scored) {
      const set = [...plays].sort().join("|");
      if (!bySet.has(set)) bySet.set(set, p);
      if (bySet.size >= k) break;
    }
    return [...scored.slice(0, k).map(({ p }) => p), ...bySet.values()];
  };
  const picked = new Map<string, string[]>();
  for (const p of [...rank({}), ...rank(DAMAGE_ONLY)]) picked.set(p.join("|"), p);
  if (keep && seen.has(keep.join("|"))) picked.set(keep.join("|"), keep);
  return { picked: [...picked.values()], total: all.length };
}

/** The party as schedule.ts sees it (locations: back 1, 3, 5; front 2, 4, 6), with `h` playing `rotation`. */
export function scheduleParty(sim: Sim, front: Row, back: Row, h: Hero, rotation: string[]): PartyMember[] {
  const out: PartyMember[] = [];
  front.forEach((x, i) => x && out.push({ location: 2 * i + 2, rotation: x === h ? rotation : sim.rotation(x) }));
  back.forEach((x, i) => x && out.push({ location: 2 * i + 1, rotation: x === h ? rotation : sim.rotation(x) }));
  return out;
}

/**
 * Best 5-turn rotation and passive for `hero` in this party against a quest. Stage 1 scores every multiset of
 * unlocked skills within the AP budget (current passive, nQuick fights); stage 2 every ordering of the `top`
 * multisets; stage 3 the `top` orderings with every passive at nFinal fights. The hero is put back as it was.
 * If the hero is in neither row, it is added at the front of the front row.
 */
export function searchSkills(sim: Sim, hero: Hero, front: Row, back: Row, t: QuestTarget,
  o?: SkillSearchOptions, ctl?: SearchControl): SkillSearch;
export function searchSkills(sim: Sim, hero: Hero, front: Row, back: Row, t: MapTarget,
  o?: SkillSearchOptions, ctl?: SearchControl): SkillSearch<MapEval>;
export function searchSkills(sim: Sim, hero: Hero, front: Row, back: Row, t: QuestTarget | MapTarget,
  o?: SkillSearchOptions, ctl?: SearchControl): SkillSearch<FightEval | MapEval>;
export function searchSkills(sim: Sim, hero: Hero, front: Row, back: Row, t: QuestTarget | MapTarget,
  o: SkillSearchOptions = {}, ctl: SearchControl = {}): SkillSearch<FightEval | MapEval> {
  const nQuick = o.nQuick ?? 30, nFinal = o.nFinal ?? 300, top = o.top ?? 8;
  const kPre = o.prefilter === false ? 0 : o.prefilter ?? 15;
  const h = hero;
  if (!front.includes(h) && !back.includes(h)) front = [h, ...front];
  const st = stepper(ctl);
  const info = sim.skillInfo(h);
  const skills = info.skills.slice(0, info.unlocked);
  const names = skills.map((x) => x.name), costs = skills.map((x) => x.ap);
  const passives = h.level >= 10 ? info.passives : ["None"];
  const current: [string[], string] = [sim.rotation(h), h.passiveSelect];
  const ev = (n: number) => {
    st.check();
    const e = evaluateTarget(sim, t, front, back, n, 1, ctl.shouldStop);
    st.tick();
    return e;
  };
  // A passive can change the AP budget (Wisdom: +2). The game silently replaces an over-budget rotation with the
  // default one (Hero:calculateAPRemainder), so a candidate only counts if it is really applied.
  const budget = new Map<string, number>();
  for (const p of new Set([current[1], ...passives])) {
    sim.setSkills(h, ["Basic", "Basic", "Basic", "Basic", "Basic"], p);
    budget.set(p, sim.skillInfo(h).maxAP);
  }
  sim.setSkills(h, current[0], current[1]);
  const apOf = (rot: string[]) => sum(rot.map((x) => costs[names.indexOf(x)] ?? 0));
  const apply = (rot: string[], p: string) => {
    sim.setSkills(h, rot, p);
    return sim.rotation(h).join() === rot.join() && h.passiveSelect === p;
  };
  // the passive a multiset is scored with in stages 1-2: the current one if it affords it, else the widest budget
  const widest = [...budget].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const passiveFor = (rot: string[]) => (apOf(rot) <= (budget.get(current[1]) ?? info.maxAP) ? current[1] : widest);
  try {
    st.stage("current", 1);
    const base = ev(nFinal);
    // Stage 1: every multiset of skills within the largest budget, in one canonical order (scored with the
    // current passive, or the widest-budget one when the current can't afford it, unless pre-filtered).
    const combos = [...rotations(names, costs, Math.max(...budget.values()))].filter((c) => apply(c, passiveFor(c)));
    // lost fights (win < 50 %) are where the score is least reliable: keep 4x more candidates there
    const kEff = base.win < 0.5 ? kPre * 4 : kPre;
    const pre = kPre > 0 && !("map" in t) && hasTimelines() ? prefilterRotations(sim, h, front, back, t, combos, kEff, current[0], ctl.shouldStop) : null;
    let cands: string[][];
    if (pre) {
      // Pre-filter: every ordering ranked by the counter-schedule score (and damage only); simulate the top ones.
      st.stage("pre-filter", 1);
      st.tick();
      cands = pre.picked;
    } else {
      st.stage("skill sets", combos.length);
      const scored: [number, string[]][] = combos.map((combo) => {
        apply(combo, passiveFor(combo));
        return [ev(nQuick).score, combo];
      });
      scored.sort(byScoreDesc);
      // Stage 2: orderings of the best combos (rotation order matters: buffs before hits...).
      const seen = new Set<string>();
      cands = [];
      for (const [, combo] of scored.slice(0, top)) {
        for (const p of uniquePermutations(combo)) {
          const key = JSON.stringify(p);
          if (!seen.has(key)) (seen.add(key), cands.push(p));
        }
      }
    }
    // warm start: the offline table's rotation for this class, tier and enemy (if the hero can play it)
    let warm: { rotation: string[]; passive: string; adapted?: boolean } | undefined;
    if (o.warmStart !== false && !("map" in t) && hasWarmStart()) {
      const w = warmStart(h.class, h.prestigeLevel ?? 1, t.quest, t.rare ?? false);
      if (w) {
        // the table's standard hero may have other skills unlocked or another AP budget: locked skills become Basic,
        // then the most expensive skill becomes Basic until the hero affords the rotation (with its passive or the
        // table's)
        const rot = w.rotation.map((x) => (x === "Basic" || names.includes(x) ? x : "Basic"));
        const fits = () => (apply(rot, w.passive) ? w.passive : apply(rot, current[1]) ? current[1] : null);
        let passive = fits();
        while (passive === null && rot.some((x) => x !== "Basic")) {
          const i = rot.reduce((best, x, k) => (x !== "Basic" && (best < 0 || costs[names.indexOf(x)] > costs[names.indexOf(rot[best])]) ? k : best), -1);
          rot[i] = "Basic";
          passive = fits();
        }
        if (passive !== null) {
          warm = { rotation: rot, passive, ...(rot.join() !== w.rotation.join() ? { adapted: true } : {}) };
          if (!cands.some((c) => c.join() === rot.join())) cands = [...cands, rot];
        }
      }
    }
    st.stage("orderings", cands.length);
    const scored2: [number, string[]][] = cands.map((perm) => {
      apply(perm, passiveFor(perm));
      return [ev(nQuick).score, perm];
    });
    scored2.sort(byScoreDesc);
    // Stage 3: best orderings x every passive, with more fights. The current rotation is always a finalist, so the
    // result is never worse than what the hero plays (quick scores are noisy when fights differ by little).
    const finalists = scored2.slice(0, top);
    if (!finalists.some(([, r]) => r.join() === current[0].join()) && apply(current[0], current[1])) finalists.push([base.score, current[0]]);
    if (warm && !finalists.some(([, r]) => r.join() === warm!.rotation.join())) finalists.push([-Infinity, warm.rotation]);
    const pairs = finalists.flatMap(([, perm]) => passives.filter((p) => apOf(perm) <= (budget.get(p) ?? 0)).map((p) => [perm, p] as const));
    st.stage("final", pairs.length);
    const ranked: RotationResult<FightEval | MapEval>[] = [];
    for (const [perm, p] of pairs) {
      if (!apply(perm, p)) continue; // over budget for this passive: the game would play the default rotation
      ranked.push({ ev: ev(nFinal), rotation: perm, passive: p });
    }
    ranked.sort((a, b) => b.ev.score - a.ev.score);
    return {
      current: { rotation: current[0], passive: current[1], ev: base }, ranked, maxAP: info.maxAP,
      unlocked: skills.map((x) => ({ name: x.name, ap: x.ap })),
      counts: { combos: combos.length, orderings: cands.length, final: ranked.length, ...(pre ? { prefiltered: pre.total } : {}) },
      ...(warm ? { warm } : {}),
    };
  } finally {
    sim.setSkills(h, current[0], current[1]); // leave the hero as in the save
  }
}

export function cmdSkills(sim: Sim, roster: Roster,
  o: FightOpts & { hero: number; nQuick?: number; nFinal?: number; top?: number }, io: IO = consoleIO) {
  const nFinal = o.nFinal ?? 300, nQuick = o.nQuick ?? 30;
  const [front, back] = parseRows(roster, o.front, o.back);
  const res = searchSkills(sim, roster.get(o.hero), front, back, o, o, {
    onProgress: (done, total, stage) => {
      if (done !== 0) return;
      if (stage === "skill sets") io.progress(`  stage 1: ${total} skill combinations x ${nQuick} fights`);
      if (stage === "orderings") io.progress(`  stage 2: ${total} orderings x ${nQuick} fights`);
    },
  });
  io.out(`${roster.label(o.hero)} vs ${questName(o.quest)}; AP budget ${res.maxAP}; ` +
    `unlocked: ${res.unlocked.map((x) => `${x.name} (${x.ap})`).join(", ")}`);
  io.out(`  current  ${res.current.rotation.join(", ")} / ${res.current.passive}: ${fmtEval(res.current.ev)}`);
  io.out(`  best rotations (${nFinal} fights each):`);
  for (const f of res.ranked.slice(0, 5)) io.out(`    ${fs(f.rotation.join(", "), 60)} / ${fs(f.passive, 20)} ${fmtEval(f.ev)}`);
  return { current: res.current, best: res.ranked.slice(0, 5) };
}

export interface GearOpts extends FightOpts {
  hero: number;
  pool?: "owned" | "catalog";
  itemGrade?: number;
  asc?: number;
  crafterLevel?: number;
  levelWindow?: number;
  passes?: number;
}

/** A gear candidate: [where it comes from, compact save string or engine item]. */
export type GearCandidate = [label: string, item: string | Any];

/** Catalog items (no prefix/suffix) usable by `h`, within `levelWindow` levels below it, rolled with seed 1. */
export function catalogGearCandidates(sim: Sim, h: Hero,
  o: { itemGrade?: number; asc?: number; crafterLevel?: number; levelWindow?: number } = {}): Map<number, GearCandidate[]> {
  const cands = new Map<number, GearCandidate[]>();
  const grade = o.itemGrade ?? 5, asc = o.asc ?? 0;
  for (const [iid, it] of Object.entries<Any>(G.itemData.equipment)) {
    if (!it || typeof it !== "object" || !it.itemSlot || (it.itemLevel ?? 99) > h.level) continue;
    if ((it.itemLevel ?? 0) < h.level - (o.levelWindow ?? 15)) continue;
    const item = sim.makeItem(Number(iid), grade, asc, o.crafterLevel ?? 60, 1);
    cands.set(it.itemSlot, [...(cands.get(it.itemSlot) ?? []), [`${it.name} (catalog, grade ${grade}, asc ${asc})`, item]]);
  }
  return cands;
}

/** Items owned in the save (inventory, sale slots, worn by other heroes than `heroId`), by slot. */
export function ownedGearCandidates(save: Save, heroId: number): Map<number, GearCandidate[]> {
  const cands = new Map<number, GearCandidate[]>();
  const add = (slot: number, c: GearCandidate) => cands.set(slot, [...(cands.get(slot) ?? []), c]);
  for (const [where, items] of [["inventory", save.inventory], ["sale slot", save.sales.filter(Boolean)]] as const) {
    for (const it of items) if (it.itemType === "equipment" && it.itemSlot) add(it.itemSlot, [where, it.compact]);
  }
  for (const raw of save.raw.hero ?? []) {
    if (raw.id === heroId) continue;
    for (const it of raw.heroInventory ?? []) {
      if (typeof it === "string") add(Number.parseInt(it.split("|")[3], 10), [`worn by #${raw.id} ${raw.name ?? ""}`, it]);
    }
  }
  return cands;
}

/** {slot: [[label, item]]} from the chosen pool, usable at the hero's level. Items are compact strings or engine items. */
export function gearCandidates(sim: Sim, roster: Roster, h: Hero, o: GearOpts): Map<number, GearCandidate[]> {
  return (o.pool ?? "owned") === "catalog" ? catalogGearCandidates(sim, h, o) : ownedGearCandidates(roster.save, o.hero);
}

export const SLOT_NAMES: Record<number, string> = { 1: "weapon", 2: "head", 3: "body", 4: "hands", 5: "feet", 6: "trinket" };

export interface GearSearch<E extends FightEval | MapEval = FightEval> {
  base: E;
  final: E;
  /** Slots 1..6: the item kept or chosen. `from` is the candidate label, null when the hero keeps its item. */
  gear: { slot: number; slotName: string; item: string | undefined; from: string | null }[];
  /** Fights evaluated (candidates x passes). */
  evaluated: number;
}

/**
 * Best gear for `hero` in this party against a quest: per slot, every candidate is tried and kept if it raises the
 * score (n fights, same seeds); repeated for `passes` passes or until nothing improves. The hero gets its own gear
 * back at the end. If the hero is in neither row, it is added at the front of the front row.
 */
export function searchGear(sim: Sim, hero: Hero, front: Row, back: Row, t: QuestTarget, cands: Map<number, GearCandidate[]>,
  o?: { n?: number; passes?: number }, ctl?: SearchControl): GearSearch;
export function searchGear(sim: Sim, hero: Hero, front: Row, back: Row, t: MapTarget, cands: Map<number, GearCandidate[]>,
  o?: { n?: number; passes?: number }, ctl?: SearchControl): GearSearch<MapEval>;
export function searchGear(sim: Sim, hero: Hero, front: Row, back: Row, t: QuestTarget | MapTarget,
  cands: Map<number, GearCandidate[]>, o?: { n?: number; passes?: number }, ctl?: SearchControl): GearSearch<FightEval | MapEval>;
export function searchGear(sim: Sim, hero: Hero, front: Row, back: Row, t: QuestTarget | MapTarget,
  cands: Map<number, GearCandidate[]>, o: { n?: number; passes?: number } = {}, ctl: SearchControl = {}): GearSearch<FightEval | MapEval> {
  const n = o.n ?? 60;
  const h = hero;
  if (!front.includes(h) && !back.includes(h)) front = [h, ...front];
  const st = stepper(ctl);
  let evaluated = 0;
  // An item that lowers the AP budget makes the game reset the hero to its default rotation and passive
  // (Hero:calculateAPRemainder); every candidate is scored with the hero's own rotation put back (reset again only if
  // that candidate really can't afford it), and the hero leaves the search with it.
  const rotation = sim.rotation(h), passive = h.passiveSelect;
  const ev = () => {
    st.check();
    sim.setSkills(h, rotation, passive);
    const e = evaluateTarget(sim, t, front, back, n, 1, ctl.shouldStop);
    evaluated++;
    st.tick();
    return e;
  };
  const original = h.heroInventory.slice(); // empty slots included: restore exactly what was there
  const perPass = [1, 2, 3, 4, 5, 6].reduce((acc, slot) => acc + (cands.get(slot)?.length ?? 0), 0);
  try {
    st.stage("current", 1);
    const base = ev();
    let bestScore = base.score;
    const chosen = new Map<number, string>();
    for (let pass = 0; pass < (o.passes ?? 2); pass++) {
      st.stage(`pass ${pass + 1}`, perPass);
      let improved = false;
      for (let slot = 1; slot <= 6; slot++) {
        const current = h.heroInventory[slot];
        let best: [number, string, Any] | null = null;
        for (const [label, item] of cands.get(slot) ?? []) {
          if (typeof item === "string") sim.equip(h, slot, item);
          else sim.equipItem(h, slot, item);
          if (h.heroInventory[slot].itemLevel > h.level) {
            sim.equipItem(h, slot, current);
            st.tick();
            continue;
          }
          const sc = ev().score;
          if (sc > bestScore + 1e-9 && (best === null || sc > best[0])) best = [sc, label, h.heroInventory[slot]];
        }
        if (best) {
          bestScore = best[0];
          sim.equipItem(h, slot, best[2]);
          chosen.set(slot, best[1]);
          improved = true;
        } else sim.equipItem(h, slot, current);
      }
      if (!improved) break;
    }
    st.stage("final", 1);
    const final = ev();
    const gear = [1, 2, 3, 4, 5, 6].map((slot) => {
      const it = h.heroInventory[slot];
      return { slot, slotName: SLOT_NAMES[slot], item: it?.name as string | undefined, from: chosen.get(slot) ?? null,
      };
    });
    return { base, final, gear, evaluated };
  } finally {
    h.heroInventory = original;
    h.determineStats();
    sim.setSkills(h, rotation, passive);
  }
}

export function cmdGear(sim: Sim, roster: Roster, o: GearOpts, io: IO = consoleIO) {
  const h = roster.get(o.hero);
  const [front, back] = parseRows(roster, o.front, o.back);
  const res = searchGear(sim, h, front, back, o, gearCandidates(sim, roster, h, o), o);
  io.out(`${roster.label(o.hero)} vs ${questName(o.quest)}, pool ${o.pool ?? "owned"}`);
  io.out(`  current gear: ${fmtEval(res.base)}`);
  io.out(`  best gear:    ${fmtEval(res.final)}`);
  for (const g of res.gear) io.out(`    ${fs(g.slotName, 8)} ${g.item}${g.from ? `  <- ${g.from}` : "  (keep)"}`);
  roster.reload(o.hero);
  return { base: res.base, final: res.final, gear: res.gear.map((g) => ({ slot: g.slotName, item: g.item, from: g.from })) };
}

export interface MapOpts {
  map: string;
  asc?: number;
  mapGrade?: number;
  prefix?: number;
  suffix?: number;
  scrolls?: string | null;
  front?: string | null;
  back?: string | null;
  n?: number;
}

const mapSpecOf = (roster: Roster, o: MapOpts) => parseMap(roster, o.map, o.asc ?? 0, o.mapGrade ?? 3, o.prefix ?? 0, o.suffix ?? 0);

export function cmdMap(sim: Sim, roster: Roster, o: MapOpts, io: IO = consoleIO): MapEval {
  const n = o.n ?? 100;
  const [front, back] = parseRows(roster, o.front, o.back);
  const [spec, label] = mapSpecOf(roster, o);
  const scrolls = parseScrolls(o.scrolls);
  const m = sim.makeMap(spec, 1);
  io.out(`${m.name} (asc ${m.prestigeLevel}, enemy mod ${m.enemyMod}), ${label}, ${n} runs, scrolls: ${scrollNames(scrolls)}`);
  const ev = evaluateMap(sim, spec, front, back, n, 1, scrolls);
  io.out("  " + fmtMap(ev));
  if (scrolls) {
    const used = ev.charges_used.map(([k, v]) => `${G.itemData.consumable[k].name} ${fx(v, 0, 2)}`).join(", ");
    io.out(`  scroll charges used per run: ${used || "none"}; escaped ${fx((100 * ev.escaped), 0, 0)}% of runs`);
  }
  if (ev.errors) io.out(`  ${ev.errors} runs crashed in the game code: ${ev.error}`);
  const fails = Object.entries(ev.fail_room);
  if (fails.length) io.out("  lost at: " + fails.slice(0, 6).map(([k, v]) => `${k} ${fx((100 * v / n), 0, 0)}%`).join(", "));
  printPartyDetail(ev, "run", io);
  return ev;
}

/** One map at one ascension in the survey (a row of maps_survey.csv). */
export interface MapSurveyRow {
  map_id: number;
  map: string;
  asc: number;
  level: number;
  "win%": number;
  "progress%": number;
  grade: number;
  time_h: number;
  essence_per_run: number | string;
  essence: string;
  essence_per_hour: number;
  loot_value_per_run: number;
  loot_value_per_hour: number;
  lost_at: string;
  game_errors: number;
  game_error: string;
}

/** A survey entry: the row and its MapEval, or the game error that made every run fail. */
export interface MapSurveyEntry {
  mapId: number;
  name: string;
  asc: number;
  row?: MapSurveyRow;
  ev?: MapEval;
  error?: string;
}

/** Maps the survey covers: every map with a boss, without the level-70 ones unless `include70`. */
export function surveyMapIds(include70 = false): number[] {
  return Object.entries<Any>(G.itemData.map).map(([k, m]) => [Number(k), m] as const).sort((a, b) => a[0] - b[0])
    .filter(([, m]) => m.bossList && Object.keys(m.bossList).length)
    // level-70 maps (ids 27-32) can't be crafted: crafters cap at level 60
    .filter(([, m]) => !((m.itemLevel ?? 0) > 60 && !include70)).map(([id]) => id);
}

/** Every map (asc 0 and 1) with one party: win rate, progress, grade, time, essence and loot per hour. */
export function surveyMaps(sim: Sim, front: Row, back: Row,
  o: { n?: number; mapGrade?: number; scrolls?: Scroll[] | null; include70?: boolean } = {}, ctl: SearchControl = {}): MapSurveyEntry[] {
  const n = o.n ?? 20;
  const st = stepper(ctl);
  const ids = surveyMapIds(o.include70);
  st.stage("maps", ids.length * 2);
  const out: MapSurveyEntry[] = [];
  for (const mid of ids) {
    const m = G.itemData.map[mid];
    for (const asc of [0, 1]) {
      st.check();
      const spec = { id: mid, prestigeLevel: asc, grade: o.mapGrade ?? 3 };
      let ev: MapEval;
      try {
        ev = evaluateMap(sim, spec, front, back, n, 1, o.scrolls ? o.scrolls.map((x) => ({ ...x })) : null);
      } catch (e) {
        if (String(e).includes("not ported")) throw e;
        out.push({ mapId: mid, name: m.name, asc, error: (e as Error).message });
        st.tick();
        continue;
      }
      const essTotal = sum(Object.values(ev.essence));
      const row: MapSurveyRow = { map_id: mid, map: m.name, asc, level: m.itemLevel,
        "win%": r(100 * ev.win, 1), "progress%": r(100 * ev.cleared, 1),
        grade: r(ev.grade, 2), time_h: r(ev.time_h, 2),
        // sum() of no essence is the int 0 in Python, a float otherwise
        essence_per_run: Object.keys(ev.essence).length ? r(essTotal, 1) : "0", essence: Object.keys(ev.essence).join(", "),
        essence_per_hour: ev.time_h ? r(essTotal / ev.time_h, 1) : 0,
        loot_value_per_run: r(ev.loot_value),
        loot_value_per_hour: ev.time_h ? r(ev.loot_value / ev.time_h) : 0,
        lost_at: Object.keys(ev.fail_room).slice(0, 2).join(", "),
        game_errors: ev.errors, game_error: ev.error };
      out.push({ mapId: mid, name: m.name, asc, row, ev });
      st.tick();
    }
  }
  return out;
}

/** Survey every map (asc 0 and 1) with one party (Python wrote reports/maps_survey.csv). */
export function cmdMaps(sim: Sim, roster: Roster,
  o: { front?: string | null; back?: string | null; n?: number; mapGrade?: number; scrolls?: string | null; include70?: boolean },
  io: IO = consoleIO) {
  const n = o.n ?? 20;
  const [front, back] = parseRows(roster, o.front, o.back);
  const entries = surveyMaps(sim, front, back, { n, mapGrade: o.mapGrade, scrolls: parseScrolls(o.scrolls), include70: o.include70 });
  const rows: MapSurveyRow[] = [];
  for (const e of entries) {
    if (!e.row) {
      io.out(`  ${fs(e.name, 26)} asc ${e.asc}: game error - ${e.error}`);
      continue;
    }
    const row = e.row;
    rows.push(row);
    io.out(`  ${fs(e.name, 26)} asc ${e.asc}: win ${fx(row["win%"], 5, 1)}%  progress ${fx(row["progress%"], 5, 1)}%  ` +
      `grade ${fx(row.grade, 0, 2)}  ${fx(row.essence_per_hour, 7, 1)} essence/h  ` +
      `${fs(row.loot_value_per_hour, 6, true)} g loot/h` + (row.lost_at ? `  lost at ${row.lost_at}` : "") +
      (row.game_errors ? `  [${row.game_errors}/${n} runs crashed in game code]` : ""));
  }
  return { csv: rows, csvName: "maps_survey.csv", floats: ["win%", "progress%", "time_h", "essence_per_run", "essence_per_hour"] };
}

/** Every loadout of 0 to `slots` scrolls from `pool` (combinations with repetition, smallest first). */
export function scrollLoadouts(pool: number[] = SCROLL_IDS, slots = 3): number[][] {
  const loadouts: number[][] = [[]];
  for (let k = 1; k <= slots; k++) {
    const rec = (start: number, acc: number[]) => {
      if (acc.length === k) return void loadouts.push(acc);
      for (let i = start; i < pool.length; i++) rec(i, [...acc, pool[i]]);
    };
    rec(0, []);
  }
  return loadouts;
}

/** The solved profit model per loaded game data (solving takes 0.5-2 s and can't be interrupted: once). */
const solvers = new WeakMap<object, ReturnType<Solver["solve"]>>();

/** Crafted cost of each scroll (profit solver at grade 3); `error` when the solver can't price them (prices are then 0). */
export function scrollPrices(pool: number[] = SCROLL_IDS, scrollAsc = 0): { prices: Record<number, number>; error?: string } {
  try {
    let solver = solvers.get(G.itemData);
    if (!solver) solvers.set(G.itemData, solver = new Solver(gameFromData()).solve());
    return { prices: Object.fromEntries(pool.map((sid) => [sid, solver.get("consumable", sid, scrollAsc)])) };
  } catch (e) {
    return { prices: Object.fromEntries(pool.map((sid) => [sid, 0])), error: (e as Error).message };
  }
}

export interface ScrollLoadout {
  /** Scroll ids (empty = no scrolls). */
  loadout: number[];
  ev: MapEval;
  /** Crafted cost of the loadout (sum of scroll prices). */
  cost: number;
}

/**
 * Best loadout of up to 3 scrolls for one map and party: stage 1 scores every loadout (nQuick runs), stage 2
 * re-runs the `top` ones and "no scrolls" with nFinal runs. `prices`: cost per scroll id (default: profit solver).
 */
export function searchScrolls(sim: Sim, spec: MapSpec, front: Row, back: Row,
  o: { pool?: number[]; scrollAsc?: number; nQuick?: number; nFinal?: number; top?: number; prices?: Record<number, number> } = {},
  ctl: SearchControl = {}): { ranked: ScrollLoadout[]; priceError?: string } {
  const nQuick = o.nQuick ?? 10, nFinal = o.nFinal ?? 100, top = o.top ?? 8, scrollAsc = o.scrollAsc ?? 0;
  const pool = o.pool ?? SCROLL_IDS;
  const st = stepper(ctl);
  const loadouts = scrollLoadouts(pool);
  const priced = o.prices ? { prices: o.prices } : scrollPrices(pool, scrollAsc);
  const asScrolls = (lo: number[]) => (lo.length ? lo.map((id) => ({ id, prestigeLevel: scrollAsc })) : null);
  const run = (lo: number[], n: number) => {
    st.check();
    const e = evaluateMap(sim, spec, front, back, n, 1, lo.length ? asScrolls(lo) : null, ctl.shouldStop);
    st.tick();
    return e;
  };
  st.stage("loadouts", loadouts.length);
  const scored: [number, number[]][] = loadouts.map((lo) => [run(lo, nQuick).score, lo]);
  scored.sort(byScoreDesc);
  const best = scored.slice(0, top).map(([, lo]) => lo);
  const withNone = best.some((lo) => lo.length === 0) ? best : [...best, []];
  st.stage("final", withNone.length);
  const ranked: ScrollLoadout[] = withNone.map((lo) => ({ loadout: lo, ev: run(lo, nFinal),
    cost: sum(lo.map((sid) => priced.prices[sid] ?? 0)) }));
  ranked.sort((a, b) => b.ev.score - a.ev.score);
  return { ranked, ...(priced.error ? { priceError: priced.error } : {}) };
}

/** Best loadout of up to 3 scrolls for one map and party. `prices`: crafted cost per scroll id (optional). */
export function cmdScrolls(sim: Sim, roster: Roster,
  o: MapOpts & { pool?: string; scrollAsc?: number; nQuick?: number; nFinal?: number; top?: number; prices?: Record<number, number> },
  io: IO = consoleIO) {
  const nQuick = o.nQuick ?? 10, nFinal = o.nFinal ?? 100, scrollAsc = o.scrollAsc ?? 0;
  const [front, back] = parseRows(roster, o.front, o.back);
  const [spec, label] = mapSpecOf(roster, o);
  const pool = o.pool ? o.pool.split(",").map(toInt) : SCROLL_IDS;
  const res = searchScrolls(sim, spec, front, back, { ...o, pool }, {
    onProgress: (done, total, stage) => {
      if (done === 0 && stage === "loadouts") io.progress(`  stage 1: ${total} loadouts x ${nQuick} runs`);
    },
  });
  if (res.priceError) io.progress(`  (no scroll prices: ${res.priceError})`);
  io.out(`Best scroll loadouts for ${label} (${nFinal} runs each):`);
  for (const { ev, loadout, cost } of res.ranked) {
    const name = loadout.length ? scrollNames(loadout.map((id) => ({ id, prestigeLevel: scrollAsc }))) : "no scrolls";
    const ess = sum(Object.values(ev.essence));
    io.out(`  ${fs(name, 55)} cost ${fx(cost, 6)} g  win ${pct(ev.win)}%  progress ${pct(ev.cleared)}%  ` +
      `grade ${fx(ev.grade, 0, 2)}  essence/run ${fx(ess, 6, 1)}  loot ${fx(ev.loot_value, 6)} g  ` +
      `time ${fx(ev.time_h, 0, 2)} h  escaped ${fx((100 * ev.escaped), 0, 0)}%`);
  }
  return res.ranked.map(({ ev, loadout }) => ({ ev, loadout }));
}

/** Hero ids by slot: front[0..2], back[0..2], null = empty. */
export interface PartyLayout {
  front: (number | null)[];
  back: (number | null)[];
}

export interface PartySearch {
  party: PartyLayout;
  /** The final party at nFinal fights / runs. */
  ev: FightEval | MapEval;
  /** Greedy additions in order: hero id, slot ("front 1" ...), score after adding it (nQuick). */
  added: { heroId: number; slot: string; score: number }[];
  /** Local-search improvements (swap a hero in, or move one to an empty slot). */
  improvements: number;
}

/**
 * Best party from `pool` (hero id -> hero, in priority order) for a quest or a map: greedily add the hero + slot
 * that raises the score most (nQuick) until `size` heroes or no gain, then swap/move heroes while it helps;
 * the result is evaluated with nFinal. Progress stages: "add 1".."add N" (one tick per hero x slot tried), then
 * "improve" (one tick per swap or move tried; its total is the number of options for the current slot).
 * `lock`: heroes that must be in the party (placed first, may move, never swapped out). With a quest amount above 1,
 * parties whose highest prestige can't take it are skipped; it throws only if no legal party exists. The game's
 * layout rules (partyRules) hold: the size is capped at the quest's party size, a required slot (front 2 in a party
 * quest, front 1 in a solo quest) is filled first and never emptied.
 */
export function searchParty(sim: Sim, pool: Map<number, Hero>, t: QuestTarget | MapTarget,
  o: { size?: number; nQuick?: number; nFinal?: number; lock?: number[] } = {}, ctl: SearchControl = {}): PartySearch {
  const nQuick = o.nQuick ?? 40, nFinal = o.nFinal ?? 500;
  const lock = [...new Set(o.lock ?? [])];
  for (const id of lock) if (!pool.has(id)) throw new Error(`locked hero ${id} is not in the pool`);
  const rules = partyRules(t);
  if (lock.length > rules.maxSize) throw new Error(`at most ${rules.maxSize} heroes can be locked for this ${rules.kind === "map" ? "map" : "quest"}`);
  const size = Math.min(Math.max(o.size ?? 6, lock.length), rules.maxSize);
  const ids = [...pool.keys()];
  const st = stepper(ctl);
  const slots = ["front:0", "front:1", "front:2", "back:0", "back:1", "back:2"];
  const placed = new Map<string, number>(); // "row:i" -> hero id
  const used = () => new Set(placed.values());
  const rows = (): [Row, Row] => {
    const row = (name: string) => [0, 1, 2].map((i) => (placed.has(`${name}:${i}`) ? pool.get(placed.get(`${name}:${i}`)!)! : null));
    return [row("front"), row("back")];
  };
  const evOf = (n: number): FightEval | MapEval => {
    st.check();
    const [front, back] = rows();
    const e = "map" in t
      ? evaluateMap(sim, t.map, front, back, n, 1, t.scrolls ? t.scrolls.map((x) => ({ ...x })) : null)
      : evaluate(sim, t.quest, front, back, n, t.rare, t.amount);
    st.tick();
    return e;
  };
  const slotLabel = (x: string) => `${x.split(":")[0]} ${Number(x.split(":")[1]) + 1}`;
  const added: PartySearch["added"] = [];
  // A quest amount above 1 needs a hero of high enough prestige in the party (maxQuestAmount): parties without one
  // are skipped instead of evaluated (evaluate refuses them).
  const amount = "map" in t ? 1 : t.amount ?? 1;
  // The game's layout rules (partyRules: a required front 2, a solo quest's front 1) are checked the same way.
  const legal = () => (amount <= 1 || amount <= maxQuestAmount([...used()].map((id) => pool.get(id)), Boolean((t as QuestTarget).rare), sim.mode)) &&
    !partyProblem(t, ...rows());

  // Greedy: add the hero + slot that improves the score most, until the party is full or another hero stops
  // helping. Locked heroes go in first (best slot each, in the order given), whatever the score.
  let best: number | null = null;
  for (let step = 0; step < size; step++) {
    const lockLeft = lock.filter((hid) => !used().has(hid));
    const cands = lockLeft.length ? [lockLeft[0]] : ids.filter((hid) => !used().has(hid));
    st.stage(`add ${step + 1}`, cands.length * slots.filter((x) => !placed.has(x)).length);
    let candBest: [number, number, string] | null = null;
    for (const hid of cands) {
      for (const slot of slots) {
        if (placed.has(slot)) continue;
        placed.set(slot, hid);
        // an illegal party (amount) can't be scored: while locked heroes are placed, any slot will do
        const sc = legal() ? evOf(nQuick).score : lockLeft.length ? -Infinity : null;
        placed.delete(slot);
        if (sc !== null && (candBest === null || sc > candBest[0])) candBest = [sc, hid, slot];
      }
    }
    if (candBest === null) {
      if (best === null && !lockLeft.length) {
        throw new Error(`no party from these heroes can take quest amount ${amount}: it needs a hero of prestige ` +
          `${Math.ceil((amount + 1) / 2)} or more`);
      }
      break;
    }
    const mustAdd = lockLeft.length > 0 || best === null || best === -Infinity;
    if (!mustAdd && candBest[0] <= best! + 1e-9) break;
    best = candBest[0];
    placed.set(candBest[2], candBest[1]);
    added.push({ heroId: candBest[1], slot: slotLabel(candBest[2]), score: candBest[0] });
  }

  if (!legal()) throw new Error(partyProblem(t, ...rows()) ?? `no party with these locked heroes can take quest amount ${amount}`);

  // Local search: replace a placed hero by an unused one, or move a hero to an empty slot.
  let improvements = 0;
  let improved = true;
  while (improved) {
    improved = false;
    st.stage("improve", 1);
    let base = evOf(nQuick).score;
    for (const slot of [...placed.keys()]) {
      const cur = placed.get(slot)!;
      const options: ["swap" | "move", Any][] = [
        // locked heroes may move but not leave
        ...(lock.includes(cur) ? [] : ids.filter((hid) => !used().has(hid)).map((hid) => ["swap", hid] as ["swap", number])),
        ...slots.filter((s2) => !placed.has(s2)).map((s2) => ["move", s2] as ["move", string]),
      ];
      st.stage("improve", options.length);
      for (const [kind, x] of options) {
        if (kind === "swap") placed.set(slot, x);
        else (placed.delete(slot), placed.set(x, cur));
        const sc = legal() ? evOf(nQuick).score : -Infinity;
        if (sc > base + 1e-9) {
          base = sc;
          improved = true;
          improvements++;
          break;
        }
        if (kind === "swap") placed.set(slot, cur);
        else (placed.delete(x), placed.set(slot, cur));
      }
      if (improved) break;
    }
  }

  st.stage("final", 1);
  const ev = evOf(nFinal);
  const party: PartyLayout = {
    front: [0, 1, 2].map((i) => placed.get(`front:${i}`) ?? null),
    back: [0, 1, 2].map((i) => placed.get(`back:${i}`) ?? null),
  };
  return { party, ev, added, improvements };
}

export function cmdParty(sim: Sim, roster: Roster,
  o: Partial<MapOpts> & { quest?: number; rare?: boolean; amount?: number; heroes?: string; size?: number; nQuick?: number; nFinal?: number },
  io: IO = consoleIO) {
  const nFinal = o.nFinal ?? 500;
  if (!o.map && o.quest === undefined) throw new Error("party needs a quest or a map");
  const pool = new Map(roster.ids(o.heroes ?? "all").map((hid) => [hid, roster.get(hid)] as const));
  const target: QuestTarget | MapTarget = o.map
    ? { map: mapSpecOf(roster, o as MapOpts)[0], scrolls: parseScrolls(o.scrolls) }
    : { quest: o.quest!, rare: o.rare, amount: o.amount };
  const res = searchParty(sim, pool, target, o);
  for (const a of res.added) io.progress(`  + ${roster.label(a.heroId)} in ${a.slot}`);
  const target_ = o.map ? `map ${o.map}` : questName(o.quest!);
  io.out(`Best party found for ${target_} (${nFinal} ${o.map ? "runs" : "fights"}):`);
  const party: Record<string, (number | null)[]> = { front: res.party.front, back: res.party.back };
  for (const row of ["front", "back"]) {
    io.out(`  ${fs(row, 5)}: ` + party[row].map((hid) => (hid !== null ? roster.label(hid) : "-")).join(" | "));
  }
  if (o.map) {
    io.out("  " + fmtMap(res.ev as MapEval));
    printPartyDetail(res.ev, "run", io);
  } else {
    io.out("  " + fmtEval(res.ev as FightEval));
    printPartyDetail(res.ev, "fight", io);
  }
  return { party, ev: res.ev };
}

// ---------------------------------------------------------------- CSV
/** CSV as Python's csv.DictWriter writes it; `floats`: columns that were Python floats (100 -> "100.0"). */
export function toCsv(rows: Record<string, unknown>[], floats: string[] = []): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const fl = new Set(floats);
  const cell = (v: unknown, k: string) => {
    const s = v === null || v === undefined ? "" : typeof v === "number" && fl.has(k) ? pf(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((row) => keys.map((k) => cell(row[k], k)).join(","))].join("\r\n") + "\r\n";
}
