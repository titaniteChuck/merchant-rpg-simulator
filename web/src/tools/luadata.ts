/**
 * Minimal evaluator for the decompiled Merchant data files (port of the former tools/luadata.py).
 *
 * The data.*.lua files are mostly statements of the form
 *
 *     itemData.equipment[3] = { name = "Iron Hatchet", ... }
 *     local prestigeItemID = {}
 *     gradeBonus[0] = 0
 *
 * Every assignment whose right-hand side is a literal (numbers, strings, booleans, nil, tables, simple
 * arithmetic, references to already-defined names) is evaluated; everything else (functions, control
 * flow, calls) is skipped and recorded in `Env.skipped`.
 *
 * Values follow what the Python version computes, so the exported JSON is byte-identical:
 * integers and floats are distinct (`2` vs `2.0`, a float is a `PyFloat`), tables keep insertion order,
 * and table keys compare like Python dict keys (1, 1.0 and true are the same key).
 */

export class PyFloat {
  readonly v: number;
  constructor(v: number) {
    this.v = v;
  }
}

export type Value = null | boolean | number | PyFloat | string | LuaTable;

/** A Lua table as the Python version holds it: a dict in insertion order. */
export class LuaTable {
  /** normalized key -> [original key, value] */
  readonly entries = new Map<string, [Value, Value]>();

  get size(): number {
    return this.entries.size;
  }
  has(k: Value): boolean {
    return this.entries.has(keyOf(k));
  }
  get(k: Value): Value {
    return this.entries.get(keyOf(k))?.[1] ?? null;
  }
  set(k: Value, v: Value): void {
    const nk = keyOf(k);
    const cur = this.entries.get(nk);
    if (cur) cur[1] = v; // a dict keeps the first key object
    else this.entries.set(nk, [k, v]);
  }
  *items(): IterableIterator<[Value, Value]> {
    for (const [k, v] of this.entries.values()) yield [k, v];
  }
}

export class NotLiteral extends Error {}

const num = (v: Value): number | undefined =>
  typeof v === "number" ? v : v instanceof PyFloat ? v.v : typeof v === "boolean" ? Number(v) : undefined;
const isFloat = (v: Value) => v instanceof PyFloat;

/** Python hash equality of dict keys: True == 1 == 1.0; tables are unhashable. */
function keyOf(k: Value): string {
  if (k instanceof LuaTable) throw new TypeError("unhashable type: 'LuaTable'");
  if (k === null) return "z";
  const n = num(k);
  if (n !== undefined) return `n:${Object.is(n, -0) ? 0 : n}`;
  return `s:${k}`;
}

/** Python str() of a value. */
export function pyStr(v: Value): string {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (v instanceof PyFloat) return pyFloatRepr(v.v);
  if (v instanceof LuaTable) return "{" + [...v.items()].map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(", ") + "}";
  return String(v);
}
function pyRepr(v: Value): string {
  return typeof v === "string" ? `'${v}'` : pyStr(v);
}

/** repr(float): shortest round-trip digits, exponent below 1e-4 and from 1e16. */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (Object.is(x, -0)) return "-0.0";
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e16)) {
    const [m, e] = x.toExponential().split("e");
    const exp = Number(e);
    return `${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

// ---------------------------------------------------------------- tokens
const KEYWORDS = new Set(["and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in",
  "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while"]);

type Tok = ["str" | "num" | "name" | "kw" | "op" | "eof", Value];

const TOKEN_RE = new RegExp(
  String.raw`(?<ws>\s+)` +
  String.raw`|(?<comment>--\[(?<ceq>=*)\[[\s\S]*?\]\k<ceq>\]|--[^\n]*)` +
  String.raw`|(?<lstring>\[(?<leq>=*)\[[\s\S]*?\]\k<leq>\])` +
  String.raw`|(?<string>"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')` +
  String.raw`|(?<number>0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)` +
  String.raw`|(?<name>[A-Za-z_][A-Za-z0-9_]*)` +
  String.raw`|(?<op>\.\.\.|\.\.|==|~=|<=|>=|[-+*/%^#<>=(){}\[\];:,.])`,
  "y",
);
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v",
  "\\": "\\", '"': '"', "'": "'", "\n": "\n" };
