/**
 * The Battle section's two pages (U41), one code: initBattlePage("simulate") for the Simulator (site/battle.html,
 * entry battle.ts) and initBattlePage("solve") for the Solver (site/solver.html, entry solver.ts).
 *
 * Simulator (U48: no section titles, no Results section): the Simulate panel (the opponent's controls; U72: no Clear
 * all, no "?"s); U70: the four figures over the runs (#sim-stats, sticky); then the Party view: the HP chart over the party
 * (six slots, back row | front row; cards move by drag and drop, party-drag.ts) and the opponent card (a quest enemy
 * or a map run's room). U48: the Solver's Party view is read-only (battle-edit.ts pageControls); both pages have a "↑"
 * back-to-top button. U61: the Party view's HP chart (hp-chart.ts). U62: the hero and enemy cards are one builder
 * (fighter-card.ts): the picker as the head, the stats, the rotation (the enemy's from its timeline, read-only); a
 * skill or passive opens its picker in place, each choice with its effect (pick-list.ts). The enemy list holds each
 * rare variant as its own entry ("<id>:rare"), no "Rare variant" box. U65: the chart is the Party view's first row,
 * full width, over heroes | opponent; a click, a tap or the arrow keys on it pick a turn and every card shows that
 * turn's end (paintTurn: HP, the engine's live stats, the row played; turn 0 the start), from the same trace. The
 * opponent is chosen in the Simulate panel (quest or map run, size, map, grade, scrolls; the Solver's Solve panel as
 * before); its card shows one enemy, no picker (drawEnemyCard; a map run: the selected turn's room's).
 *
 * Solver (U42): the spoiler guard (battle-search.ts) first, then one full-width Solve panel: the quest / map toggle and
 * its pickers (the opponent card waits in #target-card, beside the party: drawEnemyCard), the options, the time budget,
 * Solve and its progress; the results under it only once a solve is done; the Party view stays hidden until a
 * result's "Show" fills it (revealParty). Its party is its own, in memory only: the Simulator's remembered
 * party changes only by "Open in Simulator" (battle-links.ts simulatorPartyFrom), which copies the shown party and
 * the opponent over and opens the Simulator. The Solver's opponent is remembered apart (`solver-opponent`).
 * Runs go to a web worker with the game's rules (TypeScript engine).
 *
 * U70: Flow 2, Flow 3 and their tabs are gone: the Party view is the only view. No Simulate button, runs count or result
 * tiles: every change that matters to the fight (party, rotations, passives, opponent, map, scrolls) runs WORST_RUNS
 * traced runs in the worker (debounced; a newer change drops the run on its way), and the chart and the cards show one
 * of them (tools/worst-run.ts; U74: the run picker's, Worst / Random / Best, Random the first run, on the Simulator;
 * the first run on the Solver; U70: the worst). On the Simulator, four sticky figures over the runs sit between the Simulate
 * panel and the party (#sim-stats: win rate, grade when won, heroes dead, life left).
 * U73: `‹ Turn X ›` and `‹ <actor> k/n ›` (the turn's actions in game order) in #hp-nav, sticky under the figures; at a
 * step the cards show the state right after that action (turnView), the actor's card marked.
 *
 * U72: the opponent's controls on three rows (the toggle, the enemy or map, its modifiers: quest size; a catalog map's
 * ascension, grade, prefix and suffix); no scroll pickers, no map facts; no row or opponent titles on screen.
 *
 * Expansions (U28): the enemy and map pickers leave out content of expansions the visitor hides
 * (expansion-state.ts); the save's own maps always stay. Options of expansion content end with ❄ / ✒. The opponent
 * card is rebuilt (keeping the choice when it is still there) whenever the expansion switches change.
 */
