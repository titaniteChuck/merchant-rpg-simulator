/**
 * U75: the Solver's findings, kept in this browser so a solve of the same setup shows at once and the next Solve
 * resumes from them (searchParties' `prior` and `round`, tools/parties.ts). No DOM, so Node tests can check it.
 *
 * - Key: a hash of everything the search is fed (solveKey): the cache version, the game mode, the pool's raw save
 *   entries (levels, gear, rotations: the heroes as the search builds them; Neutral and Exclude decide who is in it),
 *   the Must include heroes, the opponent (a quest's id, rare variant and size; a map's spec: id, ascension, grade,
 *   prefix, suffix, or a save map's own string), the party sizes and Include scrolls. The time budget is not in it:
 *   more time is how a solve goes further.
 * - SOLVER_CACHE_VERSION: bump it when the engine, the game data or the search change what a solve finds; entries of
 *   another version are ignored and dropped.
 * - Storage: localStorage, one item per setup (`solver-cache:<key>`) and an LRU index (`solver-cache-index`). Measured
 *   on the example save (17 heroes): 6 to 18 kB per quest setup, 17 to 31 kB per map setup after 1 to 4 solves, about
 *   1 kB per configuration. Capped: MAX_CONFIGS configurations and MAX_SCREENED screens per setup, MAX_ENTRIES setups
 *   and MAX_TOTAL characters in all (the least recently used go first). Storage blocked or full: kept for the page view.
 */
import { configSet, MAX_ROUND, type PartiesMemo, type PartiesResult, type PartyConfig } from "../tools/parties.ts";
import type { MapSpec } from "../tools/engine.ts";

/** Bump when the engine, the game data or the search change what a solve finds: older entries are then ignored. */
export const SOLVER_CACHE_VERSION = 1;

export const CACHE_PREFIX = "solver-cache:";
export const CACHE_INDEX = "solver-cache-index";

export interface CacheLimits {
  /** Setups kept (the least recently used dropped first). */
  entries: number;
  /** Characters of all entries together (localStorage counts UTF-16 code units). */
  total: number;
  /** Configurations and quick screens kept per setup. */
  configs: number;
  screened: number;
}
export const LIMITS: CacheLimits = { entries: 12, total: 1_500_000, configs: 40, screened: 2000 };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What a solve is fed (SearchRequest "parties"), the cache key's input. */
export interface SolveInput {
  gameMode: string;
  /** Raw save entries of the heroes in the pool (Neutral and Must include). */
  pool: { id: number }[];
  /** Must include hero ids. */
  lock: number[];
  quest?: { id: number; rare: boolean; amount: number };
  map?: MapSpec;
  minSize: number;
  maxSize: number;
  scrolls: boolean;
}

