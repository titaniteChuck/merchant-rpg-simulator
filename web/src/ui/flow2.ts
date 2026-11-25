/**
 * U58, Flow 2: the fight turn by turn, one column per fighter in action order, no column heads. Each turn starts
 * with its band ("Turn 3"), then a row of cards, one per fighter (the heroes and the enemy): its name, its HP at the
 * turn's start (U63: the Flows' shared bar, flow-hp.ts, "remaining / total" inside it) and its effects then, buffs and
 * then debuffs, one per line, as text (U37/U38: no coloured dots). Then the turn's action lines (skills, damage and
 * healing with their "▾ calculation", one column wide: battle-layout.ts calcColumn); the effects are in the next
 * cards. After the last turn, the cards as the fight ended, then the result. The first turn's cards say where each
 * hero stands and its level, and carry the hero and opponent pickers (with `edit`). U63: a hero's card is outlined in
 * its class colour (no ascension frame); the enemy's in its own.
 * Without a traced fight (no party, or one that can't fight): the rotation as planned (flow-planned.ts).
 * CSS: the `Flow 2` and `U63` blocks of style.css. Registered in flow-layouts.ts.
 */
import { lv, el } from "./dom.ts";
import { locationLabel, type PlanColumn, planGrid, type PlanMember, planTimeline, type TimelineCell, type TimelineChip,
  type TimelineTurn, type TracedFight } from "./battle-plan.ts";
import { actorEl, calcPanel, calcToggle, FLOW_PAGE, fmtInt, nameEdit, type PlanEdit, skillEdit, turnRow, unreachedRows } from "./flow-parts.ts";
import { hpBar } from "./flow-hp.ts";
import { PLANNED_NOTE, plannedRotation } from "./flow-planned.ts";
import { timelineOf, tlName } from "./timeline.ts";

type Life = { hp: number; maxHP: number };

/**
 * Every fighter's HP when the fight begins (0 = the enemy). The trace records life after each action, so the first
 * action's own hits are undone: their first calculation's HP before it, else the HP after it plus the damage, minus
 * the healing. (A map room starts from the HP the last room left.)
 */
export function fightStart(trace: TracedFight): Record<number, Life> {
  const first = trace.actions[0];
  const out: Record<number, Life> = {};
  for (const l of first?.life ?? []) {
    const h = first.hits.find((x) => x.who === l.who);
    const before = h?.calc?.[0]?.hpBefore ?? (h ? l.hp + h.dmg - h.heal : l.hp);
    out[l.who] = { hp: Math.max(0, Math.min(l.maxHP, before)), maxHP: l.maxHP };
  }
  return out;
}

/** What a card shows. `enemy`: the opponent's card (its own colour); `meta`: the first turn's line (place, level). */
export interface CardState {
  name: string;
  enemy: boolean;
  /** The hero's class: the card's outline, top edge and tint (U63: never the ascension). */
  cls?: number;
  life?: Life;
  fx: TimelineChip[];
  /** Turn 1: the name with its picker (nameEdit), and the place and level. */
  nameNode?: HTMLElement;
  meta?: (HTMLElement | string)[];
  /** For the screen reader text: "start of turn 3", "end of the fight". */
  when: string;
}

/** One effect line: what it does, and its turns left (the full "<skill> from <fighter> · N turns left" on hover). */
function fxLine(c: TimelineChip): HTMLElement {
  const left = c.turns !== undefined && c.turns > 0 ? c.turns : null;
  return el("li", { class: `f2-fx ${c.debuff ? "debuff" : "buff"}`, title: c.title },
    el("span", { class: "visually-hidden" }, c.debuff ? "Debuff: " : "Buff: "),
    el("span", { class: "f2-fx-name" }, c.label),
    ...(left === null ? [] : [el("span", { class: "visually-hidden" }, `, ${left} turn${left === 1 ? "" : "s"} left`),
      el("span", { class: "f2-fx-left", "aria-hidden": "true" }, String(left))]));
}

/**
 * A fighter's card: the name (✝ before it once down), the HP bar (flow-hp.ts), then the buffs and the debuffs one
 * per line. Down: dimmed, dashed, "0 / total" in an empty bar and no effects (they ended with it).
 */
