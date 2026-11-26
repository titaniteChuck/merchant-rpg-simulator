/**
 * U70: the Battle Simulator's automatic runs. Every change that matters to the fight runs WORST_RUNS traced fights (or
 * map runs) with the seeds Simulate used (fightSeed(1, 0..n-1)); the page draws one of them in its chart and cards
 * (U74: the run the picker asks for, Worst / Random / Best, Random being the first run and the default; U70 drew the
 * worst), and four figures over all of them (win rate, grade when won, heroes dead, life left: over every run).
 *
 * Pure parts (outcomeOfFight, outcomeOfMap, compareRuns, worstRun, bestRun, pickedRun, parsePick, runStats,
 * gradeLetter) apart from the runner
 * (traceWorst), so tests check the ordering and the figures without the engine.
 */
import { fightSeed } from "./combat.ts";
import type { FightResult, HeroResult, MapRunResult, MapSpec, Row, Scroll, Sim } from "./engine.ts";
import { type FightTrace, type MapRoomTrace, traceFightRun, traceMapRunResult } from "./fight-trace.ts";

/** How many runs each change makes. */
export const WORST_RUNS = 20;

/** What one run came to, for the ordering and the figures. */
export interface RunOutcome {
  won: boolean;
  /** Rooms cleared (a quest: 1 when won, else 0). */
  rooms: number;
  /** Turns fought in all (a map run: every room's). */
  turns: number;
  /** The run's grade (1 = D … 5 = S); only a win's counts. */
  grade: number;
  /** Heroes down at the end. */
  dead: number;
  /** Each hero still standing at the end: its HP left, a share of its max HP. */
  alive: number[];
}

const down = (h: HeroResult) => h.dead || h.hp <= 0;
const heroesOf = (heroes: HeroResult[]) => ({
  dead: heroes.filter(down).length,
  alive: heroes.filter((h) => !down(h)).map((h) => (h.maxHP > 0 ? Math.max(0, Math.min(1, h.hp / h.maxHP)) : 0)),
});

/** A quest fight's outcome from the engine's result. */
export function outcomeOfFight(res: Pick<FightResult, "won" | "turns" | "grade" | "heroes">): RunOutcome {
  return { won: res.won, rooms: res.won ? 1 : 0, turns: res.turns, grade: res.grade, ...heroesOf(res.heroes) };
}

