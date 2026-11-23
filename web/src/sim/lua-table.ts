/**
 * Lua 5.1 table internals (ltable.c), for the few places where the game's
 * results depend on them:
 *   - `pairs()` order when a loop draws random numbers (weightedRandom over loot
 *     odds, default.bonusStat over an item's bonus stats);
 *   - `#t` on a list with a hole (Map:generateTreasure can insert nil).
 *
 * Emulates the array part, the node (hash) part with its collision chains and
 * free pointer, rehash/resize sizing, `luaH_getn` and `luaH_next` traversal.
 * Keys: numbers and strings. Checked against real Lua 5.1 (test/lua-table.test.ts).
 */

type Key = number | string;

interface Node {
  key: Key | undefined; // undefined = free node (nil key)
  val: unknown; // undefined = nil value
  next: number; // index of the next node in the chain, -1 = none
}

const MAXBITS = 26;
const f64 = new DataView(new ArrayBuffer(8));
const utf8 = new TextEncoder();

function ceillog2(x: number): number {
  // luaO_log2(x - 1) + 1, with ceillog2(1) = 0
  let l = 0;
  x = x - 1;
  while (x >= 1) {
    l++;
    x = Math.floor(x / 2);
  }
  return l;
}

/** luaS_hash (Lua 5.1, seed = length). */
function stringHash(s: string): number {
  const b = utf8.encode(s);
  const l = b.length;
  let h = l >>> 0;
  const step = (l >> 5) + 1;
  for (let l1 = l; l1 >= step; l1 -= step) {
    h = (h ^ (((h << 5) >>> 0) + (h >>> 2) + b[l1 - 1])) >>> 0;
  }
  return h;
}

/** arrayindex: the key as an integer, or -1. */
function arrayIndex(k: Key): number {
  return typeof k === "number" && Number.isInteger(k) ? k : -1;
}

export class LuaTable {
  array: unknown[] = [];
  node: Node[] = [];
  isDummy = true;
  lastfree = 0;

  /** `{}` (0, 0), or a constructor with `narray` list items and `nhash` record fields. */
  constructor(narray = 0, nhash = 0) {
    this.setNodeVector(0);
    if (narray > 0 || nhash > 0) this.resize(narray, nhash);
  }

  /** A table built like a Lua constructor: record fields set in source order. */
  static fromRecord(entries: [Key, unknown][]): LuaTable {
    const t = new LuaTable(0, entries.length);
    for (const [k, v] of entries) t.set(k, v);
    return t;
  }

  private sizeNode(): number {
    return this.node.length;
  }

  private setNodeVector(size: number): void {
    if (size === 0) {
      this.node = [{ key: undefined, val: undefined, next: -1 }];
      this.isDummy = true;
    } else {
      const n = 2 ** ceillog2(size);
      this.node = [];
      for (let i = 0; i < n; i++) this.node.push({ key: undefined, val: undefined, next: -1 });
      this.isDummy = false;
    }
    // dummy node: lastfree = node + 0, so getfreepos finds nothing
    this.lastfree = this.isDummy ? 0 : this.node.length;
  }

  private mainPosition(k: Key): number {
    const size = this.sizeNode();
    if (typeof k === "string") return stringHash(k) & (size - 1);
    if (k === 0) return 0;
    f64.setFloat64(0, k, true);
    const a = (f64.getUint32(0, true) + f64.getUint32(4, true)) >>> 0;
    return a % ((size - 1) | 1);
  }

  private findNode(k: Key): number {
    if (this.isDummy) return -1;
    let n = this.mainPosition(k);
    while (n !== -1) {
      if (this.node[n].key === k) return n;
      n = this.node[n].next;
    }
    return -1;
  }

  get(k: Key): unknown {
    const i = arrayIndex(k);
    if (i >= 1 && i <= this.array.length) return this.array[i - 1];
    const n = this.findNode(k);
    return n === -1 ? undefined : this.node[n].val;
  }

  /** t[k] = v (v undefined = nil). */
  set(k: Key, v: unknown): void {
    if (typeof k === "number" && Number.isNaN(k)) throw new Error("table index is NaN");
    const i = arrayIndex(k);
    if (i >= 1 && i <= this.array.length) {
      this.array[i - 1] = v;
      return;
    }
    const n = this.findNode(k);
    if (n !== -1) {
      this.node[n].val = v;
      return;
    }
    // luaH_set -> newkey; Lua then stores the value (even nil) in the new slot
    const slot = this.newKey(k);
    if (slot.kind === "array") this.array[slot.index] = v;
    else this.node[slot.index].val = v;
  }

  private getFreePos(): number {
    while (this.lastfree > 0) {
      this.lastfree--;
      if (this.node[this.lastfree].key === undefined) return this.lastfree;
    }
    return -1;
  }

