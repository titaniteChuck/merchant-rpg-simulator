/**
 * The wiki list pages' filter text and sorted column, kept per route in sessionStorage (QA R2 F4): typing in the
 * filter keeps the sort, and Back to a list restores both. Storage that throws (private mode, blocked site data)
 * only means nothing is restored.
 */
import type { TableSort } from "./dom.ts";

export interface ListState { q: string; sort?: TableSort }

const listKey = (route: string) => `merchant.wiki.list:${route}`;

export function loadListState(route: string): ListState {
  try {
    const raw = sessionStorage.getItem(listKey(route));
    const v = raw ? JSON.parse(raw) as Partial<ListState> : {};
    const sort = v.sort && typeof v.sort.key === "string" && typeof v.sort.asc === "boolean" ? { key: v.sort.key, asc: v.sort.asc } : undefined;
    return { q: typeof v.q === "string" ? v.q : "", ...(sort ? { sort } : {}) };
  } catch {
    return { q: "" };
  }
}

export function saveListState(route: string, st: ListState): void {
  try {
    sessionStorage.setItem(listKey(route), JSON.stringify(st));
  } catch { /* private mode or storage off: the list still works, it just isn't restored */ }
}