import * as api from "../sim/api.ts";
import { dataJson, dataWorker } from "./data-files.ts";
import { G } from "../sim/data.ts";
import { maxQuestAmount } from "../tools/combat.ts";
import type { MapSpec, Scroll } from "../tools/engine.ts";
import {
  DEFAULT_PICK, gradeLetter, parsePick, pickedTrace, type RunPick, type RunStats, runStats, WORST_RUNS, type WorstRuns,
} from "../tools/worst-run.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import type { BattleRequest, BattleResponse, SkillChoice } from "./battle-worker.ts";
import { $, el, expansionMark, fmt1, heroAsc, lv, lvStart, pct, rateTone, select, shortLabel, shortPick, toast } from "./dom.ts";
import { isHidden, isVisible, needsOf, subscribe } from "./expansion-state.ts";
import { type CardRow, type CardTurn, fighterCard, paintCard } from "./fighter-card.ts";
import { cardTurnOf, stepStates } from "./card-turn.ts";
import type { PickOption } from "./pick-list.ts";
import { initSearch, type PartyMember } from "./battle-search.ts";
import { linkedOpponent, SIMULATOR_PAGE, simulatorPartyFrom, type StoredParty, withoutOpponentQuery } from "./battle-links.ts";
import { migrateOldLocks } from "./solver-heroes.ts";
import { type PageTarget, problemOf, rulesOf, rulesText } from "./battle-rules.ts";
import { loadTimelineData, timelineOf } from "./timeline.ts";
import { locationLabel, locationOf, mapRoomTabs } from "./battle-plan.ts";
import { clampStep, drawHpChart, type FighterState, type FightTime, type HpChartData, hpData, type HpRun, keepStep, pickStep, roomIds, stepsOf, timeOf } from "./hp-chart.ts";
import { defaultQuest, defaultSlots, enemyGroups, enemyStats, enemyTurns, includedSlots, isFightable, parseQuestValue, questEntries, questValue, type SlotRef } from "./battle-setup.ts";
import { helpTip } from "./wiki-help.ts";
import { prefixEffect, suffixEffect, validPrefixes, validSuffixes } from "./wiki-config.ts";
import { initSaveSource } from "./save-source.ts";
import { type ApBudget, apRefusal, apUsed, assignHeroChecked, editRotationSkill, moveHero, moveRefusal, pageControls, budgetOptions } from "./battle-edit.ts";
import { enableSlotDrag } from "./party-drag.ts";
import { PARTY_COLUMNS, toTopVisible } from "./battle-layout.ts";
import { enemyLevelText, loadWikiText, passiveText, passiveTip, skillAp, skillDesc, skillTip } from "./wiki-data.ts";
import { languageReady, onLanguageChange } from "./language.ts";
import { className as classNameOf, enemyName, itemName, modItemName, passiveName, prefixTag, skillName, suffixName } from "./names.ts";

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
}
const state: State = { mode: MODES.simulate, sv: null, saveName: "", slots: {}, skills: {}, excluded: {} };

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
      // U34 / U36: "[Prefix] Map +N", each part translated (names.ts modItemName).
      return [`own:${i}`, `${modItemName("map", m.id, m)} · ${GRADES[(m.grade ?? 3) - 1] ?? m.grade}`];
    })]);
  }
  if (catalog.length) groups.push(["All maps", catalog]);
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
    + "play the default rotation instead." : null;
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
      // U69: a passive the onPick below would refuse (the rotation over the limit it gives) is greyed out.
      options: () => (info!.passives as string[]).map((x): PickOption => {
        const b = x === passive ? null : apBudgetOf(idx!, x), u = b ? apUsed(rot, b) : 0;
        const off = b !== null && u > b.max && b.max < apBudgetOf(idx!, passive).max;
        return { value: x, label: x === "None" ? "No passive" : passiveName(x), note: x === "None" ? "" : passiveText(x),
          ...(off ? { disabled: true, why: `${u} / ${b!.max} AP` } : {}) };
      }),
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
      // U69: the skills the AP budget can't take in this slot (this slot's skill replaced) are greyed out.
      options: () => budgetOptions(rotationChoices(raw, sk).map(skillOption), rot, k, apBudgetOf(idx!)),
      onPick: (v) => {
        // U39: battle-edit.ts's edit; U40: refused over the AP limit.
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
      // U39: battle-edit.ts's edit: one slot per hero, the new hero fights. U40: not a hero
      // whose rotation is over its AP limit.
      const pick = s.value === "" ? null : Number(s.value);
      const r = assignHeroChecked(state, key, pick, pick === null ? null : apOver(pick));
      if (!r.ok) return refuseAp(pick!, r);
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
  // U69: back row | front row at every width (battle-layout.ts PARTY_COLUMNS): a phone keeps the formation, two cards a row.
  const cols = PARTY_COLUMNS.map((row) => {
    const empty = picks ? [0, 1, 2].filter((i) => isEmptySlot(row, i) && !rules.required.some((x) => x.row === row && x.i === i)) : [];
    const shown = [0, 1, 2].filter((i) => !empty.includes(i)).map((i) => slot(row, i));
    // U72: no "Front row" / "Back row" titles on screen; the column keeps its name for screen readers.
    return el("div", { class: "party-row", role: "group", "aria-label": row === "front" ? "Front row" : "Back row" },
      el("div", { class: "slots" }, ...shown, ...(empty.length
        // U48: read-only (the Solver), the folded empty slots are a plain count: no hero is added by hand.
        ? [ctl.edit ? foldEmpty(row, empty.map((i) => slot(row, i))) : el("p", { class: "small muted empty-slots" }, emptyCount(row, empty.length))] : [])));
  });
  // U72: no Clear all (U32-U66). R2 F23 / F36: on the Solver, the party's rule and what this party is, in the party's
  // "?" (#party-help, in its head; the Simulator has none since U72).
  document.querySelector("#party-help")?.replaceChildren(...partyHelp(rules, picks, ctl.drag));
  // U36: heroes left out over the size cap. U48: said on the opponent's side, under its picker, without their names
  // (their cards say "over the limit").
  const cap = document.querySelector<HTMLElement>("#party-cap");
  if (cap) {
    cap.hidden = !fight.capped.length;
    cap.replaceChildren(...(fight.capped.length ? [`ℹ️ At most ${rules.maxSize} heroes`] : []));
  }
  $("#party").replaceChildren(
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
 * R2 F23 / F36: the party's "?" (the Solver only since U72, in the party's head): the opponent's party rule, on the Solver what the shown party is (U48:
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
  persistParty();
  renderParty();
}

// ---------------------------------------------------------------- target
let search: ReturnType<typeof initSearch> | null = null;
const oppKind = (): Opp => ($<HTMLInputElement>("input[name=opp]:checked")?.value ?? "quest") as Opp;