export function fighterCard(s: CardState): HTMLElement {
  const down = s.life !== undefined && s.life.hp <= 0;
  const cls = s.enemy ? "enemy" : `hero cls-${s.cls ?? 0}`;
  const fx = down ? [] : s.fx;
  const buffs = fx.filter((c) => !c.debuff), debuffs = fx.filter((c) => c.debuff);
  const hpText = !s.life ? "" : down ? `down, 0 / ${fmtInt.format(s.life.maxHP)} HP` : `${fmtInt.format(s.life.hp)} / ${fmtInt.format(s.life.maxHP)} HP`;
  return el("div", { class: `f2-card ${cls}${down ? " dead" : ""}`, role: "cell", title: `${s.name}, ${s.when}${hpText ? `: ${hpText}` : ""}` },
    el("div", { class: "f2-name" }, ...(down ? [el("span", { class: "f2-dead", "aria-hidden": "true" }, "✝")] : []),
      s.nameNode ?? el("strong", {}, s.name)),
    ...(s.meta?.length ? [el("div", { class: "f2-meta" }, ...s.meta)] : []),
    ...(s.life ? [hpBar(s.life, `${s.name}: ${hpText}`)] : []),
    ...(buffs.length ? [el("ul", { class: "f2-fxs buffs" }, ...buffs.map(fxLine))] : []),
    ...(debuffs.length ? [el("ul", { class: "f2-fxs debuffs" }, ...debuffs.map(fxLine))] : []));
}

/** What a fighter took during one action: damage, healing (each with its ▾), "no target", KO; the effects are in the cards. */
function takenEl(c: TimelineCell | undefined, w: number, nameOf: (w: number) => string, box: HTMLElement, col: number): HTMLElement[] {
  if (!c) return [];
  const name = nameOf(w);
  return [
    ...(c.dmg ? [el("span", { class: "tc-dmg", title: `${fmtInt.format(c.dmg)} damage to ${name}` }, `−${fmtInt.format(c.dmg)}`),
      calcToggle(() => calcPanel(c.calc, "dmg", nameOf, c.dmg), box, col * 2, `the damage to ${name}`)] : []),
    ...(c.deadHits ? [el("span", { class: "tc-void", title: `${name} was already down: these hits change nothing.` }, c.dmg ? "then no target" : "no target"),
      ...(c.dmg ? [] : [calcToggle(() => calcPanel(c.calc, "dmg", nameOf, 0), box, col * 2, `the hits on ${name}`)])] : []),
    ...(c.heal ? [el("span", { class: "tc-heal", title: `${fmtInt.format(c.heal)} HP healed on ${name}` }, `+${fmtInt.format(c.heal)}`),
      calcToggle(() => calcPanel(c.calc, "heal", nameOf, c.heal), box, col * 2 + 1, `the healing on ${name}`)] : []),
    ...(c.ko ? [el("span", { class: "tc-ko", title: "Falls" }, "✝ KO")] : []),
  ];
}

/**
 * Flow 2 (U58): the layout registry's signature (flow-layouts.ts FlowRender). Null without a timeline for this enemy;
 * without a traced fight, the rotation as planned (flow-planned.ts).
 */
