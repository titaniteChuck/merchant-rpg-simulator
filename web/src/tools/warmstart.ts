/**
 * Offline warm start: the best rotation and passive per class × tier × enemy, found ahead of time
 * (inventory/warmstart.json, from warmstart-build.ts) and tried first by the searches. A searched rotation for one
 * standard hero, alone, on equal gear: a good starting point for a real hero in a party, not its answer.
 * Pure, worker-safe: load the JSON once with loadWarmStart.
 */

export interface WarmEntry {
  rotation: string[];
  passive: string;
  /** The standard hero's result with it (searchSkills' final evaluation). */
  win: number;
  peak: number;
  turns: number;
}

export interface WarmStartData {
  version: number;
  /** How the table was made (hero, gear, search breadth). */
  params: Record<string, unknown>;
  /** By warmKey(class, tier, quest, rare). */
  entries: Record<string, WarmEntry>;
}

export const WARMSTART_VERSION = 1;

export const warmKey = (classId: number, tier: number, quest: number, rare = false) => `${classId}:${tier}:${quest}${rare ? "B" : ""}`;

let data: WarmStartData | undefined;

export function loadWarmStart(json: WarmStartData): void {
  data = json;
}

export const hasWarmStart = (): boolean => data !== undefined;

/** The entry for this class, tier and enemy; else the same class and enemy at the nearest tier (higher first). */
export function warmStart(classId: number, tier: number, quest: number, rare = false): WarmEntry | undefined {
  if (!data) return undefined;
  for (const t of [tier, tier + 1, tier - 1, tier + 2, tier - 2]) {
    const e = data.entries[warmKey(classId, t, quest, rare)];
    if (e) return e;
  }
  return undefined;
}