/**
 * U36: the chosen opponent (quest or map, size, rare, map grade, ascension; U72: prefix and suffix, no scrolls), remembered in this browser across
 * pages (localStorage `battle-opponent`, convenience only) and put back when the page is built again. U41: the Solver
 * remembers its own (`solver-opponent`), starting from the Simulator's.
 */
const OPP_KEY = "battle-opponent";
const SOLVER_OPP_KEY = "solver-opponent";
const oppKey = () => (solving() ? SOLVER_OPP_KEY : OPP_KEY);
interface OppChoice { kind?: Opp; quest?: string; rare?: boolean; amount?: string; map?: string; asc?: string; grade?: string; prefix?: string; suffix?: string }
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
  const kind = oppKind();
  // The other kind's choice stays as it was remembered.
  const was = storedOpponent();
  // U62: stored as before, the quest id and `rare` apart (the picker's value is "<id>" or "<id>:rare").
  const q = questPick();
  return kind === "quest"
    ? { ...was, kind, quest: q ? String(q.id) : undefined, rare: q?.rare ?? false, amount: v("#amount") }
    : { ...was, kind, map: v("#map"), asc: v("#map-asc"), grade: v("#map-grade"), prefix: v("#map-prefix"), suffix: v("#map-suffix") };
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
  // U72: the link's map is the plain catalog map (a link names no prefix or suffix): not an earlier visit's.
  if (linked.kind === "map") {
    delete o.prefix;
    delete o.suffix;
  }
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
  // U72: three rows in the panel: the Quest enemy / Map run toggle (the page's HTML), the enemy or map list, then its
  // modifiers on one row (a quest: its size; a catalog map: ascension, grade, prefix, suffix; a map of the save: none,
  // it carries its own). No "?" and no map facts (U65's line), no scrolls (the Solver's shown result keeps its own).
  const mods = el("div", { class: "toolbar opp-mods", role: "group", "aria-label": "Modifiers" });
  if (oppKind() === "quest") {
    // U62: one list with each rare variant as its own entry ("<id>:rare"). U65: in the Simulate (Solve) panel, #target;
    // the card (#target-card) shows the enemy, no picker (drawEnemyCard).
    const q = select({ id: "quest", "aria-label": "Enemy" }, questOptions());
    const amount = select({ id: "amount", "aria-label": "Quest size" }, [["1", "×1"]]);
    mods.append(amount);
    const update = () => {
      syncAmount(amount, parseQuestValue(q.value).rare);
      saveOpponent();
    };
    // Another enemy may have other party rules (required slot, size cap): the slots are drawn again (and the fight
    // traced again, which draws the enemy's card).
    q.addEventListener("change", () => (update(), renderParty()));
    // The card's HP follows the quest size.
    amount.addEventListener("change", () => (update(), renderPlan()));
    box.replaceChildren(el("div", { class: "opp-controls" }, q, mods, capNote()));
    update();
  } else {
    const m = select({ id: "map", "aria-label": "Map" }, mapOptions(state.sv));
    const asc = select({ id: "map-asc", "aria-label": "Map ascension" }, [["0", "asc 0"], ["1", "asc 1"]]);
    const grade = select({ id: "map-grade", "aria-label": "Map grade" }, GRADES.map((g, i): [string, string] => [String(i + 1), g]));
    grade.value = "3";
    // U72: a catalog map's prefix and suffix, the wiki's lists and effects (wiki-config.ts, as its map pages); the run
    // gets them in its MapSpec (targetOf), so the engine applies them (sim/map.ts applyPrefix / applySuffix).
    const pre = select({ id: "map-prefix", "aria-label": "Map prefix" }, [["0", "No prefix"]]);
    const suf = select({ id: "map-suffix", "aria-label": "Map suffix" }, [["0", "No suffix"]]);
    // U76: short faces on a phone's row: the prefix's name, the suffix's "+1" (the open list keeps the effects)
    mods.append(asc, grade, shortPick(pre), shortPick(suf));
    const listed = { pre: "", suf: "" };
    const sync = () => {
      const own = m.value.startsWith("own:");
      mods.hidden = own;
      if (!own) {
        const id = Number(m.value.slice(4)), a = Number(asc.value);
        if (listed.pre !== `${id}`) {
          listed.pre = `${id}`;
          fillMods(pre, mapPrefixOptions(id));
        }
        if (listed.suf !== `${id}:${a}`) {
          listed.suf = `${id}:${a}`;
          fillMods(suf, mapSuffixOptions(id, a));
        }
      }
      saveOpponent();
    };
    // U39: the chart follows the map, its ascension, grade, prefix and suffix (U70: the runs start again). U72: another
    // map drops the Solver's shown scrolls.
    m.addEventListener("change", () => ((shownScrolls = []), sync(), renderPlan()));
    for (const x of [asc, grade, pre, suf]) x.addEventListener("change", () => (sync(), renderPlan()));
    box.replaceChildren(el("div", { class: "opp-controls" }, m, mods, capNote()));
    sync();
  }
  // The party rules follow the opponent (renderParty also draws the plan); the search panel is refreshed above.
  renderParty(false);
}

