/**
 * The Merchant game data in the shape the former tools/gamedata.py gave it (port of its Game class),
 * built from inventory/gamedata.json (loaded with loadGameData, web/src/sim/data.ts).
 *
 *   const g = gameFromData()          // after loadGameData(json)
 *   g.items.equipment.get(1)          // entries keep the original Lua field names
 *   g.sellValue("equipment", 1, 1)
 *
 * Lua tables become what luadata.to_py makes of them: arrays when keyed 1..n, objects otherwise.
 * Id-keyed tables are Maps iterated in ascending id order (as the Python dicts are).
 */
import { G } from "../sim/data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export const ITEM_TYPES = ["material", "equipment", "consumable", "map"] as const;
export const STACKABLE = new Set(["material", "consumable"]); // default.isStack
export const PRESTIGE_TYPES = new Set(["equipment", "consumable", "map"]); // default.itemTypesAvailableForPrestige

/** math.round / round() in this codebase: floor(x + 0.5). */
export const luaRound = (x: number): number => Math.floor(x + 0.5);
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Python round(x, d): the double's exact decimal value rounded to d places, ties to even.
 * Number.toFixed rounds exact ties up; the exact expansion (toFixed(100)) detects them.
 */
export function pyRound(x: number, d = 0): number {
  if (!Number.isFinite(x)) return x;
  const s = Math.abs(x).toFixed(100);
  const dot = s.indexOf(".");
  const rest = s.slice(dot + 1 + d);
  let out = Number(x.toFixed(d));
  if (/^50*$/.test(rest)) { // exact tie: toFixed went away from zero; Python goes to even
    const m = 10 ** d;
    const lo = Math.trunc(Math.abs(x) * m); // the candidate toward zero
    if (lo % 2 === 0) out = Math.sign(x) * lo / m;
  }
  return out; // keeps -0, as Python's round(-0.004, 1) == -0.0
}

const isIntKey = (k: string) => /^-?\d+$/.test(k);

/** luadata.to_py on a Lua-shaped JSON value. */
export function toPy(v: unknown): Any {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(toPy);
  const keys = Object.keys(v);
  if (!keys.length) return [];
  if (keys.every(isIntKey)) {
    const nums = keys.map(Number).sort((a, b) => a - b);
    if (nums.every((n, i) => n === i + 1)) return nums.map((n) => toPy((v as Any)[n]));
  }
  return Object.fromEntries(keys.map((k) => [k, toPy((v as Any)[k])]));
}

/** _indexed: an id-keyed table as a Map in ascending id order. */
function indexed(t: unknown): Map<number, Any> {
  const out = new Map<number, Any>();
  if (!t || typeof t !== "object") return out;
  for (const k of Object.keys(t).filter(isIntKey).map(Number).sort((a, b) => a - b)) out.set(k, toPy((t as Any)[k]));
  return out;
}

export class Game {
  items: Record<string, Map<number, Any>> = {};
  quests: Map<number, Any>;
  parcels: Record<string, Any>;
  crafters: Map<number, Any>;
  prefixes: Map<number, Any>; // prefixList, id -> entry (0 = none)
  suffixes: Map<number, Any>; // suffixList, id -> entry (-1 = Worn, 0 = none)
  rarityMod: Map<number, number[]>;
  gradeBonus: Map<number, number>;
  gradeParcelBonus: Map<number, number>;
  gradeTime: Map<number, number>;
  prestigeItemId: Map<number, number[]>; // ascLevel -> essence id per region

  constructor(data: Any = G) {
    for (const t of ITEM_TYPES) {
      this.items[t] = indexed(data.itemData?.[t]);
      for (const [iid, it] of this.items[t]) Object.assign(it, { id: iid, itemType: t });
    }
    this.quests = indexed(data.questData);
    for (const [qid, q] of this.quests) q.id = qid;
    this.parcels = toPy(data.parcelData ?? {});
    this.crafters = indexed(data.crafterData);
    this.prefixes = indexed(data.prefixList);
    this.suffixes = indexed(data.suffixList);
    this.rarityMod = indexed(data.rarityMod);
    this.gradeBonus = indexed(data.gradeBonus);
    this.gradeParcelBonus = indexed(data.gradeParcelBonus);
    this.gradeTime = indexed(data.gradeTime);
    this.prestigeItemId = indexed(data.defaultLocals?.prestigeItemID);
  }

