/**
 * Lua 5.1 / Solar2D semantics the combat rules depend on.
 *
 * The random generator is a Park-Miller LCG with Lua 5.1 `math.random`
 * argument handling. The reference fixtures (test/fixtures/) were recorded from
 * the real game code with this same generator installed (by the former Lua
 * harness), so fights can be compared with them roll by roll.
 */

const MOD = 2147483647;

export class Rng {
  state = 1;
  calls = 0;

  constructor(seed = 1) {
    this.seed(seed);
  }

  /** math.randomseed */
  seed(x: number): void {
    this.state = (Math.floor(Math.abs(Number(x) || 0)) % (MOD - 1)) + 1;
  }

  /** math.random(), math.random(n), math.random(m, n) */
  random(m?: number, n?: number): number {
    this.state = (this.state * 16807) % MOD;
    this.calls++;
    const r = (this.state - 1) / (MOD - 1);
    if (m === undefined) return r;
    if (n === undefined) return Math.floor(r * Math.trunc(m)) + 1;
    const lo = Math.trunc(m);
    const hi = Math.trunc(n);
    return Math.floor(r * (hi - lo + 1)) + lo;
  }
}

/** The generator every rule draws from (Lua's global math.random). */
export let rng = new Rng(1);
export function setRng(r: Rng): void {
  rng = r;
}
export const random = (m?: number, n?: number): number => rng.random(m, n);
export const randomseed = (x: number): void => rng.seed(x);

/** Solar2D math.round (JavaScript Math.round): floor(x + 0.5). */
export const mathRound = (x: number): number => Math.floor(x + 0.5);

/** Utilities.lua round(num, places). */
export function round(num: number, places = 0): number {
  const mult = 10 ** places;
  return Math.floor(num * mult + 0.5) / mult;
}

/** Utilities.lua copyTable: shallow copy. Arrays stay arrays. */
export function copyTable<T>(orig: T): T {
  if (Array.isArray(orig)) return orig.slice() as T;
  if (orig !== null && typeof orig === "object") return { ...(orig as object) } as T;
  return orig;
}

/** Utilities.lua tableSum over numeric values (1-based slot arrays included). */
export function tableSum(t: ArrayLike<unknown> | Record<string, unknown>): number {
  let sum = 0;
  for (const v of Object.values(t)) if (typeof v === "number") sum += v;
  return sum;
}

/** Lua truthiness: only nil (undefined/null) and false are false. */
export const truthy = (v: unknown): boolean => v !== undefined && v !== null && v !== false;

/** `#t` for a Lua-shaped table (JSON object with keys "1".."n", or a 1-based array with index 0 unused). */
export function len(t: unknown): number {
  if (t === undefined || t === null) return 0;
  const o = t as Record<number, unknown>;
  let n = 0;
  while (o[n + 1] !== undefined && o[n + 1] !== null) n++;
  return n;
}

/** t[1..#t] as a 0-based array. */
export function seq<T = any>(t: unknown): T[] {
  const n = len(t);
  const o = t as Record<number, T>;
  const out: T[] = [];
  for (let i = 1; i <= n; i++) out.push(o[i]);
  return out;
}

/** A Lua sequence as a 1-based array (index 0 unused). */
export function oneBased<T = any>(t: unknown): T[] {
  return [undefined as T, ...seq<T>(t)];
}

/** Utilities.lua clamp. */
export function clamp(num: number, low: number, high: number): number {
  if (num < low) return low;
  if (high < num) return high;
  return num;
}

/**
 * `#row` for a hero row (1-based, built by sequential assignment in Battle).
 * Lua 5.1 gives the count of leading filled slots for every pattern of holes
 * (measured: {1,3} -> 1, {2,3} -> 0).
 */
export function rowLen(row: unknown[]): number {
  let n = 0;
  while (n < 3 && row[n + 1] !== undefined && row[n + 1] !== null) n++;
  return n;
}

/** Lua tonumber for decimal strings (nil -> undefined). */
export function toNumber(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return undefined;
  return Number(t);
}
