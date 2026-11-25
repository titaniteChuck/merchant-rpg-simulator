/**
 * The Battle section's two pages (U41), one code: initBattlePage("simulate") for the Simulator (site/battle.html,
 * entry battle.ts) and initBattlePage("solve") for the Solver (site/solver.html, entry solver.ts).
 *
 * Simulator (U48: no section titles, no Results section): the Simulate panel (runs, ▶ Simulate, then the run's
 * progress or its summary: win rate, grade when won, Show details), the details right under it; then the party (six
 * slots, back row | front row; cards move by drag and drop, party-drag.ts) on the left and the opponent card (a quest
 * enemy or a map run) on the right; U39: two tabs, Party (those) and Flow (the whole fight, turn by turn, editable).
 * U48: the Solver's Party and Flow are read-only (battle-edit.ts pageControls); both pages have a "↑" back-to-top button.
 * U51: one "?" beside the Party / Flow tabs, the open tab's (showTab). U58: Flow layouts to compare (flow-layouts.ts;
 * U63: Party · Flow 2 · Flow 3, Flow 1 gone), one Flow panel drawn by the open one. U61: the Party view's HP chart
 * (hp-chart.ts), drawn by renderPlan from the very trace it hands the Flow layout. U62: the Party view in three
 * columns, heroes | opponent | HP chart (#hp-col); the hero and enemy cards are one builder (fighter-card.ts): the picker as the
 * head, the stats on two lines, the rotation (the enemy's from its timeline, read-only); a skill or passive opens its
 * picker in place, each choice with its effect (pick-list.ts). The enemy list holds each rare variant as its own entry
 * ("<id>:rare"), no "Rare variant" box. U65: the chart is the Party view's first row, full width, over heroes |
 * opponent (no third column); a click, a tap or the arrow keys on it pick a turn and every card shows that turn's end
 * (paintTurn: HP, the engine's live stats, the effects, the row played; turn 0 the start), from the same trace. The
 * opponent is chosen in the Simulate panel (quest or map run, size, map, grade, scrolls; the Solver's Solve panel as
 * before); its card shows one enemy, no picker (drawEnemyCard; a map run: the selected turn's room's).
 *
 * Solver (U42): the spoiler guard (battle-search.ts) first, then one full-width Solve panel: the quest / map toggle and
 * its pickers (the opponent card waits in #target-card, beside the party: drawEnemyCard), the options, the time budget,
 * Solve and its progress; the results under it only once a solve is done; the Party and Flow tabs stay hidden until a
 * result's "Show" fills them (revealParty). Its party is its own, in memory only: the Simulator's remembered
 * party changes only by "Open in Simulator" (battle-links.ts simulatorPartyFrom), which copies the shown party and
 * the opponent over and opens the Simulator. The Solver's opponent is remembered apart (`solver-opponent`).
 * Runs go to a web worker with the game's rules (TypeScript engine).
 *
 * Expansions (U28): the enemy and map pickers and the scrolls leave out content of expansions the visitor hides
 * (expansion-state.ts); the save's own maps always stay. Options of expansion content end with ❄ / ✒. The opponent
 * card is rebuilt (keeping the choice when it is still there) whenever the expansion switches change.
 */
import * as api from "../sim/api.ts";
import { dataJson, dataWorker } from "./data-files.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { maxQuestAmount, SCROLL_IDS } from "../tools/combat.ts";
import type { FightEval, HeroEval, MapEval } from "../tools/combat.ts";
import { type MapSpec, type Scroll, Sim } from "../tools/engine.ts";
import { type FightTrace, type MapRoomTrace, traceFight, traceMapRun } from "../tools/fight-trace.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import type { BattleRequest, BattleResponse, SkillChoice } from "./battle-worker.ts";
import { $, duration, el, expansionMark, fmt, fmt1, gold, gradeBadge, heroAsc, LV, lv, lvStart, pct, pill, rateTone, type Row, select, table, tabKeys, tile, toast } from "./dom.ts";
import { isHidden, isVisible, needsOf, subscribe } from "./expansion-state.ts";
import { type CardRow, fighterCard, paintCard } from "./fighter-card.ts";
import { hpTexts } from "./flow-hp.ts";
import type { PickOption } from "./pick-list.ts";
import { initSearch, type PartyMember } from "./battle-search.ts";
import { linkedOpponent, SIMULATOR_PAGE, simulatorPartyFrom, type StoredParty, withoutOpponentQuery } from "./battle-links.ts";
import { migrateOldLocks } from "./solver-heroes.ts";
import { type PageTarget, problemOf, rulesOf, rulesText } from "./battle-rules.ts";
import { loadTimelineData, timelineOf } from "./timeline.ts";
import type { PlanEdit } from "./flow-parts.ts";
import { type FlowId, flowLayout, isFlow, parseTab, type ViewTab } from "./flow-layouts.ts";
import { locationOf, mapRoomTabs, type PlanMember } from "./battle-plan.ts";
import { drawHpChart, type HpChartData, hpData, type HpRun, pickStep } from "./hp-chart.ts";
import { defaultQuest, defaultSlots, effectiveDamage, enemyGroups, enemyMaxHp, enemyStats, enemyTurns, includedSlots, isFightable, parseQuestValue, questEntries, questValue, type SlotRef } from "./battle-setup.ts";
import { helpTip } from "./wiki-help.ts";
import { mapRooms, mapTreasure } from "../tools/quest-stats.ts";
import { initSaveSource } from "./save-source.ts";
import { type ApBudget, apRefusal, apUsed, assignHeroChecked, editRotationSkill, moveHero, moveRefusal, pageControls, slotKeyOfLoc } from "./battle-edit.ts";
import { enableSlotDrag } from "./party-drag.ts";
import { roomBarWheel, rowStep, scrollToShow, toTopVisible } from "./battle-layout.ts";
import { enemyLevelText, enemyLink, itemLink, loadWikiText, passiveText, passiveTip, skillAp, skillDesc, skillTip } from "./wiki-data.ts";
import { type MapRunContext, mapResultXp } from "./quest-xp.ts";
import { statLink } from "./wiki-ref.ts";
import { cappedNote, compactResult, essenceLines, hpLeftCell, resultTile, tileColumns, turnCapNote } from "./battle-results.ts";
import { languageReady, onLanguageChange } from "./language.ts";
import { className as classNameOf, enemyName, itemName, itemNameFromEnglish, modItemName, passiveName, prefixName, skillName, suffixName } from "./names.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const GRADES = ["D", "C", "B", "A", "S"];

type Opp = "quest" | "map";
/**
 * The two pages (U41; until then two modes of one page). `party`: the user sets the party (Simulator); the Solver
 * finds it. `opp`: the opponents the page works on (the first is the default).
 */
export type PageKind = "simulate" | "solve";
interface Mode { key: PageKind; party: boolean; opp: Opp[] }
const MODES: Record<PageKind, Mode> = {
  simulate: { key: "simulate", party: true, opp: ["quest", "map"] },
  // U27: the solver (was Best party, Best rotation and Best scrolls; "Solve" since U36), behind a spoiler guard (battle-search.ts).
  solve: { key: "solve", party: false, opp: ["quest", "map"] },
};
/** The page is the Solver. */
const solving = () => state.mode.key === "solve";
const SLOTS = [["front", 0], ["front", 1], ["front", 2], ["back", 0], ["back", 1], ["back", 2]] as const;

interface State {
  mode: Mode;
  sv: Save | null;
  /** file name of the save, to remember the party per save */
  saveName: string;
  slots: Record<string, number | null>; // "front0" -> hero index in sv.raw.hero
  skills: Record<number, SkillChoice>; // hero index -> edited rotation
  /** U36: slots whose hero is ticked out on its card: it stays in the slot but doesn't fight (slot key -> true). */
  excluded: Record<string, boolean>;
  worker: Worker | null;
}
const state: State = { mode: MODES.simulate, sv: null, saveName: "", slots: {}, skills: {}, excluded: {}, worker: null };

// The Simulator's party and edited rotations, remembered per save in this browser (convenience only). The Solver's
// party lives in memory only (U41): a result's Show sets it; "Open in Simulator" hands it over.
const partyKey = () => `battle-party:${state.saveName}`;
function persistParty(): void {
  if (solving()) return;
  try {
    localStorage.setItem(partyKey(), JSON.stringify({ slots: state.slots, skills: state.skills, excluded: state.excluded }));
  } catch { /* storage blocked: the party just isn't remembered */ }
}
/** Put back this save's remembered party; false when none was remembered (a fresh save, R1 F02). */
function restoreParty(heroes: number): boolean {
  if (solving()) return false;
  try {
    const p = JSON.parse(localStorage.getItem(partyKey()) ?? "null");
    if (!p) return false;
    const ok = (i: unknown) => i === null || (typeof i === "number" && i >= 0 && i < heroes);
    state.slots = Object.fromEntries(Object.entries(p.slots ?? {}).filter(([, i]) => ok(i))) as State["slots"];
    state.skills = Object.fromEntries(Object.entries(p.skills ?? {}).filter(([i]) => ok(Number(i)))) as State["skills"];
    state.excluded = Object.fromEntries(Object.entries(p.excluded ?? {}).filter(([, v]) => v === true)) as State["excluded"];
    return true;
  } catch {
    // Storage blocked: like a fresh save. Broken JSON: start over too.
    return false;
  }
}

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= dataJson("gamedata.json", "game data").then((json) => api.loadGameData(json));
  return dataReady;
}

const className = (cls: number) => classNameOf(cls) ?? `class ${cls}`;
// No "asc N" in option text: the card's hero picker carries the ascension frame (U62: asc-N on the <select>).
const heroLabel = (h: Any) => `${h.name} · ${className(h.class)} ${lv(h.level)}`;
const slotKey = (row: string, i: number) => `${row}${i}`;
const slotLabel = (key: string) => `${key.startsWith("front") ? "Front" : "Back"} ${key.endsWith("1") ? 1 : key.endsWith("2") ? 2 : 3}`;

// ---------------------------------------------------------------- choices
/**
 * The enemy picker (U36): by region and kind, region by region: "<Region>", "<Region> – Event", "<Region> – Map" (map
 * bosses and map Treasure Bushes only), each by level (battle-setup.ts enemyGroups on wiki-data.ts regionOf). U62: an
 * enemy with a rare variant is listed twice, "Lvl 20 · Goblin" ("20") then "Lvl 20 · Goblin Warlord (rare)"
 * ("20:rare"), so the list sets rare too (no "Rare variant" box); the Flow's enemy head uses the same list.
 */
function questOptions(): [string, [string, string][]][] {
  const ids = Object.keys(G.questData).map(Number)
    // Placeholders are not fights (wiki-data PLACEHOLDER_QUEST_IDS); the quest bushes (gathering quests) are. Nor is
    // an expansion the visitor hides (Frentir, map bosses).
    .filter((id) => isFightable(id) && isVisible("enemy", id));
  return enemyGroups(ids, !mapsHidden()).map((g) => [g.label, g.ids.flatMap((id) => questEntries(id).map(([value, rare]): [string, string] =>
    [value, `${lvStart(enemyLevelText(id))} · ${(rare ? enemyName(id, true) : undefined) ?? enemyName(id)}${rare ? " (rare)" : ""}${expansionMark(needsOf("enemy", id))}`]))]);
}

/** The enemy chosen in #quest, or null while no quest opponent is built. */
function questPick(): { id: number; rare: boolean } | null {
  const q = document.querySelector<HTMLSelectElement>("#quest");
  return q ? parseQuestValue(q.value) : null;
}

function mapOptions(sv: Save | null): [string, [string, string][]][] {
  const catalog = Object.entries<Any>(G.itemData.map ?? {}).filter(([id, m]) => m.name && isVisible("map", Number(id)))
    .sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || Number(a[0]) - Number(b[0]))
    .map(([id, m]): [string, string] => [`cat:${id}`, `Lvl ${m.itemLevel ?? "?"} · ${itemName("map", id) ?? m.name}${expansionMark(needsOf("map", Number(id)))}`]);
  const groups: [string, [string, string][]][] = [];
  const owned = sv?.mapInventory ?? [];
  if (owned.length) {
    groups.push(["Your maps", owned.map((m: Any, i: number): [string, string] => {
      // U34 / U36: "[Prefix] Map +N", each part translated (names.ts modItemName). Options can't be outlined: the
      // chosen map is shown outlined under the pickers (renderTarget).
      return [`own:${i}`, `${modItemName("map", m.id, m)} · ${GRADES[(m.grade ?? 3) - 1] ?? m.grade}`];
    })]);
  }
  if (catalog.length) groups.push(["All maps (choose ascension and grade)", catalog]);
  return groups;
}

/**
 * U42: Scribe hidden (not owned, expansion content not shown): nothing of maps on either battle page, the save's own
 * maps included: no Quest / Map toggle (quests only), no map pickers or scrolls, no "– Map" enemy groups, so no map
 * bar or map-run results either. A remembered map run falls back to a quest (syncOppKinds); the expansion menu's
 * changes arrive through subscribe(onExpansions).
 */