/**
 * U62: the enemy card's rotation, read-only: its skill on turns 1-5 (turn 6 is turn 1 again) from its timeline (the
 * data the wiki's timeline strip uses), else its game rotation; the effect on hover.
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
  // U70: a quest enemy changed since the runs shown (the new ones are on their way): its own stats, not the old fight's.
  const run = at ? chart?.runs[at.run] : undefined;
  const now = run?.quest && (run.quest.id !== foe.id || run.quest.rare !== foe.rare) ? undefined : turnView()?.states[0];
  const name = `${enemyName(String(foe.id), foe.rare) ?? d?.name ?? foe.id}${foe.rare ? " (rare)" : ""}`;
  host.replaceChildren(fighterCard({
    kind: "enemy", classes: foe.rare ? "rare" : "",
    head: el("span", { class: "fc-name" }, `${lvStart(enemyLevelText(foe.id))} · ${name}`, ...(foe.n > 1 ? [el("span", { class: "muted" }, ` ×${foe.n}`)] : [])),
    lines: [...(foe.room ? [el("p", { class: "fc-line small muted" }, foe.room.startsWith("Boss") ? "Boss room" : `Room ${foe.room.split(" ·")[0]}`)] : []),
      ...(d?.questType === 6 ? [el("p", { class: "fc-line small muted" }, "Attacks first")] : [])],
    stats: now?.stats ? { ...now.stats, maxHP: now.maxHP } : enemyStats(foe.id, foe.rare, foe.n),
    ...(now && at ? { turn: turnOfCard(at, 0, now) } : {}),
    rotation: enemyRotation(foe.id, foe.rare),
  }));
}

/** U72: a catalog map's prefixes as the wiki lists them: "No prefix", then "[Titan] · essence ×1.3, enemy HP +240". */
function mapPrefixOptions(id: number): ModOption[] {
  return [["0", "No prefix"], ...validPrefixes("map", id).map((p): ModOption => [String(p), `[${prefixTag(p)}] · ${prefixEffect("map", id, p)}`, prefixTag(p)])];
}
/** U72: a catalog map's suffixes at an ascension, as the wiki lists them: "No suffix", then "+3 · essence and Enemy × ×1.3". */
function mapSuffixOptions(id: number, asc: number): ModOption[] {
  return [["0", "No suffix"], ...validSuffixes("map", id, asc).map((x): ModOption => [String(x), `${suffixName(x)} · ${suffixEffect("map", x)}`, suffixName(x)])];
}
/** U76: a modifier option: value, full text (the open list), short text (the closed face, shortPick; none: the full). */
type ModOption = [string, string, string?];
/** U72: a modifier picker's options, the choice kept when still offered (else none); hidden with nothing to pick. */
function fillMods(s: HTMLSelectElement, opts: ModOption[]): void {
  const was = s.value;
  s.replaceChildren(...opts.map(([v, label, short]) => el("option", { value: v, ...(short ? { "data-short": short } : {}) }, label)));
  s.value = opts.some(([v]) => v === was) ? was : "0";
  s.hidden = opts.length < 2;
  shortLabel(s);
}

/**
 * The quest sizes the game offers (questService.getCurrentAndMaxAmount): ×1 up to maxQuestAmount, from the highest
 * hero prestige of the party; a rare quest is always ×1. The modes that pick the party allow up to the strongest hero
 * of the save (searchParty / optimiseFight skip parties that can't take the size). Keeps the current choice when allowed.
 */
function syncAmount(amount = document.querySelector<HTMLSelectElement>("#amount"), rare = questPick()?.rare ?? false): void {
  // U62: the opponent card passes its own controls (it calls this before the card is in the page).
  if (!amount || !state.sv) return;
  // Modes that choose the party: up to the strongest hero of the save (the search skips parties that can't take it).
  const max = maxQuestAmount(state.mode.party ? partyOf().members.map((m) => m.raw) : state.sv.raw.hero, rare, state.sv.raw.gameMode || "Standard");
  const was = Number(amount.value) || 1;
  amount.replaceChildren(...Array.from({ length: max }, (_, k) => el("option", { value: String(k + 1) }, `×${k + 1}`)));
  amount.value = String(Math.min(was, max));
  amount.disabled = max === 1;
  // U72: no "?" beside the size (R1 F20's note gone).
}

// ---------------------------------------------------------------- U70: the runs behind the chart and the figures
/** How long the page waits after a change before it runs (a burst of changes runs once). */
export const AUTO_DELAY_MS = 200;

/** A fighter of the shown runs: where it stands, the save's hero, its name and class (the chart's legend). */
interface ChartMember { row: "front" | "back"; i: number; idx: number; name: string; cls: number }

/** The runs a change asks for: the worker's request, its key (same key: same fight) and the party it is about. */
interface AutoRun { req: BattleRequest; key: string; members: ChartMember[] }

/**
 * U70: the runs this page state asks for, or null when the party can't fight (no opponent built yet, no hero, a party
 * rule, a hero over its AP limit). The key is the request itself: the heroes (gear, level), their rotations and
 * passives, who fights, the opponent, the map and its scrolls; not the selected turn, the chart's tab or its zoom.
 */
