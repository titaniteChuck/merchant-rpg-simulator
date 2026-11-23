/**
 * Enchanter model: expected cost of adding a prefix or suffix to an item you own.
 * Port of the former tools/enchant.py; the game rules are documented here and in
 * docs/tooling/profit-calculator.
 *
 * - Every attempt pays gold + a gem (prefix) or rune (suffix) by item-level band,
 *   amount 1 + fibo[min(attempts, 5)]; ascended items also pay essence.
 * - Prefix: clamp((L - itemLevel) * 2 + 2 * grade, 10, 80) %, no break risk for a first prefix.
 * - Suffix: steps +1 with clamp((L + 10 + 2a + 4 grade - nextSuffix.minLevel) * 2, 10, 95) %;
 *   a failure breaks with min(4a, 100) %, dropping one step and resetting the counter.
 * - A roll succeeds when odds > math.random(1, 100), i.e. with (odds - 1) %.
 */
import { clamp, type Game, luaRound, pyRound } from "./gamedata.ts";

/** Price of one unit of an item (asc 0). */
export type UnitCost = (itype: string, iid: number) => number;

export const FIBO: Record<number, number> = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3, 5: 5 };
export const PREFIX_GEM: [number, number][] = [[10, 30], [20, 44], [30, 88], [40, 126], [50, 157], [60, 252]];
export const SUFFIX_RUNE: [number, number][] = [[10, 32], [20, 48], [30, 92], [40, 127], [50, 158], [60, 253]];
const MAX_STATE = 60; // attempt counter states tracked by the Markov chain

/** The gem/rune id for an item level (undefined above level 60: the game can't enchant it). */
export function band(table: [number, number][], level: number): number | undefined {
  for (const [top, mid] of table) if (level <= top) return mid;
  return undefined;
}

const hit = (odds: number) => clamp(Math.ceil(odds) - 1, 0, 100) / 100;

/** default.prestigeEnchantMaterial on an item with `mods` modifiers -> [essence id, amount]. */
export function enchantEssence(g: Game, itype: string, iid: number, prestige: number, mods: number): [number | undefined, number] {
  if (!prestige) return [undefined, 0];
  const level = g.item(itype, iid).itemLevel ?? 1;
  const x = (level - 1) / 10;
  const region = clamp(Math.floor(x) + 1, 1, 6), frac = x - Math.floor(x);
  const eid = g.prestigeItemId.get(prestige)![region - 1];
  let amount = 2 + frac * 10;
  const rm = g.rarityMod.get(g.rarity(itype, iid, mods));
  if (rm) amount = rm[0] * amount;
  return [eid, luaRound(amount)];
}

/**
 * Expected total cost (and attempts) from counter 0 until success:
 * E[a] = cost(a) + (1 - p(a)) * (b(a) * E[0] + (1 - b(a)) * E[a + 1]), the last state loops on itself.
 */
function markov(cost: (a: number) => number, pSuccess: (a: number) => number, pBreak: (a: number) => number,
  states = MAX_STATE): [number, number] {
  const solve = (c: (a: number) => number) => {
    let a = states;
    let f = 1 - pSuccess(a), b = pBreak(a);
    const den = 1 - f * (1 - b);
    if (den <= 0) return Infinity;
    let alpha = c(a) / den, beta = f * b / den;
    for (a = states - 1; a >= 0; a--) {
      f = 1 - pSuccess(a);
      b = pBreak(a);
      [alpha, beta] = [c(a) + f * (1 - b) * alpha, f * b + f * (1 - b) * beta];
    }
    return beta < 1 ? alpha / (1 - beta) : Infinity;
  };
  return [solve(cost), solve(() => 1.0)];
}

export interface StepResult {
  cost: number;
  attempts: number;
  seconds: number;
  "chance%": number;
  gem?: string;
  rune?: string;
}