const mapsHidden = (): boolean => isHidden("Scribe");
/** A map run can be set up: Scribe not hidden, and the save has maps or some catalog map is visible. */
const mapsAvailable = (): boolean => !mapsHidden() && mapOptions(state.sv).some(([, list]) => list.length > 0);

/** Hide "Map run" when no map can be picked (no Scribe, no maps in the save); fall back to the quest enemy. */
function syncOppKinds(): boolean {
  let changed = false;
  const maps = mapsAvailable();
  document.querySelectorAll<HTMLInputElement>("input[name=opp]").forEach((r) => {
    const ok = state.mode.opp.includes(r.value as Opp) && (r.value !== "map" || maps);
    (r.closest("label") as HTMLElement).hidden = !ok;
    if (!ok && r.checked) {
      r.checked = false;
      changed = true;
    }
  });
  const left = state.mode.opp.filter((o) => o !== "map" || maps);
  if (changed && left.length) $<HTMLInputElement>(`input[name=opp][value=${left[0]}]`).checked = true;
  $("#opp-switch").hidden = left.length < 2;
  return changed;
}

// ---------------------------------------------------------------- party
function heroRaw(i: number | null): Any | null {
  return i === null || i === undefined || !state.sv ? null : state.sv.raw.hero[i];
}

/** U62: the focus back on a card's control after a redraw: the skill or passive button (`[data-focus]`). */
const refocusCard = (focusKey: string) => document.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`)?.focus();

/** Rebuild the party after an in-place edit, then put the focus back on the control that made it. */
function afterEdit(focusKey: string): void {
  persistParty();
  renderParty(false);
  refocusCard(focusKey);
}

/**
 * The skills a hero can put in a rotation slot, with their AP: Basic and its unlocked skills. `current`: a skill it
 * plays but hasn't unlocked (old save) stays listed, so the picker shows the truth. The Party view's cards and the
 * Flows' skill names use it (U62, U64), shown with their effects (skillOption).
 */
function rotationChoices(raw: Any | null, current?: string): { name: string; ap: number | undefined }[] {
  if (!raw) return [];
  const info = api.skillInfo(api.newHero(raw));
  const unlocked: Any[] = info.skills.slice(0, info.unlocked);
  const out = [{ name: "Basic", ap: 0 as number | undefined }, ...unlocked.map((u) => ({ name: String(u.name), ap: u.ap as number | undefined }))];
  if (current && current !== "Basic" && !unlocked.some((u) => u.name === current)) {
    out.push({ name: current, ap: info.skills.find((x: Any) => x.name === current)?.ap ?? skillAp(current) });
  }
  return out;
}
/** U62: a skill choice of the picker (the Party view's cards; U64, the Flows): its name, AP and effect. */
const skillOption = (c: { name: string; ap: number | undefined }): PickOption => ({ value: c.name, label: skillName(c.name), ap: c.ap, note: skillDesc(c.name) });

/** The rotation and passive a hero (save index) plays: its edited one, else its save's. */
function rotationOf(idx: number): SkillChoice {
  const raw = state.sv!.raw.hero[idx];
  const h = api.newHero(raw);
  return { attackList: state.skills[idx]?.attackList ?? h.attackList.slice(1, 6), passive: state.skills[idx]?.passive ?? h.passiveSelect };
}

/**
 * U40: a hero's AP budget (what each skill costs it, its limit) with its passive (`passive`, else the one it plays
 * now): a passive can give AP (Wisdom).
 */
function apBudgetOf(idx: number, passive = rotationOf(idx).passive): ApBudget {
  const h = api.newHero(state.sv!.raw.hero[idx]);
  if (passive && passive !== h.passiveSelect) {
    h.passiveSelect = passive;
    h.determineStats();
  }
  const info = api.skillInfo(h);
  const apOf: Record<string, number> = Object.fromEntries(info.skills.map((x: Any) => [x.name, x.ap]));
  return { cost: (s) => apOf[s] ?? skillAp(s) ?? 0, max: info.maxAP ?? 0 };
}
/** U40: a hero's AP use and limit when its rotation is over the limit, else null. */
function apOver(idx: number): { used: number; max: number } | null {
  const b = apBudgetOf(idx), used = apUsed(rotationOf(idx).attackList, b);
  return used > b.max ? { used, max: b.max } : null;
}
/**
 * U40: the party's heroes over their AP limit (an old saved party): the game would play their default rotation, so the
 * flow shows this instead of a fight, as the Party tab warns on the card.
 */
function apProblem(): string | null {
  const over = partyOf().members.map((m) => ({ name: String(m.raw.name), o: apOver(m.idx) })).filter((x) => x.o);
  return over.length ? `${over.map((x) => `${x.name}: ${x.o!.used} / ${x.o!.max} AP`).join(", ")}: over the AP limit, so the game would `
    + "play the default rotation instead. Lower it in the Party tab." : null;
}
/** U40: an edit refused for AP: the toast, then the views drawn again from the unchanged state. */
function refuseAp(idx: number, r: { used?: number; max?: number }, focus?: () => void): void {
  toast(apRefusal(String(state.sv!.raw.hero[idx].name), r.used ?? 0, r.max ?? 0));
  renderParty(false);
  focus?.();
}

/**
 * U62: a hero card's passive and rotation rows (fighter-card.ts). Editable (the Simulator), a skill or the passive is
 * a button that opens its picker in place, each choice with its effect (pick-list.ts; was a "⇄" select and a wiki
 * link); read-only (the Solver), plain text. Both carry the effect on hover; the passive's effect is not on its line.
 * The passive row ends with the rotation's "14 / 20 AP". An empty slot (`raw` null) shows the same skeleton, greyed.
 */
function heroRows(idx: number | null, raw: Any | null, key: string, editable = true): { passive: CardRow; rotation: CardRow[] } {
  const hero = raw ? api.newHero(raw) : null;
  const info = hero ? api.skillInfo(hero) : null;
  const apOf: Record<string, number> = Object.fromEntries((info?.skills ?? []).map((x: Any) => [x.name, x.ap]));
  const rot: string[] = idx !== null && hero ? state.skills[idx]?.attackList ?? hero.attackList.slice(1, 6) : ["", "", "", "", ""];
  const passive: string = idx !== null && hero ? state.skills[idx]?.passive ?? hero.passiveSelect : "";
  const live = Boolean(raw && info && idx !== null);

  // "14 / 20 AP"; over budget the game plays the default rotation (Hero.calculateAPRemainder).
  const used = rot.reduce((a, n) => a + (n && n !== "Basic" ? apOf[n] ?? skillAp(n) ?? 0 : 0), 0);
  // U40: the limit with the passive it plays (Wisdom gives AP).
  const max = idx !== null && info ? apBudgetOf(idx, passive).max : info?.maxAP ?? 0;
  const over = info !== null && used > max;
  const apTitle = info ? `${used} of ${max} action points used${over ? `: ${used - max} over budget, the game plays the default rotation instead` : `, ${max - used} remaining`}` : "";
  const ap = info
    ? el("span", { class: `fc-ap${over ? " over" : ""}`, title: apTitle, role: "img", "aria-label": apTitle }, over ? "⚠ " : "", el("strong", {}, String(used)), ` / ${max} AP`)
    : el("span", { class: "fc-ap off", "aria-hidden": "true" }, "– / – AP");

  const passiveRow: CardRow = {
    text: raw ? (passive && passive !== "None" ? passiveName(passive) : "No passive") : "—",
    tip: raw ? (e) => passiveTip(e, passive) : undefined,
    end: ap,
    pick: editable && live ? {
      label: `${raw.name}: passive`, value: passive, focus: `${key}-p`,
      options: () => (info!.passives as string[]).map((x): PickOption => ({ value: x, label: x === "None" ? "No passive" : passiveName(x), note: x === "None" ? "" : passiveText(x) })),
      onPick: (v) => {
        // U40: a passive that gives AP (Wisdom) can't be dropped when the rotation then goes over the limit.
        const b = apBudgetOf(idx!, v), u = apUsed(rot, b);
        if (u > b.max && b.max < apBudgetOf(idx!, passive).max) return refuseAp(idx!, { used: u, max: b.max }, () => refocusCard(`${key}-p`));
        state.skills[idx!] = { attackList: [...rot], passive: v };
        afterEdit(`${key}-p`);
      },
    } : undefined,
  };
  const rotation = rot.map((sk, k): CardRow => ({
    text: raw ? skillName(sk) : "—",
    ap: raw ? (sk === "Basic" ? 0 : apOf[sk] ?? skillAp(sk) ?? 0) : null,
    tip: raw && sk !== "Basic" ? (e) => skillTip(e, sk) : undefined,
    pick: editable && live ? {
      label: `${raw.name}: turn ${k + 1} skill`, value: sk, focus: `${key}-${k}`,
      options: () => rotationChoices(raw, sk).map(skillOption),
      onPick: (v) => {
        // U39: the same edit as the Flow tab's skill ▾ (battle-edit.ts); U40: refused over the AP limit.
        const r = editRotationSkill(state, idx!, k, v, { attackList: rot, passive }, apBudgetOf(idx!));
        if (!r.ok) return refuseAp(idx!, r, () => refocusCard(`${key}-${k}`));
        afterEdit(`${key}-${k}`);
      },
    } : undefined,
  }));
  return { passive: passiveRow, rotation };
}

/** A hero's card stats (fighter-card.ts statGrid), with the passive it plays (an edited one too); null: an empty slot. */
function heroCardStats(idx: number | null, raw: Any | null): Record<string, number> | null {
  if (!raw) return null;
  const h = api.newHero(raw);
  const p = idx !== null ? state.skills[idx]?.passive : undefined;
  if (p && p !== h.passiveSelect) h.passiveSelect = p;
  return api.heroStats(h);
}

/**
 * U36: which filled slots fight. A hero ticked out on its card stays in its slot; over the opponent's size cap the
 * first ones in the game's slot order are kept (the required slot first) and the rest are left out automatically.
 */
function fighting(): { included: Set<string>; capped: SlotRef[] } {
  const filled: SlotRef[] = SLOTS.filter(([r, i]) => state.slots[slotKey(r, i)] !== null && state.slots[slotKey(r, i)] !== undefined)
    .map(([row, i]) => ({ key: slotKey(row, i), row, i }));
  const excluded = new Set(Object.keys(state.excluded).filter((k) => state.excluded[k]));
  const r = includedSlots(filled, excluded, rulesOf(pageTarget()));
  return { included: new Set(r.included.map((s) => s.key)), capped: r.capped };
}

/** The six slots, back row (left) and front row (right), every slot the same size, filled or not. On the Solver,
 * which chooses the party, empty slots are "to be found" (U50: no 🔒 locks, the Solve panel's hero table instead). */
function renderParty(refreshSearch = true): void {
  const sv = state.sv!;
  const picks = !state.mode.party;
  // U48: the Simulator edits (pickers, ⇄, include ticks, Clear all, drag and drop); the Solver's cards are read-only.
  const ctl = pageControls(state.mode.key);
  // Party setup rules of the opponent (battle-rules.ts): required slot, solo quests, party size cap.
  const rules = rulesOf(pageTarget());
  // U36: heroes ticked out on their card stay in the slot without fighting; the size cap counts the others.
  const fight = fighting();
  const filled = SLOTS.filter(([r, i]) => {
    const k = slotKey(r, i);
    return state.slots[k] !== null && state.slots[k] !== undefined && !state.excluded[k];
  }).length;
  const options: [string, string][] = [["", picks ? "— to be found —" : "— empty —"], ...sv.raw.hero.map((h: Any, i: number): [string, string] => [String(i), heroLabel(h)])];
  const slot = (row: "front" | "back", i: number) => {
    const key = slotKey(row, i);
    const s = select({ "aria-label": `${row} row slot ${i + 1}` }, options);
    s.value = state.slots[key] === null || state.slots[key] === undefined ? "" : String(state.slots[key]);
    const idx = state.slots[key] ?? null;
    const raw = heroRaw(idx);
    s.addEventListener("change", () => {
      // U39: the same edit as the Flow tab's (battle-edit.ts): one slot per hero, the new hero fights. U40: not a hero
      // whose rotation is over its AP limit.
      const pick = s.value === "" ? null : Number(s.value);
      const r = assignHeroChecked(state, key, pick, pick === null ? null : apOver(pick));
      if (!r.ok) return refuseAp(pick!, r);
      clearUndo = null;
      persistParty();
      renderParty();
    });
    // U36: the include box, top right: unticked, the hero stays in the slot but doesn't fight. Over the size cap the
    // last ones (game slot order) are left out automatically: their box is unticked and disabled.
    const capped = raw ? fight.capped.some((c) => c.key === key) : false;
    const out = raw ? Boolean(state.excluded[key]) || capped : false;
    const include = raw && ctl.edit ? (() => {
      const c = el("input", { type: "checkbox", class: "include-box" }) as HTMLInputElement;
      c.checked = !out;
      c.disabled = capped;
      const what = capped ? `${raw.name} is left out: this quest takes at most ${rules.maxSize} hero${rules.maxSize === 1 ? "" : "es"} (untick another hero to bring this one in)`
        : out ? `${raw.name} stays in the slot but doesn't fight (tick to include)` : `${raw.name} fights (untick to leave out without emptying the slot)`;
      c.setAttribute("aria-label", `Include ${raw.name} in the battle`);
      c.addEventListener("change", () => {
        if (c.checked) delete state.excluded[key];
        else state.excluded[key] = true;
        persistParty();
        renderParty();
        document.querySelector<HTMLInputElement>(`[data-include="${key}"] input`)?.focus();
      });
      return el("label", { class: `include${capped ? " capped" : ""}`, title: what, "data-include": key }, c, el("span", { class: "visually-hidden" }, "Include"));
    })() : null;
    // Rules: the required slot is flagged; an empty slot the opponent doesn't allow (solo quest, party full) is disabled.
    const required = rules.required.some((x) => x.row === row && x.i === i);
    const soloOff = rules.kind === "solo" && !required;
    const off = !raw && (soloOff || (rules.kind !== "solo" && filled >= rules.maxSize));
    const offText = soloOff ? "solo: Front 1 only" : `at most ${rules.maxSize} heroes`;
    if (off) {
      s.disabled = true;
      // U62: no pill beside the picker: an empty slot the opponent doesn't allow says why in the picker itself.
      if (s.options[0]) s.options[0].textContent = `— ${offText} —`;
    }
    // U62: the picker is the card's head (no avatar, place or class pill); the hero's ascension frames it. Read-only
    // (the Solver): the same words as plain text.
    if (raw && heroAsc(raw.prestigeLevel)) s.classList.add(`asc-${heroAsc(raw.prestigeLevel)}`);
    s.classList.add("fc-pick");
    const outText = capped ? "over the limit" : out ? "left out" : "";
    const head = ctl.edit ? s
      : el("span", { class: "fc-name" }, raw ? heroLabel(raw) : off ? offText : picks ? "to be found" : "empty", ...(outText ? [el("span", { class: "muted" }, ` · ${outText}`)] : []));
    const title = [required ? (rules.kind === "solo" ? "Required: a solo quest takes one hero, here" : "Required: a party quest always fills this slot (it can be swapped, never emptied)") : "",
      outText ? `${String(raw?.name)}: ${outText}` : ""].filter(Boolean).join(". ");
    const rows = heroRows(raw ? idx : null, raw, key, ctl.edit);
    // U48: every slot is a drop target (data-slot); a filled one on the Simulator is picked up by dragging (data-drag).
    return fighterCard({
      kind: "hero",
      classes: `${raw ? `filled cls-${raw.class}` : "empty"}${required ? " required" : ""}${off ? " off-limits" : ""}${out ? " excluded" : ""}`,
      attrs: { "data-slot": key, ...(ctl.drag && raw ? { "data-drag": "" } : {}), ...(title ? { title } : {}) },
      head, tools: include ? [include] : [], stats: heroCardStats(idx, raw), passive: rows.passive, rotation: rows.rotation,
    });
  };
  // R1 F20: what the rows mean is in the heading's tooltip, not a line under it. R2 F33: on the Solver, a row's empty
  // slots (not the required one) fold into one line, "3 empty back slots", that opens them (foldEmpty).
  const cols = (["back", "front"] as const).map((row) => {
    const empty = picks ? [0, 1, 2].filter((i) => isEmptySlot(row, i) && !rules.required.some((x) => x.row === row && x.i === i)) : [];
    const shown = [0, 1, 2].filter((i) => !empty.includes(i)).map((i) => slot(row, i));
    return el("div", { class: "party-row" },
      el("h3", { title: row === "front" ? "Enemies hit the front row while anyone stands in it." : "Safe until the front row falls." },
        row === "front" ? "🛡️ Front row" : "🏹 Back row"),
      el("div", { class: "slots" }, ...shown, ...(empty.length
        // U48: read-only (the Solver), the folded empty slots are a plain count: no hero is added by hand.
        ? [ctl.edit ? foldEmpty(row, empty.map((i) => slot(row, i))) : el("p", { class: "small muted empty-slots" }, emptyCount(row, empty.length))] : [])));
  });
  // U32: "Clear all" empties the six slots, with the same undo as a search's Load. U48: not on a read-only page.
  const clear = el("button", { type: "button", class: "secondary clear-all" }, "🧹 Clear all");
  clear.title = "Empty every hero slot (the edited rotations are kept)";
  if (!Object.values(state.slots).some((v) => v !== null && v !== undefined)) clear.setAttribute("disabled", "");
  clear.addEventListener("click", clearAll);
  // R2 F23 / F36: the party's rule and, on the Solver, what this party is, in the "?" beside the Party tab.
  document.querySelector("#party-help")?.replaceChildren(...partyHelp(rules, picks, ctl.drag));
  // U36: heroes left out over the size cap. U48: said on the opponent's side, under its picker, without their names
  // (their cards say "over the limit").
  const cap = document.querySelector<HTMLElement>("#party-cap");
  if (cap) {
    cap.hidden = !fight.capped.length;
    cap.replaceChildren(...(fight.capped.length ? [`ℹ️ At most ${rules.maxSize} heroes`] : []));
  }
  $("#party").replaceChildren(
  ...(ctl.edit ? [el("div", { class: "toolbar party-tools" }, clear, ...(clearUndo ? [clearUndo] : []))] : []),
  // What keeps this party from fighting (shown before Simulate, not as a worker error). The modes that pick the
  // party fill the slots themselves.
  ...((p) => (p && !picks ? [el("p", { class: "error small party-problem", role: "status" }, `⚠ ${p}`)] : []))(partyProblem()),
  el("div", { class: "party-cols" }, ...cols));
  syncAmount();
  renderPlan();
  // Not after a search filled the slots: rebuilding the search panel would reset its form.
  if (refreshSearch) search?.refresh();
}