function autoRun(): AutoRun | null {
  if (!state.sv || !document.querySelector(oppKind() === "quest" ? "#quest" : "#map")) return null;
  const { front, back, skills, members } = partyOf();
  if (!members.length || partyProblem() || apProblem()) return null;
  const req: BattleRequest = { gameMode: state.sv.raw.gameMode || "Standard", front, back, skills, n: WORST_RUNS, worst: true, ...targetOf() };
  return { req, key: JSON.stringify(req),
    members: members.map((m) => ({ row: m.row, i: m.i, idx: m.idx, name: String(m.raw.name), cls: Number(m.raw.class) })) };
}

/** The runs shown now (chart, cards, figures): their key, the request's opponent and party, the worker's answer. */
let shown: { key: string; req: BattleRequest; members: ChartMember[]; runs: WorstRuns } | null = null;
/** The key of the last change's runs (asked for, waiting or running). */
let wanted: string | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let simWorker: Worker | null = null;
/** The id of the request the worker is on (null: idle); an answer with another id is stale. */
let running: number | null = null;
let runSeq = 0;
/** U70: the last runs' error (a map the game's code can't run), shown under the figures, and their key. */
let runError: string | null = null;
let errorKey: string | null = null;

/** Stop what is waiting or running (a terminated worker is made again on the next run). */
function cancelRuns(): void {
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = null;
  if (running !== null) {
    simWorker?.terminate();
    simWorker = null;
    running = null;
  }
  wanted = null;
}

/**
 * U70 (was the Flow tab and ▶ Simulate): the state changed. Unchanged fight (same key: a language or expansion redraw):
 * the shown runs are drawn again. Another fight: after AUTO_DELAY_MS without a newer change, WORST_RUNS runs in the
 * worker; the chart and the cards keep the last runs, the figures marked busy, until the answer.
 */
function renderPlan(): void {
  if (!state.sv) return;
  const next = autoRun();
  if (!next) {
    cancelRuns();
    shown = null;
    runError = null;
    const built = Boolean(document.querySelector(oppKind() === "quest" ? "#quest" : "#map"));
    showHp(null, chartMembers(), !built);
    drawStats();
    return;
  }
  if (shown?.key === next.key) {
    cancelRuns();
    drawShown();
    return;
  }
  // the same fight failed already: its error again, not another run
  if (runError !== null && errorKey === next.key) {
    cancelRuns();
    showHp(null, next.members);
    drawStats();
    return;
  }
  // Until the answer the cards (just redrawn by renderParty) keep the shown runs' turn where their hero is the same
  // (paintTurn); with nothing shown yet, the chart's empty line.
  if (wanted === next.key) return paintTurn(); // already on its way
  wanted = next.key;
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    startRuns(next);
  }, AUTO_DELAY_MS);
  if (shown) paintTurn();
  else showHp(null, next.members);
  drawStats();
}

/** The party as the chart names it, from the page now (no runs to show). */
function chartMembers(): ChartMember[] {
  return state.sv ? partyOf().members.map((m) => ({ row: m.row, i: m.i, idx: m.idx, name: String(m.raw.name), cls: Number(m.raw.class) })) : [];
}

/** Send the runs to the worker; a run still going is dropped (its worker terminated). */
function startRuns(next: AutoRun): void {
  if (running !== null) {
    simWorker?.terminate();
    simWorker = null;
  }
  simWorker ??= dataWorker("battle-worker.js", ["gamedata.json"]);
  const worker = simWorker, id = ++runSeq;
  running = id;
  drawStats();
  worker.onmessage = (e: MessageEvent<BattleResponse>) => {
    const r = e.data;
    if (r.ok ? r.kind !== "worst" || r.id !== id : r.id !== id) return;
    running = null;
    if (wanted === next.key) wanted = null;
    if (!r.ok) {
      shown = null;
      runError = r.error;
      errorKey = next.key;
      showHp(null, next.members);
    } else if (r.kind === "worst") {
      shown = { key: next.key, req: next.req, members: next.members, runs: r.runs };
      runError = null;
      drawShown(undefined, true);
    }
    drawStats();
  };
  worker.onerror = (e) => {
    if (running !== id) return;
    worker.terminate();
    if (simWorker === worker) simWorker = null;
    running = null;
    if (wanted === next.key) wanted = null;
    shown = null;
    runError = `Simulation failed: ${e.message}`;
    errorKey = null; // the worker itself failed: the next change tries again
    showHp(null, next.members);
    drawStats();
  };
  worker.postMessage({ ...next.req, id });
}

/** U74: the run picker's remembered choice (localStorage, this browser only). */
const PICK_KEY = "battle-run-pick";
let runPick: RunPick = (() => {
  try {
    return parsePick(localStorage.getItem(PICK_KEY));
  } catch {
    return DEFAULT_PICK;
  }
})();

/** U74: the run the chart and cards show: the picker's on the Simulator, the first run (Random) on the Solver. */
const pickNow = (): RunPick => (state.mode.key === "simulate" ? runPick : DEFAULT_PICK);