/** Expected cost, attempts and seconds to add a first prefix (null if the item can't be enchanted). */
export function addPrefix(g: Game, unitCost: UnitCost, itype: string, iid: number, prestige: number, grade: number,
  enchanterLevel: number, modsBefore: number): StepResult | null {
  const level = g.item(itype, iid).itemLevel ?? 1;
  const gem = band(PREFIX_GEM, level);
  if (gem === undefined) return null;
  const [eid, eamt] = enchantEssence(g, itype, iid, prestige, modsBefore);
  const perUnitEss = eid ? unitCost("material", eid) : 0;
  const gemCost = unitCost("material", gem);
  const gold = level * 40;
  const p = hit(clamp(luaRound((enchanterLevel - level) * 2 + grade * 2), 10, 80));
  const [cost, attempts] = markov((a) => gold + gemCost * (1 + FIBO[Math.min(a, 5)]) + eamt * perUnitEss, () => p, () => 0.0);
  return { cost, attempts, seconds: attempts * level * 10, "chance%": pyRound(100 * p, 1), gem: g.name("material", gem) };
}

/** Expected cost, attempts and seconds to go from no suffix to +1 (null if impossible). */
export function addSuffix(g: Game, unitCost: UnitCost, itype: string, iid: number, prestige: number, grade: number,
  enchanterLevel: number, modsBefore: number): StepResult | null {
  const it = g.item(itype, iid);
  if (itype === "equipment" && it.itemSlot === 6) return null; // slot 6 can't take a suffix
  const level = it.itemLevel ?? 1;
  const rune = band(SUFFIX_RUNE, level);
  if (rune === undefined) return null;
  const [eid, eamt] = enchantEssence(g, itype, iid, prestige, modsBefore);
  const perUnitEss = eid ? unitCost("material", eid) : 0;
  const runeCost = unitCost("material", rune);
  const gold = level * 60;
  const nextMin = g.suffixes.get(1).minLevel;
  const p = (a: number) => hit(clamp((luaRound(enchanterLevel + 10 + 2 * a + grade * 4) - nextMin) * 2, 10, 95));
  const [cost, attempts] = markov((a) => gold + runeCost * (1 + FIBO[Math.min(a, 5)]) + eamt * perUnitEss,
    p, (a) => Math.min(a * 4, 100) / 100);
  return { cost, attempts, seconds: attempts * level * 5, "chance%": pyRound(100 * p(0), 1), rune: g.name("material", rune) };
}

// ---------------------------------------------------------------- reset
/** Reset runes by item-level band (default.resetEnchantCost). */
export const RESET_RUNE: [number, number][] = [[10, 31], [20, 65], [30, 97], [40, 129], [50, 160], [60, 254]];

/**
 * default.resetEnchant: the item's grade after one more Reset, when it was reset `resets` times before. Reset keeps
 * the prefix and suffix and re-rolls the base stats; the grade can drop by one at most.
 * startingGrade = itemStartGrade(enchanter level + 5, itemLevel) (Utilities.round: floor(x * 100 + 0.5) / 100).
 */
export function resetGrade(enchanterLevel: number, itemLevel: number, grade: number, resets: number): number {
  const start = clamp(Math.floor((1 + (enchanterLevel + 5 - itemLevel) / 4) * 100 + 0.5) / 100, 1, 4.5);
  return clamp(luaRound(start + resets * 0.4), Math.max(grade - 1, 1), 5);
}

export interface ResetStep {
  resets: number;
  grade: number;
  /** Cumulative cost and time of `resets` resets. */
  cost: number;
  seconds: number;
}

/**
 * Grades reachable by resetting an item `0..maxResets` times, with the cumulative cost: per reset
 * gold itemLevel * 20 + 20 * resets, (1 + fibo[min(resets, 5)]) reset runes, essence if ascended, itemLevel * 2.5 s.
 */