const isEmptySlot = (row: "front" | "back", i: number) => state.slots[slotKey(row, i)] === null || state.slots[slotKey(row, i)] === undefined;

/** R2 F33: the folded empty slots of each row, open or closed as last left (this page view). */
const emptyOpen: Record<string, boolean> = {};
/**
 * R2 F33: a Solver row's empty slots as one line ("3 empty back slots"), closed by default, so the heroes the solve
 * found come first; opening it shows the slots, to add a hero by hand.
 */
function foldEmpty(row: "front" | "back", slots: HTMLElement[]): HTMLElement {
  const d = el("details", { class: "empty-slots" }, el("summary", { class: "small" }, emptyCount(row, slots.length)), ...slots);
  (d as HTMLDetailsElement).open = Boolean(emptyOpen[row]);
  d.addEventListener("toggle", () => (emptyOpen[row] = (d as HTMLDetailsElement).open));
  return d;
}

/** "3 empty back slots". */
const emptyCount = (row: "front" | "back", n: number) => `${n} empty ${row} slot${n === 1 ? "" : "s"}`;

/**
 * R2 F23 / F36: the "?" beside the Party tab: the opponent's party rule, on the Solver what the shown party is (U48:
 * read-only there), on the Simulator that cards move by dragging (U48).
 */
function partyHelp(rules: ReturnType<typeof rulesOf>, picks: boolean, drag: boolean): HTMLElement[] {
  const paras = [
    ...(picks ? ["Read-only: to change the party, open it in the Simulator."] : []),
    ...(drag ? ["Drag a hero card onto another slot to move it there, or onto a hero to swap them."] : []),
    ...(rulesText(rules) ? [rulesText(rules)] : []),
  ];
  return paras.length ? [helpTip(paras, "the party")] : [];
}

/** The opponent for the party rules, or null while the opponent card isn't built yet. */
function pageTarget(): PageTarget | null {
  if (oppKind() !== "quest") return document.querySelector("#map") ? { map: targetOf().map!.spec } : null;
  const q = questPick();
  return q ? { quest: q } : null;
}
/** Why the six slots can't fight the opponent (battle-rules.ts), or null. */
function partyProblem(front?: (unknown | null)[], back?: (unknown | null)[]): string | null {
  // U33 fix: the slots hold hero indices and the engine's check reads an empty slot as falsy, so hero 0 (the save's
  // first hero) looked missing; each filled slot is passed as an object.
  const inc = fighting().included;
  const key = (row: "front" | "back") => [0, 1, 2].map((i) => {
    const v = state.slots[slotKey(row, i)];
    return v === null || v === undefined || !inc.has(slotKey(row, i)) ? null : { hero: v };
  });
  return problemOf(pageTarget(), front ?? key("front"), back ?? key("back"));
}

/**
 * U48: a hero card dropped on another slot (party-drag.ts): the two heroes swap, or the hero moves to the empty slot
 * (battle-edit.ts moveHero). The opponent's rules hold: the required slot (Front 2 on a party quest) is never emptied,
 * a solo quest keeps its hero in Front 1; such a move is refused with a toast.
 */
function dropHero(from: string, to: string): void {
  const rules = rulesOf(pageTarget());
  const required = rules.required.map((x) => slotKey(x.row, x.i));
  const r = moveHero(state, from, to, { required, solo: rules.kind === "solo" });
  if (!r.ok) {
    if (r.reason === "required" || r.reason === "solo") toast(moveRefusal(r.reason, slotLabel(`${from.replace(/\d$/, "")}${Number(from.slice(-1)) + 1}`)));
    return;
  }
  clearUndo = null;
  persistParty();
  renderParty();
}

/** The "Put back the previous party" button after Clear all (until it is used or the slots change by hand). */
let clearUndo: HTMLElement | null = null;
function clearAll(): void {
  const prev = { slots: { ...state.slots }, excluded: { ...state.excluded } };
  state.slots = {};
  state.excluded = {};
  const b = el("button", { type: "button", class: "secondary" }, "↩ Put back the previous party");
  b.addEventListener("click", () => {
    state.slots = prev.slots;
    state.excluded = prev.excluded;
    clearUndo = null;
    persistParty();
    renderParty();
    document.querySelector<HTMLElement>("#party .clear-all")?.focus();
  });
  clearUndo = b;
  persistParty();
  renderParty();
  clearUndo.focus();
}

// ---------------------------------------------------------------- target
let search: ReturnType<typeof initSearch> | null = null;
const oppKind = (): Opp => ($<HTMLInputElement>("input[name=opp]:checked")?.value ?? "quest") as Opp;

/**
 * U36: the chosen opponent (quest or map, size, rare, map grade, ascension, scrolls), remembered in this browser across
 * pages (localStorage `battle-opponent`, convenience only) and put back when the page is built again. U41: the Solver
 * remembers its own (`solver-opponent`), starting from the Simulator's.
 */
const OPP_KEY = "battle-opponent";
const SOLVER_OPP_KEY = "solver-opponent";
const oppKey = () => (solving() ? SOLVER_OPP_KEY : OPP_KEY);
interface OppChoice { kind?: Opp; quest?: string; rare?: boolean; amount?: string; map?: string; asc?: string; grade?: string; scrolls?: string[] }
/** False while onExpansions puts a choice back (the intermediate states are not remembered). */
let saving = true;
function saveOpponent(): void {
  if (!saving) return;
  try {
    localStorage.setItem(oppKey(), JSON.stringify(currentOpponent()));
  } catch { /* storage blocked: not remembered */ }
}
/** The opponent as the controls show it, or what was remembered when they aren't built yet. */
function currentOpponent(): OppChoice {
  const v = (sel: string) => document.querySelector<HTMLSelectElement>(sel)?.value;
  const scrolls = [...document.querySelectorAll<HTMLSelectElement>("select.scroll")].map((s) => s.value);
  const kind = oppKind();
  // The other kind's choice stays as it was remembered.
  const was = storedOpponent();
  // U62: stored as before, the quest id and `rare` apart (the picker's value is "<id>" or "<id>:rare").
  const q = questPick();
  return kind === "quest"
    ? { ...was, kind, quest: q ? String(q.id) : undefined, rare: q?.rare ?? false, amount: v("#amount") }
    : { ...was, kind, map: v("#map"), asc: v("#map-asc"), grade: v("#map-grade"), scrolls };
}
function storedOpponent(key = oppKey()): OppChoice {
  try {
    const o = JSON.parse(localStorage.getItem(key) ?? "null");
    if (o && typeof o === "object") return o;
    // The Solver's first visit: the Simulator's opponent.
    return key === SOLVER_OPP_KEY ? storedOpponent(OPP_KEY) : {};
  } catch {
    return linkedFallback ?? {};
  }
}

