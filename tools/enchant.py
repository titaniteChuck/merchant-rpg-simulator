"""Enchanter model: expected cost of adding a prefix or suffix to an item you own.

Game rules (decompiled/obj.Enchant.lua, scene.EnchantItemOverlay.lua, data.Default.lua):

* Every attempt pays gold + a gem (prefix) or rune (suffix) by item-level band,
  amount 1 + fibo[min(attempts, 5)] -> 1, 2, 2, 3, 4, 6, 6...
  Ascended items also pay default.prestigeEnchantMaterial essence per attempt.
* The attempt counter of that enchant type goes up by one per attempt and is
  reset to 0 when the enchant breaks.
* Prefix (default.__prefixChance): clamp((L - itemLevel) * 2 + 2 * grade
  (+15 if already prefixed), 10, 80) %. Breaking only exists when re-rolling
  an existing prefix, so adding a first prefix has no break risk.
* Suffix (default.__suffixChance): steps the suffix +1, chance
  clamp((L + 10 + 2 * attempts + 4 * grade - nextSuffix.minLevel) * 2, 10, 95) %;
  on failure it breaks with min(4 * attempts, 100) %, dropping one step
  (no-op from 0) and resetting the counter.
* L = Enchanter level (its prestige level for an ascended item).
* A roll succeeds when odds > math.random(1, 100), i.e. with (odds - 1) %.

Only the number of modifiers changes the price (rarity step), so the cheapest
way to "+1 modifier" is a +1 suffix or a first prefix; "+2" is both.
"""

from __future__ import annotations

import functools
import math

from gamedata import Game, clamp, lua_round

FIBO = {0: 0, 1: 1, 2: 1, 3: 2, 4: 3, 5: 5}
PREFIX_GEM = [(10, 30), (20, 44), (30, 88), (40, 126), (50, 157), (60, 252)]
SUFFIX_RUNE = [(10, 32), (20, 48), (30, 92), (40, 127), (50, 158), (60, 253)]
MAX_STATE = 60   # attempt counter states tracked by the Markov chain


def _band(table, level):
    for top, mid in table:
        if level <= top:
            return mid
    return None   # above level 60: no rune defined, the game can't enchant it


def _hit(odds):
    return clamp(math.ceil(odds) - 1, 0, 100) / 100


def enchant_essence(g: Game, itype, iid, prestige, mods):
    """default.prestigeEnchantMaterial on an item with `mods` modifiers."""
    if not prestige:
        return None, 0
    it = g.items[itype][iid]
    level = it.get("itemLevel", 1)
    region, frac = divmod((level - 1) / 10, 1)
    region = clamp(int(region) + 1, 1, 6)
    eid = g.prestige_item_id[prestige][region - 1]
    amount = 2 + frac * 10
    rarity = g.rarity(itype, iid, mods)
    if rarity in g.rarity_mod:
        amount = g.rarity_mod[rarity][0] * amount
    return eid, lua_round(amount)


def _markov(cost, p_success, p_break, states=MAX_STATE):
    """Expected total cost (and attempts) from counter 0 until success.

    E[a] = cost(a) + (1 - p(a)) * (b(a) * E[0] + (1 - b(a)) * E[a + 1]),
    counter capped at `states` (the last state loops on itself). Solved
    exactly backwards with E[a] = alpha[a] + beta[a] * E[0]."""
    def solve(c):
        a = states
        f, b = 1 - p_success(a), p_break(a)
        den = 1 - f * (1 - b)
        if den <= 0:
            return math.inf
        alpha, beta = c(a) / den, f * b / den
        for a in range(states - 1, -1, -1):
            f, b = 1 - p_success(a), p_break(a)
            alpha, beta = c(a) + f * (1 - b) * alpha, f * b + f * (1 - b) * beta
        return alpha / (1 - beta) if beta < 1 else math.inf
    return solve(cost), solve(lambda a: 1.0)


def add_prefix(g: Game, unit_cost, itype, iid, prestige, grade, enchanter_level, mods_before):
    """Expected (gold-equivalent cost, attempts, seconds) to add a first prefix."""
    it = g.items[itype][iid]
    level = it.get("itemLevel", 1)
    gem = _band(PREFIX_GEM, level)
    if gem is None:
        return None
    eid, eamt = enchant_essence(g, itype, iid, prestige, mods_before)
    per_unit_ess = unit_cost("material", eid) if eid else 0
    gem_cost = unit_cost("material", gem)
    gold = level * 40
    odds = clamp(lua_round((enchanter_level - level) * 2 + grade * 2), 10, 80)
    p = _hit(odds)
    cost, attempts = _markov(lambda a: gold + gem_cost * (1 + FIBO[min(a, 5)]) + eamt * per_unit_ess,
                             lambda a: p, lambda a: 0.0)
    return {"cost": cost, "attempts": attempts, "seconds": attempts * level * 10, "chance%": round(100 * p, 1),
            "gem": g.name("material", gem)}