/** JSON with object keys sorted (the same value always gives the same text). */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** cyrb53: a 53-bit string hash. */
function cyrb53(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The cache key of a solve: 28 hex digits (two 53-bit hashes) of its canonical input and the cache version. */
export function solveKey(input: SolveInput): string {
  const text = canonical({
    v: SOLVER_CACHE_VERSION, mode: input.gameMode || "Standard",
    pool: [...input.pool].sort((a, b) => Number(a.id) - Number(b.id)), lock: [...new Set(input.lock)].sort((a, b) => a - b),
    quest: input.quest ? { id: input.quest.id, rare: Boolean(input.quest.rare), amount: input.quest.amount } : undefined,
    map: input.map, min: input.minSize, max: input.maxSize, scrolls: input.scrolls,
  });
  const hex = (n: number) => n.toString(16).padStart(14, "0");
  return hex(cyrb53(text, 1)) + hex(cyrb53(text, 2));
}

export interface SolveCacheEntry {
  v: number;
  key: string;
  /** Last written (ms since 1970). */
  at: number;
  /** Solves merged in, and their evaluations and search time together. */
  runs: number;
  tried: number;
  ms: number;
  /** The last solve: its time budget and how it ended (the status line). */
  last: { ms: number; budgetMs: number; stopped: boolean; cancelled: boolean };
  memo: PartiesMemo;
  /** The last solve's results, in order, as hero sets of memo.configs. */
  results: string[];
}

/** Two memos of the same setup as one: every screen and configuration of both (a tuned one over a screened one, else the later). */
export function mergeMemo(a: PartiesMemo | undefined, b: PartiesMemo): PartiesMemo {
  if (!a) return b;
  const solo = new Map(a.solo);
  for (const [id, s] of b.solo) solo.set(id, s);
  const screened = new Map(a.screened.map((x) => [x[0], x]));
  for (const x of b.screened) screened.set(x[0], x);
  const configs = new Map(a.configs.map((c) => [configSet(c), c]));
  for (const c of b.configs) {
    const had = configs.get(configSet(c));
    if (!had || c.tuned || !had.tuned) configs.set(configSet(c), c);
  }
  return { solo: [...solo], screened: [...screened.values()], configs: [...configs.values()], round: b.round, complete: b.complete };
}

/**
 * A memo within the limits: the configurations of `keep` (the results shown) first, then the tuned ones, then by
 * score; the latest screens. What is dropped is evaluated again if a later solve needs it.
 */
export function trimMemo(m: PartiesMemo, keep: readonly string[], limits: Pick<CacheLimits, "configs" | "screened"> = LIMITS): PartiesMemo {
  const rank = new Map(keep.map((k, i) => [k, i]));
  const configs = m.configs.length <= limits.configs ? m.configs : [...m.configs].sort((x, y) => {
    const rx = rank.get(configSet(x)) ?? Infinity, ry = rank.get(configSet(y)) ?? Infinity;
    return rx - ry || Number(y.tuned) - Number(x.tuned) || y.score - x.score;
  }).slice(0, limits.configs);
  return { ...m, configs, screened: m.screened.slice(-limits.screened) };
}

/** The round the next solve runs: the same one again after a stopped solve (it isn't done), else one wider. */
export function nextRound(m: PartiesMemo | undefined): number {
  if (!m) return 0;
  return m.complete ? Math.min(MAX_ROUND, m.round + 1) : m.round;
}

/** A solve's answer merged into its setup's entry (null: the setup's first solve). */
export function mergeEntry(old: SolveCacheEntry | null, key: string, res: PartiesResult,
  run: { ms: number; budgetMs: number; cancelled: boolean }, now: number, limits: CacheLimits = LIMITS): SolveCacheEntry {
  const prev = old && old.v === SOLVER_CACHE_VERSION && old.key === key ? old : null;
  const results = res.results.map(configSet);
  return {
    v: SOLVER_CACHE_VERSION, key, at: now, runs: (prev?.runs ?? 0) + 1, tried: (prev?.tried ?? 0) + res.tried, ms: (prev?.ms ?? 0) + run.ms,
    last: { ms: run.ms, budgetMs: run.budgetMs, stopped: res.stopped, cancelled: run.cancelled },
    memo: trimMemo(mergeMemo(prev?.memo, res.memo), results, limits), results,
  };
}

/** The entry as the results table takes it (the last solve's results; every solve's evaluations). */
export function entryResult(e: SolveCacheEntry): PartiesResult {
  const bySet = new Map(e.memo.configs.map((c) => [configSet(c), c]));
  return { results: e.results.map((k) => bySet.get(k)).filter((c): c is PartyConfig => Boolean(c)), tried: e.tried, stopped: e.last.stopped, memo: e.memo };
}

/** The indicator beside Solve: "41 parties · 3 solves". */
export function cacheLabel(e: SolveCacheEntry): string {
  const n = e.memo.screened.length;
  return `${n} part${n === 1 ? "y" : "ies"} · ${e.runs} solve${e.runs === 1 ? "" : "s"}`;
}

/** One row of the LRU index: key, cache version, characters, last used. */
export type IndexRow = [key: string, v: number, chars: number, at: number];

export function parseIndex(text: string | null): IndexRow[] {
  try {
    const rows = JSON.parse(text ?? "[]");
    return Array.isArray(rows) ? rows.filter((r): r is IndexRow => Array.isArray(r) && typeof r[0] === "string"
      && typeof r[1] === "number" && typeof r[2] === "number" && typeof r[3] === "number") : [];
  } catch {
    return [];
  }
}

/**
 * The index with `key` used now (most recent first; `chars` null: a read, its size kept) and the keys to drop: other
 * versions, then the least recently used beyond the setups or the characters allowed (the one just used always stays).
 */
export function touchIndex(index: readonly IndexRow[], key: string, chars: number | null, now: number,
  limits: Pick<CacheLimits, "entries" | "total"> = LIMITS): { index: IndexRow[]; evict: string[] } {
  const was = index.find((r) => r[0] === key);
  const me: IndexRow = [key, SOLVER_CACHE_VERSION, chars ?? was?.[2] ?? 0, now];
  const evict: string[] = [];
  const rest = index.filter((r) => r[0] !== key && (r[1] === SOLVER_CACHE_VERSION || (evict.push(r[0]), false)))
    .sort((a, b) => b[3] - a[3]);
  const out: IndexRow[] = [me];
  let total = me[2];
  for (const r of rest) {
    if (out.length < limits.entries && total + r[2] <= limits.total) {
      out.push(r);
      total += r[2];
    } else evict.push(r[0]);
  }
  return { index: out, evict };
}

/**
 * The Solver's cache over a Storage (localStorage on the page, a fake in the tests); `store` null or throwing: the
 * entries are kept in memory for the page view.
 */
export class SolveCache {
  private mem = new Map<string, SolveCacheEntry>();
  private store: Store | null;
  private limits: CacheLimits;
  private now: () => number;
  constructor(store: Store | null, limits: CacheLimits = LIMITS, now: () => number = Date.now) {
    this.store = store;
    this.limits = limits;
    this.now = now;
  }

  /** The entry of `key` (null: none, of another version or unreadable), marked as used. */
  get(key: string): SolveCacheEntry | null {
    const mem = this.mem.get(key);
    if (mem) return mem;
    if (!this.store) return null;
    try {
      const text = this.store.getItem(CACHE_PREFIX + key);
      if (text === null) return null;
      let e: SolveCacheEntry | null = null;
      try {
        e = JSON.parse(text);
      } catch { /* broken */ }
      if (!e || e.v !== SOLVER_CACHE_VERSION || e.key !== key || !e.memo || !Array.isArray(e.results)) {
        this.remove(key);
        return null;
      }
      this.writeIndex(key, null);
      return e;
    } catch {
      return null;
    }
  }

  /** Keep an entry (dropping the least recently used ones over the limits); false: only kept for this page view. */
  put(e: SolveCacheEntry): boolean {
    if (this.store) {
      try {
        const text = JSON.stringify(e);
        if (text.length <= this.limits.total) {
          // Full: drop the least recently used setups one by one and try again.
          for (;;) {
            try {
              this.writeIndex(e.key, text.length);
              this.store.setItem(CACHE_PREFIX + e.key, text);
              this.mem.delete(e.key);
              return true;
            } catch {
              const others = parseIndex(this.store.getItem(CACHE_INDEX)).filter((r) => r[0] !== e.key);
              if (!others.length) break;
              const oldest = others.reduce((a, b) => (b[3] < a[3] ? b : a));
              this.remove(oldest[0]);
            }
          }
          this.remove(e.key);
        }
      } catch { /* storage blocked */ }
    }
    this.mem.set(e.key, e);
    return false;
  }

  /** Forget a setup's findings (Reset). */
  remove(key: string): void {
    this.mem.delete(key);
    if (!this.store) return;
    try {
      this.store.removeItem(CACHE_PREFIX + key);
      const index = parseIndex(this.store.getItem(CACHE_INDEX));
      if (index.some((r) => r[0] === key)) this.store.setItem(CACHE_INDEX, JSON.stringify(index.filter((r) => r[0] !== key)));
    } catch { /* storage blocked */ }
  }

  private writeIndex(key: string, chars: number | null): void {
    const store = this.store!;
    const { index, evict } = touchIndex(parseIndex(store.getItem(CACHE_INDEX)), key, chars, this.now(), this.limits);
    for (const k of evict) store.removeItem(CACHE_PREFIX + k);
    store.setItem(CACHE_INDEX, JSON.stringify(index));
  }
}

/** The page's cache: localStorage when the browser lets the page use it, else memory only. */
export function pageCache(): SolveCache {
  let store: Store | null = null;
  try {
    store = globalThis.localStorage ?? null;
    store?.getItem(CACHE_INDEX);
  } catch {
    store = null;
  }
  return new SolveCache(store);
}