/**
 * U53: a wiki "Fight in simulator" link (`battle.html?quest=12`, `?map=22&asc=1`, battle-links linkedOpponent): its
 * opponent becomes the remembered one before the page is built (the party stays the visitor's), then the query goes.
 * With storage blocked it holds for this visit only.
 */
let linkedFallback: OppChoice | null = null;
function takeLinkedOpponent(): void {
  const linked = linkedOpponent(location.search);
  if (!linked) return;
  const o: OppChoice = { ...storedOpponent(OPP_KEY), ...linked };
  try {
    localStorage.setItem(OPP_KEY, JSON.stringify(o));
  } catch {
    linkedFallback = o;
  }
  history.replaceState(history.state, "", withoutOpponentQuery(location.pathname, location.search, location.hash));
}

/** Set while the page redraws for another language: the search panel keeps its form (U29). */
let keepSearchForm = false;

function renderTarget(): void {
  queueMicrotask(() => {
    if (!keepSearchForm) search?.refresh();
  });
  const box = $("#target");
  if (oppKind() === "quest") {
    // U62: one list with each rare variant as its own entry ("<id>:rare"); the quest size a compact control. U65: both
    // in the Simulate (Solve) panel, #target; the card (#target-card) shows the enemy, no picker (drawEnemyCard).
    const q = select({ id: "quest", "aria-label": "Enemy" }, questOptions());
    const amount = select({ id: "amount", "aria-label": "Quest size" }, [["1", "×1"]]);
    // R1 F20: the quest size's explanation is in a "?" (syncAmount fills it), not a paragraph.
    const sizeNote = el("span", { id: "amount-note" });
    const update = () => {
      syncAmount(amount, sizeNote, parseQuestValue(q.value).rare);
      saveOpponent();
    };
    // Another enemy may have other party rules (required slot, size cap): the slots are drawn again (and the fight
    // traced again, which draws the enemy's card).
    q.addEventListener("change", () => (update(), renderParty()));
    // The card's HP follows the quest size.
    amount.addEventListener("change", () => (update(), renderPlan()));
    box.replaceChildren(el("div", { class: "opp-controls" }, q, el("div", { class: "toolbar" }, amount, sizeNote), capNote()));
    update();
    setRuns("200");
  } else {
    const m = select({ id: "map", "aria-label": "Map" }, mapOptions(state.sv));
    const asc = select({ id: "map-asc", "aria-label": "Map ascension" }, [["0", "No ascension"], ["1", "Ascension 1"]]);
    const grade = select({ id: "map-grade", "aria-label": "Map grade" }, GRADES.map((g, i): [string, string] => [String(i + 1), `Grade ${g}`]));
    grade.value = "3";
    const scrollOpts: [string, string][] = [["", "— no scroll —"], ...SCROLL_IDS.filter((id) => G.itemData.consumable?.[id] && isVisible("consumable", id))
      .map((id): [string, string] => [String(id), `${itemName("consumable", id)}${expansionMark(needsOf("consumable", id))}`])];
    const scrolls = [0, 1, 2].map((k) => select({ class: "scroll", "aria-label": `Scroll ${k + 1}` }, scrollOpts));
    // U65: the map's facts, one compact line in the panel (was the map card beside the party, with the scrolls).
    const facts = el("div", { class: "map-facts small" });
    const sync = () => {
      const own = m.value.startsWith("own:");
      asc.hidden = grade.hidden = own;
      const it: Any = own ? state.sv?.mapInventory[Number(m.value.slice(4))] : null;
      const id = own ? Number(it?.id) : Number(m.value.slice(4));
      const d: Any = G.itemData.map?.[id] ?? {};
      const a = own ? it?.prestigeLevel : Number(asc.value), g = own ? (it?.grade ?? 3) : Number(grade.value);
      const pre = own && it?.prefix ? prefixName(it.prefix) : "", suf = own && it?.suffix > 0 ? suffixName(it.suffix) : "";
      // Plain catalog map: no label, so the link shows (and keeps in step) the map's name in the visitor's language. A
      // modded map (U34 / U36): "[Prefix] Map +N" from its translated parts (modItemName).
      const name = pre || suf ? modItemName("map", id, it) : undefined;
      const bosses = seq<number>(d.bossList ?? {});
      const fact = (k: string, v: Node | string) => el("div", {}, el("dt", {}, k), el("dd", {}, v));
      facts.replaceChildren(
        el("span", { class: "map-name" }, itemLink("map", id, name, undefined, a, { always: own }), ...(own ? [" ", pill("yours", "t-green")] : []),
          // R1 F20: what a run is, in a "?" instead of a paragraph.
          helpTip("Each run uses a new layout (rooms, enemies, rare spawns, boss); hero HP carries over between rooms. "
            + "Rooms and time are the map's own, before its prefix and suffix.", "map runs")),
        el("dl", {},
          fact(LV, String(d.itemLevel ?? "?")),
          ...(own ? [fact("Grade", gradeBadge(GRADES[g - 1] ?? String(g)))] : []),
          fact("Rooms", roomsFact(id, g)),
          fact("Time", d.baseMapTime ? duration(d.baseMapTime) : "?"),
          fact("Enemy power", `×${d.enemyMod ?? 1}`),
          fact(bosses.length > 1 ? "Bosses" : "Boss", bosses.length
            ? el("span", {}, ...bosses.flatMap((b, k) => [...(k ? [", "] : []), enemyLink({ id: b })])) : "none"),
          ...(pre || suf ? [fact("Modifiers", [pre && `prefix ${pre}`, suf && `suffix ${suf}`].filter(Boolean).join(" · "))] : [])));
      saveOpponent();
    };
    // U39: the Flow tab follows the map, its ascension, grade and scrolls (one traced run).
    m.addEventListener("change", () => (sync(), renderPlan()));
    asc.addEventListener("change", () => (sync(), renderPlan()));
    grade.addEventListener("change", () => (sync(), renderPlan()));
    for (const x of scrolls) x.addEventListener("change", () => (saveOpponent(), renderPlan()));
    box.replaceChildren(el("div", { class: "opp-controls" }, m, el("div", { class: "toolbar" }, asc, grade),
      el("div", { class: "toolbar opp-scrolls", role: "group", "aria-label": "Scrolls" }, ...scrolls), facts, capNote()));
    sync();
    setRuns("50");
  }
  // The party rules follow the opponent (renderParty also draws the plan); the search panel is refreshed above.
  renderParty(false);
}

/**
 * U62: the enemy card's rotation, read-only: its skill on turns 1-5 (turn 6 is turn 1 again) from its timeline (the
 * data the Flow and the wiki's timeline strip use), else its game rotation; the effect on hover.
 */
function enemyRotation(id: number, rare: boolean): CardRow[] {
  // No AP: the enemy spends none.
  return enemyTurns(id, rare, timelineOf(id, rare)).map((sk): CardRow => ({ text: skillName(sk), tip: sk === "Basic" ? undefined : (e) => skillTip(e, sk) }));
}

/** U48: under the opponent's picker, the size cap when it leaves heroes out (renderParty fills it). U65: in the panel. */
const capNote = () => el("p", { id: "party-cap", class: "small party-capped", role: "status", title: "The last heroes in slot order are left out.", hidden: "" });

/**
 * U65: the opponent card (#target-card, beside the party on both pages): always one enemy, no picker (the opponent
 * is chosen in the Simulate or Solve panel). A quest: the chosen enemy. A map run: the enemy of the selected turn's
 * room (none before the run can be traced). At the chart's selected turn it shows that turn's state, as the hero
 * cards do (paintTurn): HP, the engine's live stats, the effects, the row it played.
 */
function drawEnemyCard(): void {
  const host = document.querySelector<HTMLElement>("#target-card");
  if (!host || !state.sv) return;
  const at = chart?.steps[turnAt];
  let foe: { id: number; rare: boolean; n: number; room?: string } | null = null;
  if (oppKind() === "quest") {
    const q = questPick();
    if (q) foe = { ...q, n: Number(document.querySelector<HTMLSelectElement>("#amount")?.value) || 1 };
  } else if (chart && at) {
    const run = chart.runs[at.run];
    if (run.quest) foe = { ...run.quest, n: 1, room: run.room };
  }
  if (!foe) {
    host.replaceChildren(...(oppKind() === "map" && document.querySelector("#map") ? [el("p", { class: "muted small" }, "The room's enemy: shown once the party can fight.")] : []));
    return;
  }
  const d = G.questData[foe.id];
  const now = at?.states[0];
  const name = `${enemyName(String(foe.id), foe.rare) ?? d?.name ?? foe.id}${foe.rare ? " (rare)" : ""}`;
  host.replaceChildren(fighterCard({
    kind: "enemy", classes: foe.rare ? "rare" : "",
    head: el("span", { class: "fc-name" }, `${lvStart(enemyLevelText(foe.id))} · ${name}`, ...(foe.n > 1 ? [el("span", { class: "muted" }, ` ×${foe.n}`)] : [])),
    lines: [...(foe.room ? [el("p", { class: "fc-line small muted" }, foe.room.startsWith("Boss") ? "Boss room" : `Room ${foe.room.split(" ·")[0]}`)] : []),
      ...(d?.questType === 6 ? [el("p", { class: "fc-line small muted" }, "Attacks first")] : [])],
    stats: now?.stats ? { ...now.stats, maxHP: now.maxHP } : enemyStats(foe.id, foe.rare, foe.n),
    ...(now ? { turn: { life: { hp: now.hp, maxHP: now.maxHP, label: `${name}: ${hpTexts(now.hp, now.maxHP).full} HP` }, fx: now.fx, active: now.active } } : {}),
    rotation: enemyRotation(foe.id, foe.rare),
  }));
}

/**
 * R1 F29: the map card's rooms, counted as the results count them: the rooms at this grade (boss included, ±1 by
 * grade) plus the treasure rooms expected per run ("9 + 0.9 treasure"), the tooltip saying what is counted.
 */
function roomsFact(id: number, grade: number): HTMLElement {
  let rooms: number, treasure = 0;
  try {
    rooms = mapRooms(id, grade);
    treasure = mapTreasure(id, grade)?.perRun ?? 0;
  } catch {
    return el("span", {}, "?");
  }
  const t = treasure >= 0.05 ? ` + ${fmt1.format(treasure)} treasure` : "";
  return el("span", { title: `${rooms} rooms at grade ${GRADES[grade - 1] ?? grade}, the boss included${t ? `, and ${fmt1.format(treasure)} treasure room${treasure === 1 ? "" : "s"} per run on average` : ""}. `
    + "The results count every room a run meets (treasure rooms and boss included), so their average can differ a little." }, `${rooms}${t}`);
}

/**
 * The quest sizes the game offers (questService.getCurrentAndMaxAmount): ×1 up to maxQuestAmount, from the highest
 * hero prestige of the party; a rare quest is always ×1. The modes that pick the party allow up to the strongest hero
 * of the save (searchParty / optimiseFight skip parties that can't take the size). Keeps the current choice when allowed.
 */
function syncAmount(amount = document.querySelector<HTMLSelectElement>("#amount"), note = document.querySelector<HTMLElement>("#amount-note"),
  rare = questPick()?.rare ?? false): void {
  // U62: the opponent card passes its own controls (it calls this before the card is in the page).
  if (!amount || !state.sv) return;
  // Modes that choose the party: up to the strongest hero of the save (the search skips parties that can't take it).
  const max = maxQuestAmount(state.mode.party ? partyOf().members.map((m) => m.raw) : state.sv.raw.hero, rare, state.sv.raw.gameMode || "Standard");
  const was = Number(amount.value) || 1;
  amount.replaceChildren(...Array.from({ length: max }, (_, k) => el("option", { value: String(k + 1) }, `×${k + 1}`)));
  amount.value = String(Math.min(was, max));
  amount.disabled = max === 1;
  const n = Number(amount.value);
  // R1 F20 / F36: the explanation in a "?"; the cap only once the party has heroes (before, it depends on them).
  if (note) {
    const what = `Quest size ×${n}: one enemy with ${n > 1 ? `${n}× HP, ${n}× loot and ${n}× quest time` : "its normal HP"}.`;
    const heroes = state.mode.party ? partyOf().members.length : state.sv.raw.hero.length;
    const cap = rare ? "A rare quest is always ×1."
      : !heroes ? "The largest size depends on your heroes' ascension tier."
      : !state.mode.party ? `Up to ×${max} with your strongest hero; parties that can't take this size are skipped.`
      : `Up to ×${max} for this party: its highest hero ascension sets the cap.`;
    note.replaceChildren(helpTip([what, cap], "the quest size"));
  }
}

// ---------------------------------------------------------------- the views: Party and the Flows (U39, U40, U58)
/**
 * Step 3's tabs over one party state: Party (the hero cards and the opponent; first, U40) and the Flow (the fight, turn
 * by turn). U58: the Flow layouts, Flow 2 · Flow 3 (flow-layouts.ts; U63: Flow 1 gone), sharing one panel (#flow-panel, drawn
 * by renderPlan with the open layout, or the last one opened while Party is open). Edits in any change the same state
 * (battle-edit.ts), then everything redraws and the flow is simulated again. The open tab is remembered per page for
 * this browser tab (sessionStorage `battle-tab` on the Simulator, `solver-tab` on the Solver; convenience only; the old
 * "flow" and the U58 "flow1" read as Flow 2); without one, the first tab, Party.
 */
