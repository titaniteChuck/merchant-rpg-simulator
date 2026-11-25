/**
 * Traced fights, action by action (U39), for the battle page's flow diagram: who acts, what it planned and what it
 * really played, the damage and healing each fighter took, and the effects on every fighter afterwards. It runs the
 * same fight as Simulate's first one (seed fightSeed(1, 0)), or the same map run as the Map run mode's first one, and
 * changes nothing in the engine: the trace only reads.
 */
import { type TraceEffect, type TraceEntry, type TraceHit, type TraceLife, traceStart, traceStop } from "../sim/api.ts";
import { fightSeed } from "./combat.ts";
import type { MapSpec, Row, Scroll, Sim } from "./engine.ts";

export interface FightAction {
  /** Turn of the fight (1-based) and the action's place in it (0-based, in action order). */
  turn: number;
  order: number;
  /** 0 = the enemy, 1-6 = party location (back 1, front 1, back 2 …). */
  who: number;
  /** The rotation's skill for this turn. */
  planned: string;
  /** What it really played: a skill, false when its action was taken (stun), null when it was dead. */
  did: string | false | null;
  hits: TraceHit[];
  /** The effects on every fighter after the action. */
  fx: TraceEffect[];
  misses: number;
  /** Every fighter's HP and max HP after the action (0 = the enemy); U65: and its live stats. */
  life: TraceLife[];
}

export interface FightTrace {
  won: boolean;
  /** Turns the fight lasted. */
  turns: number;
  actions: FightAction[];
  /** U65: every fighter as the fight began, before any action (turn 0): HP, max HP, stats, effects. */
  start?: { life: TraceLife[]; fx: TraceEffect[] };
}

/** Trace entries as actions, numbered within their turn. */
function actionsOf(entries: TraceEntry[]): FightAction[] {
  const actions: FightAction[] = [];
  let turn = 0, order = 0;
  for (const e of entries) {
    if (e.turn !== turn) {
      turn = e.turn;
      order = 0;
    }
    actions.push({ turn: e.turn, order: order++, who: e.who, planned: e.act, did: e.did === undefined ? e.act : e.did,
      hits: e.hits ?? [], fx: e.fx ?? [], misses: e.misses ?? 0, life: e.life ?? [] });
  }
  return actions;
}

/** Run `f` with the trace on; the entries it recorded. */
function traced<T>(f: () => T): [T, TraceEntry[]] {
  traceStart();
  let res: T;
  try {
    res = f();
  } catch (e) {
    traceStop();
    throw e;
  }
  return [res, traceStop()];
}

/** Trace one fight against a quest enemy (the first of Simulate's fights unless `seed` says otherwise). */
export function traceFight(sim: Sim, quest: number, front: Row, back: Row, o: { rare?: boolean; amount?: number; seed?: number } = {}): FightTrace {
  const [res, entries] = traced(() => sim.fight(quest, front, back, { seed: o.seed ?? fightSeed(1, 0), isRare: o.rare ?? false, amount: o.amount ?? 1 }));
  return { won: res.won, turns: res.turns, actions: actionsOf(entries), ...(entries[0]?.start ? { start: entries[0].start } : {}) };
}

/** One room of a traced map run, in map order. */
export interface MapRoomTrace {
  questId: number;
  name: string;
  isRare: boolean;
  /** The map's boss (always its last room). */
  boss: boolean;
  /** 0 not reached, 1 won, 2 lost (the Campaign's combat status). */
  status: number;
  /** The room's fight, from the party's real state when it began (HP carries over); null when not reached. */
  trace: FightTrace | null;
}

/**
 * Trace one map run (the first of the Map run mode's runs unless `seed` says otherwise): every room in map order,
 * each fought room with its own fight, as the run played it.
 */
export function traceMapRun(sim: Sim, spec: MapSpec, front: Row, back: Row, o: { scrolls?: Scroll[] | null; seed?: number } = {}): MapRoomTrace[] {
  const [res, entries] = traced(() => sim.mapRun(spec, front, back, o.seed ?? fightSeed(1, 0), o.scrolls));
  const byBattle = new Map<number, TraceEntry[]>();
  for (const e of entries) {
    const k = e.battle ?? 0;
    if (!byBattle.has(k)) byBattle.set(k, []);
    byBattle.get(k)!.push(e);
  }
  // The rooms are fought in map order, one battle each, so battle k is room k (a room not reached has none).
  const fought = [...byBattle.keys()].sort((a, b) => a - b);
  return res.combats.map((c, k): MapRoomTrace => {
    const es = c.status ? byBattle.get(fought[k]) : undefined;
    const last = es?.[es.length - 1];
    return { questId: Number(c.questId), name: c.name, isRare: c.isRare, boss: k === res.combats.length - 1, status: c.status,
      trace: es ? { won: c.status === 1, turns: last?.turn ?? 0, actions: actionsOf(es), ...(es[0].start ? { start: es[0].start } : {}) } : null };
  });
}