export function resetPath(g: Game, unitCost: UnitCost, itype: string, iid: number, prestige: number, grade: number,
  enchanterLevel: number, mods: number, maxResets = 8): ResetStep[] {
  const level = g.item(itype, iid).itemLevel ?? 1;
  const rune = band(RESET_RUNE, level);
  const out: ResetStep[] = [{ resets: 0, grade, cost: 0, seconds: 0 }];
  if (rune === undefined) return out;
  const [eid, eamt] = enchantEssence(g, itype, iid, prestige, mods);
  const essence = eid ? eamt * unitCost("material", eid) : 0;
  let cur = grade, cost = 0, secs = 0;
  for (let i = 0; i < maxResets; i++) {
    cost += level * 20 + 20 * i + unitCost("material", rune) * (1 + FIBO[Math.min(i, 5)]) + essence;
    secs += level * 2.5;
    cur = resetGrade(enchanterLevel, level, cur, i);
    out.push({ resets: i + 1, grade: cur, cost, seconds: secs });
  }
  return out;
}

type Route = [number, number, string];

/** Cheapest way to reach 1 and 2 modifiers from a plain item. */
export function enchantPlan(g: Game, unitCost: UnitCost, itype: string, iid: number, prestige: number, grade: number,
  enchanterLevel: number) {
  const pre0 = addPrefix(g, unitCost, itype, iid, prestige, grade, enchanterLevel, 0);
  const suf0 = addSuffix(g, unitCost, itype, iid, prestige, grade, enchanterLevel, 0);
  const pre1 = addPrefix(g, unitCost, itype, iid, prestige, grade, enchanterLevel, 1);
  const suf1 = addSuffix(g, unitCost, itype, iid, prestige, grade, enchanterLevel, 1);
  const one: Route[] = ([[pre0, "prefix"], [suf0, "+1 suffix"]] as const).filter(([r]) => r)
    .map(([r, name]) => [r!.cost, r!.seconds, name]);
  const two: Route[] = [];
  if (suf0 && pre1) two.push([suf0.cost + pre1.cost, suf0.seconds + pre1.seconds, "+1 suffix then prefix"]);
  if (pre0 && suf1) two.push([pre0.cost + suf1.cost, pre0.seconds + suf1.seconds, "prefix then +1 suffix"]);
  const minRoute = (rs: Route[]) => rs.reduce((a, b) => (cmpRoute(b, a) < 0 ? b : a));
  return { 1: one.length ? minRoute(one) : null, 2: two.length ? minRoute(two) : null, prefix: pre0, suffix: suf0 };
}

/** Python tuple comparison of routes. */
function cmpRoute(a: Route, b: Route): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------- map suffix
const MAX_ATTEMPTS = 26; // beyond this a failure always breaks (4 * 25 = 100 %)

/** Highest suffix index reachable by enchanting (canNextSuffix: ascLevel <= prestige). */
export function maxSuffixFor(g: Game, prestige: number): number {
  let top = 0;
  for (const n of [...g.suffixes.keys()].filter((k) => k > 0).sort((a, b) => a - b)) {
    const asc = g.suffixes.get(n).ascLevel;
    if (asc && prestige < asc) break;
    top = n;
  }
  return top;
}

type Vec = [number, number, number, number];
const chainCache = new Map<string, Vec>();

/**
 * Item-independent part of a suffix climb from none to `target`: Markov chain over (tier s, attempt a).
 * Returns (attempts at s = 0, attempts at s > 0, sum of minLevel(s) over attempts, runes).
 */
