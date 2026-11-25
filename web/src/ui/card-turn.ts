/**
 * U67: what the Party view's cards need of a traced fight at one turn beyond the chart's states (hp-chart.ts
 * FighterState): each stat's modifier parts, named (fighter-card.ts ModPart), and what the fighter's action of that
 * turn did (fighter-card.ts CardOutcome). U69: and its HP change during the turn, by source (fighter-card.ts HpDelta).
 * Read from the same trace the chart and the Flows use (sim/api.ts TraceMod, TraceOutcome, TraceHit); pure, for the
 * tests.
 */
import type { TraceCalc, TraceMod, TraceOutcome } from "../sim/api.ts";
import { effectName } from "./battle-calc.ts";
import type { CardOutcome, HpDelta, HpSource, ModPart, StatMods } from "./fighter-card.ts";
import { itemNameFromEnglish, passiveName } from "./names.ts";

type Life = { who: number; hp?: number; mods?: TraceMod[] };
type Calc = Pick<TraceCalc, "kind" | "from" | "to" | "src" | "hpBefore" | "hpAfter"> & { missed?: boolean };
/** What this module reads of a traced fight (tools/fight-trace.ts FightTrace). */
export interface CardTrace {
  actions: { turn: number; who: number; did: string | false | null; by?: string; out?: TraceOutcome[]; life?: Life[];
    hits?: { who: number; calc?: Calc[] }[] }[];
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

/** U69: the fighter's HP at the end of `turn` (turn 0: the start), its last record up to then (0 when down); null: none. */
export function hpAt(trace: CardTrace, turn: number, who: number): number | null {
  let hp = trace.start?.life.find((l) => l.who === who)?.hp;
  if (turn > 0) {
    for (const a of trace.actions) {
      if (a.turn > turn) break;
      const l = a.life?.find((x) => x.who === who);
      if (l?.hp !== undefined) hp = l.hp;
    }
  }
  return hp === undefined ? null : Math.max(0, hp);
}

/**
 * U69: the fighter's HP change during `turn` (its HP at the turn's end less at the previous one's), and the hits and
 * heals behind it by source ("Odin · Fireball", "Ana · Heal"; a damage or heal over time under its effect's name):
 * the HP each really took or gave (no overkill, no overheal; nothing on a fighter already down). Null at turn 0 or
 * without HP records.
 */
export function hpDeltaAt(trace: CardTrace, turn: number, who: number, nameOf: (who: number) => string): HpDelta | null {
  if (turn <= 0) return null;
  const now = hpAt(trace, turn, who), before = hpAt(trace, turn - 1, who);
  if (now === null || before === null) return null;
  const taken = new Map<string, number>(), healed = new Map<string, number>();
  for (const a of trace.actions) {
    if (a.turn !== turn) continue;
    for (const h of a.hits ?? []) {
      if (h.who !== who) continue;
      for (const c of h.calc ?? []) {
        if (c.to !== who || (c.kind === "dmg" && c.missed)) continue;
        const v = c.kind === "heal" ? Math.max(0, c.hpAfter) - Math.max(0, c.hpBefore) : Math.max(0, c.hpBefore) - Math.max(0, c.hpAfter);
        if (v <= 0) continue;
        const label = `${c.from >= 0 ? `${nameOf(c.from)} · ` : ""}${effectName(c.src)}`;
        const into = c.kind === "heal" ? healed : taken;
        into.set(label, (into.get(label) ?? 0) + v);
      }
    }
  }
  const list = (m: Map<string, number>): HpSource[] => [...m].map(([label, value]) => ({ label, value }));
  return { turn, net: now - before, taken: list(taken), healed: list(healed) };
}

/**
 * A card's state at a turn beyond the chart's (battle-page.ts paintTurn, drawEnemyCard): the stats' modifier parts,
 * what came of its action, U69: its HP change. No trace: nothing more (U69: no effects list).
 */
export function cardTurnOf(trace: CardTrace | undefined, turn: number, who: number, nameOf: (who: number) => string):
  { mods?: StatMods; outcome: CardOutcome | null; hpDelta?: HpDelta | null } {
  if (!trace) return { outcome: null };
  return { mods: statMods(modsAt(trace, turn, who), nameOf), outcome: outcomeAt(trace, turn, who, nameOf), hpDelta: hpDeltaAt(trace, turn, who, nameOf) };
}