type Tab = ViewTab;
const tabKey = () => (solving() ? "solver-tab" : "battle-tab");
let tabChoice: Tab | null = null;
/** The Flow layout the panel shows: the open tab's, else the last one opened (Flow 2 at first). */
let flowChoice: FlowId = "flow2";
/** The layout the panel holds now, so opening another one redraws it. */
let flowDrawn: FlowId | null = null;
function storedTab(): Tab {
  if (tabChoice) return tabChoice;
  try {
    return parseTab(sessionStorage.getItem(tabKey()));
  } catch {
    return "party";
  }
}
function showTab(tab: Tab, remember = true): void {
  if (remember) {
    tabChoice = tab;
    try {
      sessionStorage.setItem(tabKey(), tab);
    } catch { /* not remembered: it holds until the page is left */ }
  }
  document.querySelectorAll<HTMLButtonElement>(".b3-tabs [role=tab]").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const flow = isFlow(tab);
  $("#flow-panel").hidden = !flow;
  $("#setup-grid").hidden = tab !== "party";
  if (flow) {
    $("#flow-panel").setAttribute("aria-labelledby", `tab-${tab}`);
    flowChoice = tab;
    // U58: another layout than the one drawn: draw the panel again with it.
    if (flowDrawn !== null && flowDrawn !== tab) renderPlan();
  }
  // U51: one "?" beside the tabs, the open tab's: the party's rule on Party, how to read the open Flow on a Flow.
  const [partyTip, flowTip] = [document.querySelector<HTMLElement>("#party-help"), document.querySelector<HTMLElement>("#plan-help")];
  if (partyTip) partyTip.hidden = tab !== "party";
  if (flowTip) flowTip.hidden = !flow;
}
function initTabs(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".b3-tabs [role=tab]")) b.addEventListener("click", () => showTab(parseTab(b.dataset.tab)));
  // The arrow keys, Home and End move between the tabs (the tablist pattern, dom.ts tabKeys).
  const list = document.querySelector<HTMLElement>(".b3-tabs[role=tablist]");
  if (list) tabKeys(list);
  showTab(storedTab(), false);
}

/** The party's heroes as the engine takes them (edited rotations applied), for a traced fight or map run. */
function engineParty(sim: Sim): [Any[], Any[]] {
  const { front, back, skills } = partyOf();
  const build = (raws: (Any | null)[], sk: (SkillChoice | null)[]) => raws.map((raw, i) => {
    if (!raw) return null;
    const h = sim.hero(raw);
    if (sk[i]) sim.setSkills(h, sk[i]!.attackList, sk[i]!.passive);
    return h;
  });
  return [build(front, skills.front), build(back, skills.back)];
}

/**
 * U39: Simulate's first fight of this party against the quest (same seed, so the same rolls: hits, crits, misses),
 * traced action by action (tools/fight-trace.ts); null when the party can't fight it (a rule, or an engine error).
 */
function planTrace(t: { id: number; rare: boolean; amount: number }): FightTrace | null {
  if (partyProblem() || apProblem()) return null;
  try {
    const sim = new Sim(state.sv!.raw.gameMode || "Standard");
    const [front, back] = engineParty(sim);
    return traceFight(sim, t.id, front, back, { rare: t.rare, amount: t.amount });
  } catch {
    return null;
  }
}

/** The Map run mode's first run of this party (same seed: same layout and rolls), every room traced; null when it can't run. */
function mapTrace(m: { spec: MapSpec; scrolls: Scroll[] }): MapRoomTrace[] | string {
  try {
    const sim = new Sim(state.sv!.raw.gameMode || "Standard");
    const [front, back] = engineParty(sim);
    return traceMapRun(sim, m.spec, front, back, { scrolls: m.scrolls.length ? m.scrolls : null });
  } catch (e) {
    return String((e as Error)?.message ?? e).split("\n")[0];
  }
}

/** The room shown in the flow of a map run, remembered while the same map stays chosen (sessionStorage). */
const ROOM_KEY = "battle-flow-room";
const mapKey = () => [document.querySelector<HTMLSelectElement>("#map")?.value, document.querySelector<HTMLSelectElement>("#map-asc")?.value,
  document.querySelector<HTMLSelectElement>("#map-grade")?.value].join("|");
let roomChoice: { map: string; room: number } | null = null;
function storedRoom(): number {
  let r = roomChoice;
  if (!r) {
    try {
      r = JSON.parse(sessionStorage.getItem(ROOM_KEY) ?? "null");
    } catch { /* none */ }
  }
  return r && r.map === mapKey() && Number.isInteger(r.room) ? r.room : 0;
}
function setRoom(room: number): void {
  roomChoice = { map: mapKey(), room };
  try {
    sessionStorage.setItem(ROOM_KEY, JSON.stringify(roomChoice));
  } catch { /* not remembered */ }
}

/**
 * The flow's edits (the names in its heads, U64 the skill names in turns 1-5): the same edits as the Party tab's, then
 * both redraw and the fight is traced again.
 */
function planEdit(): PlanEdit {
  const rules = rulesOf(pageTarget());
  // a head name's <select> (nameEdit), or a skill name's picker button (U64: pick-list.ts, data-focus)
  const refocus = (key: string) => document.querySelector<HTMLElement>(`[data-flow-focus="${key}"] select, #flow-panel [data-focus="${key}"]`)?.focus();
  const idxAt = (loc: number) => state.slots[slotKeyOfLoc(loc)] ?? null;
  return {
    heroes: (loc) => {
      const key = slotKeyOfLoc(loc);
      // The party rules: the required slot (Front 2 on a party quest) is never emptied; swapping heroes keeps the size.
      const required = rules.required.some((x) => slotKey(x.row, x.i) === key);
      const options: [string, string][] = [...(required ? [] : [["", "— take out of the party —"] as [string, string]]),
        ...state.sv!.raw.hero.map((h: Any, i: number): [string, string] => [String(i), heroLabel(h)])];
      return { options, value: String(idxAt(loc) ?? "") };
    },
    setHero: (loc, v) => {
      const pick = v === "" ? null : Number(v);
      const r = assignHeroChecked(state, slotKeyOfLoc(loc), pick, pick === null ? null : apOver(pick));
      if (!r.ok) return refuseAp(pick!, r, () => refocus(`hero-${loc}`));
      clearUndo = null;
      persistParty();
      renderParty();
      refocus(`hero-${loc}`);
    },
    skills: (loc, current) => {
      const idx = idxAt(loc);
      return idx === null ? null : rotationChoices(state.sv!.raw.hero[idx], current).map(skillOption);
    },
    setSkill: (loc, k, skill) => {
      const idx = idxAt(loc);
      if (idx === null) return;
      // U40: refused over the AP limit, as in the Party tab.
      const r = editRotationSkill(state, idx, k, skill, rotationOf(idx), apBudgetOf(idx));
      if (!r.ok) return refuseAp(idx, r, () => refocus(`skill-${loc}-${k + 1}`));
      persistParty();
      renderParty(false);
      refocus(`skill-${loc}-${k + 1}`);
    },
    // U40: the enemy column's head changes the opponent through the Party tab's own controls (one state).
    enemies: () => {
      if (oppKind() === "quest") {
        const q = document.querySelector<HTMLSelectElement>("#quest");
        // U62: the Party view's own list, rare variants included ("<id>:rare"; was flowEnemyOptions).
        return q ? { label: "Enemy", groups: questOptions(), value: q.value } : null;
      }
      const m = document.querySelector<HTMLSelectElement>("#map");
      return m ? { label: "Map", groups: mapOptions(state.sv), value: m.value } : null;
    },
    setEnemy: (v) => {
      const s = $<HTMLSelectElement>(oppKind() === "quest" ? "#quest" : "#map");
      if (s.value !== v) {
        s.value = v;
        s.dispatchEvent(new Event("change"));
      }
      refocus("enemy");
    },
  };
}

/** U63: how far the selected room stays clear of the bar's edges (the 36 px fade and its ‹ › button). */
const ROOM_PAD = 36;

/**
 * The map's room bar, scrollable on every device. R2 F29: `fade-start` / `fade-end` while there is more to see on
 * that side (style.css r2-c fades that edge). U63, for a PC (the bar has no scrollbar): a vertical mouse wheel over it
 * moves it sideways while it can move that way, then the page scrolls on (battle-layout.ts roomBarWheel); a ‹ / ›
 * button over each faded edge scrolls it by most of its width (mouse only: the arrow keys, Home and End move between
 * the rooms); `reveal()` keeps the selected room in view. Kept in step on scroll and on resize (a hidden tab shown
 * later). Returns the box holding the bar and its buttons.
 */
function roomScroller(bar: HTMLElement): { box: HTMLElement; reveal: (smooth?: boolean) => void } {
  const motion = (): ScrollBehavior =>
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  const btn = (dir: -1 | 1) => {
    const b = el("button", { type: "button", class: `room-scroll ${dir < 0 ? "prev" : "next"}`, tabindex: "-1", "aria-hidden": "true",
      title: dir < 0 ? "Earlier rooms" : "Later rooms" }, dir < 0 ? "‹" : "›");
    // a mouse aid: it keeps the focus where it was (the selected room)
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => bar.scrollBy({ left: rowStep(bar, dir), behavior: motion() }));
    return b;
  };
  const prev = btn(-1), next = btn(1);
  const box = el("div", { class: "room-nav" }, prev, bar, next);
  const reveal = (smooth = true) => {
    const cur = bar.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!cur || bar.clientWidth === 0) return;
    const left = cur.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
    const to = scrollToShow(bar, left, cur.offsetWidth, ROOM_PAD);
    if (to !== null) bar.scrollTo({ left: to, behavior: smooth ? motion() : "auto" });
  };
  let width = 0;
  const sync = () => {
    const rest = bar.scrollWidth - bar.clientWidth - bar.scrollLeft;
    bar.classList.toggle("fade-start", bar.scrollLeft > 2);
    bar.classList.toggle("fade-end", rest > 2);
    prev.hidden = !bar.classList.contains("fade-start");
    next.hidden = !bar.classList.contains("fade-end");
    // shown (a hidden tab opened) or resized from nothing: the selected room comes into view at once
    if (width === 0 && bar.clientWidth > 0) reveal(false);
    width = bar.clientWidth;
  };
  bar.addEventListener("scroll", sync, { passive: true });
  // not passive: a wheel the bar takes must not scroll the page too
  bar.addEventListener("wheel", (e) => {
    const d = roomBarWheel(e, bar);
    if (!d) return;
    e.preventDefault();
    bar.scrollLeft += d;
  }, { passive: false });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(sync).observe(bar);
  sync();
  return { box, reveal };
}

/** What the flow shows, and how (U39): one concrete run, Simulate's first. */
const FLOW_NOTE = "One concrete fight: the first of the Simulator's runs (same seed), so its hits, misses and critical hits are that run's rolls.";
const MAP_FLOW_NOTE = "One concrete run: the first of the Map run's runs (same seed), so its layout, rolls and the HP carried from room to room are that run's.";

