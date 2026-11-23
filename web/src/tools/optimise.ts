/**
 * Joint optimiser for one fight (a quest) or one map run: party and rows, each member's rotation and passive,
 * each member's gear from the items you own, and the scrolls of a map run, tuned together by coordinate descent.
 *
 *   const res = optimiseFight(sim, pool, { quest: 81 }, { save })
 *   res.config.party.front, res.config.skills[heroId].rotation, res.trace
 *
 * Every evaluation uses seeds 1..n (common random numbers), so a step is only kept when it beats the current
 * configuration on the same rolls. Pure: no output, no Node APIs; progress and cancel through SearchControl.
 */
import {
  evaluateTarget, type FightEval, type GearCandidate, type MapEval, type MapTarget, type PartyLayout, type QuestTarget,
  SearchCancelled, type SearchControl, searchGear, searchParty, searchScrolls, searchSkills,
} from "./combat.ts";
import type { Hero, Row, Scroll, Sim } from "./engine.ts";
import type { Save } from "./save.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface OptimiseOptions {
  /** The save: owned items for the gear step (inventory, sale slots, gear of heroes outside the party). Without it, gear is kept. */
  save?: Save;
  /** Party size (default 6). */
  size?: number;
  /** Fights / map runs per candidate (default 10 fights, 4 runs) and for the final evaluation (default 200 / 30). */
  nQuick?: number;
  nFinal?: number;
  /** Steps to run (default all). */
  steps?: { party?: boolean; skills?: boolean; gear?: boolean; scrolls?: boolean };
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
  const steps = { party: true, skills: true, gear: Boolean(o.save), scrolls: map, ...o.steps };
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
  let party: PartyLayout = { front: [null, null, null], back: [null, null, null] };
  const gearChanges = new Map<number, { slot: string; item: string; from: string }[]>();
  const usedItems = new Set<string>(); // keys of owned items given to a party member
  const rows = (): [Row, Row] => [party.front.map((id) => (id === null ? null : pool.get(id)!)),
    party.back.map((id) => (id === null ? null : pool.get(id)!))];
  const placed = () => [...party.front, ...party.back].filter((id): id is number => id !== null);
  const score = (): number => {
    const [front, back] = rows();
    return placed().length ? evaluateTarget(sim, t, front, back, nQuick).score : -Infinity;
  };

  const trace: OptimiseStep[] = [];
  let firstPartyEv: FightEval | MapEval | undefined;
  let stopped = false, round = 0;
  try {
    for (round = 1; round <= maxRounds; round++) {
      let improved = false;
      const gains = (before: number, after: number) => after >= before + minGain;
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
        const res = searchParty(sim, pool, t, { size: o.size ?? 6, nQuick, nFinal: nQuick }, inner);
        const newParty = res.party;
        const after = res.ev.score;
        if (gains(before, after)) {
          // members leaving the party give back the items they were lent
          for (const id of placed()) if (![...newParty.front, ...newParty.back].includes(id)) returnGear(id);
          party = newParty;
          record("party", before, after, describeParty(newParty));
        } else record("party", before, before, "kept");
        if (!firstPartyEv) {
          const [front, back] = rows();
          firstPartyEv = evaluateTarget(sim, t, front, back, nFinal);
        }
      }

      // 2. each member's rotation and passive
      if (steps.skills) {
        for (const id of placed()) {
          current.step = `skills #${id}`;
          stepStart = Date.now();
          if (outOfTime()) throw new SearchCancelled();
          const h = pool.get(id)!;
          const before = score();
          const [front, back] = rows();
          const res = searchSkills(sim, h, front, back, t, { nQuick, nFinal: nQuick, top: o.skillsTop ?? 2 }, inner);
          const best = res.ranked[0];
          if (best && gains(before, best.ev.score)) {
            sim.setSkills(h, best.rotation, best.passive);
            record(`skills #${id}`, before, best.ev.score, `${best.rotation.join(" / ")} | ${best.passive}`);
          } else record(`skills #${id}`, before, before, "kept");
        }
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
          const res = searchGear(sim, h, front, back, t, cands.byslot, { n: nQuick, passes: o.gearPasses ?? 1 }, inner);
          const changes = res.gear.filter((g) => g.from !== null);
          if (changes.length && gains(before, res.final.score)) {
            for (const g of changes) {
              const c = cands.byLabel.get(g.from!)!;
              if (typeof c.item === "string") sim.equip(h, g.slot, c.item);
              else sim.equipItem(h, g.slot, c.item);
              usedItems.add(c.key);
              gearChanges.set(id, [...(gearChanges.get(id) ?? []).filter((x) => x.slot !== g.slotName),
                { slot: g.slotName, item: String(g.item), from: c.where, key: c.key } as Any]);
            }
            record(`gear #${id}`, before, res.final.score, changes.map((g) => `${g.slotName}: ${g.item}`).join(", "));
          } else record(`gear #${id}`, before, before, "kept");
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
    }
  } catch (e) {
    if (!(e instanceof SearchCancelled)) throw e;
    stopped = true;
  }

  // final evaluation, then put every hero back as it was
  const [front, back] = rows();
  const ev = placed().length ? evaluateTarget(sim, t, front, back, nFinal) : undefined;
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