export function renderFlow2(quest: { id: number; rare: boolean }, members: PlanMember[], trace: TracedFight | null = null, edit?: PlanEdit): HTMLElement | null {
  const tl = timelineOf(quest.id, quest.rare);
  if (!tl) return null;
  if (!trace || !members.length) return plannedRotation(quest, members, edit);
  const cols = planGrid(tl, members, 5).columns;
  const whoOf = (c: PlanColumn) => (c.kind === "enemy" ? 0 : c.loc!);
  const nameOf = (w: number) => (w ? cols.find((c) => c.loc === w)?.member?.name ?? locationLabel(w) : tlName(tl));
  const data = planTimeline(trace, cols.filter((c) => c.kind === "hero").map((c) => c.loc!), nameOf);
  const start = fightStart(trace);

  /** The cards row: every fighter's state at a turn's start (`first`: turn 1, with the place, level and pickers). */
  const cards = (life: Record<number, Life>, status: Record<number, TimelineChip[]>, when: string, label: string, first = false) =>
    el("div", { class: "f2-cards", role: "row", "aria-label": label }, ...cols.map((c) => {
      const w = whoOf(c);
      const base = { life: life[w], fx: status[w] ?? [], when };
      if (c.kind === "enemy") {
        const e = first ? edit?.enemies?.() ?? null : null;
        return fighterCard({ ...base, name: tlName(tl), enemy: true,
          ...(first ? { meta: ["enemy", ...(tl.rare ? [" · ", el("span", { class: "f2-rare" }, "rare")] : [])] } : {}),
          ...(e ? { nameNode: nameEdit(tlName(tl), e.label, e.groups, e.value, "enemy", (v) => edit!.setEnemy?.(v)) } : {}) });
      }
      const m = c.member!;
      const h = first ? edit?.heroes(c.loc!) : undefined;
      const meta = [el("span", {}, locationLabel(c.loc!)), ...(m.level !== undefined ? [" · ", el("span", {}, lv(m.level))] : [])];
      return fighterCard({ ...base, name: m.name, enemy: false, cls: m.cls, ...(first ? { meta } : {}),
        ...(h ? { nameNode: nameEdit(m.name, `${locationLabel(c.loc!)}: hero`, h.options, h.value, `hero-${c.loc}`, (v) => edit!.setHero(c.loc!, v)) } : {}) });
    }));

  const turnEl = (t: TimelineTurn): HTMLElement => {
    const prev = data.turns[t.turn - 2];
    const head = cards(prev ? prev.hp : start, prev ? prev.status : {}, `start of turn ${t.turn}`, `Turn ${t.turn}: each fighter at its start`, t.turn === 1);
    const rows: HTMLElement[] = t.lines.flatMap((l) => {
      const box = el("div", { class: "tc-calcs", role: "row", "aria-label": `${nameOf(l.who)}: calculations`, "data-cols": String(cols.length) });
      box.hidden = true;
      const line = el("div", { class: "tc-line", role: "row", "aria-label": `${nameOf(l.who)} acts` }, ...cols.map((c, k) => {
        const w = whoOf(c), actor = w === l.who;
        const cls = actor ? ` actor ${c.kind === "enemy" ? "enemy" : `cls-${c.member!.cls}`}` : "";
        return el("div", { class: `tc-cell${cls}`, role: "cell" }, ...(actor ? actorEl(l) : []),
          ...(actor && c.kind === "hero" ? skillEdit(edit, w, t.turn, l.planned) : []), ...takenEl(l.cells[w], w, nameOf, box, k));
      }));
      return [line, box];
    });
    return el("div", { class: `tc-turn f2-turn${t.rotation ? " rotation" : ""}`, role: "rowgroup", "aria-label": `Turn ${t.turn}` },
      turnRow(t.turn, cols.length), head, el("div", { class: "tc-lines" }, ...rows));
  };

  const oneCell = (cls: string, ...kids: HTMLElement[]) => el("div", { class: cls, role: "row" }, el("div", { role: "cell" }, ...kids));
  const last = data.turns[data.turns.length - 1];
  const end = el("div", { class: "tc-turn f2-turn f2-end", role: "rowgroup", "aria-label": "End of the fight" },
    el("div", { class: "tc-turnrow", role: "row" }, el("div", { class: "tc-turnhead", role: "rowheader", "aria-colspan": String(cols.length) }, "End")),
    cards(last ? last.hp : start, last ? last.status : {}, "end of the fight", "Each fighter at the end of the fight"));
  const result = oneCell("tc-result-row", el("p", { class: `tc-result ${data.won ? "won" : "lost"}`, role: "status" },
    data.won ? `🏆 Won on turn ${data.lastTurn}` : data.capped ? `⏱ Stopped at the game's turn cap (${data.lastTurn} turns): lost`
      : `💀 Lost on turn ${data.lastTurn}`));
  const body = el("div", { class: "tc-body" }, ...data.turns.slice(0, FLOW_PAGE).map(turnEl));
  if (data.turns.length > FLOW_PAGE) {
    const more = el("button", { type: "button", class: "secondary tc-more" }, `Show turns ${FLOW_PAGE + 1}–${data.lastTurn}`);
    const moreRow = oneCell("tc-more-row", more);
    more.addEventListener("click", () => moreRow.replaceWith(...data.turns.slice(FLOW_PAGE).map(turnEl)));
    body.append(moreRow);
  }
  body.append(end, result, ...unreachedRows(cols, new Set(data.turns.map((t) => t.turn)), edit));
  return el("div", { class: "tl pg tc f2", role: "group", "aria-label": "The fight, turn by turn, each turn from its fighters' state" },
    el("div", { class: "pg-scroll tc-scroll" }, el("div", { class: "pg-grid tc-grid", role: "table", style: `--pg-cols: ${cols.length}` }, body)));
}

/** Flow 2's "?" (the run's note comes first, battle-page.ts). */
export function flow2Note(editable: boolean): string {
  return "Each turn starts with one card per fighter: its HP at the turn's start, then its buffs and debuffs, one per line "
    + "(the number: turns left). Then the turn's actions in order, one line each: the skill in the actor's column, damage (−) "
    + "and healing (+) in the target's; ▾ calculation opens how a number was worked out. Heroes play rotation slot k on turn k; "
    + "turn 6 is turn 1 again."
    + (editable ? " In turn 1, a name changes the hero or the opponent; ▾ changes a skill in turns 1–5." : "")
    + ` ${PLANNED_NOTE}`;
}