/** U74: the picker changed: another of the shown runs, drawn again (nothing runs again), and the choice remembered. */
function setPick(p: RunPick): void {
  runPick = p;
  try {
    localStorage.setItem(PICK_KEY, p);
  } catch { /* storage blocked: the choice lasts this page view */ }
  // U76: the turn, the actor's step, the zoom and the scroll stay (a turn past the new run's end: its last one)
  const who = chart && stepAt !== null ? stepsOf(chart, turnAt)[stepAt]?.who ?? null : null;
  drawShown({ who });
}

/**
 * The shown runs' picked one (U74; U70: the worst) in the chart (and so the cards), names in the language of the moment.
 * U77: `fresh`, a new answer of the worker: the chart starts at its end; a map room carries its index (the fight's
 * identity across runs).
 */
function drawShown(keep?: { who: number | null }, fresh = false): void {
  if (!shown) return;
  const { req, runs, members } = shown;
  const run = pickedTrace(runs, pickNow());
  if (req.quest && run?.quest) {
    const t = req.quest;
    showHp([{ trace: run.quest, enemy: enemyName(String(t.id), t.rare) ?? "Enemy", quest: { id: t.id, rare: t.rare } }], members, false, keep, fresh);
  } else if (run?.map) {
    const rooms = run.map;
    const tabs = mapRoomTabs(rooms, (id, rare) => enemyName(String(id), rare));
    // U79: a room's identity across runs is its enemy and which of them it is (each run has its own map), not its index
    const ids = roomIds(rooms);
    // U61: every fought room of the run, in map order.
    showHp(rooms.flatMap((r, k): HpRun[] => (r.trace ? [{ trace: r.trace, enemy: enemyName(String(r.questId), r.isRare) ?? r.name, room: tabs[k].label,
      quest: { id: r.questId, rare: r.isRare }, ...ids[k] }] : [])), members, false, keep, fresh);
  } else showHp(null, members);
  drawStats();
}

/** U70: the figures' card: the label (a short one on a phone), the value, a tone and, for a rate, its bar. */
function statTile(long: string, short: string, value: string, o: { tone?: string; bar?: number; title?: string } = {}): HTMLElement {
  return el("div", { class: `tile ${o.tone ?? ""}`.trim(), ...(o.title ? { title: o.title } : {}) },
    el("span", { class: "tile-label" }, el("span", { class: "st-long" }, long), el("span", { class: "st-short", "aria-hidden": "true" }, short)),
    el("span", { class: "tile-value" }, value),
    ...(o.bar !== undefined ? [el("div", { class: "bar", "aria-hidden": "true" }, el("span", { style: `width: ${Math.round(Math.max(0, Math.min(1, o.bar)) * 100)}%` }))] : []));
}

/**
 * U70: the four figures over the shown runs (runStats), on the Simulator only (#sim-stats): win rate, grade when won,
 * heroes dead, life left; "–" without runs. Busy while newer runs wait or run (the old figures stay, dimmed).
 */
