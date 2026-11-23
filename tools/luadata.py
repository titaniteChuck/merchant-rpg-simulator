"""Minimal evaluator for the decompiled Merchant data files.

The data.*.lua files are mostly statements of the form

    itemData.equipment[3] = { name = "Iron Hatchet", ... }
    local prestigeItemID = {}
    gradeBonus[0] = 0

This module tokenizes a Lua 5.1 source file, evaluates every assignment whose
right-hand side is a literal (numbers, strings, booleans, nil, tables, simple
arithmetic, references to already-defined names) and skips everything else
(function definitions, control flow, calls). Unparseable statements are
recorded in `Env.skipped` so nothing is silently dropped.

Lua tables become `LuaTable` (a dict). `to_py()` converts tables whose keys are
exactly 1..n into Python lists, recursively.
"""

from __future__ import annotations

import re
from pathlib import Path

KEYWORDS = {
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
    "true", "until", "while",
}

_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<comment>--\[(?P<ceq>=*)\[.*?\](?P=ceq)\]|--[^\n]*)
  | (?P<lstring>\[(?P<leq>=*)\[.*?\](?P=leq)\])
  | (?P<string>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')
  | (?P<number>0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)
  | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<op>\.\.\.|\.\.|==|~=|<=|>=|[-+*/%^\#<>=(){}\[\];:,.])
    """,
    re.VERBOSE | re.DOTALL,
)

_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "a": "\a", "b": "\b", "f": "\f",
            "v": "\v", "\\": "\\", '"': '"', "'": "'", "\n": "\n"}


def _unescape(body: str) -> str:
    out, i = [], 0
    while i < len(body):
        c = body[i]
        if c != "\\":
            out.append(c)
            i += 1
            continue
        nxt = body[i + 1]
        if nxt.isdigit():
            m = re.match(r"\d{1,3}", body[i + 1:])
            out.append(chr(int(m.group(0))))
            i += 1 + len(m.group(0))
        else:
            out.append(_ESCAPES.get(nxt, nxt))
            i += 2
    return "".join(out)


def tokenize(src: str):
    toks, pos = [], 0
    while pos < len(src):
        m = _TOKEN_RE.match(src, pos)
        if not m:
            raise SyntaxError(f"bad char {src[pos]!r} at {pos}")
        pos = m.end()
        kind = m.lastgroup
        if kind in ("ws", "comment", "ceq", "leq"):
            continue
        text = m.group(kind)
        if kind == "string":
            toks.append(("str", _unescape(text[1:-1])))
        elif kind == "lstring":
            body = re.sub(r"^\[=*\[\n?", "", text)
            body = re.sub(r"\]=*\]$", "", body)
            toks.append(("str", body))
        elif kind == "number":
            v = int(text, 16) if text.lower().startswith("0x") else float(text)
            if isinstance(v, float) and v.is_integer() and "." not in text and "e" not in text.lower():
                v = int(v)
            toks.append(("num", v))
        elif kind == "name":
            toks.append(("kw" if text in KEYWORDS else "name", text))
        else:
            toks.append(("op", text))
    toks.append(("eof", None))
    return toks


class LuaTable(dict):
    pass


class NotLiteral(Exception):
    pass


_BINARY = {
    "or": 1, "and": 2,
    "<": 3, ">": 3, "<=": 3, ">=": 3, "~=": 3, "==": 3,
    "..": 5, "+": 6, "-": 6, "*": 7, "/": 7, "%": 7, "^": 10,
}
_RIGHT_ASSOC = {"..", "^"}
_UNARY_PRIO = 8


class Env:
    def __init__(self):
        self.globals: dict = {}
        self.skipped: list[str] = []
        self.file_locals: dict[str, dict] = {}

    # ------------------------------------------------------------------ files
    def load(self, path: str | Path):
        toks = tokenize(Path(path).read_text(encoding="utf-8", errors="replace"))
        parser = _Parser(self, toks, str(path))
        parser.run()
        self.file_locals[Path(path).stem] = parser.locals
        return self


class _Parser:
    def __init__(self, env: Env, toks, fname):
        self.env, self.t, self.i, self.fname = env, toks, 0, fname
        self.locals: dict = {}

    # helpers
    def peek(self, k=0):
        return self.t[self.i + k]

    def next(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def accept(self, kind, val=None):
        tok = self.peek()
        if tok[0] == kind and (val is None or tok[1] == val):
            self.i += 1
            return True
        return False

    def expect(self, kind, val=None):
        if not self.accept(kind, val):
            raise NotLiteral(f"expected {val or kind}, got {self.peek()}")

    def lookup(self, name):
        if name in self.locals:
            return self.locals[name]
        if name in self.env.globals:
            return self.env.globals[name]
        raise NotLiteral(f"unknown name {name}")

    # statements
    def run(self):
        while self.peek()[0] != "eof":
            start = self.i
            try:
                self.statement()
            except NotLiteral as e:
                self.i = start
                self.skip_statement(str(e))

    def skip_statement(self, reason):
        """Skip one statement, balancing block keywords and brackets."""
        start_tok = self.peek()
        depth = 0
        brackets = 0
        first = True
        while self.peek()[0] != "eof":
            kind, val = self.peek()
            if kind == "kw" and val in ("function", "if", "do", "repeat"):
                depth += 1
            elif kind == "kw" and val in ("end", "until"):
                depth -= 1
                if depth <= 0 and brackets == 0:
                    self.i += 1
                    if val == "until":  # skip the until-condition loosely
                        self.skip_expression_tokens()
                    break
            elif kind == "op" and val in "({[":
                brackets += 1
            elif kind == "op" and val in ")}]":
                brackets -= 1
            elif (not first and depth == 0 and brackets == 0 and
                  self._starts_new_statement()):
                break
            self.i += 1
            first = False
        self.env.skipped.append(f"{Path(self.fname).name}: {start_tok[1]!r} ({reason})")

    def _starts_new_statement(self):
        kind, val = self.peek()
        prev = self.t[self.i - 1]
        if kind == "kw" and val in ("local", "return", "for", "while", "if", "do", "repeat", "function"):
            return True
        # a name right after a closing token / literal begins a new statement
        if kind == "name" and (prev[0] in ("num", "str", "name") or prev[1] in (")", "}", "]", "end")):
            return True
        return False

    def skip_expression_tokens(self):
        while self.peek()[0] != "eof" and not self._starts_new_statement():
            self.i += 1

    def statement(self):
        if self.accept("op", ";"):
            return
        if self.accept("kw", "local"):
            if self.peek() == ("kw", "function"):
                raise NotLiteral("local function")
            names = [self.next()[1]]
            while self.accept("op", ","):
                names.append(self.next()[1])
            if self.accept("op", "="):
                vals = [self.expr()]
                while self.accept("op", ","):
                    vals.append(self.expr())
            else:
                vals = []
            for n, name in enumerate(names):
                self.locals[name] = vals[n] if n < len(vals) else None
            return
        if self.peek()[0] != "name":
            raise NotLiteral(f"statement starts with {self.peek()[1]!r}")
        # lvalue: Name { .Name | [expr] }
        root = self.next()[1]
        path = []
        while True:
            if self.accept("op", "."):
                path.append(self.next()[1])
            elif self.accept("op", "["):
                path.append(self.expr())
                self.expect("op", "]")
            else:
                break
        if not self.accept("op", "="):
            raise NotLiteral("not an assignment")
        value = self.expr()
        if self.peek() == ("op", ","):
            raise NotLiteral("multiple assignment")
        self.assign(root, path, value)

    def assign(self, root, path, value):
        if not path:
            if root in self.locals:
                self.locals[root] = value
            else:
                self.env.globals[root] = value
            return
        container = self.lookup(root) if (root in self.locals or root in self.env.globals) else None
        if container is None:
            container = self.env.globals[root] = LuaTable()
        for key in path[:-1]:
            if key not in container:
                container[key] = LuaTable()
            container = container[key]
        if not isinstance(container, dict):
            raise NotLiteral("index into non-table")
        container[path[-1]] = value

    # expressions (literal subset)
    def expr(self, limit=0):
        kind, val = self.peek()
        if (kind == "op" and val in ("-", "#")) or (kind == "kw" and val == "not"):
            self.next()
            operand = self.expr(_UNARY_PRIO)
            left = (-operand if val == "-" else len(operand) if val == "#" else not operand)
        else:
            left = self.simple()
        while True:
            kind, op = self.peek()
            prio = _BINARY.get(op) if kind in ("op", "kw") else None
            if prio is None or prio <= limit:
                return left
            self.next()
            right = self.expr(prio - 1 if op in _RIGHT_ASSOC else prio)
            left = self.binop(op, left, right)

    @staticmethod
    def binop(op, a, b):
        try:
            if op == "+": return a + b
            if op == "-": return a - b
            if op == "*": return a * b
            if op == "/": return a / b
            if op == "%": return a % b
            if op == "^": return a ** b
            if op == "..": return f"{a}{b}"
            if op == "and": return b if a not in (None, False) else a
            if op == "or": return a if a not in (None, False) else b
            if op == "==": return a == b
            if op == "~=": return a != b
            if op == "<": return a < b
            if op == ">": return a > b
            if op == "<=": return a <= b
            if op == ">=": return a >= b
        except TypeError as e:
            raise NotLiteral(str(e))
        raise NotLiteral(op)

    def simple(self):
        kind, val = self.next()
        if kind in ("num", "str"):
            return val
        if kind == "kw" and val in ("true", "false", "nil"):
            return {"true": True, "false": False, "nil": None}[val]
        if kind == "op" and val == "{":
            return self.table()
        if kind == "op" and val == "(":
            v = self.expr()
            self.expect("op", ")")
            return v
        if kind == "name":
            v = self.lookup(val)
            while True:
                if self.accept("op", "."):
                    v = self._index(v, self.next()[1])
                elif self.accept("op", "["):
                    k = self.expr()
                    self.expect("op", "]")
                    v = self._index(v, k)
                elif self.peek()[1] in ("(", ":", "{") or self.peek()[0] == "str":
                    raise NotLiteral("function call")
                else:
                    return v
        raise NotLiteral(f"unexpected {val!r}")

    @staticmethod
    def _index(v, k):
        if not isinstance(v, dict):
            raise NotLiteral("index into non-table")
        return v.get(k)

    def table(self):
        t = LuaTable()
        n = 1
        while not self.accept("op", "}"):
            if self.accept("op", "["):
                k = self.expr()
                self.expect("op", "]")
                self.expect("op", "=")
                t[k] = self.expr()
            elif self.peek()[0] == "name" and self.peek(1) == ("op", "="):
                k = self.next()[1]
                self.next()
                t[k] = self.expr()
            else:
                t[n] = self.expr()
                n += 1
            if not (self.accept("op", ",") or self.accept("op", ";")):
                self.expect("op", "}")
                break
        return t


def to_py(v):
    """Convert LuaTables to lists (keys 1..n) or dicts, recursively."""
    if isinstance(v, dict):
        keys = list(v.keys())
        if keys and all(isinstance(k, int) for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
            return [to_py(v[k]) for k in range(1, len(keys) + 1)]
        if not keys:
            return []
        return {(str(k) if not isinstance(k, str) else k): to_py(x) for k, x in v.items()}
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def load_files(paths) -> Env:
    env = Env()
    for p in paths:
        env.load(p)
    return env