// Python str.isdigit(): Unicode decimal digits (the data only has ASCII ones).
const isDigit = (c: string) => /^\p{Nd}$/u.test(c);

function unescape(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const nxt = body[i + 1];
    if (isDigit(nxt)) {
      const m = /^\d{1,3}/.exec(body.slice(i + 1))!;
      out += String.fromCodePoint(Number(m[0]));
      i += 1 + m[0].length;
    } else {
      out += ESCAPES[nxt] ?? nxt;
      i += 2;
    }
  }
  return out;
}

export function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new SyntaxError(`bad char ${JSON.stringify(src[pos])} at ${pos}`);
    pos = TOKEN_RE.lastIndex;
    const g = m.groups!;
    if (g.ws !== undefined || g.comment !== undefined) continue;
    if (g.string !== undefined) toks.push(["str", unescape(g.string.slice(1, -1))]);
    else if (g.lstring !== undefined) toks.push(["str", g.lstring.replace(/^\[=*\[\n?/, "").replace(/\]=*\]$/, "")]);
    else if (g.number !== undefined) {
      const t = g.number;
      if (/^0x/i.test(t)) toks.push(["num", Number.parseInt(t.slice(2), 16)]);
      else {
        const f = Number(t);
        toks.push(["num", Number.isInteger(f) && !t.includes(".") && !/e/i.test(t) ? f : new PyFloat(f)]);
      }
    } else if (g.name !== undefined) toks.push([KEYWORDS.has(g.name) ? "kw" : "name", g.name]);
    else toks.push(["op", g.op]);
  }
  toks.push(["eof", null]);
  return toks;
}

// ---------------------------------------------------------------- evaluation
const BINARY: Record<string, number> = {
  or: 1, and: 2, "<": 3, ">": 3, "<=": 3, ">=": 3, "~=": 3, "==": 3, "..": 5, "+": 6, "-": 6, "*": 7, "/": 7, "%": 7, "^": 10,
};
const RIGHT_ASSOC = new Set(["..", "^"]);
const UNARY_PRIO = 8;

const truthyLua = (v: Value) => v !== null && v !== false;
/** Python truthiness (used by `not`, as the Python version does). */
function truthyPy(v: Value): boolean {
  if (v === null || v === false) return false;
  if (v instanceof LuaTable) return v.size > 0;
  if (v instanceof PyFloat) return v.v !== 0;
  if (typeof v === "string") return v.length > 0;
  return v !== 0;
}

/** Python == */
export function pyEq(a: Value, b: Value): boolean {
  const x = num(a), y = num(b);
  if (x !== undefined && y !== undefined) return x === y;
  if (a instanceof LuaTable && b instanceof LuaTable) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a.items()) if (!b.has(k) || !pyEq(v, b.get(k))) return false;
    return true;
  }
  return a === b;
}

function arith(op: string, a: Value, b: Value): Value {
  const x = num(a), y = num(b);
  if (x === undefined || y === undefined) {
    if (op === "+" && typeof a === "string" && typeof b === "string") return a + b; // Python str + str
    if (op === "*" && typeof a === "string" && typeof b === "number") return a.repeat(Math.max(b, 0));
    if (op === "*" && typeof b === "string" && typeof a === "number") return b.repeat(Math.max(a, 0));
    throw new NotLiteral(`unsupported operand type(s) for ${op}`);
  }
  const fl = isFloat(a) || isFloat(b);
  const wrap = (r: number, float: boolean): Value => (float ? new PyFloat(r) : r);
  switch (op) {
    case "+": return wrap(x + y, fl);
    case "-": return wrap(x - y, fl);
    case "*": return wrap(x * y, fl);
    case "/":
      if (y === 0) throw new RangeError("division by zero"); // ZeroDivisionError: not caught in Python either
      return new PyFloat(x / y);
    case "%": {
      if (y === 0) throw new RangeError("modulo by zero");
      const r = x - Math.floor(x / y) * y; // Python/Lua floored modulo
      return wrap(r, fl);
    }
    case "^": {
      if (!fl && y < 0) return new PyFloat(x ** y);
      return wrap(x ** y, fl);
    }
  }
  throw new NotLiteral(op);
}