/** The Flow tab: the opponent in one line, then the fight (a quest) or the room bar and a room's fight (a map run). */
function renderPlan(): void {
  const box = document.querySelector<HTMLElement>("#plan");
  if (!box || !state.sv) return;
  const opp = $("#flow-opp"), help = document.querySelector<HTMLElement>("#plan-help");
  box.replaceChildren();
  opp.replaceChildren();
  help?.replaceChildren();
  // U58: the open Flow layout (flow-layouts.ts), the same inputs for each.
  const layout = flowLayout(flowChoice);
  flowDrawn = layout.id;
  const members: PlanMember[] = partyOf().members.map((m) => ({
    row: m.row, i: m.i, name: String(m.raw.name), cls: Number(m.raw.class), rotation: rotationOf(m.idx).attackList,
    level: Number(m.raw.level),
  }));
  const problem = partyProblem();
  // U40: a hero over its AP limit (an old saved party): the warning, not a fight with the default rotation.
  const ap = problem ? null : apProblem();
  // U48: the Solver's flow is read-only: no ▾, no enemy picker in the enemy column's head.
  const edit = pageControls(state.mode.key).edit ? planEdit() : undefined;
  if (oppKind() === "quest" && document.querySelector("#quest")) {
    // U48: no "vs <enemy> change" line: the enemy column's head names the enemy and, clicked, changes it.
    const t = targetOf().quest!;
    const trace = members.length ? planTrace(t) : null;
    // U61: the Party view's HP chart draws this very trace (the same object the Flow layout gets).
    showHp(trace ? [{ trace, enemy: enemyName(String(t.id), t.rare) ?? "Enemy", quest: { id: t.id, rare: t.rare } }] : null, members);
    const plan = layout.render(t, members, trace, edit);
    if (plan) {
      box.append(...(problem && members.length ? [el("p", { class: "error small" }, `⚠ ${problem} The rotation as planned until then.`)] : []),
        ...(ap && members.length ? [el("p", { class: "error small flow-ap", role: "status" }, `⚠ ${ap} Below, the rotation as planned.`)] : []), plan);
      // R2 F28: what the flow shows (one concrete fight) is the first paragraph of its "?", not a line above it.
      help?.append(helpTip([...(trace ? [FLOW_NOTE] : []), layout.help(t, Boolean(edit))], "the flow"));
    } else box.append(el("p", { class: "muted" }, "No timeline for this enemy yet."));
    return;
  }
  if (oppKind() !== "map" || !document.querySelector("#map")) return showHp(null, members, true);
  const m = targetOf().map!;
  opp.append(el("span", { class: "muted small" }, "map run: "), el("strong", {}, $<HTMLSelectElement>("#map").selectedOptions[0]?.textContent ?? ""));
  if (!members.length || problem || ap) {
    showHp(null, members);
    box.append(el("p", { class: problem || ap ? "error" : "muted" }, problem || ap ? `⚠ ${problem ?? ap}` : "Put heroes in the party (Party tab) to see the run."));
    return;
  }
  const rooms = mapTrace(m);
  if (typeof rooms === "string" || !rooms.length) {
    showHp(null, members);
    box.append(el("p", { class: "error" }, `This map run could not be simulated${typeof rooms === "string" ? `: ${rooms}` : ""}.`));
    return;
  }
  const tabs = mapRoomTabs(rooms, (id, rare) => enemyName(String(id), rare));
  // U61: the HP chart draws the same traced run as the room bar: every fought room, in map order.
  showHp(rooms.flatMap((r, k): HpRun[] => (r.trace ? [{ trace: r.trace, enemy: enemyName(String(r.questId), r.isRare) ?? r.name, room: tabs[k].label,
    quest: { id: r.questId, rare: r.isRare } }] : [])), members);
  let at = Math.min(storedRoom(), rooms.length - 1);
  const view = el("div", { class: "flow-room", id: "flow-room", role: "tabpanel" });
  const bar = el("div", { class: "room-bar scroll-row", role: "tablist", "aria-label": "The map's battles, in order" });
  // R2 F29 / U63: the bar scrolls sideways (touch, wheel, ‹ ›), its edges fade while more rooms are there.
  const scroller = roomScroller(bar);
  const draw = (smooth = true) => {
    bar.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((b, k) => {
      b.setAttribute("aria-selected", String(k === at));
      b.tabIndex = k === at ? 0 : -1;
    });
    // U63: the selected room stays in view (a click, the arrow keys, Home, End, a redraw)
    scroller.reveal(smooth);
    view.setAttribute("aria-labelledby", `room-tab-${at}`);
    const r = rooms[at];
    // U40: after the room where the party died there is no battle: one centred line, no timeline.
    if (tabs[at].skipped) {
      view.replaceChildren(el("p", { class: "flow-skipped", role: "status" }, "💀 Party died, battle skipped"));
      help?.replaceChildren(helpTip(MAP_FLOW_NOTE, "the flow"));
      return;
    }
    const plan = layout.render({ id: r.questId, rare: r.isRare }, members, r.trace, edit);
    view.replaceChildren(...(r.trace ? [] : [el("p", { class: "muted small" }, "Not reached in this run: the rotation as planned.")]),
      plan ?? el("p", { class: "muted" }, "No timeline for this enemy yet."));
    // R2 F28: the run's note is the first paragraph of the "?".
    help?.replaceChildren(helpTip([MAP_FLOW_NOTE, layout.help({ id: r.questId, rare: r.isRare }, Boolean(edit))], "the flow"));
  };
  tabs.forEach((x, k) => {
    const b = el("button", { type: "button", role: "tab", id: `room-tab-${k}`, "aria-controls": "flow-room", class: `room-tab st-${x.status}${x.boss ? " boss" : ""}`, "aria-selected": "false",
      title: `${x.label}: ${x.skipped ? "skipped, the party died before" : ["not reached in this run", "won", "lost"][x.status] ?? ""}` }, x.label,
      ...(x.status === 2 ? [el("span", { "aria-hidden": "true" }, " 💀")] : []));
    b.addEventListener("click", () => {
      at = k;
      setRoom(k);
      draw();
    });
    bar.append(b);
  });
  // The arrow keys, Home and End move between the rooms (the tablist pattern, dom.ts tabKeys).
  tabKeys(bar);
  box.append(scroller.box, view);
  draw(false);
}

/**
 * U61: the HP chart's box in the Party view, made once. U65: #hp-col is the view's first row, full width, above the
 * heroes | opponent columns (U62 had it as the third column; until U62 it was under the opponent's card).
 */
function hpBox(): HTMLElement | null {
  const col = document.querySelector<HTMLElement>("#hp-col");
  if (!col) return null;
  let box = col.querySelector<HTMLElement>("#hp-chart");
  if (!box) {
    box = el("section", { id: "hp-chart", class: "hp-chart-box", "aria-label": "HP by turn" });
    col.append(box);
  }
  return box;
}

/**
 * U61: draw the HP chart from the traced fight(s) renderPlan just made for the Flow (never a fight of its own): one
 * quest fight, or a map run's fought rooms. Only the chart's box is replaced. `runs` null: the empty line; `hide`: none.
 */
function showHp(runs: HpRun[] | null, members: PlanMember[], hide = false): void {
  const box = hpBox();
  const fighters = members.map((m) => ({ who: locationOf(m.row, m.i), name: m.name, cls: m.cls }));
  chart = runs ? hpData(runs, fighters) : null;
  // U65: the turn the cards show: the one picked before when this fight still has it, else turn 0.
  turnAt = chart ? pickStep(chart, turnPick) : 0;
  if (chart) turnPick = { run: chart.steps[turnAt].run, turn: chart.steps[turnAt].turn };
  if (box) drawHpChart(box, chart, { hide, selected: turnAt, onSelect: selectTurn });
  paintTurn();
}

/**
 * U65: the chart's data from the last trace, the step its marker is on (`turnAt`), and the turn picked (a room and a
 * turn; it outlives a new trace, so an edit keeps the turn when the new fight still has it).
 */
let chart: HpChartData | null = null;
let turnAt = 0;
let turnPick: { run: number; turn: number } = { run: 0, turn: 0 };

/** U65: a click, a tap or a key on the chart picked another turn: the cards show it (nothing is traced again). */
function selectTurn(i: number): void {
  if (!chart?.steps[i]) return;
  turnAt = i;
  turnPick = { run: chart.steps[i].run, turn: chart.steps[i].turn };
  paintTurn();
}

/**
 * U65: every card at the selected turn's end (turn 0: the start), from the chart's data, the Flows' own trace: a hero
 * card's HP, live stats, effects and played row (paintCard, in place: its pickers and focus stay), and the enemy's
 * card. A hero that doesn't fight (left out, no fight to show) gets its own stats back, nothing else.
 */
function paintTurn(): void {
  const at = chart?.steps[turnAt];
  const inc = fighting().included;
  document.querySelectorAll<HTMLElement>("#party [data-slot]").forEach((card) => {
    const key = card.dataset.slot ?? "";
    const idx = state.slots[key] ?? null;
    const raw = heroRaw(idx);
    if (!raw) return;
    const now = at?.states[locationOf(key.startsWith("front") ? "front" : "back", Number(key.slice(-1)))];
    const inFight = now && inc.has(key);
    paintCard(card, inFight
      ? { stats: now.stats ? { ...now.stats, maxHP: now.maxHP } : heroCardStats(idx, raw), fx: now.fx, active: now.active,
        life: { hp: now.hp, maxHP: now.maxHP, label: `${raw.name}: ${now.hp <= 0 ? "down, " : ""}${hpTexts(now.hp, now.maxHP).full} HP` } }
      : { stats: heroCardStats(idx, raw) });
  });
  drawEnemyCard();
}

// ---------------------------------------------------------------- the page's own parts (U41)
/** The Simulator's number of runs (a quest takes more than a map run); the Solver has none. */
function setRuns(v: string): void {
  const runs = document.querySelector<HTMLInputElement>("#runs");
  if (runs) runs.value = v;
}

/** Build the opponent and, on the Solver, its panel, once a save is in. */
function buildPage(): void {
  syncOppKinds();
  if (!state.sv) return;
  renderParty(false); // "to be found" slots on the Solver
  // The opponent card: the remembered one, else a useful one (onExpansions).
  onExpansions();
  if (solving()) search?.show("party");
}

/**
 * U41, the Solver's step 3: the Party and Flow tabs show only once a result's Show has filled the party; before, no
 * party panel at all. It stays shown for later solves until the save is forgotten.
 */
function revealParty(): void {
  const box = document.querySelector<HTMLElement>("#party-box");
  if (!box) return;
  box.hidden = false;
  showTab(storedTab(), false);
  renderParty(false);
  // R2 F33: every Show brings the party into view (not only the first one).
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}
function hideParty(): void {
  const box = document.querySelector<HTMLElement>("#party-box");
  if (box) box.hidden = true;
}

/**
 * U41: the Solver's "Open in Simulator": the shown party (slots, rotations, heroes left out) and the opponent become
 * the Simulator's for this save (its edited rotations of other heroes stay), then the Simulator opens. The Solver's
 * edits change nothing else of the Simulator.
 */
function openInSimulator(): void {
  if (!state.sv) return;
  try {
    let was: Partial<StoredParty> | null = null;
    try {
      was = JSON.parse(localStorage.getItem(partyKey()) ?? "null");
    } catch { /* broken: replaced */ }
    const party = simulatorPartyFrom({ slots: state.slots, skills: state.skills, excluded: state.excluded }, was);
    localStorage.setItem(partyKey(), JSON.stringify(party));
    localStorage.setItem(OPP_KEY, JSON.stringify(currentOpponent()));
  } catch {
    toast("This browser blocks site storage, so the party can't be handed to the Simulator.");
    return;
  }
  location.href = SIMULATOR_PAGE;
}

// ---------------------------------------------------------------- run
/**
 * U48: no Results section. A run's progress, error or summary (win rate, grade when won, Show details) is in the
 * Simulate panel after ▶ Simulate (#sim-summary), where the click was, so nothing scrolls; the details right under
 * the panel (#results, empty and so not shown until a result). A new or forgotten save clears both.
 */
function clearResults(): void {
  document.querySelector("#sim-summary")?.replaceChildren();
  document.querySelector("#results")?.replaceChildren();
}

/** The six slots as the worker takes them (raw save heroes, edited rotations), and who stands where. */
function partyOf() {
  const sv = state.sv!;
  const front: (Any | null)[] = [null, null, null], back: (Any | null)[] = [null, null, null];
  const skills = { front: [null, null, null] as (SkillChoice | null)[], back: [null, null, null] as (SkillChoice | null)[] };
  const members: PartyMember[] = [];
  // U36: only the heroes that fight (ticked in, within the size cap); the others stay in their slot.
  const inc = fighting().included;
  for (const [row, i] of SLOTS) {
    const idx = state.slots[slotKey(row, i)];
    if (idx === null || idx === undefined || !inc.has(slotKey(row, i))) continue;
    (row === "front" ? front : back)[i] = sv.raw.hero[idx];
    (row === "front" ? skills.front : skills.back)[i] = state.skills[idx] ?? null;
    members.push({ row, i, idx, raw: sv.raw.hero[idx] });
  }
  return { front, back, skills, members };
}

/** The opponent chosen in step 3. */
function targetOf(): { quest?: { id: number; rare: boolean; amount: number }; map?: { spec: MapSpec; scrolls: Scroll[] } } {
  const sv = state.sv!;
  if (oppKind() === "quest") {
    return { quest: { ...questPick()!, amount: Number($<HTMLSelectElement>("#amount").value) } };
  }
  const v = $<HTMLSelectElement>("#map").value;
  const spec: MapSpec = v.startsWith("own:") ? sv.raw.mapInventory.filter((c: unknown) => typeof c === "string")[Number(v.slice(4))]
    : { id: Number(v.slice(4)), prestigeLevel: Number($<HTMLSelectElement>("#map-asc").value), grade: Number($<HTMLSelectElement>("#map-grade").value) };
  const scrolls = [...document.querySelectorAll<HTMLSelectElement>("select.scroll")].map((s) => s.value).filter(Boolean)
    .map((id) => ({ id: Number(id), prestigeLevel: 0 }));
  return { map: { spec, scrolls } };
}