def add_suffix(g: Game, unit_cost, itype, iid, prestige, grade, enchanter_level, mods_before):
    """Expected (cost, attempts, seconds) to go from no suffix to +1."""
    it = g.items[itype][iid]
    if itype == "equipment" and it.get("itemSlot") == 6:
        return None   # slot 6 can't take a suffix
    level = it.get("itemLevel", 1)
    rune = _band(SUFFIX_RUNE, level)
    if rune is None:
        return None
    eid, eamt = enchant_essence(g, itype, iid, prestige, mods_before)
    per_unit_ess = unit_cost("material", eid) if eid else 0
    rune_cost = unit_cost("material", rune)
    gold = level * 60
    next_min = g.suffixes[1]["minLevel"]

    def p(a):
        eff = lua_round(enchanter_level + 10 + 2 * a + grade * 4)
        return _hit(clamp((eff - next_min) * 2, 10, 95))

    cost, attempts = _markov(lambda a: gold + rune_cost * (1 + FIBO[min(a, 5)]) + eamt * per_unit_ess,
                             p, lambda a: min(a * 4, 100) / 100)
    return {"cost": cost, "attempts": attempts, "seconds": attempts * level * 5, "chance%": round(100 * p(0), 1),
            "rune": g.name("material", rune)}


def enchant_plan(g: Game, unit_cost, itype, iid, prestige, grade, enchanter_level):
    """Cheapest way to reach 1 and 2 modifiers from a plain item.

    Returns {"1": (cost, seconds, route), "2": (...)} with None when impossible."""
    pre0 = add_prefix(g, unit_cost, itype, iid, prestige, grade, enchanter_level, 0)
    suf0 = add_suffix(g, unit_cost, itype, iid, prestige, grade, enchanter_level, 0)
    pre1 = add_prefix(g, unit_cost, itype, iid, prestige, grade, enchanter_level, 1)
    suf1 = add_suffix(g, unit_cost, itype, iid, prestige, grade, enchanter_level, 1)
    one = [(r["cost"], r["seconds"], name) for r, name in ((pre0, "prefix"), (suf0, "+1 suffix")) if r]
    two = []
    if suf0 and pre1:
        two.append((suf0["cost"] + pre1["cost"], suf0["seconds"] + pre1["seconds"], "+1 suffix then prefix"))
    if pre0 and suf1:
        two.append((pre0["cost"] + suf1["cost"], pre0["seconds"] + suf1["seconds"], "prefix then +1 suffix"))
    return {
        "1": min(one) if one else None,
        "2": min(two) if two else None,
        "prefix": pre0,
        "suffix": suf0,
    }


# ---------------------------------------------------------------- map suffix
MAX_ATTEMPTS = 26   # beyond this a failure always breaks (4 * 25 = 100 %)


def max_suffix_for(g: Game, prestige):
    """Highest suffix index reachable by enchanting (canNextSuffix: ascLevel <= prestige)."""
    top = 0
    for n in sorted(k for k in g.suffixes if k > 0):
        asc = g.suffixes[n].get("ascLevel")
        if asc and prestige < asc:
            break
        top = n
    return top