/** A map run's outcome from the engine's result. */
export function outcomeOfMap(res: Pick<MapRunResult, "won" | "cleared" | "grade" | "heroes" | "combats">): RunOutcome {
  const turns = res.combats.reduce((a, c) => a + (c.turns ?? 0), 0);
  return { won: res.won, rooms: res.cleared, turns, grade: res.grade, ...heroesOf(res.heroes) };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** The standing heroes' average HP left (0 when nobody stands). */
const lifeOf = (o: RunOutcome) => (o.alive.length ? mean(o.alive) : 0);

/**
 * Negative when `a` is the worse run. A loss is worse than any win; among losses, the one that ends earliest (fewer
 * rooms cleared, then fewer turns); among wins, the lower grade. Then more heroes down, then less HP left on the
 * heroes still standing.
 */
export function compareRuns(a: RunOutcome, b: RunOutcome): number {
  if (a.won !== b.won) return a.won ? 1 : -1;
  if (!a.won) {
    if (a.rooms !== b.rooms) return a.rooms - b.rooms;
    if (a.turns !== b.turns) return a.turns - b.turns;
  } else if (a.grade !== b.grade) return a.grade - b.grade;
  if (a.dead !== b.dead) return b.dead - a.dead;
  return lifeOf(a) - lifeOf(b);
}

/** The worst run's index (compareRuns; a tie keeps the earlier run); -1 without runs. */
export function worstRun(outcomes: RunOutcome[]): number {
  let w = -1;
  outcomes.forEach((o, k) => {
    if (w < 0 || compareRuns(o, outcomes[w]) < 0) w = k;
  });
  return w;
}

/** The four figures over the runs. */
export interface RunStats {
  n: number;
  /** Share of runs won. */
  win: number;
  /** Average grade of the runs won (1 = D … 5 = S); null without a win. */
  grade: number | null;
  /** Average heroes down at the end. */
  dead: number;
  /** Average HP left of every hero still standing at the end, over all runs; null when none ever stands. */
  life: number | null;
}

export function runStats(outcomes: RunOutcome[]): RunStats {
  const n = outcomes.length;
  const wins = outcomes.filter((o) => o.won);
  const alive = outcomes.flatMap((o) => o.alive);
  return {
    n,
    win: n ? wins.length / n : 0,
    grade: wins.length ? mean(wins.map((o) => o.grade)) : null,
    dead: n ? mean(outcomes.map((o) => o.dead)) : 0,
    life: alive.length ? mean(alive) : null,
  };
}

const GRADES = ["D", "C", "B", "A", "S"];
/** An average grade as the nearest letter. */
export const gradeLetter = (g: number): string => GRADES[Math.min(4, Math.max(0, Math.round(g) - 1))];

/**
 * U74: which of the runs the chart and the cards show: the worst (compareRuns), a random one (the first run, index 0:
 * nothing picks it, so it is a draw like any other), or the best (compareRuns reversed). The Simulator's picker; the
 * Solver's Show always uses "random".
 */
export type RunPick = "worst" | "random" | "best";
export const RUN_PICKS: { id: RunPick; label: string }[] = [
  { id: "worst", label: "Worst" }, { id: "random", label: "Random" }, { id: "best", label: "Best" },
];
/** U74: the default pick. */
export const DEFAULT_PICK: RunPick = "random";
/** U74: a remembered pick; anything else (nothing stored, an old or foreign value) is the default. */
export const parsePick = (v: unknown): RunPick => (v === "worst" || v === "best" || v === "random" ? v : DEFAULT_PICK);

/**
 * U74: the best run's index: compareRuns reversed (a win before any loss; among wins the highest grade, then the
 * fewest heroes down, then the most life left on the survivors; among losses the one that gets furthest); a tie keeps
 * the earlier run; -1 without runs.
 */
export function bestRun(outcomes: RunOutcome[]): number {
  let b = -1;
  outcomes.forEach((o, k) => {
    if (b < 0 || compareRuns(o, outcomes[b]) > 0) b = k;
  });
  return b;
}

/** One traced run: a quest's fight or a map run's rooms. */
export interface RunTrace {
  quest?: FightTrace;
  map?: MapRoomTrace[];
}

/**
 * The runs' outcomes, the worst and the best one's index, and the traces a pick can show (U74: the first, the worst
 * and the best run's, by run index; at most 3, never all of them; U79: the Random run's, randomRun, not the first's).
 */
export interface WorstRuns {
  outcomes: RunOutcome[];
  worst: number;
  best: number;
  traces: Record<number, RunTrace>;
  /** Map runs the game's own code failed on (left out, as evaluateMap does). */
  errors: number;
}

/**
 * U79: the Random run's index: the first run (0, 1, 2 …) that is neither the worst nor the best run (U74 had run 0,
 * which could be either). Among `n` runs; fewer than three runs: the first that is neither, else run 0; -1 without
 * runs. All runs equal (worst = best = run 0): run 1.
 */
export function randomRun(n: number, worst: number, best: number): number {
  if (n <= 0) return -1;
  for (let k = 0; k < n; k++) if (k !== worst && k !== best) return k;
  return 0;
}

/** U74: the run index a pick shows (U79: random, randomRun); -1 without runs. */
export function pickedRun(runs: Pick<WorstRuns, "outcomes" | "worst" | "best">, pick: RunPick): number {
  if (!runs.outcomes.length) return -1;
  return pick === "worst" ? runs.worst : pick === "best" ? runs.best : randomRun(runs.outcomes.length, runs.worst, runs.best);
}

/** U74: the trace a pick shows (undefined without runs). */
export const pickedTrace = (runs: WorstRuns, pick: RunPick): RunTrace | undefined => runs.traces[pickedRun(runs, pick)];

/**
 * Trace `n` fights or map runs of this party (seeds fightSeed(seed0, 0..n-1), run 0 being Simulate's first) and keep
 * the traces of the Random, the worst and the best run only (U74; U70 kept the worst one's): a pick switches between
 * them without running again. U79: the Random run (randomRun) is known only at the end, and it is one of the first
 * three runs (at most two of them are the worst or the best), so runs 0-2 are kept while tracing (at most 6 traces held
 * at once: the three, the worst, the best and the newest) and the end keeps three. Throws when every map run fails
 * in the game's code.
 */
export function traceWorst(sim: Sim, target: { quest?: { id: number; rare: boolean; amount: number }; map?: { spec: MapSpec; scrolls: Scroll[] } },
  front: Row, back: Row, n = WORST_RUNS, seed0 = 1): WorstRuns {
  const outcomes: RunOutcome[] = [];
  let worst = -1, best = -1, errors = 0, firstError = "";
  const traces: Record<number, RunTrace> = {};
  const keep = (o: RunOutcome, t: RunTrace) => {
    const k = outcomes.push(o) - 1;
    if (worst < 0 || compareRuns(o, outcomes[worst]) < 0) worst = k;
    if (best < 0 || compareRuns(o, outcomes[best]) > 0) best = k;
    if (k < 3 || k === worst || k === best) traces[k] = t;
    for (const i of Object.keys(traces).map(Number)) if (i >= 3 && i !== worst && i !== best) delete traces[i];
  };
  for (let k = 0; k < n; k++) {
    const seed = fightSeed(seed0, k);
    if (target.quest) {
      const t = target.quest;
      const r = traceFightRun(sim, t.id, front, back, { rare: t.rare, amount: t.amount, seed });
      keep(outcomeOfFight(r.result), { quest: r.trace });
    } else if (target.map) {
      let r;
      try {
        r = traceMapRunResult(sim, target.map.spec, front, back, { scrolls: target.map.scrolls.length ? target.map.scrolls : null, seed });
      } catch (e) {
        if (String(e).includes("not ported")) throw e;
        errors++;
        firstError ||= String((e as Error)?.message ?? e).split("\n")[0];
        continue;
      }
      keep(outcomeOfMap(r.result), { map: r.rooms });
    } else throw new Error("nothing to simulate");
  }
  if (!outcomes.length) throw new Error(`all ${n} runs failed in game code: ${firstError}`);
  const random = randomRun(outcomes.length, worst, best);
  for (const i of Object.keys(traces).map(Number)) if (i !== random && i !== worst && i !== best) delete traces[i];
  return { outcomes, worst, best, traces, errors };
}