function request(): BattleRequest {
  const sv = state.sv!;
  const { front, back, skills, members } = partyOf();
  if (!members.length) throw new Error("Put at least one hero in the party.");
  const n = Math.max(1, Math.min(5000, Math.trunc(Number($<HTMLInputElement>("#runs").value) || 0)));
  return { gameMode: sv.raw.gameMode || "Standard", front, back, skills, n, ...targetOf() };
}

/**
 * The map a map result is about (U33; U65: for its craft time only, the XP tiles are gone), taken when the run starts
 * (the page may change before it ends): id, grade, ascension, party size. Null for a quest.
 */
function runContext(req: BattleRequest): MapRunContext | null {
  if (req.quest) return null;
  const heroes = partyOf().members.length;
  const mode = req.gameMode || "Standard";
  const v = $<HTMLSelectElement>("#map").value;
  const own: Any = v.startsWith("own:") ? state.sv?.mapInventory[Number(v.slice(4))] : null;
  return own ? { map: Number(own.id), grade: own.grade ?? 3, asc: own.prestigeLevel ?? 0, heroes, mode }
    : { map: Number(v.slice(4)), grade: Number($<HTMLSelectElement>("#map-grade").value), asc: Number($<HTMLSelectElement>("#map-asc").value), heroes, mode };
}

/** The last simulation shown (drawn again in another language, U29), with its run context. */
let lastResult: (Extract<BattleResponse, { ok: true }> & { ctx: MapRunContext | null }) | null = null;
function drawResult(): void {
  const r = lastResult;
  if (!r) return;
  const shown = r.kind === "quest" ? questResults(r.result, r.ms) : mapResults(r.result, r.ms, r.ctx);
  // U48: the summary and its toggle in the Simulate panel, the details right under it.
  $("#sim-summary").replaceChildren(...shown.head);
  $("#results").replaceChildren(shown.details);
}

function run(): void {
  // U48: progress, errors and the summary in the Simulate panel, after the button; the old details go.
  const out = $("#sim-summary");
  lastResult = null;
  document.querySelector("#results")?.replaceChildren();
  let req: BattleRequest;
  let ctx: MapRunContext | null = null;
  try {
    req = request();
    const problem = partyProblem();
    if (problem) throw new Error(problem);
    try {
      ctx = runContext(req);
    } catch {
      ctx = null; // the craft time is left out, the result still shows
    }
  } catch (e) {
    out.replaceChildren(el("p", { class: "error", role: "alert" }, (e as Error).message));
    return;
  }
  state.worker?.terminate();
  const worker = dataWorker("battle-worker.js", ["gamedata.json"]);
  state.worker = worker;
  const btn = $<HTMLButtonElement>("#run");
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const stop = () => {
    worker.terminate();
    state.worker = null;
    btn.disabled = false;
  };
  cancel.addEventListener("click", () => {
    stop();
    out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
  });
  btn.disabled = true;
  out.replaceChildren(el("div", { class: "toolbar" }, el("p", { class: "muted" }, `Simulating ${req.n} ${req.quest ? "fights" : "map runs"}…`), cancel));
  worker.onmessage = (e: MessageEvent<BattleResponse>) => {
    stop();
    const r = e.data;
    if (!r.ok) out.replaceChildren(el("p", { class: "error", role: "alert" }, r.error));
    else {
      lastResult = { ...r, ctx };
      drawResult();
    }
  };
  worker.onerror = (e) => {
    stop();
    out.replaceChildren(el("p", { class: "error", role: "alert" }, `Simulation failed: ${e.message}`));
  };
  worker.postMessage(req);
}

// ---------------------------------------------------------------- results
/** Average grade (1..5) as the nearest letter. */
const gradeOf = (g: number) => GRADES[Math.min(4, Math.max(0, Math.round(g) - 1))];
/** A hint as a "?" sentence: capital first letter, full stop. */
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;

/**
 * Per hero: damage, taken, healing, death rate, damage by skill. R1 F22: against a quest (`quest`: the result) the
 * damage is what really came off the enemy, the party's total capped at the enemy's max HP (effectiveDamage); the
 * damage dealt, overkill included, is in the cell's tooltip. A map run keeps the damage dealt (its rooms differ).
 */
function heroTable(heroes: Record<string, HeroEval>, unit: string, quest?: FightEval): HTMLElement {
  const order = ["front1", "front2", "front3", "back1", "back2", "back3"];
  const eff = quest ? effectiveDamage(quest) : null;
  const maxHp = quest ? enemyMaxHp(quest) : null;
  const rows: Row[] = order.filter((k) => heroes[k]).map((k) => {
    const h = heroes[k];
    const top = Object.entries(h.skillDmg).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([sk, v]) => `${skillName(sk)} ${fmt.format(v)} (${fmt1.format(h.skillUses[sk] ?? 0)}×)`).join(" · ");
    const raw = heroRaw(state.slots[`${k.replace(/\d$/, "")}${Number(k.slice(-1)) - 1}`] ?? null);
    return { slot: slotLabel(k), name: h.name, cls: raw?.class ?? h.class ?? 0, dmg: eff?.[k]?.[0] ?? h.dmg, dealt: h.dmg, taken: h.taken, heal: h.heal,
      hp_left: h.hp_left_frac, hp_tip: hpLeftCell(h, quest ? "fight" : "run").title, death_rate: h.death_rate, skills: top };
  });
  const dmgTip = eff && maxHp ? `Damage that came off the enemy: the party's total is capped at its ${fmt.format(maxHp)} HP (no overkill), each hero keeping its share. `
    + "Hover a number for the damage dealt, overkill included." : "Damage dealt, overkill included.";
  // R2 F25 / F26: no Slot column (the slot is the hero's subline); the name is plain text with its class colour as a
  // bar on its left, not a pill (a pill reads as a class). "Damage" per fight (or run) is said in its tooltip.
  const t = table(rows, [
    { key: "name", label: "Hero", render: (r) => el("span", { class: `hero-cell cls-${r.cls}`, title: `${r.name} · ${className(Number(r.cls))}` },
      el("span", { class: "hero-cell-name" }, String(r.name)), el("span", { class: "hero-cell-sub" }, String(r.slot))) },
    { key: "dmg", label: "Damage", num: true, render: (r) => (eff && Number(r.dealt) > Number(r.dmg) + 0.5
      ? el("span", { title: `${fmt.format(Number(r.dealt))} dealt, overkill included` }, fmt.format(Number(r.dmg)))
      : fmt.format(Number(r.dmg))) },
    { key: "taken", label: "Taken", num: true },
    { key: "heal", label: "Healing", num: true },
    // U43: HP left at the end (a map run: of the whole run), the HP in the tooltip.
    { key: "hp_left", label: "HP left", num: true, render: (r) => el("span", { title: String(r.hp_tip) }, pct(Number(r.hp_left))) },
    { key: "death_rate", label: "Dies", num: true, render: (r) => el("span", { class: `rate ${rateTone(Number(r.death_rate), true)}`, style: "color: var(--c)" }, pct(Number(r.death_rate))) },
    { key: "skills", label: "Damage by skill (uses)" },
  ]);
  const head = [...t.querySelectorAll<HTMLElement>("th")].find((th) => th.textContent === "Damage");
  if (head) head.title = `Per ${unit}. ${dmgTip}`;
  return t;
}

/**
 * U43: compact first. The win rate and the average grade; "Show details" opens the rest (compactResult). Turns: the
 * average, the longest fight and the game's cap (a fight still running at turn 200 is lost).
 */
function questResults(ev: FightEval, ms: number): ReturnType<typeof compactResult> {
  const turnHint = [ev.turns_win !== null ? `${fmt1.format(ev.turns_win)} when won` : "never won", turnCapNote(ev.turns_max),
    cappedNote(ev.turns_capped, ev.n, "fights")].filter(Boolean).join(" · ");
  // R2 F24: the details are one grid, label and value only, each explanation in its "?". U65: no XP per hero, quest
  // time or XP / min (U33's tiles): the outcome only.
  return compactResult(
    tiles({ class: "result-summary" },
      tile("Win rate", pct(ev.win), undefined, { icon: "🏆", tone: rateTone(ev.win), bar: ev.win }),
      gradeTile(ev.win, ev.grade),
    ),
    [
      tiles({ class: "result-tiles" },
        resultTile("Turns", fmt1.format(ev.turns), sentence(turnHint), { icon: "⏱️", tone: ev.turns_capped ? "bad" : "t-blue" }),
        resultTile("Enemy HP removed", pct(ev.enemy_dmg), ev.enemy_dmg_peak !== undefined && ev.enemy_dmg_peak > ev.enemy_dmg + 5e-4
          ? `Lowest point ${pct(ev.enemy_dmg_peak)} (it heals back).` : undefined, { icon: "🗡️", tone: rateTone(ev.enemy_dmg), bar: ev.enemy_dmg }),
        resultTile("Party HP left", pct(ev.hp_left), undefined, { icon: "❤️", tone: rateTone(ev.hp_left * 1.6), bar: ev.hp_left }),
      ),
      heroTable(ev.heroes, "fight", ev),
    ],
    runLine(ev.n, "fights", ms),
  );
}

const gradeTile = (win: number, grade: number) =>
  resultTile("Grade when won", win ? gradeOf(grade) : "–", win ? `Average ${fmt1.format(grade)} (D = 1 … S = 5).` : undefined, { icon: "⭐", tone: "t-gold" });

/** R1 F20: the run's size in one short line (R2 F24: its time and the seeds in its tooltip). */
const runLine = (n: number, unit: string, ms: number, seeds = n) => el("p", { class: "muted small run-line",
  title: `Simulated in ${fmt.format(ms)} ms. Seeds 1–${seeds}: every setting is tested on the same rolls.` }, `${fmt.format(n)} ${unit}`);

/**
 * R1 F35: a tile grid knows its tile count. R2 F24: and its columns (tileColumns: on a phone and wider), so no row
 * ends with a lone tile.
 */
function tiles(attrs: Record<string, string>, ...items: HTMLElement[]): HTMLElement {
  const g = el("div", { ...attrs, class: `tiles${attrs.class ? ` ${attrs.class}` : ""}` }, ...items);
  const cols = tileColumns(items.length);
  g.style.setProperty("--n", String(items.length));
  g.style.setProperty("--cols-phone", String(cols.phone));
  g.style.setProperty("--cols-wide", String(cols.wide));
  g.dataset.n = String(items.length);
  return g;
}

/**
 * U43: as questResults. Turns per room: the average, per run in the hint, the longest room and the cap. U65: no XP per
 * hero or XP / min; one Time tile (per run, simulated), the map's craft time in its "?" (was a tile of its own).
 */
function mapResults(ev: MapEval, ms: number, ctx: MapRunContext | null = null): ReturnType<typeof compactResult> {
  const fails = Object.entries(ev.fail_room).map(([k, v]) => `${k} (${pct(v / ev.n)})`).join(", ");
  const charges = ev.charges_used.map(([id, v]) => `${itemName("consumable", id) ?? id}: ${fmt1.format(v)}`).join(", ");
  const essence = resultTile("Essence per run",
    el("span", { class: "tile-lines" }, ...essenceLines(ev.essence, (k) => itemNameFromEnglish("material", k)).map((t) => el("span", {}, t))),
    ev.win < 1 ? "From the runs won." : undefined, { icon: "✨", tone: "t-violet" });
  const turnHint = [`${fmt1.format(ev.run_turns)} per run`, `longest room: ${turnCapNote(ev.room_turns_max)}`,
    cappedNote(ev.rooms_capped, ev.n, "runs")].filter(Boolean).join(" · ");
  // R2 F24: one grid of 6 tiles: the outcome, the time, the loot and the essence last.
  let craft: string | null = null;
  try {
    craft = ctx ? duration(mapResultXp(ev, ctx).craftSeconds) : null;
  } catch { /* no craft time: the tile says the run's only */ }
  return compactResult(
    tiles({ class: "result-summary" },
      tile("Win rate", pct(ev.win), undefined, { icon: "🏆", tone: rateTone(ev.win), bar: ev.win }),
      gradeTile(ev.win, ev.grade),
    ),
    [
      tiles({ class: "result-tiles" },
        // R1 F29: the rooms as the map card counts them (treasure rooms and boss included), said in the "?".
        resultTile("Progress", pct(ev.cleared), [`Of ${fmt1.format(ev.rooms)} rooms on average.`,
          "Rooms cleared per run, of the rooms a run met on average: treasure rooms and the boss included, as on the map card."],
        { icon: "🧭", tone: rateTone(ev.cleared), bar: ev.cleared }),
        resultTile("Turns per room", fmt1.format(ev.room_turns), sentence(turnHint), { icon: "⏱️", tone: ev.rooms_capped ? "bad" : "t-blue" }),
        resultTile("Time", duration(ev.time_h * 3600), ["Per run, simulated.", craft ? `Crafting the map: ${craft}.` : null], { icon: "⌛", tone: "t-blue" },
          [statLink("time", "time")]),
        resultTile("Loot value", gold(ev.loot_value), "Base sell value per run.", { icon: "💰", tone: "t-orange" }),
        resultTile("Party HP left", pct(ev.hp_left), "At the end of the run.", { icon: "❤️", tone: rateTone(ev.hp_left * 1.6), bar: ev.hp_left }),
        essence,
      ),
      ...(fails ? [el("p", { class: "result-note" }, el("strong", {}, "💀 Lost at: "), fails)] : []),
      ...(charges ? [el("p", { class: "result-note" }, el("strong", {}, "📜 Scroll charges used per run: "), charges)] : []),
      ...(ev.escaped ? [el("p", { class: "muted" }, `Escaped in ${pct(ev.escaped)} of runs.`)] : []),
      ...(ev.errors ? [el("p", { class: "muted small" }, `${ev.errors} runs failed inside the game's own code (${ev.error}); the game would crash on them too.`)] : []),
      heroTable(ev.heroes, "run"),
    ],
    runLine(ev.n, "map runs", ms, ev.n + ev.errors),
  );
}