function compare(op: string, a: Value, b: Value): boolean {
  const x = num(a), y = num(b);
  let c: number;
  if (x !== undefined && y !== undefined) c = x < y ? -1 : x > y ? 1 : 0;
  else if (typeof a === "string" && typeof b === "string") c = a < b ? -1 : a > b ? 1 : 0;
  else throw new NotLiteral(`'${op}' not supported between these types`);
  return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
}

function binop(op: string, a: Value, b: Value): Value {
  if (op === "..") return pyStr(a) + pyStr(b);
  if (op === "and") return truthyLua(a) ? b : a;
  if (op === "or") return truthyLua(a) ? a : b;
  if (op === "==") return pyEq(a, b);
  if (op === "~=") return !pyEq(a, b);
  if (op === "<" || op === ">" || op === "<=" || op === ">=") return compare(op, a, b);
  return arith(op, a, b);
}

function pyLen(v: Value): number {
  if (v instanceof LuaTable) return v.size;
  if (typeof v === "string") return [...v].length;
  throw new NotLiteral("object has no len()");
}

function negate(v: Value): Value {
  if (v instanceof PyFloat) return new PyFloat(-v.v);
  if (typeof v === "number") return -v;
  if (typeof v === "boolean") return -Number(v);
  throw new NotLiteral("bad operand type for unary -");
}

export class Env {
  globals = new Map<string, Value>();
  skipped: string[] = [];
  fileLocals = new Map<string, Map<string, Value>>();

  /** Evaluate one data file. `name` is the file name (its stem keys fileLocals, like Path.stem). */
  load(src: string, name: string): this {
    const parser = new Parser(this, tokenize(src), name);
    parser.run();
    this.fileLocals.set(name.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, ""), parser.locals);
    return this;
  }
}

class Parser {
  locals = new Map<string, Value>();
  private i = 0;
  private readonly env: Env;
  private readonly t: Tok[];
  private readonly fname: string;

  constructor(env: Env, toks: Tok[], fname: string) {
    this.env = env;
    this.t = toks;
    this.fname = fname;
  }