function drawStats(): void {
  const box = document.querySelector<HTMLElement>("#sim-stats");
  if (!box) return;
  const st: RunStats | null = shown ? runStats(shown.runs.outcomes) : null;
  const busy = running !== null || autoTimer !== null;
  box.classList.toggle("busy", busy);
  box.setAttribute("aria-busy", String(busy));
  const runs = st ? `${st.n} ${shown!.req.quest ? "fights" : "map runs"}` : "";
  box.replaceChildren(
    el("div", { class: "sim-stats-row" },
      statTile("Win rate", "Win", st ? pct(st.win) : "–", { tone: st ? rateTone(st.win) : "", bar: st?.win ?? 0, title: runs }),
      statTile("Grade when won", "Grade", st?.grade != null ? gradeLetter(st.grade) : "–",
        { tone: "t-gold", title: st?.grade != null ? `Average ${fmt1.format(st.grade)} (D = 1 … S = 5)` : runs }),
      statTile("Avg heroes dead", "Dead", st ? fmt1.format(st.dead) : "–", { tone: st && st.dead > 0 ? "bad" : "", title: runs }),
      statTile("Life left", "Life", st?.life != null ? pct(st.life) : "–",
        { tone: st?.life != null ? rateTone(st.life * 1.6) : "", bar: st?.life ?? 0, title: runs })),
    ...(runError ? [el("p", { class: "error small sim-stats-error", role: "alert" }, runError)] : []));
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
 * U73: the turn and step controls' host (#hp-nav), made once in the Party view's grid right after the chart's column:
 * sticky under the Simulator's figures (style.css U73; their height kept in --sim-stats-h on #setup), over the cards.
 */
function navHost(): HTMLElement | null {
  const col = document.querySelector<HTMLElement>("#hp-col");
  if (!col) return null;
  let nav = document.querySelector<HTMLElement>("#hp-nav");
  if (!nav) {
    nav = el("div", { id: "hp-nav", class: "hp-nav-host", hidden: "" });
    col.after(nav);
    const stats = document.querySelector<HTMLElement>("#sim-stats"), setup = document.querySelector<HTMLElement>("#setup");
    if (stats && setup) {
      const put = () => setup.style.setProperty("--sim-stats-h", `${stats.offsetHeight}px`);
      put();
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(put).observe(stats);
    }
  }
  return nav;
}

/**
 * U61: draw the HP chart from traced fight(s): one quest fight, or a map run's fought rooms (U74: the picked one of the
 * shown runs). Only the chart's box is replaced. `runs` null: the empty line; `hide`: none.
 */
function showHp(runs: HpRun[] | null, members: ChartMember[], hide = false, keep?: { who: number | null }, fresh = false): void {
  const box = hpBox();
  const fighters = members.map((m) => ({ who: locationOf(m.row, m.i), name: m.name, cls: m.cls }));
  chart = runs ? hpData(runs, fighters) : null;
  // U67: the heroes' names, for the cards' modifiers and outcomes (the fought runs' traces are the chart's own, chart.runs).
  chartNames = new Map(fighters.map((f) => [f.who, f.name]));
  // U70: which save hero each place held in these runs (a card whose hero changed since shows its own stats).
  chartHeroes = new Map(members.map((m) => [locationOf(m.row, m.i), m.idx]));
  // U65: the turn the cards show: the one picked before when this fight still has it, else turn 0. U76: a run switch
  // (`keep`) clamps it instead (clampStep: past the new run's end, its last turn) and keeps the actor's step. U77: the
  // turn kept is a fight's identity (the map room) and its turn (timeOf); a run switch keeps the turn's place on
  // screen (`follow`), a new answer (`fresh`) starts the chart at its end.
  const want = turnPick;
  turnAt = chart ? (keep ? clampStep(chart, want) : pickStep(chart, want)) : 0;
  if (chart) turnPick = timeOf(chart, turnAt);
  const clamped = Boolean(chart) && (turnPick.run !== want.run || turnPick.turn !== want.turn);
  // U73: a new trace shows the turn's end; U76: a run switch keeps the same actor's step when the turn is kept
  stepAt = chart && keep && !clamped ? keepStep(chart, turnAt, keep.who) : null;
  if (box) drawHpChart(box, chart, { hide, selected: turnAt, onSelect: selectTurn, step: stepAt, onStep: selectStep, nav: navHost(),
    pick: state.mode.key === "simulate" ? { value: runPick, onPick: setPick } : null, follow: Boolean(keep), toEnd: fresh }, !keep);
  paintTurn();
}

/**
 * U65: the chart's data from the last trace, the step its marker is on (`turnAt`), and the turn picked (a room and a
 * turn; it outlives a new trace, so an edit keeps the turn when the new fight still has it).
 */
let chart: HpChartData | null = null;
let chartNames = new Map<number, string>();
let chartHeroes = new Map<number, number>();
let turnAt = 0;
let turnPick: FightTime = { run: 0, turn: 0 };
/** U73: the step within the selected turn (its index in stepsOf), null: the turn's end (its last step). */
let stepAt: number | null = null;

/** U65: a click, a tap or a key on the chart picked another turn: the cards show it (nothing is traced again). */
function selectTurn(i: number): void {
  if (!chart?.steps[i]) return;
  turnAt = i;
  turnPick = timeOf(chart, i);
  stepAt = null; // U73: a turn picked lands on its end, its last step
  paintTurn();
}

/** U73: a step arrow picked step `k` of the selected turn: the cards show the state right after that action. */
function selectStep(k: number): void {
  stepAt = k;
  paintTurn();
}

/**
 * U73: what the cards show at the chart's step: the turn's end (the chart's states, `upTo` none) or, at a step before
 * the last, every fighter right after that action (stepStates; `upTo` its last action counted); `actor` the step's
 * fighter. Undefined without a chart.
 */
function turnView(): { at: HpChartData["steps"][number]; states: Record<number, FighterState>; upTo?: number; actor: number | null } | undefined {
  const at = chart?.steps[turnAt];
  if (!chart || !at) return undefined;
  const steps = stepsOf(chart, turnAt);
  if (!steps.length) return { at, states: at.states, actor: null };
  const k = stepAt === null || stepAt >= steps.length ? steps.length - 1 : stepAt;
  if (k === steps.length - 1) return { at, states: at.states, actor: steps[k].who };
  const trace = chart.runs[at.run].trace;
  return { at, states: stepStates(trace, at.turn, steps[k].upTo, at.states), upTo: steps[k].upTo, actor: steps[k].who };
}

/**
 * U65: every card at the selected turn's end (turn 0: the start), from the chart's data: a hero card's HP, live
 * stats, effects and played row (paintCard, in place: its pickers and focus stay), and the enemy's card. A hero that
 * doesn't fight (left out, no fight to show, U70: not the hero of the shown runs) gets its own stats back, nothing else.
 */
function paintTurn(): void {
  const view = turnView();
  const at = view?.at;
  const inc = fighting().included;
  document.querySelectorAll<HTMLElement>("#party [data-slot]").forEach((card) => {
    const key = card.dataset.slot ?? "";
    const idx = state.slots[key] ?? null;
    const raw = heroRaw(idx);
    if (!raw) return;
    const w = locationOf(key.startsWith("front") ? "front" : "back", Number(key.slice(-1)));
    const now = view?.states[w];
    const inFight = at && now && inc.has(key) && chartHeroes.get(w) === idx;
    paintCard(card, inFight
      ? { stats: now.stats ? { ...now.stats, maxHP: now.maxHP } : heroCardStats(idx, raw), ...turnOfCard(at, w, now) }
      : { stats: heroCardStats(idx, raw) });
  });
  drawEnemyCard();
}

/**
 * U67: a card's state at the chart's step beyond the chart's own (cardTurnOf, card-turn.ts): HP now, each stat's
 * modifier parts, the row played and what came of it. U69: HP's change during the turn; no effects list.
 */
function turnOfCard(at: HpChartData["steps"][number], who: number, now: FighterState): Omit<CardTurn, "stats"> {
  const nameOf = (w: number) => (w ? chartNames.get(w) ?? locationLabel(w) : chart?.runs[at.run]?.enemy ?? "Enemy");
  // U73: at a step within the turn, the state right after its action; the acting fighter's card marked
  const view = turnView();
  return { hp: now.hp, active: now.active, acting: view?.actor === who,
    ...cardTurnOf(chart?.runs[at.run]?.trace, at.turn, who, nameOf, view?.upTo) };
}

// ---------------------------------------------------------------- the page's own parts (U41)
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
 * U41, the Solver's step 3: the Party view shows only once a result's Show has filled the party; before, no party
 * panel at all. It stays shown for later solves until the save is forgotten.
 */
function revealParty(): void {
  const box = document.querySelector<HTMLElement>("#party-box");
  if (!box) return;
  box.hidden = false;
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

/** U72: a catalog map's prefix or suffix picker as the engine takes it: its id, or undefined for none. */
const modOf = (sel: string): number | undefined => Number(document.querySelector<HTMLSelectElement>(sel)?.value) || undefined;
/**
 * U72: the scrolls of the Solver's shown result (SearchContext.applyScrolls), its map runs' scrolls since the pickers
 * went; another map drops them. Always none on the Simulator.
 */
let shownScrolls: number[] = [];

/** The opponent chosen in step 3. */
function targetOf(): { quest?: { id: number; rare: boolean; amount: number }; map?: { spec: MapSpec; scrolls: Scroll[] } } {
  const sv = state.sv!;
  if (oppKind() === "quest") {
    return { quest: { ...questPick()!, amount: Number($<HTMLSelectElement>("#amount").value) } };
  }
  const v = $<HTMLSelectElement>("#map").value;
  const spec: MapSpec = v.startsWith("own:") ? sv.raw.mapInventory.filter((c: unknown) => typeof c === "string")[Number(v.slice(4))]
    : { id: Number(v.slice(4)), prestigeLevel: Number($<HTMLSelectElement>("#map-asc").value), grade: Number($<HTMLSelectElement>("#map-grade").value),
      prefix: modOf("#map-prefix"), suffix: modOf("#map-suffix") };
  // U72: no scroll pickers: the Simulator's runs use none; the Solver's, the scrolls of the result it shows.
  const scrolls = shownScrolls.map((id) => ({ id, prestigeLevel: 0 }));
  return { map: { spec, scrolls } };
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
  // U70: a new save: nothing shown or running from the last one.
  cancelRuns();
  shown = null;
  runError = null;
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
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#loaded"), load: loadSave,
    onForget: () => {
      state.sv = null;
      cancelRuns();
      shown = null;
      runError = null;
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
    // U48: hero cards move by drag and drop (party-drag.ts); #party stays, its cards are redrawn inside it.
    enableSlotDrag($("#party"), dropHero);
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
      persistParty();
      renderParty(false);
    },
    saveName: () => state.saveName,
    poolSkills: () => Object.fromEntries(Object.entries(state.skills).map(([i, s]) => [state.sv!.raw.hero[Number(i)].id, s])),
    // U72: no scroll pickers: the shown result's scrolls are kept for its runs (targetOf), and the chart runs again.
    applyScrolls: (ids) => {
      shownScrolls = [...ids];
      renderPlan();
    },
    // U42: no onStart (the progress is in the Solve panel; the results appear only once a solve is done).
    // U41: a result's Show (after its party is applied) brings the Party view.
    onShow: revealParty,
    rules: () => rulesOf(pageTarget()),
    problem: (front, back) => problemOf(pageTarget(), front, back),
    goSimulate: () => {
      location.href = SIMULATOR_PAGE;
    },
    // U39: the spoiler guard hides the whole rest of the page (the opponent and options, results, party) until accepted.
    guarded: (on) => $("#setup").classList.toggle("solve-guarded", on),
  }, $("#search-panel"), $("#search-form"), $("#search-results"));
}

/**
 * U29: another language. Redraw the party (skill and passive pickers), the opponent card (pickers, names, timeline)
 * keeping every choice, the chart (U70: the shown runs, not run again) and the last search result; the search form is left as it is
 * (it holds no game name). Marked names elsewhere are already updated (language.ts relabel).
 */
function onLanguage(): void {
  if (!state.sv) return;
  const y = window.scrollY;
  keepSearchForm = true; // no search panel rebuild (it would reset its form); the refresh renderTarget queues is skipped
  renderParty(false);
  onExpansions();
  queueMicrotask(() => (keepSearchForm = false));
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
    scribeFallback = { kind: "map", map: was.map, asc: was.asc, grade: was.grade, prefix: was.prefix, suffix: was.suffix };
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
  // U72: after the ascension (the suffixes it allows).
  put("#map-prefix", was.prefix);
  put("#map-suffix", was.suffix);
}

