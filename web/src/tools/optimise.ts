/**
 * Joint optimiser for one fight (a quest) or one map run: party and rows, the order of heroes within and across
 * rows, each member's rotation, passive and rotation phase, each member's gear from the items you own, and the
 * scrolls of a map run, tuned together by coordinate descent.
 *
 *   const res = optimiseFight(sim, pool, { quest: 81 }, { save })
 *   res.config.party.front, res.config.skills[heroId].rotation, res.trace
 *
 * Every evaluation uses seeds 1..n (common random numbers), so a step is only kept when it beats the current
 * configuration on the same rolls. Pure: no output, no Node APIs; progress and cancel through SearchControl.
 */
import {
  checkAmount, evaluateTarget, type FightEval, scheduleParty, type GearCandidate, type MapEval, type MapTarget, type PartyLayout, type QuestTarget,
  SearchCancelled, type SearchControl, searchGear, searchParty, searchScrolls, searchSkills,
} from "./combat.ts";
import type { Hero, Row, Scroll, Sim } from "./engine.ts";
import type { Save } from "./save.ts";
import { DAMAGE_ONLY, enemyTimeline, hasTimelines, scheduleContext, scoreSchedule, type ScoreWeights } from "./schedule.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface OptimiseOptions {
  /** The save: owned items for the gear step (inventory, sale slots, gear of heroes outside the party). Without it, gear is kept. */
  save?: Save;
  /** Starting layout (hero ids from the pool). With the party step off, the search starts from it; with it on, it is
   * the candidate the party search must beat (by minGain). */
  startParty?: PartyLayout;
  /** Heroes that must stay in the party: the party step keeps them (and adds any missing); order, row swaps and
   * phase shifts may still move them within the party. */
  lock?: number[];
  /** Party size (default 6). */
  size?: number;
  /** Fights / map runs per candidate (default 10 fights, 4 runs) and for the final evaluation (default 200 / 30). */
  nQuick?: number;
  nFinal?: number;
  /** Steps to run (default all; gear needs `save`, scrolls a map target). `order`: every order of the heroes within
   * the front and back rows (3! x 3!, empty slots included); `swap`: one front slot exchanged with one back slot (9
   * pairs), then `order` again if kept; `phase`: each member's rotation shifted cyclically by 1-4 turns (passive
   * unchanged). order, swap and phase run after the party step and again after the skill steps. */
  steps?: { party?: boolean; order?: boolean; swap?: boolean; phase?: boolean; skills?: boolean; gear?: boolean; scrolls?: boolean };
  /** Rounds of the full cycle (default 2); stops earlier when a round changes nothing. */
  maxRounds?: number;
  /** Smallest score gain a step must bring to be kept (default 5: half a turn, 1 % HP left, 0.05 % enemy HP). */
  minGain?: number;
  /** Re-run the party search in every round (default: first round only; it is the costliest step). */
  partyEveryRound?: boolean;
  /** Wall-clock budget in ms (default 120000; Infinity for none): searches stop when it runs out, and the best
   * configuration so far is returned (then evaluated at nFinal). */
  timeBudgetMs?: number;
  /** Rotation search breadth (skill sets / orderings kept, default 2) and gear passes (default 1). */
  skillsTop?: number;
  gearPasses?: number;
  /** Schedule pre-filter (quests, timelines loaded; see searchSkills): rotations simulated per hero in the skill
   * step = its top `prefilter` + the damage-only top (x4 on fights won under 50 %); phase step: only the 2 best
   * shifts by schedule score and the best by damage are simulated, on fights won at least half the time. Default 15;
   * 0 or false = off. */
  prefilter?: number | false;
}

export interface FightConfig {
  party: PartyLayout;
  /** Per placed hero id: rotation and passive. */
  skills: Record<number, { rotation: string[]; passive: string }>;
  /** Per placed hero id: items changed from the hero's own (slot name, item name, where it comes from). */
  gear: Record<number, { slot: string; item: string; from: string }[]>;
  scrolls: Scroll[] | null;
}

