/**
 * Party search for the merged "best party" mode: the smallest parties that win, each with its rows and order,
 * every hero's rotation and passive, and (map runs) its scrolls.
 *
 * Parties grow one hero at a time from minSize to maxSize (beam search: the best `beam` hero sets of a size are each
 * extended by the strongest heroes not in them, strength = solo score), until `enough` configurations win at
 * winThreshold or the time runs out. Every candidate set gets one quick evaluation with a default layout (sturdiest
 * heroes in front). Once a size comes near winning (its best quick win rate >= winThreshold / 2, or it is the last
 * size), its best `refine` sets are tuned: front / back split and order within rows, rotations (searchSkills with
 * the schedule pre-filter and warm start, cheap settings; a map run on its boss fight), scrolls for map runs, and a
 * final evaluation at nFinal. Sizes far from winning keep their screened sets (`tuned: false`) and the search grows.
 * Results: winners first (fewer heroes first, then score), then the others by score; one configuration per hero set.
 * The game's party rules hold (partyRules): no more heroes than the quest takes, a party quest's front 2 always
 * filled, a solo quest's one hero in front 1.
 *
 * Pure, worker-safe; progress ("size 3: 12/40") and cancel through SearchControl; heroes are left as they were.
 */
import {
  evaluateTarget, type FightEval, type MapEval, type MapTarget, maxQuestAmount, type PartyLayout, partyProblem, partyRules,
  type QuestTarget, SearchCancelled, type SearchControl, searchScrolls, searchSkills, soloRows,
} from "./combat.ts";
import type { Hero, Row, Sim } from "./engine.ts";

export interface PartySearchOptions {
  /** Party sizes tried, smallest first (default 1 to 6). */
  minSize?: number;
  maxSize?: number;
  /** Configurations returned (default 10). */
  topK?: number;
  /** Stop growing the party once this many configurations win at winThreshold (default topK). */
  enough?: number;
  /** Win rate that counts as winning (default 0.9). */
  winThreshold?: number;
  /** Search each hero's rotation and passive (default true); scrolls (map runs only, default false). */
  rotations?: boolean;
  scrolls?: boolean;
  /** Heroes that must be in every party; heroes never used. */
  lock?: number[];
  exclude?: number[];
  /** Fights (map runs) per quick evaluation and per final one (default 10 / 100 fights, 3 / 20 runs). */
  nQuick?: number;
  nFinal?: number;
  /** Hero sets kept per size, and how many of them are fully tuned (default 6 and 3). */
  beam?: number;
  refine?: number;
  /** Wall-clock budget (default 120000 ms); when it runs out the configurations found so far are returned. */
  timeBudgetMs?: number;
}

export interface PartyConfig {
  size: number;
  /** Hero ids by slot (index 0 = front 1 / back 1), null = empty. */
  layout: PartyLayout;
  /** Per hero id: rotation and passive. */
  skills: Record<number, { rotation: string[]; passive: string }>;
  /** Scroll ids for a map run (null: none, or a quest). */
  scrolls: number[] | null;
  ev: FightEval | MapEval;
  score: number;
  /** Crafted cost of the scrolls (searchScrolls' prices), when any. */
  scrollCost?: number;
  /**
   * False when the set was only screened: no size near winning yet, so it was evaluated with the default layout and
   * the heroes' own rotations (nQuick) and the search moved on to bigger parties.
   */
  tuned: boolean;
}

export interface PartiesResult {
  results: PartyConfig[];
  /** Evaluations run (quick and final). */
  tried: number;
  /** True when the time budget or shouldStop ended the search early. */
  stopped: boolean;
}

type Layout = { front: (number | null)[]; back: (number | null)[] };

const key = (ids: number[]) => [...ids].sort((a, b) => a - b).join(",");

/** Every split of `ids` into a front and a back row (3 slots each), heroes in the given order within each row. */
function splits(ids: number[]): Layout[] {
  const out: Layout[] = [];
  const n = ids.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const front = ids.filter((_, i) => mask & (1 << i)), back = ids.filter((_, i) => !(mask & (1 << i)));
    if (front.length > 3 || back.length > 3) continue;
    const pad = (r: number[]) => [0, 1, 2].map((i) => r[i] ?? null);
    out.push({ front: pad(front), back: pad(back) });
  }
  return out;
}

/** The 6 orders of a 3-slot row (duplicates removed). */
function orders(row: (number | null)[]): (number | null)[][] {
  const [a, b, c] = row;
  const all = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
  const seen = new Set<string>();
  return all.filter((r) => !seen.has(r.join()) && (seen.add(r.join()), true));
}