  item(itype: string, iid: number): Any {
    const it = this.items[itype]?.get(iid);
    if (!it) throw new KeyError(`${itype} #${iid}`);
    return it;
  }

  name(itype: string, iid: number): string {
    return this.items[itype]?.get(iid)?.name ?? `${itype}#${iid}?`;
  }

  /** [[ingredient_type, ingredient_id, amount], ...] or null if not craftable. */
  recipe(itype: string, iid: number): [string, number, number][] | null {
    const it = this.item(itype, iid);
    const mids = it.materialID;
    if (!mids || !mids.length || !it.crafterID) return null;
    const mtypes: string[] = Array.isArray(it.materialType) ? it.materialType : [];
    const amounts: number[] = Array.isArray(it.materialAmount) ? it.materialAmount : [];
    return mids.map((mid: number, n: number) => [
      n < mtypes.length && mtypes[n] ? mtypes[n] : "material", mid, n < amounts.length ? amounts[n] : 1,
    ]);
  }

  /** Item rarity after `mods` modifiers: each adds a step, capped at 6 below rarity 7 and at 8 above. */
  rarity(itype: string, iid: number, mods = 0): number {
    let r = this.item(itype, iid).rarity ?? 1;
    for (let i = 0; i < mods; i++) r = r < 7 ? Math.min(r + 1, 6) : Math.min(r + 1, 8);
    return r;
  }

  /** Base price a customer pays (Item:getSellValue). Throws KeyError for an unknown item. */
  sellValue(itype: string, iid: number, prestige = 0, mods = 0): number {
    const it = this.item(itype, iid);
    const mult = prestige > 0 ? prestige * 2 : 1;
    if (STACKABLE.has(itype)) {
      const s = it.sell || [0, 0];
      return luaRound((s[0] * mult + s[1] * mult) / 2);
    }
    const value = (it.value ?? it.cost ?? 0) * mult;
    return luaRound(value * (this.rarityMod.get(this.rarity(itype, iid, mods)) ?? [1])[0]);
  }

  /** default.prestigeItemMaterial -> [essence_id, amount]. */
  essenceForAscension(itype: string, iid: number, ascLevel: number, upgrade: boolean, mods = 0): [number, number] {
    const it = this.item(itype, iid);
    const level = it.itemLevel ?? 1;
    const x = (level - 1) / 10;
    const region = clamp(Math.floor(x) + 1, 1, 6), frac = x - Math.floor(x);
    const essId = this.prestigeItemId.get(ascLevel)![region - 1];
    let amount = itype === "consumable" ? 2 + frac * 5 : 20 + frac * 50;
    const rm = this.rarityMod.get(this.rarity(itype, iid, mods));
    if (rm) amount = luaRound(rm[0] * amount);
    if (upgrade) amount *= 4 + mods;
    return [essId, luaRound(amount)];
  }

  /** The essence an ascended map drops instead of `baseId` (undefined: no such tier in the game). */
  prestigedEssence(baseId: number, mapPrestige: number): number | undefined {
    if (mapPrestige === 0) return baseId;
    const base = this.prestigeItemId.get(1)!;
    const i = base.indexOf(baseId);
    if (i < 0) return baseId;
    const tier = this.prestigeItemId.get(mapPrestige + 1);
    return tier ? tier[i] : undefined;
  }
}

/** Python's KeyError, for the places where tools catch it. */
export class KeyError extends Error {}

export function gameFromData(data: Any = G): Game {
  if (!data.itemData) throw new Error("game data not loaded: call loadGameData(inventory/gamedata.json) first");
  return new Game(data);
}