export interface OptimiseStep {
  round: number;
  step: string;
  /** Score of the configuration (nQuick, same seeds) before and after the step; equal when nothing changed. */
  before: number;
  after: number;
  change: string;
  /** Wall-clock time of the step. */
  ms: number;
}

export interface OptimiseResult {
  config: FightConfig;
  /** The final configuration at nFinal fights / runs. */
  ev: FightEval | MapEval;
  /** The starting party found by the first party step, at nFinal, for comparison. */
  firstPartyEv?: FightEval | MapEval;
  trace: OptimiseStep[];
  rounds: number;
  /** True when the time budget or shouldStop ended the search early (the result is the best so far). */
  stopped: boolean;
}

interface HeroState {
  attackList: Any;
  passive: string;
  inventory: Any[];
}

const isMap = (t: QuestTarget | MapTarget): t is MapTarget => "map" in t;

/**
 * Coordinate descent over party, skills, gear and scrolls. The heroes in `pool` are put back as they were at the
 * end; apply `config` to use the result. Each step keeps its change only if the score (nQuick) goes up.
 */
export function optimiseFight(sim: Sim, pool: Map<number, Hero>, target: QuestTarget | MapTarget, o: OptimiseOptions = {},
  ctl: SearchControl = {}): OptimiseResult {
  const map = isMap(target);
  const nQuick = o.nQuick ?? (map ? 4 : 10), nFinal = o.nFinal ?? (map ? 30 : 200);
  const steps = { party: true, order: true, swap: true, phase: true, skills: true, gear: Boolean(o.save), scrolls: map, ...o.steps };
  const deadline = Date.now() + (o.timeBudgetMs ?? 120_000);
  const minGain = o.minGain ?? 5, maxRounds = o.maxRounds ?? 2;
  let stepStart = Date.now();
  const outOfTime = () => Date.now() > deadline || Boolean(ctl.shouldStop?.());
  const inner: SearchControl = {
    onProgress: (d, t, s) => ctl.onProgress?.(d, t, `${current.step}: ${s}`),
    shouldStop: () => outOfTime(),
  };
  const current = { step: "" };

  // Snapshot every hero to restore at the end (searches restore their own changes; we apply the kept ones).
  const saved = new Map<number, HeroState>();
  for (const [id, h] of pool) saved.set(id, { attackList: sim.rotation(h), passive: h.passiveSelect, inventory: h.heroInventory.slice() });

  let t: QuestTarget | MapTarget = map ? { ...target, scrolls: target.scrolls ? [...target.scrolls] : null } : { ...target };
  const start = o.startParty;
  let party: PartyLayout = start
    ? { front: [0, 1, 2].map((i) => start.front[i] ?? null), back: [0, 1, 2].map((i) => start.back[i] ?? null) }
    : { front: [null, null, null], back: [null, null, null] };
  const lock = [...new Set(o.lock ?? [])];
  for (const id of [...party.front, ...party.back, ...lock]) if (id !== null && !pool.has(id)) throw new Error(`hero #${id} is not in the pool`);
  if (lock.length > 6) throw new Error("at most 6 heroes can be locked in the party");
  const missingLocked = () => lock.filter((id) => !party.front.includes(id) && !party.back.includes(id));
  if (!steps.party && missingLocked().length) {
    throw new Error(`locked heroes not in the starting party: ${missingLocked().map((id) => `#${id}`).join(", ")}`);
  }
  const label = (id: number) => {
    const nm = (pool.get(id) as Any)?.name;
    return nm ? `${nm} (#${id})` : `#${id}`;
  };
  const toRows = (p: PartyLayout): [Row, Row] => [p.front.map((id) => (id === null ? null : pool.get(id)!)),
    p.back.map((id) => (id === null ? null : pool.get(id)!))];
  /** nQuick score of a layout; -Infinity when it is empty or the game would not offer it the quest amount
   * (maxQuestAmount: the party's highest prestige), instead of the error evaluate throws. */
  const evalScore = (front: Row, back: Row): number => {
    if (!front.some(Boolean) && !back.some(Boolean)) return -Infinity;
    if (!map) {
      const q = t as QuestTarget;
      try {
        checkAmount(sim, front, back, Boolean(q.rare), q.amount ?? 1);
      } catch {
        return -Infinity;
      }
    }
    return evaluateTarget(sim, t, front, back, nQuick).score;
  };
  const gearChanges = new Map<number, { slot: string; item: string; from: string }[]>();
  const usedItems = new Set<string>(); // keys of owned items given to a party member
  const rows = (): [Row, Row] => toRows(party);
  const placed = () => [...party.front, ...party.back].filter((id): id is number => id !== null);
  const score = (): number => evalScore(...rows());
  /** Score of another layout (the current party is unchanged). */
  const scoreLayout = (p: PartyLayout): number => evalScore(...toRows(p));
  /** Everything a step can change, to skip a layout pass on a configuration it has already seen. */
  const configKey = () => JSON.stringify([party, placed().map((id) => [sim.rotation(pool.get(id)!), pool.get(id)!.passiveSelect]),
    [...gearChanges], map ? (t as MapTarget).scrolls : null]);
  let lastLayoutKey = "";

  const trace: OptimiseStep[] = [];
  let firstPartyEv: FightEval | MapEval | undefined;
  let stopped = false, round = 0;
  try {
    for (round = 1; round <= maxRounds; round++) {
      let improved = false;
      const gains = (before: number, after: number) => after > -Infinity && after >= before + minGain;
      const record = (step: string, before: number, after: number, change: string) => {
        trace.push({ round, step, before, after, change, ms: Date.now() - stepStart });
        stepStart = Date.now();
        // another round only helps if something other than the party moved (the party is searched once by default)
        if (after > before + 1e-9 && (step !== "party" || o.partyEveryRound)) improved = true;
      };

      // 1. party and rows (with every hero's current rotation and gear)
      if (steps.party && (round === 1 || o.partyEveryRound)) {
        stepStart = Date.now();
        current.step = "party";
        if (outOfTime()) throw new SearchCancelled();
        const before = score();
        // searchParty knows neither locks nor the prestige rule of a quest amount: the constrained search does both
        const constrained = lock.length > 0 || (!map && ((t as QuestTarget).amount ?? 1) > 1);
        const res = constrained
          ? constrainedParty()
          : (({ party: p, ev }) => ({ party: p, score: ev.score }))(searchParty(sim, pool, t, { size: o.size ?? 6, nQuick, nFinal: nQuick }, inner));
        const newParty = res.party;
        const after = res.score;
        if (gains(before, after) || (after > -Infinity && missingLocked().length)) {
          // members leaving the party give back the items they were lent
          for (const id of placed()) if (![...newParty.front, ...newParty.back].includes(id)) returnGear(id);
          party = newParty;
          record("party", before, after, describeParty(newParty));
        } else record("party", before, before, "kept");
        if (!firstPartyEv && score() > -Infinity) {
          const [front, back] = rows();
          firstPartyEv = evaluateTarget(sim, t, front, back, nFinal);
        }
      }

      // 1b. order within rows, row swaps and rotation phases for the party just found
      layoutPass();

      // 2. each member's rotation and passive
      if (steps.skills) {
        for (const id of placed()) {
          current.step = `skills #${id}`;
          stepStart = Date.now();
          if (outOfTime()) throw new SearchCancelled();
          const h = pool.get(id)!;
          const before = score();
          const [front, back] = rows();
          const res = searchSkills(sim, h, front, back, t, { nQuick, nFinal: nQuick, top: o.skillsTop ?? 2, prefilter: o.prefilter }, inner);
          const best = res.ranked[0];
          if (best && gains(before, best.ev.score)) {
            sim.setSkills(h, best.rotation, best.passive);
            record(`skills #${id}`, before, best.ev.score, `${best.rotation.join(" / ")} | ${best.passive}`);
          } else record(`skills #${id}`, before, before, "kept");
        }
        // 2b. new rotations change who should act first and when: order, swaps and phases again
        layoutPass();
      }

      // 3. each member's gear from owned items, none used twice
      if (steps.gear && o.save) {
        for (const id of placed()) {
          current.step = `gear #${id}`;
          stepStart = Date.now();
          if (outOfTime()) throw new SearchCancelled();
          const h = pool.get(id)!;
          const before = score();
          const cands = freeCandidates(o.save, party, id, usedItems);
          const [front, back] = rows();
          // searchGear scores every candidate with the hero's rotation and passive and puts them back (an item that
          // lowers AP makes the game reset them: Hero:calculateAPRemainder)
          const rot0 = sim.rotation(h), passive0 = h.passiveSelect, inv0 = h.heroInventory.slice();
          const res = searchGear(sim, h, front, back, t, cands.byslot, { n: nQuick, passes: o.gearPasses ?? 1 }, inner);
          const changes = res.gear.filter((g) => g.from !== null);
          let after = -Infinity;
          if (changes.length && gains(before, res.final.score)) {
            for (const g of changes) {
              const c = cands.byLabel.get(g.from!)!;
              if (typeof c.item === "string") sim.equip(h, g.slot, c.item);
              else sim.equipItem(h, g.slot, c.item);
            }
            sim.setSkills(h, rot0, passive0); // the game's default if the new gear can't afford the rotation
            after = score();
          }
          if (gains(before, after)) {
            for (const g of changes) {
              const c = cands.byLabel.get(g.from!)!;
              usedItems.add(c.key);
              gearChanges.set(id, [...(gearChanges.get(id) ?? []).filter((x) => x.slot !== g.slotName),
                { slot: g.slotName, item: String(g.item), from: c.where, key: c.key } as Any]);
            }
            record(`gear #${id}`, before, after, changes.map((g) => `${g.slotName}: ${g.item}`).join(", "));
          } else {
            h.heroInventory = inv0;
            sim.setSkills(h, rot0, passive0); // also recomputes stats from the restored gear
            record(`gear #${id}`, before, before, "kept");
          }
        }
      }

      // 4. scrolls (map runs)
      if (steps.scrolls && map) {
        current.step = "scrolls";
        stepStart = Date.now();
        if (outOfTime()) throw new SearchCancelled();
        const before = score();
        const [front, back] = rows();
        const res = searchScrolls(sim, (t as MapTarget).map, front, back, { nQuick, nFinal: nQuick, top: 4, prices: {} }, inner);
        const best = res.ranked[0];
        if (best && gains(before, best.ev.score)) {
          t = { ...(t as MapTarget), scrolls: best.loadout.length ? best.loadout.map((id) => ({ id, prestigeLevel: 0 })) : null };
          record("scrolls", before, best.ev.score, best.loadout.length ? best.loadout.join(", ") : "none");
        } else record("scrolls", before, before, "kept");
      }

      if (!improved) break;

      /**
       * searchParty with constraints: locked heroes are placed first (in their starting slot, else the best free
       * slot) and never leave; layouts the quest amount is not offered to score -Infinity. Then, as searchParty:
       * greedy adds while the score rises, then swaps (unlocked heroes only) and moves until no improvement.
       */
      function constrainedParty(): { party: PartyLayout; score: number } {
        const ids = [...pool.keys()];
        const size = Math.max(o.size ?? 6, lock.length);
        const slots = ["front:0", "front:1", "front:2", "back:0", "back:1", "back:2"];
        const at = new Map<string, number>();
        const layout = (): PartyLayout => ({
          front: [0, 1, 2].map((i) => at.get(`front:${i}`) ?? null), back: [0, 1, 2].map((i) => at.get(`back:${i}`) ?? null),
        });
        const used = () => new Set(at.values());
        let stage = "", done = 0, total = 0;
        const begin = (name: string, n: number) => {
          [stage, done, total] = [`party: ${name}`, 0, n];
          ctl.onProgress?.(0, n, stage);
        };
        const sc = () => {
          if (outOfTime()) throw new SearchCancelled();
          const v = scoreLayout(layout());
          ctl.onProgress?.(++done, total, stage);
          return v;
        };
        const startSlot = (id: number) =>
          start && slots.find((x) => (start[x.split(":")[0] as "front" | "back"][Number(x.split(":")[1])] ?? null) === id);
        for (const id of lock) {
          const own = startSlot(id);
          if (own && !at.has(own)) {
            at.set(own, id);
            continue;
          }
          let pick: [number, string] | null = null;
          begin(`lock ${label(id)}`, 6 - at.size);
          for (const slot of slots.filter((x) => !at.has(x))) {
            at.set(slot, id);
            const v = sc();
            at.delete(slot);
            if (!pick || v > pick[0]) pick = [v, slot];
          }
          at.set(pick![1], id);
        }
        begin("locked heroes", 1);
        let best = at.size ? sc() : -Infinity;
        while (at.size < size) {
          let cand: [number, number, string] | null = null;
          begin(`add ${at.size + 1}`, ids.filter((x) => !used().has(x)).length * (6 - at.size));
          for (const id of ids.filter((x) => !used().has(x))) {
            for (const slot of slots.filter((x) => !at.has(x))) {
              at.set(slot, id);
              const v = sc();
              at.delete(slot);
              if (!cand || v > cand[0]) cand = [v, id, slot];
            }
          }
          if (!cand || cand[0] <= best + 1e-9) break;
          best = cand[0];
          at.set(cand[2], cand[1]);
        }
        let again = true;
        while (again) {
          again = false;
          for (const slot of [...at.keys()]) {
            const cur = at.get(slot)!;
            const options: (["swap", number] | ["move", string])[] = [
              ...(lock.includes(cur) ? [] : ids.filter((x) => !used().has(x)).map((x) => ["swap", x] as ["swap", number])),
              ...slots.filter((x) => !at.has(x)).map((x) => ["move", x] as ["move", string]),
            ];
            begin("improve", options.length);
            for (const [kind, x] of options) {
              if (kind === "swap") at.set(slot, x as number);
              else (at.delete(slot), at.set(x as string, cur));
              const v = sc();
              if (v > best + 1e-9) {
                best = v;
                again = true;
                break;
              }
              if (kind === "swap") at.set(slot, cur);
              else (at.delete(x as string), at.set(slot, cur));
            }
            if (again) break;
          }
        }
        return { party: layout(), score: best };
      }

      /** Order, row swaps and phase shifts, unless nothing changed since the last pass (same seeds: same result). */
      function layoutPass() {
        if (!placed().length) return;
        const key = configKey();
        if (key === lastLayoutKey) return;
        if (steps.order) orderStep("Order within rows");
        if (steps.swap) swapStep();
        if (steps.phase) for (const id of placed()) phaseStep(id);
        lastLayoutKey = configKey();
      }

      /** Every order of the heroes within the front row and within the back row (empty slots move too). */
      function orderStep(name: string) {
        current.step = name;
        stepStart = Date.now();
        const cands: PartyLayout[] = [];
        const seen = new Set<string>();
        for (const front of permutations3(party.front)) {
          for (const back of permutations3(party.back)) {
            const k = JSON.stringify([front, back]);
            if (!seen.has(k)) (seen.add(k), cands.push({ front, back }));
          }
        }
        const best = bestLayout(name, cands);
        if (gains(best.before, best.after)) {
          party = best.layout;
          record(name, best.before, best.after, describeParty(party));
        } else record(name, best.before, best.before, "kept");
      }

      /** One front slot exchanged with one back slot (a hero may move to an empty slot), then the order again. */
      function swapStep() {
        current.step = "Swap rows";
        stepStart = Date.now();
        const cands: PartyLayout[] = [];
        const names = new Map<PartyLayout, string>();
        const who = (id: number | null, row: string, i: number) => (id === null ? `empty ${row} ${i + 1}` : label(id));
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            if (party.front[i] === null && party.back[j] === null) continue;
            const front = party.front.slice(), back = party.back.slice();
            [front[i], back[j]] = [party.back[j], party.front[i]];
            const c = { front, back };
            cands.push(c);
            names.set(c, `${who(party.front[i], "front", i)} ↔ ${who(party.back[j], "back", j)}`);
          }
        }
        const best = bestLayout("Swap rows", cands);
        if (gains(best.before, best.after)) {
          const name = `Swap rows: ${names.get(best.layout)}`;
          party = best.layout;
          record(name, best.before, best.after, describeParty(party));
          if (steps.order) orderStep("Order within rows (after swap)");
        } else record("Swap rows", best.before, best.before, "kept");
      }

      /** The current layout's score and the best of `cands` (the current layout is skipped). */
      function bestLayout(name: string, cands: PartyLayout[]) {
        const curKey = JSON.stringify([party.front, party.back]);
        cands = cands.filter((c) => JSON.stringify([c.front, c.back]) !== curKey);
        if (outOfTime()) throw new SearchCancelled();
        const before = score();
        let best: { layout: PartyLayout; after: number } | null = null;
        ctl.onProgress?.(0, cands.length, name);
        cands.forEach((c, i) => {
          if (outOfTime()) throw new SearchCancelled();
          const sc = scoreLayout(c);
          if (!best || sc > best.after) best = { layout: c, after: sc };
          ctl.onProgress?.(i + 1, cands.length, name);
        });
        return { before, after: best ? (best as { after: number }).after : before, layout: best ? (best as { layout: PartyLayout }).layout : party };
      }

      /** The hero's rotation shifted cyclically by 1-4 slots, passive kept: when each skill lands vs the enemy's turns. */
      function phaseStep(id: number) {
        const name = `Phase of ${label(id)}`;
        current.step = name;
        stepStart = Date.now();
        const h = pool.get(id)!;
        const rot = sim.rotation(h), passive = h.passiveSelect;
        if (outOfTime()) throw new SearchCancelled();
        const before = score();
        const seen = new Set([rot.join()]);
        let shifts = [1, 2, 3, 4].map((s) => ({ s, r: shiftRotation(rot, s) }))
          .filter(({ r }) => !seen.has(r.join()) && (seen.add(r.join()), true));
        // schedule pre-filter: simulate the 2 best shifts by counter-schedule score and the best by damage only
        const kPre = o.prefilter === false ? 0 : o.prefilter ?? 15;
        // not on fights the party doesn't win reliably (score < 0.5 x 1e6): the schedule score ranks those poorly
        if (kPre > 0 && !map && hasTimelines() && shifts.length > 2 && before >= 5e5) {
          try {
            const q = t as QuestTarget, tl = enemyTimeline(q.quest, q.rare ?? false);
            const [front, back] = rows();
            const ctx = scheduleContext(q.quest, front, back, { rare: q.rare, amount: q.amount });
            const by = (w: Partial<ScoreWeights>) => [...shifts].sort((a, b) =>
              scoreSchedule(scheduleParty(sim, front, back, h, b.r), tl, w, ctx).total -
              scoreSchedule(scheduleParty(sim, front, back, h, a.r), tl, w, ctx).total);
            const keep = new Set([...by({}).slice(0, 2), by(DAMAGE_ONLY)[0]]);
            shifts = shifts.filter((x) => keep.has(x));
          } catch {
            // no timeline for this quest: every shift
          }
        }
        let best: { s: number; r: string[]; sc: number } | null = null;
        ctl.onProgress?.(0, shifts.length, name);
        try {
          shifts.forEach(({ s, r }, i) => {
            if (outOfTime()) throw new SearchCancelled();
            sim.setSkills(h, r, passive);
            // the game only constrains the AP total (Hero:calculateAPRemainder), which a shift keeps; check anyway
            if (sim.rotation(h).join() === r.join() && h.passiveSelect === passive) {
              const sc = score();
              if (!best || sc > best.sc) best = { s, r, sc };
            }
            ctl.onProgress?.(i + 1, shifts.length, name);
          });
        } finally {
          sim.setSkills(h, rot, passive);
        }
        const b = best as { s: number; r: string[]; sc: number } | null;
        if (b && gains(before, b.sc)) {
          sim.setSkills(h, b.r, passive);
          record(`${name}: +${b.s}`, before, b.sc, `shift ${b.s}: ${b.r.join(" / ")}`);
        } else record(name, before, before, "kept");
      }
    }
  } catch (e) {
    if (!(e instanceof SearchCancelled)) throw e;
    stopped = true;
  }

  // final evaluation, then put every hero back as it was
  const [front, back] = rows();
  // no party, or one the quest amount is not offered to (score -Infinity): nothing to evaluate
  const ev = placed().length && score() > -Infinity ? evaluateTarget(sim, t, front, back, nFinal) : undefined;
  const config: FightConfig = {
    party,
    skills: Object.fromEntries(placed().map((id) => [id, { rotation: sim.rotation(pool.get(id)!), passive: pool.get(id)!.passiveSelect }])),
    gear: Object.fromEntries(placed().filter((id) => gearChanges.has(id))
      .map((id) => [id, gearChanges.get(id)!.map(({ slot, item, from }) => ({ slot, item, from }))])),
    scrolls: map ? ((t as MapTarget).scrolls ?? null) : null,
  };
  for (const [id, h] of pool) {
    const st = saved.get(id)!;
    h.heroInventory = st.inventory.slice();
    sim.setSkills(h, st.attackList, st.passive);
  }
  if (!ev) {
    if (stopped) throw new SearchCancelled(); // stopped before a party existed: nothing to return
    throw new Error("no party could be formed from the pool");
  }
  return { config, ev, firstPartyEv, trace, rounds: Math.min(round, maxRounds), stopped };

  function returnGear(id: number) {
    for (const g of gearChanges.get(id) ?? []) usedItems.delete((g as Any).key);
    gearChanges.delete(id);
    const h = pool.get(id)!;
    h.heroInventory = saved.get(id)!.inventory.slice();
    h.determineStats();
  }
}