// ---------------------------------------------------------------- page
/** Parse and use a save (from a file or from the browser's storage); throws when it isn't one. */
async function loadSave(text: string, name: string): Promise<void> {
  // Timelines are optional: without them the opponent card shows the plain rotation and there is no party plan.
  await Promise.all([loadData(), loadWikiText(), loadTimelineData().catch(() => {}), languageReady]);
  let sv: Save;
  try {
    sv = loadSaveText(text);
  } catch {
    throw new Error("this is not a Merchant save. Pick PlayerData.txt, Slot2Data.txt … Slot5Data.txt or one of their backups.");
  }
  if (!Array.isArray(sv.raw?.hero) || !sv.raw.hero.length) throw new Error("this save has no heroes.");
  api.setMode(sv.raw.gameMode || "Standard");
  state.sv = sv;
  state.saveName = name;
  state.slots = {};
  state.skills = {};
  state.excluded = {};
  // U50: a stored party's old 🔒 locks become the Solver's Must include (before the Simulator stores its party again).
  try {
    migrateOldLocks(localStorage, name, sv.raw.hero.map((h: Any) => Number(h.id)));
  } catch { /* storage blocked */ }
  const remembered = restoreParty(sv.raw.hero.length);
  $("#setup").hidden = false;
  lastResult = null;
  clearResults();
  // The Solver: no party until a result's Show (U41).
  if (solving()) hideParty();
  renderParty();
  buildPage(); // builds the opponent: the remembered one, else a useful one (onExpansions)
  if (!remembered && !solving()) fillParty();
}

/**
 * R1 F02: a save opened here for the first time starts with a party, not six empty slots: its strongest heroes, as
 * many as the opponent takes, the toughest in front, the required slot first (battle-setup.ts defaultSlots).
 */
function fillParty(): void {
  const sv = state.sv;
  if (!sv) return;
  const heroes = sv.raw.hero.map((h: Any, idx: number) => {
    let maxHP = 0;
    try {
      maxHP = Number(api.heroStats(api.newHero(h)).maxHP) || 0;
    } catch { /* unknown class: last in line */ }
    return { idx, level: Number(h.level) || 0, prestige: Number(h.prestigeLevel) || 0, maxHP };
  });
  state.slots = defaultSlots(heroes, rulesOf(pageTarget()));
  state.excluded = {};
  persistParty();
  renderParty();
}

/** R1 F02: the quest a save starts on when no opponent is remembered (defaultQuest: its strongest heroes' region). */
function startQuest(): string | undefined {
  const top = Math.max(0, ...(state.sv?.raw.hero ?? []).map((h: Any) => Number(h.level) || 0));
  // The base game's quests first (an expansion's enemy only when nothing else fits).
  const id = defaultQuest(top, (q) => isVisible("enemy", q) && !needsOf("enemy", q).length) ?? defaultQuest(top, (q) => isVisible("enemy", q));
  return id === null ? undefined : String(id);
}

/** R2 F20: the Simulate panel's "?" (was the sentence at the top of its box). U48: beside ▶ Simulate (no section titles). */
const SIMULATE_HELP = "Your party against an enemy or a map run, hundreds of times, on the same rolls every time. Set them up below.";

/**
 * U48: the "↑" button, fixed bottom right, on both battle pages (the Flow on a phone is one long page): shown once the
 * page is scrolled down more than a screen (battle-layout.ts toTopVisible), it scrolls back to the top, smoothly unless
 * the visitor asks for reduced motion, and puts the focus on the page's main content (the button then hides).
 */
function initToTop(): void {
  const btn = el("button", { type: "button", class: "to-top", "aria-label": "Back to top", title: "Back to top", hidden: "" }, "↑");
  document.body.append(btn);
  let queued = false;
  const sync = () => {
    queued = false;
    btn.hidden = !toTopVisible(scrollY, innerHeight);
  };
  addEventListener("scroll", () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(sync);
    }
  }, { passive: true });
  addEventListener("resize", sync, { passive: true });
  btn.addEventListener("click", () => {
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const main = document.querySelector<HTMLElement>("main");
    if (main) {
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
    scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" });
  });
  sync();
}

/** Starts the Simulator (`simulate`, battle.ts) or the Solver (`solve`, solver.ts) on its page's HTML. */
export function initBattlePage(kind: PageKind): void {
  state.mode = MODES[kind];
  if (kind === "simulate") takeLinkedOpponent(); // U53: before anything builds the opponent
  // Until U41 the one page remembered its mode; the Simulator and the Solver are two pages now.
  try {
    localStorage.removeItem("battle-mode");
  } catch { /* storage blocked */ }
  initTabs();
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#loaded"), load: loadSave,
    onForget: () => {
      state.sv = null;
      clearResults();
      hideParty();
    },
  });
  loadWikiText();
  // Quest enemy ⇄ map run: the other kind comes back as it was last chosen (U36).
  document.querySelectorAll<HTMLInputElement>("input[name=opp]").forEach((r) => r.addEventListener("change", () => {
    saving = false;
    try {
      const o = storedOpponent();
      o.quest ??= startQuest(); // R1 F02: never back to the first bush of the list
      restoreOpponent(o);
    } finally {
      saving = true;
    }
    saveOpponent();
  }));
  initToTop();
  if (solving()) initSolver();
  else {
    $("#run").addEventListener("click", run);
    // U48: hero cards move by drag and drop (party-drag.ts); #party stays, its cards are redrawn inside it.
    enableSlotDrag($("#party"), dropHero);
    // R2 F20: what Simulate does is in the "?" of its heading, not a sentence in the box.
    document.querySelector("#sim-help")?.replaceChildren(helpTip(SIMULATE_HELP, "Simulate"));
  }
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
  subscribe(onExpansions);
  onLanguageChange(onLanguage);
}

/** The Solver's panel (battle-search.ts): its guard, the Solve panel's options and progress, the results, Show into the tabs. */
function initSolver(): void {
  $("#open-sim").addEventListener("click", openInSimulator);
  search = initSearch({
    save: () => state.sv!,
    gameMode: () => state.sv?.raw.gameMode || "Standard",
    party: partyOf,
    target: targetOf,
    applyRotation: (idx, rotation, passive) => {
      state.skills[idx] = { attackList: rotation, passive };
      persistParty();
      renderParty(false);
    },
    applyParty: (front, back) => {
      const index = (id: number | null) => (id === null ? null : state.sv!.raw.hero.findIndex((h: Any) => h.id === id));
      state.slots = {};
      state.excluded = {};
      front.forEach((id, i) => (state.slots[slotKey("front", i)] = index(id)));
      back.forEach((id, i) => (state.slots[slotKey("back", i)] = index(id)));
      clearUndo = null;
      persistParty();
      renderParty(false);
    },
    saveName: () => state.saveName,
    poolSkills: () => Object.fromEntries(Object.entries(state.skills).map(([i, s]) => [state.sv!.raw.hero[Number(i)].id, s])),
    applyScrolls: (ids) => {
      document.querySelectorAll<HTMLSelectElement>("select.scroll").forEach((s, k) => (s.value = ids[k] === undefined ? "" : String(ids[k])));
    },
    // U42: no onStart (the progress is in the Solve panel; the results appear only once a solve is done).
    // U41: a result's Show (after its party is applied) brings the Party and Flow tabs.
    onShow: revealParty,
    rules: () => rulesOf(pageTarget()),
    problem: (front, back) => problemOf(pageTarget(), front, back),
    goSimulate: () => {
      location.href = SIMULATOR_PAGE;
    },
    // U39: the spoiler guard hides the whole rest of the page (the opponent and options, Results, party, flow) until accepted.
    guarded: (on) => $("#setup").classList.toggle("solve-guarded", on),
  }, $("#search-panel"), $("#search-form"), $("#search-results"));
}

/**
 * U29: another language. Redraw the party (skill and passive pickers), the opponent card (pickers, names, timeline)
 * keeping every choice, the plan, the last simulation and the last search result; the search form is left as it is
 * (it holds no game name). Marked names elsewhere are already updated (language.ts relabel).
 */
function onLanguage(): void {
  if (!state.sv) return;
  const y = window.scrollY;
  const runs = document.querySelector<HTMLInputElement>("#runs")?.value;
  keepSearchForm = true; // no search panel rebuild (it would reset its form); the refresh renderTarget queues is skipped
  renderParty(false);
  onExpansions();
  queueMicrotask(() => (keepSearchForm = false));
  if (runs !== undefined) setRuns(runs);
  drawResult();
  search?.relabel();
  window.scrollTo(0, y);
}

/**
 * R3: the map run that Scribe hidden pushed back to a quest (syncOppKinds), kept apart from the current opponent and
 * from the remembered one, so the fallback itself stays as it is; null when there is none. In this page only.
 */
let scribeFallback: OppChoice | null = null;
/** A map run can still be set up as it was: maps offered, and its map among them. */
function mapRunValid(o: OppChoice): boolean {
  return mapsAvailable() && o.map !== undefined && mapOptions(state.sv).some(([, list]) => list.some(([v]) => v === o.map));
}

/**
 * The expansion switches changed: rebuild the opponent card (the pickers' lists change), keeping the chosen enemy or
 * map when it is still offered, and the search panel (its candidate options).
 */
function onExpansions(): void {
  if (!state.sv) return;
  // The choice on screen, else (first build, U36) the one remembered from an earlier visit.
  const built = Boolean(document.querySelector("#quest, #map"));
  let was = built ? currentOpponent() : storedOpponent();
  // R1 F02: nothing remembered: a quest that fits the save's heroes, not the first bush of the list.
  if (!built && !was.quest) was.quest = startQuest();
  if (!built && was.kind) {
    const r = document.querySelector<HTMLInputElement>(`input[name=opp][value=${was.kind}]`);
    if (r) r.checked = true;
  }
  // R3: Scribe shown again: the map run its hiding pushed back to a quest comes back, if that map is still offered.
  if (scribeFallback && !mapsHidden()) {
    const back = scribeFallback;
    scribeFallback = null;
    const r = document.querySelector<HTMLInputElement>("input[name=opp][value=map]");
    if (r && oppKind() === "quest" && mapRunValid(back)) {
      r.checked = true;
      was = { ...was, ...back, kind: "map" };
    }
  }
  const wasMap = oppKind() === "map";
  syncOppKinds();
  // R3: Scribe hidden pushed a map run back to a quest: remember that map run on its own (put back above once Scribe
  // shows again).
  if (wasMap && oppKind() !== "map" && mapsHidden()) {
    scribeFallback = { kind: "map", map: was.map, asc: was.asc, grade: was.grade, scrolls: was.scrolls };
  }
  saving = false;
  try {
    restoreOpponent(was);
  } finally {
    saving = true;
  }
  saveOpponent();
}

function restoreOpponent(was: OppChoice): void {
  renderTarget();
  const put = (sel: string, v: string | undefined) => {
    const s = document.querySelector<HTMLSelectElement>(sel);
    if (s && v !== undefined && [...s.options].some((o) => o.value === v)) {
      s.value = v;
      s.dispatchEvent(new Event("change"));
    }
  };
  // U62: the stored { quest, rare } (a wiki "Fight in simulator" link's too) is the picker's "<id>:rare" entry; an
  // enemy without a rare variant falls back to its normal one.
  const quest = document.querySelector<HTMLSelectElement>("#quest");
  if (was.quest !== undefined) put("#quest", [questValue(was.quest, Boolean(was.rare)), was.quest].find((v) => quest && [...quest.options].some((o) => o.value === v)));
  // The quest size (U36: kept too; the sizes offered follow the party, so a size it can't take falls back to ×1).
  put("#amount", was.amount);
  put("#map", was.map);
  put("#map-asc", was.asc);
  put("#map-grade", was.grade);
  const scrolls = was.scrolls ?? [];
  document.querySelectorAll<HTMLSelectElement>("select.scroll").forEach((s, k) => {
    if ([...s.options].some((o) => o.value === scrolls[k])) s.value = scrolls[k];
  });
}