export function searchParties(sim: Sim, pool: Map<number, Hero>, target: QuestTarget | MapTarget,
  o: PartySearchOptions = {}, ctl: SearchControl = {}): PartiesResult {
  const map = "map" in target;
  const nQuick = o.nQuick ?? (map ? 3 : 10), nFinal = o.nFinal ?? (map ? 20 : 100);
  const topK = o.topK ?? 10, enough = o.enough ?? topK, threshold = o.winThreshold ?? 0.9;
  const beamW = o.beam ?? 6, refine = o.refine ?? 3;
  const lock = [...new Set(o.lock ?? [])];
  const exclude = new Set(o.exclude ?? []);
  for (const id of lock) {
    if (!pool.has(id)) throw new Error(`locked hero ${id} is not in the pool`);
    if (exclude.has(id)) throw new Error(`hero ${id} is both locked and excluded`);
  }
  const ids = [...pool.keys()].filter((id) => !exclude.has(id));
  // the game's rules: a party quest's size and its required front 2, a solo quest's one hero in front 1 (partyRules)
  const rules = partyRules(target);
  if (lock.length > rules.maxSize) throw new Error(`at most ${rules.maxSize} heroes can be locked for this target`);
  const minSize = Math.max(o.minSize ?? 1, lock.length, 1), maxSize = Math.min(o.maxSize ?? 6, rules.maxSize, ids.length);
  const deadline = Date.now() + (o.timeBudgetMs ?? 120000);
  const amount = map ? 1 : (target as QuestTarget).amount ?? 1, rare = map ? false : Boolean((target as QuestTarget).rare);
  let tried = 0, stopped = false;

  // heroes are put back exactly as they were
  const saved = new Map(ids.map((id) => [id, { rotation: sim.rotation(pool.get(id)!), passive: pool.get(id)!.passiveSelect }]));
  const restore = () => {
    for (const [id, s] of saved) sim.setSkills(pool.get(id)!, s.rotation, s.passive);
  };

  const check = () => {
    if (ctl.shouldStop?.() || Date.now() > deadline) throw new SearchCancelled();
  };
  const rows = (l: Layout): [Row, Row] => [l.front.map((id) => (id === null ? null : pool.get(id)!)), l.back.map((id) => (id === null ? null : pool.get(id)!))];
  const legal = (set: number[]) => amount <= 1 || amount <= maxQuestAmount(set.map((id) => pool.get(id)), rare, sim.mode);
  const evalLayout = (l: Layout, n: number, scrolls?: number[] | null) => {
    check();
    tried++;
    const [front, back] = rows(l);
    const t = map && scrolls?.length ? { ...(target as MapTarget), scrolls: scrolls.map((id) => ({ id, prestigeLevel: 0 })) } : target;
    return evaluateTarget(sim, t, front, back, n);
  };
  // sturdiest heroes in front (the enemy hits the front row first)
  const sturdy = new Map(ids.map((id) => {
    const s = sim.stats(pool.get(id)!);
    return [id, s.maxHP * (1 + (s.def + s.mdef) / 200)] as const;
  }));
  const defaultLayout = (set: number[]): Layout => {
    const byS = [...set].sort((a, b) => sturdy.get(b)! - sturdy.get(a)!);
    const nf = Math.min(3, Math.max(set.length - 3, Math.ceil(set.length / 2)));
    const pad = (r: number[]) => [0, 1, 2].map((i) => r[i] ?? null);
    const l: Layout = { front: pad(byS.slice(0, nf)), back: pad(byS.slice(nf)) };
    // a required slot left empty (a party quest's front 2) gets the sturdiest hero of its row, else of the other row
    for (const s of rules.required) {
      const row = l[s.row], other = l[s.row === "front" ? "back" : "front"];
      if (row[s.i] !== null) continue;
      const from = row.some((x) => x !== null) ? row : other;
      const j = from.findIndex((x) => x !== null);
      [row[s.i], from[j]] = [from[j], null];
    }
    return l;
  };
  const allowed = (l: Layout) => !partyProblem(target, l.front, l.back);

  // rotations are tuned on a quest: the target itself, or a map's boss fight
  const boss = map ? sim.makeMap((target as MapTarget).map, 1) : undefined;
  const skillTarget: QuestTarget | MapTarget = boss?.bossID ? { quest: boss.bossID, rare: Boolean(boss.bossRare), mapRoom: true } : target;
  const questN = "map" in skillTarget ? nQuick : Math.max(nQuick, 10);
  const configs = new Map<string, PartyConfig>();
  // winners first, the smallest first; parties that don't win by score (a bigger one may simply get further)
  const ranked = () => [...configs.values()].sort((a, b) => {
    const wa = a.ev.win >= threshold, wb = b.ev.win >= threshold;
    if (wa !== wb) return Number(wb) - Number(wa);
    return (wa ? a.size - b.size : 0) || b.score - a.score;
  });
  const winners = () => [...configs.values()].filter((c) => c.ev.win >= threshold).length;

  try {
    // solo strength: each hero alone (a quest amount it can't take alone: its own max)
    ctl.onProgress?.(0, ids.length, "solo");
    const solo = new Map<number, number>();
    ids.forEach((id, i) => {
      const h = pool.get(id)!;
      const t = map ? target : { ...(target as QuestTarget), amount: Math.min(amount, maxQuestAmount([h], rare, sim.mode)) };
      check();
      tried++;
      solo.set(id, evaluateTarget(sim, t, ...soloRows(t, h), nQuick).score);
      ctl.onProgress?.(i + 1, ids.length, "solo");
    });
    const strongest = [...ids].sort((a, b) => solo.get(b)! - solo.get(a)!);

    let beam: number[][] = [lock];
    for (let size = Math.max(1, lock.length); size <= maxSize; size++) {
      // grow every set of the beam by one hero (the strongest not in it), locked heroes first
      const cands = new Map<string, number[]>();
      for (const set of beam) {
        if (set.length >= size) {
          cands.set(key(set), set);
          continue;
        }
        const extra = strongest.filter((id) => !set.includes(id)).slice(0, beamW + 2);
        for (const id of extra) {
          const s = [...set, id];
          cands.set(key(s), s);
        }
      }
      const sets = [...cands.values()].filter((s) => s.length === size && legal(s));
      if (size < minSize) {
        beam = sets.sort((a, b) => b.reduce((x, id) => x + solo.get(id)!, 0) - a.reduce((x, id) => x + solo.get(id)!, 0)).slice(0, beamW);
        continue;
      }
      const stage = `size ${size}`;
      const total = sets.length + Math.min(refine, sets.length);
      let done = 0;
      ctl.onProgress?.(0, total, stage);
      // quick screen: default layout, current rotations
      const quick = sets.map((s) => {
        const ev = evalLayout(defaultLayout(s), nQuick);
        ctl.onProgress?.(++done, total, stage);
        return [ev.score, s, ev] as const;
      }).sort((a, b) => b[0] - a[0]);
      beam = quick.slice(0, beamW).map(([, s]) => s);
      // tune the best sets, once this size comes near winning (or it is the last size); else keep the screened ones
      const near = quick.length > 0 && (quick[0][2].win >= threshold / 2 || size === maxSize);
      for (const [, set, ev] of quick.slice(0, refine)) {
        if (near) configs.set(key(set), tune(set));
        else {
          const skills = Object.fromEntries(set.map((id) => [id, { ...saved.get(id)! }]));
          configs.set(key(set), { size: set.length, layout: defaultLayout(set), skills, scrolls: null, ev, score: ev.score, tuned: false });
        }
        ctl.onProgress?.(++done, total, stage);
      }
      if (winners() >= enough) break;
    }
  } catch (e) {
    if (!(e instanceof SearchCancelled)) throw e;
    stopped = true;
  } finally {
    restore();
  }
  return { results: ranked().slice(0, topK), tried, stopped };

  /** Rows and order, rotations, scrolls and a final evaluation for one hero set. */
  function tune(set: number[]): PartyConfig {
    // 1. front / back split (heroes by sturdiness within rows), then the order within rows
    let best = defaultLayout(set), bestSc = -Infinity;
    for (const l of splits([...set].sort((a, b) => sturdy.get(b)! - sturdy.get(a)!))) {
      if (!allowed(l)) continue;
      const sc = evalLayout(l, nQuick).score;
      if (sc > bestSc) (bestSc = sc, best = l);
    }
    for (const f of orders(best.front)) {
      for (const b of orders(best.back)) {
        const l = { front: f, back: b };
        if ((l.front.join() === best.front.join() && l.back.join() === best.back.join()) || !allowed(l)) continue;
        const sc = evalLayout(l, nQuick).score;
        if (sc > bestSc) (bestSc = sc, best = l);
      }
    }
    // 2. rotations, one hero after the other, each kept on the party's rows. A map run is tuned on its boss fight
    // (a quest: the schedule pre-filter and warm start apply, and a fight costs a room, not a run).
    const skills: PartyConfig["skills"] = {};
    for (const id of set) {
      const h = pool.get(id)!;
      if (o.rotations !== false) {
        check();
        const [front, back] = rows(best);
        const r = searchSkills(sim, h, front, back, skillTarget, { nQuick: Math.max(4, Math.round(questN / 2)), nFinal: questN, top: 2 },
          { shouldStop: () => ctl.shouldStop?.() === true || Date.now() > deadline });
        tried += r.counts.orderings + r.counts.final;
        const top = r.ranked[0];
        if (top && top.ev.score > r.current.ev.score) sim.setSkills(h, top.rotation, top.passive);
      }
      skills[id] = { rotation: sim.rotation(h), passive: h.passiveSelect };
    }
    // 3. scrolls (map runs)
    let scrolls: number[] | null = null, scrollCost: number | undefined;
    if (map && o.scrolls) {
      check();
      const [front, back] = rows(best);
      const r = searchScrolls(sim, (target as MapTarget).map, front, back, { nQuick: Math.max(2, Math.round(nQuick / 2)), nFinal: nQuick, top: 3 },
        { shouldStop: () => ctl.shouldStop?.() === true || Date.now() > deadline });
      const top = r.ranked[0];
      if (top && top.loadout.length) (scrolls = top.loadout, scrollCost = top.cost);
    }
    // 4. final evaluation; the heroes' rotations go back for the next set
    const ev = evalLayout(best, nFinal, scrolls);
    for (const id of set) sim.setSkills(pool.get(id)!, saved.get(id)!.rotation, saved.get(id)!.passive);
    return { size: set.length, layout: best, skills, scrolls, ev, score: ev.score, tuned: true, ...(scrollCost !== undefined ? { scrollCost } : {}) };
  }
}