  private newKey(k: Key): { kind: "array" | "node"; index: number } {
    let mp = this.mainPosition(k);
    if (this.node[mp].val !== undefined || this.isDummy) {
      const n = this.getFreePos();
      if (n === -1) {
        this.rehash(k);
        return this.slotFor(k);
      }
      const othern0 = this.mainPosition(this.node[mp].key as Key);
      let othern = othern0;
      if (othern !== mp) {
        while (this.node[othern].next !== mp) othern = this.node[othern].next;
        this.node[othern].next = n;
        this.node[n] = { ...this.node[mp] };
        this.node[mp].next = -1;
        this.node[mp].val = undefined;
      } else {
        this.node[n].next = this.node[mp].next;
        this.node[mp].next = n;
        mp = n;
      }
    }
    this.node[mp].key = k;
    return { kind: "node", index: mp };
  }

  /** luaH_set after a rehash: existing slot or a new key. */
  private slotFor(k: Key): { kind: "array" | "node"; index: number } {
    const i = arrayIndex(k);
    if (i >= 1 && i <= this.array.length) return { kind: "array", index: i - 1 };
    const n = this.findNode(k);
    if (n !== -1) return { kind: "node", index: n };
    return this.newKey(k);
  }

  private rehash(extra: Key): void {
    const nums = new Array(MAXBITS + 1).fill(0);
    let nasize = this.numUseArray(nums);
    let totaluse = nasize;
    // numusehash
    let ause = 0;
    for (let i = this.sizeNode() - 1; i >= 0; i--) {
      const nd = this.node[i];
      if (nd.val !== undefined) {
        ause += countInt(nd.key as Key, nums);
        totaluse++;
      }
    }
    nasize += ause;
    nasize += countInt(extra, nums);
    totaluse++;
    const [na, newNasize] = computeSizes(nums, nasize);
    this.resize(newNasize, totaluse - na);
  }

  private numUseArray(nums: number[]): number {
    let ause = 0;
    let i = 1;
    const size = this.array.length;
    for (let lg = 0, ttlg = 1; lg <= MAXBITS; lg++, ttlg *= 2) {
      let lc = 0;
      let lim = ttlg;
      if (lim > size) {
        lim = size;
        if (i > lim) break;
      }
      for (; i <= lim; i++) if (this.array[i - 1] !== undefined) lc++;
      nums[lg] += lc;
      ause += lc;
    }
    return ause;
  }

  private resize(nasize: number, nhsize: number): void {
    const oldasize = this.array.length;
    const nold = this.node;
    const oldDummy = this.isDummy;
    if (nasize > oldasize) for (let i = oldasize; i < nasize; i++) this.array.push(undefined);
    this.setNodeVector(nhsize);
    if (nasize < oldasize) {
      const vanishing = this.array.slice(nasize);
      this.array.length = nasize;
      for (let i = 0; i < vanishing.length; i++) {
        if (vanishing[i] !== undefined) this.set(nasize + i + 1, vanishing[i]);
      }
    }
    if (!oldDummy) {
      for (let i = nold.length - 1; i >= 0; i--) {
        const old = nold[i];
        if (old.val !== undefined) this.set(old.key as Key, old.val);
      }
    }
  }

  /** `#t` (luaH_getn). */
  len(): number {
    let j = this.array.length;
    if (j > 0 && this.array[j - 1] === undefined) {
      let i = 0;
      while (j - i > 1) {
        const m = Math.floor((i + j) / 2);
        if (this.array[m - 1] === undefined) j = m;
        else i = m;
      }
      return i;
    }
    if (this.isDummy) return j;
    // unbound_search
    let i = j;
    j++;
    while (this.get(j) !== undefined) {
      i = j;
      j *= 2;
    }
    while (j - i > 1) {
      const m = Math.floor((i + j) / 2);
      if (this.get(m) === undefined) j = m;
      else i = m;
    }
    return i;
  }

  /** `pairs(t)` order (luaH_next): array part, then nodes in index order; nil values skipped. */
  entries(): [Key, unknown][] {
    const out: [Key, unknown][] = [];
    for (let i = 0; i < this.array.length; i++) if (this.array[i] !== undefined) out.push([i + 1, this.array[i]]);
    if (!this.isDummy) {
      for (const nd of this.node) if (nd.val !== undefined) out.push([nd.key as Key, nd.val]);
    }
    return out;
  }

  keys(): Key[] {
    return this.entries().map(([k]) => k);
  }

  /** table.insert(t, pos, v) (ltablib tinsert, Lua 5.1). */
  insert(pos: number, v: unknown): void {
    let e = this.len() + 1;
    if (pos > e) e = pos;
    for (let i = e; i > pos; i--) this.set(i, this.get(i - 1));
    this.set(pos, v);
  }

  /** table.insert(t, v) */
  push(v: unknown): void {
    this.set(this.len() + 1, v);
  }
}

function countInt(k: Key, nums: number[]): number {
  const i = arrayIndex(k);
  if (i > 0 && i <= 2 ** MAXBITS) {
    nums[ceillog2(i)]++;
    return 1;
  }
  return 0;
}

/** computesizes: returns [keys going to the array part, new array size]. */
function computeSizes(nums: number[], narray: number): [number, number] {
  let a = 0;
  let na = 0;
  let n = 0;
  for (let i = 0, twotoi = 1; twotoi / 2 < narray; i++, twotoi *= 2) {
    if (nums[i] > 0) {
      a += nums[i];
      if (a > twotoi / 2) {
        n = twotoi;
        na = a;
      }
    }
  }
  return [na, n];
}