function suffixChain(minlevels: number[], grade: number, enchanterLevel: number, target: number): Vec {
  const key = JSON.stringify([minlevels, grade, enchanterLevel, target]);
  const cached = chainCache.get(key);
  if (cached) return cached;
  const A = MAX_ATTEMPTS;
  const pSuccess = (s: number, a: number) =>
    hit(clamp((luaRound(enchanterLevel + 10 + 2 * a + grade * 4) - minlevels[s + 1]) * 2, 10, 95));
  const cost = (s: number, a: number): Vec =>
    [s === 0 ? 1.0 : 0.0, s > 0 ? 1.0 : 0.0, s > 0 ? minlevels[s] : 0.0, 1 + FIBO[Math.min(a, 5)]];
  const add = (u: Vec, v: Vec): Vec => [u[0] + v[0], u[1] + v[1], u[2] + v[2], u[3] + v[3]];
  const mul = (k: number, u: Vec): Vec => [k * u[0], k * u[1], k * u[2], k * u[3]];
  const zero: Vec = [0, 0, 0, 0];

  // Tier by tier, top-down: E[s+1][a] = A1[a] + B1[a] * X_s with X_s = E[s][0];
  // E[s][a] = P[a] + Q[a] * X_s + R[a] * X_{s-1} (a break drops to X_{s-1}).
  let A1: Vec[] = Array(A + 1).fill(zero);
  let B1: number[] = Array(A + 1).fill(0);
  let result: Vec = zero;
  for (let s = target - 1; s >= 0; s--) {
    const P: Vec[] = Array(A + 1).fill(zero), Q: number[] = Array(A + 1).fill(0), R: number[] = Array(A + 1).fill(0);
    for (let a = A; a >= 0; a--) {
      const p = pSuccess(s, a), b = Math.min(4 * a, 100) / 100;
      const f = 1 - p;
      const nxt = Math.min(a + 1, A);
      if (a === A) { // last counter state loops on itself
        const den = 1 - f * (1 - b);
        P[a] = mul(1 / den, add(cost(s, a), mul(p, A1[nxt])));
        Q[a] = p * B1[nxt] / den;
        R[a] = f * b / den;
      } else {
        P[a] = add(add(cost(s, a), mul(p, A1[nxt])), mul(f * (1 - b), P[nxt]));
        Q[a] = p * B1[nxt] + f * (1 - b) * Q[nxt];
        R[a] = f * b + f * (1 - b) * R[nxt];
      }
    }
    if (s === 0) { // a break at tier 0 stays at tier 0: X_{-1} = X_0
      result = mul(1 / (1 - Q[0] - R[0]), P[0]);
      break;
    }
    const inv = 1 / (1 - Q[0]);
    A1 = P.map((Pa, a) => add(Pa, mul(Q[a] * inv, P[0])));
    B1 = R.map((Ra, a) => Ra + Q[a] * inv * R[0]);
  }
  chainCache.set(key, result);
  return result;
}

export interface Climb {
  gold: number;
  runes: number;
  rune_id: number;
  essence: number;
  essence_id: number | undefined;
  attempts: number;
  seconds: number;
}

/** Expected resources to enchant a suffix from none up to `target` (linear in prices), or null if impossible. */
export function suffixClimb(g: Game, itype: string, iid: number, prestige: number, grade: number, enchanterLevel: number,
  target: number, hasPrefix = false): Climb | null {
  const level = g.item(itype, iid).itemLevel ?? 1;
  const rune = band(SUFFIX_RUNE, level);
  if (rune === undefined || target <= 0 || target > maxSuffixFor(g, prestige)) return null;
  const top = Math.max(...g.suffixes.keys());
  const minlevels: number[] = [];
  for (let k = 0; k <= top; k++) minlevels.push(k > 0 ? g.suffixes.get(k).minLevel : 0);
  const [att0, attPos, minlvlSum, runes] = suffixChain(minlevels, grade, enchanterLevel, target);
  const [eid, e0] = enchantEssence(g, itype, iid, prestige, Number(hasPrefix));
  const [, e1] = enchantEssence(g, itype, iid, prestige, 1 + Number(hasPrefix));
  const attempts = att0 + attPos;
  return { gold: level * 60 * attempts + 20 * minlvlSum, runes, rune_id: rune, essence: e0 * att0 + e1 * attPos,
    essence_id: eid, attempts, seconds: attempts * level * 5 };
}

/** Expected essence multiplier (1 + prefix.sell) of an enchanted prefix on a map. */
export function mapPrefixMultiplier(g: Game, grade: number, enchanterLevel: number): number {
  const eff = luaRound(enchanterLevel + 5 + grade * 2);
  const pool: [number, number][] = [];
  for (const [n, d] of g.prefixes) {
    if (n > 0 && d.weight && eff >= (d.minLevel ?? 0) && (d.maxLevel == null || eff <= d.maxLevel)) pool.push([d.weight, d.sell ?? 0]);
  }
  const total = pool.reduce((s, [w]) => s + w, 0);
  return total ? 1 + pool.reduce((s, [w, x]) => s + w * x, 0) / total : 1.0;
}