/** `rot` started `s` slots further in its cycle: slot k of the result is slot k + s of `rot` (mod its length). */
export function shiftRotation<T>(rot: T[], s: number): T[] {
  const n = rot.length;
  return rot.map((_, k) => rot[(((k + s) % n) + n) % n]);
}

/** The 6 orders of a 3-slot row (duplicates when it has several empty slots). */
function permutations3<T>(r: T[]): T[][] {
  const [a, b, c] = r;
  return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
}

function describeParty(p: PartyLayout): string {
  const fmt = (r: (number | null)[]) => r.map((x) => (x === null ? "-" : `#${x}`)).join(" ");
  return `front ${fmt(p.front)} | back ${fmt(p.back)}`;
}

/**
 * Owned items a party member may take: inventory and sale slots not given to another member, and gear worn by
 * heroes outside the party. Labels are unique so a chosen candidate maps back to its item.
 */
function freeCandidates(save: Save, party: PartyLayout, heroId: number, used: Set<string>) {
  const inParty = new Set([...party.front, ...party.back].filter((x) => x !== null));
  const byslot = new Map<number, GearCandidate[]>();
  const byLabel = new Map<string, { item: Any; key: string; where: string }>();
  const add = (slot: number, where: string, key: string, item: Any) => {
    if (used.has(key)) return;
    const label = `${where} [${key}]`;
    byLabel.set(label, { item, key, where });
    byslot.set(slot, [...(byslot.get(slot) ?? []), [label, item]]);
  };
  save.inventory.forEach((it: Any, i: number) => {
    if (it.itemType === "equipment" && it.itemSlot) add(it.itemSlot, "inventory", `inv${i}`, it.compact);
  });
  save.sales.forEach((it: Any, i: number) => {
    if (it && it.itemType === "equipment" && it.itemSlot) add(it.itemSlot, "sale slot", `sale${i}`, it.compact);
  });
  for (const raw of save.raw.hero ?? []) {
    if (raw.id === heroId || inParty.has(raw.id)) continue;
    (raw.heroInventory ?? []).forEach((it: Any, i: number) => {
      if (typeof it === "string") add(Number.parseInt(it.split("|")[3], 10), `worn by #${raw.id} ${raw.name ?? ""}`, `h${raw.id}.${i}`, it);
    });
  }
  return { byslot, byLabel };
}

