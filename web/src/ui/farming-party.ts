/**
 * Farming planner (farming.ts) helpers without DOM, so Node tests can check them:
 * - farmQuestIds(): the quests the page offers (F04, F05): fightable, on the quest board, at most level 60.
 * - fightingSlots(): the heroes that fight one source (F01), by the Battle page's rules: the filled slots not ticked
 *   out on the Simulator, the required slot first, then the game's slot order, capped at the quest's size
 *   (includedSlots); or the reason the game wouldn't start it (problemOf).
 * - readStoredParty() / storedPartyWith(): the party shared with the Battle pages (`battle-party:<save>`), read and
 *   written whole, so the Simulator's locks and ticked-out heroes survive an edit here (F02).
 */
import { G } from "../sim/data.ts";
import type { FarmSource } from "../tools/farming.ts";
import { isBoardQuest } from "../tools/quest-stats.ts";
import type { StoredParty } from "./battle-links.ts";
import { type PageTarget, problemOf, rulesOf } from "./battle-rules.ts";
import { includedSlots, isFightable, type SlotRef } from "./battle-setup.ts";

/** Highest hero level (game 3.18: tier 3 caps at 60); quests above it can't be taken. */
export const MAX_HERO_LEVEL = 60;

export const FARM_SLOTS: readonly SlotRef[] = (["front", "back"] as const)
  .flatMap((row) => [0, 1, 2].map((i) => ({ key: `${row}${i}`, row, i })));

/** Quest ids the page offers, by level then id: no placeholder, no map boss or Treasure Bush, none over level 60. */
export function farmQuestIds(visible: (id: number) => boolean = () => true): number[] {
  return Object.keys(G.questData ?? {}).map(Number)
    .filter((id) => isFightable(id) && isBoardQuest(id) && (Number(G.questData[id].levelReq) || 0) <= MAX_HERO_LEVEL && visible(id))
    .sort((a, b) => (Number(G.questData[a].levelReq) || 0) - (Number(G.questData[b].levelReq) || 0) || a - b);
}

/**
 * The slot keys that fight `s`, or the reason the game wouldn't start it. `slots`: slot key -> hero index (null or
 * missing = empty); `excluded`: slot keys ticked out on the Simulator.
 */
export function fightingSlots(s: FarmSource, slots: Record<string, number | null | undefined>,
  excluded: Record<string, boolean> = {}): string[] | { problem: string } {
  const filled = FARM_SLOTS.filter((x) => slots[x.key] !== null && slots[x.key] !== undefined);
  const off = new Set(Object.keys(excluded).filter((k) => excluded[k]));
  // a map run: no required slot, up to 6 (the map itself doesn't matter to the rules)
  const t: PageTarget = s.kind === "quest" ? { quest: { id: s.quest, rare: s.rare } } : { map: { id: 0 } };
  const keys = includedSlots(filled, off, rulesOf(t)).included.map((x) => x.key);
  const row = (r: "front" | "back") => [0, 1, 2].map((i) => (keys.includes(`${r}${i}`) ? { hero: slots[`${r}${i}`] } : null));
  const problem = problemOf(t, row("front"), row("back"));
  return problem ? { problem } : keys;
}

/** The stored party (a fresh object), only the slots and rotations of heroes this save has; null when none is stored. */
export function readStoredParty(text: string | null, heroes: number): StoredParty | null {
  if (!text) return null;
  const p = JSON.parse(text);
  if (!p || typeof p !== "object") return null;
  const ok = (i: unknown) => i === null || (typeof i === "number" && i >= 0 && i < heroes);
  const flags = (x: unknown) => Object.fromEntries(Object.entries(x ?? {}).filter(([, v]) => v === true)) as Record<string, boolean>;
  return {
    slots: Object.fromEntries(Object.entries(p.slots ?? {}).filter(([, i]) => ok(i))) as StoredParty["slots"],
    skills: Object.fromEntries(Object.entries(p.skills ?? {}).filter(([i]) => ok(Number(i)))) as StoredParty["skills"],
    locked: flags(p.locked),
    excluded: flags(p.excluded),
  };
}

/** What to store after an edit here: the new slots and rotations, every other field of the stored party kept. */
export function storedPartyWith(prev: Record<string, unknown> | null, slots: StoredParty["slots"], skills: StoredParty["skills"]): StoredParty {
  return { locked: {}, excluded: {}, ...(prev ?? {}), slots: { ...slots }, skills: { ...skills } } as StoredParty;
}

/** questType of the event bosses (the game's "Epic Boss": Galam, Cragus, Odin, Faust), only fought during an event. */
export const EVENT_QUEST_TYPE = 6;
export const isEventQuest = (id: number): boolean => G.questData?.[id]?.questType === EVENT_QUEST_TYPE;

/** One fieldset of the quest list: a level band ("Lv 50–59") or the event bosses ("Event"). */
export interface QuestGroup {
  label: string;
  ids: number[];
}

/** The quest list's groups (F22): the quests by level band of 10, then the event bosses in their own "Event" group. */
export function questGroups(ids: number[]): QuestGroup[] {
  const bands = new Map<number, number[]>();
  const events: number[] = [];
  for (const id of ids) {
    if (isEventQuest(id)) {
      events.push(id);
      continue;
    }
    const b = Math.floor((Number(G.questData[id]?.levelReq) || 0) / 10) * 10;
    bands.set(b, [...(bands.get(b) ?? []), id]);
  }
  return [...[...bands].sort((a, b) => a[0] - b[0]).map(([b, list]) => ({ label: `Lv ${b}–${b + 9}`, ids: list })),
    ...(events.length ? [{ label: "Event", ids: events }] : [])];
}

/**
 * Ticked when the list is first drawn: quests from 12 levels under the party's best hero up to its level. Event
 * bosses start unticked (F22): they only come during an event.
 */
export function tickedByDefault(id: number, maxLevel: number): boolean {
  const lv = Number(G.questData[id]?.levelReq) || 0;
  return !isEventQuest(id) && lv <= maxLevel && lv >= maxLevel - 12;
}
