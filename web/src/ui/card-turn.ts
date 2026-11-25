/**
 * U67: what the Party view's cards need of a traced fight at one turn beyond the chart's states (hp-chart.ts
 * FighterState): each stat's modifier parts, named (fighter-card.ts ModPart), and what the fighter's action of that
 * turn did (fighter-card.ts CardOutcome). Read from the same trace the chart and the Flows use (sim/api.ts TraceMod,
 * TraceOutcome); pure, for the tests.
 */
import type { TraceMod, TraceOutcome } from "../sim/api.ts";
import { effectName } from "./battle-calc.ts";
import type { TimelineChip } from "./battle-plan.ts";
import type { CardOutcome, ModPart, StatMods } from "./fighter-card.ts";
import { itemNameFromEnglish, passiveName } from "./names.ts";

type Life = { who: number; mods?: TraceMod[] };
/** What this module reads of a traced fight (tools/fight-trace.ts FightTrace). */
export interface CardTrace {
  actions: { turn: number; who: number; did: string | false | null; by?: string; out?: TraceOutcome[]; life?: Life[] }[];
  start?: { life: Life[] };
}

/** The fighter's stat parts at the end of `turn` (turn 0: the start): its last record up to then. */
export function modsAt(trace: CardTrace, turn: number, who: number): TraceMod[] {
  let mods: TraceMod[] | undefined = trace.start?.life.find((l) => l.who === who)?.mods;
  if (turn > 0) {
    for (const a of trace.actions) {
      if (a.turn > turn) break;
      const l = a.life?.find((x) => x.who === who);
      if (l) mods = l.mods;
    }
  }
  return mods ?? [];
}

/** "2 turns left"; an effect at 0 still works until its owner's next action. */
const left = (t: number) => (t <= 0 ? "ends at its next action" : `${t} turn${t === 1 ? "" : "s"} left`);

/** A part's source in words: "Might (passive)", "Holy Blessing from Ana, 2 turns left", "[Sturdy] Inferno Chapeau". */
export function modLabel(m: TraceMod, nameOf: (who: number) => string): string {
  switch (m.src) {
    case "effect": {
      const from = m.from !== undefined && m.from >= 0 ? ` from ${nameOf(m.from)}` : "";
      return `${effectName(m.skill ?? m.name)}${from}${m.turns !== undefined ? `, ${left(m.turns)}` : ""}`;
    }
    case "passive": return `${passiveName(m.name)} (passive)`;
    case "item": return itemNameFromEnglish("equipment", m.name);
    case "potion": return `${itemNameFromEnglish("consumable", m.name)} (potion)`;
    case "enchant": return "Enchantments";
    case "scroll": return "Scrolls";
    default: return "Other";
  }
}

/** The parts by stat, named; parts of one kind with the same name are added up (several enchantments). */
export function statMods(mods: TraceMod[], nameOf: (who: number) => string): StatMods {
  const out: StatMods = {};
  for (const m of mods) {
    const label = modLabel(m, nameOf);
    const list = (out[m.stat] ??= []);
    const same = list.find((p) => p.kind === m.kind && p.label === label);
    if (same) same.value += m.value;
    else list.push({ kind: m.kind, value: m.value, label } satisfies ModPart);
  }
  return out;
}

/**
 * What the fighter's action of `turn` did, on its rotation row ((turn − 1) mod 5): the effect that took it, or each
 * target's damage, healing, misses and crits. Null at turn 0, when it didn't act (down) or has no record.
 */
export function outcomeAt(trace: CardTrace, turn: number, who: number, nameOf: (who: number) => string): CardOutcome | null {
  if (turn <= 0) return null;
  const a = trace.actions.find((x) => x.turn === turn && x.who === who && x.did !== null);
  if (!a) return null;
  const row = (turn - 1) % 5;
  if (a.did === false) return { row, lost: a.by ? effectName(a.by) : "stunned", targets: [] };
  return { row, targets: (a.out ?? []).map((o) => ({ name: nameOf(o.who), dmg: o.dmg, heal: o.heal, hits: o.hits, heals: o.heals, miss: o.miss, crit: o.crit })) };
}

/** The effects a card lists: those that are no stat modifier (a stun, a taunt, a damage over time); the others are in the stats. */
export function nonStatFx(fx: TimelineChip[], mods: TraceMod[]): TimelineChip[] {
  const inStats = new Set(mods.filter((m) => m.src === "effect").map((m) => m.name));
  return fx.filter((c) => !inStats.has(c.name));
}

/**
 * A card's state at a turn beyond the chart's (battle-page.ts paintTurn, drawEnemyCard): the stats' modifier parts,
 * the effects to list (`fx`, the chart's, without the stat modifiers), what came of its action. No trace: the chart's
 * effects only.
 */
export function cardTurnOf(trace: CardTrace | undefined, turn: number, who: number, fx: TimelineChip[], nameOf: (who: number) => string):
  { mods?: StatMods; fx: TimelineChip[]; outcome: CardOutcome | null } {
  if (!trace) return { fx, outcome: null };
  const mods = modsAt(trace, turn, who);
  return { mods: statMods(mods, nameOf), fx: nonStatFx(fx, mods), outcome: outcomeAt(trace, turn, who, nameOf) };
}