@functools.lru_cache(maxsize=None)
def _suffix_chain(minlevels, grade, enchanter_level, target):
    """Item-independent part of a suffix climb from none to `target`.

    Markov chain over (suffix tier s, attempt counter a). Each attempt:
    success -> (s + 1, a + 1); failure -> break with min(4a, 100) % to
    (max(s - 1, 0), 0), else (s, a + 1). Odds and rune amounts don't depend on
    the item, so the expectations below are shared by every item:
    (attempts at s = 0, attempts at s > 0, sum of minLevel(s) over attempts,
    runes)."""
    A = MAX_ATTEMPTS
    K = 4

    def p_success(s, a):
        eff = lua_round(enchanter_level + 10 + 2 * a + grade * 4)
        return _hit(clamp((eff - minlevels[s + 1]) * 2, 10, 95))

    def cost(s, a):
        return (1.0 if s == 0 else 0.0, 1.0 if s > 0 else 0.0,
                float(minlevels[s]) if s > 0 else 0.0, float(1 + FIBO[min(a, 5)]))

    add = lambda u, v: tuple(x + y for x, y in zip(u, v))
    mul = lambda k, u: tuple(k * x for x in u)
    zero = (0.0,) * K

    # Solved exactly tier by tier, top-down. For tier s+1 we hold
    # E[s+1][a] = A1[a] + B1[a] * X_s with X_s = E[s][0]. For tier s,
    # E[s][a] = P[a] + Q[a] * X_s + R[a] * X_{s-1}  (a break drops to X_{s-1}).
    A1 = [zero] * (A + 1)
    B1 = [0.0] * (A + 1)
    for s in range(target - 1, -1, -1):
        P, Q, R = [zero] * (A + 1), [0.0] * (A + 1), [0.0] * (A + 1)
        for a in range(A, -1, -1):
            p, b = p_success(s, a), min(4 * a, 100) / 100
            f = 1 - p
            nxt = min(a + 1, A)
            if a == A:   # last counter state loops on itself
                den = 1 - f * (1 - b)
                P[a] = mul(1 / den, add(cost(s, a), mul(p, A1[nxt])))
                Q[a] = p * B1[nxt] / den
                R[a] = f * b / den
            else:
                P[a] = add(add(cost(s, a), mul(p, A1[nxt])), mul(f * (1 - b), P[nxt]))
                Q[a] = p * B1[nxt] + f * (1 - b) * Q[nxt]
                R[a] = f * b + f * (1 - b) * R[nxt]
        if s == 0:   # a break at tier 0 stays at tier 0: X_{-1} = X_0
            return mul(1 / (1 - Q[0] - R[0]), P[0])
        # X_s = (P0 + R0 X_{s-1}) / (1 - Q0); substitute to express tier s in X_{s-1}
        inv = 1 / (1 - Q[0])
        A1 = [add(P[a], mul(Q[a] * inv, P[0])) for a in range(A + 1)]
        B1 = [R[a] + Q[a] * inv * R[0] for a in range(A + 1)]
    return zero


def suffix_climb(g: Game, itype, iid, prestige, grade, enchanter_level, target, has_prefix=False):
    """Expected resources to enchant a suffix from none up to `target` (+1, +2, ...).

    Per attempt: gold itemLevel*60 + minLevel(s)*20 (if s > 0), runes
    1 + fibo[min(a, 5)], essence per default.prestigeEnchantMaterial for
    ascended items (rarity bumped once a suffix is on). Returns expectations
    (linear in prices) or None if impossible."""
    it = g.items[itype][iid]
    level = it.get("itemLevel", 1)
    rune = _band(SUFFIX_RUNE, level)
    if rune is None or target <= 0 or target > max_suffix_for(g, prestige):
        return None
    top = max(k for k in g.suffixes)
    minlevels = tuple(g.suffixes[k]["minLevel"] if k > 0 else 0 for k in range(0, top + 1))
    att0, att_pos, minlvl_sum, runes = _suffix_chain(minlevels, grade, enchanter_level, target)
    eid, e0 = enchant_essence(g, itype, iid, prestige, int(has_prefix))
    _, e1 = enchant_essence(g, itype, iid, prestige, 1 + int(has_prefix))
    attempts = att0 + att_pos
    return {"gold": level * 60 * attempts + 20 * minlvl_sum, "runes": runes, "rune_id": rune,
            "essence": e0 * att0 + e1 * att_pos, "essence_id": eid,
            "attempts": attempts, "seconds": attempts * level * 5}


def map_prefix_multiplier(g: Game, map_level, grade, enchanter_level):
    """Expected essence multiplier (1 + prefix.sell) of an enchanted prefix on a
    map: Enchant:enchantPrefix picks by weight among prefixes valid at
    round(L + 5 + 2 * grade)."""
    eff = lua_round(enchanter_level + 5 + grade * 2)
    pool = [(d["weight"], d.get("sell", 0)) for n, d in g.prefixes.items()
            if n > 0 and d.get("weight") and eff >= d.get("minLevel", 0)
            and (d.get("maxLevel") is None or eff <= d["maxLevel"])]
    total = sum(w for w, _ in pool)
    return 1 + sum(w * s for w, s in pool) / total if total else 1.0