  private peek(k = 0): Tok {
    return this.t[this.i + k];
  }
  private next(): Tok {
    return this.t[this.i++];
  }
  private is(tok: Tok, kind: string, val?: Value): boolean {
    return tok[0] === kind && (val === undefined || tok[1] === val);
  }
  private accept(kind: string, val?: Value): boolean {
    if (this.is(this.peek(), kind, val)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(kind: string, val?: Value): void {
    if (!this.accept(kind, val)) throw new NotLiteral(`expected ${val ?? kind}, got ${this.peek()}`);
  }
  private lookup(name: string): Value {
    if (this.locals.has(name)) return this.locals.get(name)!;
    if (this.env.globals.has(name)) return this.env.globals.get(name)!;
    throw new NotLiteral(`unknown name ${name}`);
  }

  run(): void {
    while (this.peek()[0] !== "eof") {
      const start = this.i;
      try {
        this.statement();
      } catch (e) {
        if (!(e instanceof NotLiteral)) throw e;
        this.i = start;
        this.skipStatement(e.message);
      }
    }
  }

  /** Skip one statement, balancing block keywords and brackets. */
  private skipStatement(reason: string): void {
    const startTok = this.peek();
    let depth = 0, brackets = 0, first = true;
    while (this.peek()[0] !== "eof") {
      const [kind, val] = this.peek();
      if (kind === "kw" && (val === "function" || val === "if" || val === "do" || val === "repeat")) depth++;
      else if (kind === "kw" && (val === "end" || val === "until")) {
        depth--;
        if (depth <= 0 && brackets === 0) {
          this.i++;
          if (val === "until") this.skipExpressionTokens();
          break;
        }
      } else if (kind === "op" && typeof val === "string" && "({[".includes(val)) brackets++;
      else if (kind === "op" && typeof val === "string" && ")}]".includes(val)) brackets--;
      else if (!first && depth === 0 && brackets === 0 && this.startsNewStatement()) break;
      this.i++;
      first = false;
    }
    this.env.skipped.push(`${this.fname.replace(/^.*[\\/]/, "")}: ${pyRepr(startTok[1])} (${reason})`);
  }

  private startsNewStatement(): boolean {
    const [kind, val] = this.peek();
    const prev = this.t[this.i - 1];
    if (kind === "kw" && ["local", "return", "for", "while", "if", "do", "repeat", "function"].includes(val as string)) return true;
    // a name right after a closing token / literal begins a new statement
    return kind === "name" && (["num", "str", "name"].includes(prev[0]) || [")", "}", "]", "end"].includes(prev[1] as string));
  }

  private skipExpressionTokens(): void {
    while (this.peek()[0] !== "eof" && !this.startsNewStatement()) this.i++;
  }

  private statement(): void {
    if (this.accept("op", ";")) return;
    if (this.accept("kw", "local")) {
      if (this.is(this.peek(), "kw", "function")) throw new NotLiteral("local function");
      const names = [this.next()[1] as string];
      while (this.accept("op", ",")) names.push(this.next()[1] as string);
      const vals: Value[] = [];
      if (this.accept("op", "=")) {
        vals.push(this.expr());
        while (this.accept("op", ",")) vals.push(this.expr());
      }
      names.forEach((name, n) => this.locals.set(name, n < vals.length ? vals[n] : null));
      return;
    }
    if (this.peek()[0] !== "name") throw new NotLiteral(`statement starts with ${pyRepr(this.peek()[1])}`);
    // lvalue: Name { .Name | [expr] }
    const root = this.next()[1] as string;
    const path: Value[] = [];
    for (;;) {
      if (this.accept("op", ".")) path.push(this.next()[1]);
      else if (this.accept("op", "[")) {
        path.push(this.expr());
        this.expect("op", "]");
      } else break;
    }
    if (!this.accept("op", "=")) throw new NotLiteral("not an assignment");
    const value = this.expr();
    if (this.is(this.peek(), "op", ",")) throw new NotLiteral("multiple assignment");
    this.assign(root, path, value);
  }

  private assign(root: string, path: Value[], value: Value): void {
    if (!path.length) {
      if (this.locals.has(root)) this.locals.set(root, value);
      else this.env.globals.set(root, value);
      return;
    }
    let container: Value = this.locals.has(root) || this.env.globals.has(root) ? this.lookup(root) : null;
    if (container === null) {
      container = new LuaTable();
      this.env.globals.set(root, container);
    }
    for (const key of path.slice(0, -1)) {
      if (!(container instanceof LuaTable)) throw new TypeError("argument of type is not iterable"); // as Python
      if (!container.has(key)) container.set(key, new LuaTable());
      container = container.get(key);
    }
    if (!(container instanceof LuaTable)) throw new NotLiteral("index into non-table");
    container.set(path[path.length - 1], value);
  }

  private expr(limit = 0): Value {
    const [kind, val] = this.peek();
    let left: Value;
    if ((kind === "op" && (val === "-" || val === "#")) || (kind === "kw" && val === "not")) {
      this.next();
      const operand = this.expr(UNARY_PRIO);
      left = val === "-" ? negate(operand) : val === "#" ? pyLen(operand) : !truthyPy(operand);
    } else left = this.simple();
    for (;;) {
      const [k, op] = this.peek();
      const prio = (k === "op" || k === "kw") && typeof op === "string" ? BINARY[op] : undefined;
      if (prio === undefined || prio <= limit) return left;
      this.next();
      const right = this.expr(RIGHT_ASSOC.has(op as string) ? prio - 1 : prio);
      left = binop(op as string, left, right);
    }
  }

  private simple(): Value {
    const [kind, val] = this.next();
    if (kind === "num" || kind === "str") return val;
    if (kind === "kw" && (val === "true" || val === "false" || val === "nil")) return val === "true" ? true : val === "false" ? false : null;
    if (kind === "op" && val === "{") return this.table();
    if (kind === "op" && val === "(") {
      const v = this.expr();
      this.expect("op", ")");
      return v;
    }
    if (kind === "name") {
      let v = this.lookup(val as string);
      for (;;) {
        if (this.accept("op", ".")) v = index(v, this.next()[1]);
        else if (this.accept("op", "[")) {
          const k = this.expr();
          this.expect("op", "]");
          v = index(v, k);
        } else if (["(", ":", "{"].includes(this.peek()[1] as string) || this.peek()[0] === "str") throw new NotLiteral("function call");
        else return v;
      }
    }
    throw new NotLiteral(`unexpected ${pyRepr(val)}`);
  }

  private table(): LuaTable {
    const t = new LuaTable();
    let n = 1;
    while (!this.accept("op", "}")) {
      if (this.accept("op", "[")) {
        const k = this.expr();
        this.expect("op", "]");
        this.expect("op", "=");
        t.set(k, this.expr());
      } else if (this.peek()[0] === "name" && this.is(this.peek(1), "op", "=")) {
        const k = this.next()[1];
        this.next();
        t.set(k, this.expr());
      } else {
        t.set(n, this.expr());
        n++;
      }
      if (!(this.accept("op", ",") || this.accept("op", ";"))) {
        this.expect("op", "}");
        break;
      }
    }
    return t;
  }
}

function index(v: Value, k: Value): Value {
  if (!(v instanceof LuaTable)) throw new NotLiteral("index into non-table");
  return v.get(k);
}

// ---------------------------------------------------------------- JSON (Python json.dumps)
/** json.dumps string escaping; ensure_ascii escapes everything above 0x7e as UTF-16 units, as Python does. */
function jsonStr(s: string, ensureAscii: boolean): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || (ensureAscii && c > 0x7e)) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

/** A JSON value in Python's shape: dicts (Map, insertion order) with string keys, lists, scalars. */
export type Json = null | boolean | number | PyFloat | string | Json[] | Map<string, Json>;

export interface DumpOptions {
  /** json.dumps(indent=n): newline + n spaces per level, "," and ": " separators */
  indent?: number;
  /** default true */
  ensureAscii?: boolean;
  /** separators=(",", ":") */
  compact?: boolean;
}

function scalar(v: Json, ensureAscii: boolean): string | undefined {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (v instanceof PyFloat) return Number.isNaN(v.v) ? "NaN" : !Number.isFinite(v.v) ? (v.v > 0 ? "Infinity" : "-Infinity") : pyFloatRepr(v.v);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return jsonStr(v, ensureAscii);
  return undefined;
}

/** json.dumps(v, ...) with Python's default float/str formatting. */
export function pyJsonDumps(v: Json, o: DumpOptions = {}): string {
  const ensureAscii = o.ensureAscii ?? true;
  const itemSep = o.compact ? "," : o.indent !== undefined ? "," : ", ";
  const keySep = o.compact ? ":" : ": ";
  const rec = (x: Json, level: number): string => {
    const s = scalar(x, ensureAscii);
    if (s !== undefined) return s;
    const entries: string[] = Array.isArray(x)
      ? x.map((e) => rec(e, level + 1))
      : [...(x as Map<string, Json>)].map(([k, e]) => jsonStr(k, ensureAscii) + keySep + rec(e, level + 1));
    const [open, close] = Array.isArray(x) ? ["[", "]"] : ["{", "}"];
    if (!entries.length) return open + close;
    if (o.indent === undefined) return open + entries.join(itemSep) + close;
    const pad = "\n" + " ".repeat(o.indent * (level + 1));
    return open + pad + entries.join(itemSep + pad) + "\n" + " ".repeat(o.indent * level) + close;
  };
  return rec(v, 0);
}

/** luadata.to_py: tables keyed exactly 1..n become lists, other tables dicts with str keys, integral floats ints. */
export function toPy(v: Value): Json {
  if (v instanceof LuaTable) {
    const keys = [...v.items()].map(([k]) => k);
    if (keys.length && keys.every((k) => typeof k === "number" && Number.isInteger(k))) {
      const sorted = (keys as number[]).slice().sort((a, b) => a - b);
      if (sorted.every((k, i) => k === i + 1)) return sorted.map((k) => toPy(v.get(k)));
    }
    if (!keys.length) return [];
    return new Map([...v.items()].map(([k, x]) => [typeof k === "string" ? k : pyStr(k), toPy(x)]));
  }
  if (v instanceof PyFloat && Number.isInteger(v.v)) return v.v;
  return v;
}
