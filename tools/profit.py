"""Merchant profitability calculator: sell value vs. full production cost.

    python3 tools/profit.py [--grade 3] [--luck 0] [--alloc value|full]
                            [--essence-from ESSENCE=MAP[@PRESTIGE] ...]
                            [--hero-hour-cost 0] [--top 30] [--type equipment]
                            [--from-save] [--save-dir DIR | --save FILE] [--slot N]

Cost model (all derived from the decompiled game code):

* Quest run (obj.combat.lootService): pays `gold` to launch and yields the
  expected rewardA1/A2 drops and rewardA3/A4 parcel rolls at the chosen grade.
  The launch cost is shared between all drops in proportion to their sell
  value (--alloc value), or charged in full to each drop (--alloc full,
  pessimistic: "I only farm this for X").
* Map run (obj.Map / obj.combat.Campaign / default.mapEssenceReward): consumes
  the map, yields essence (the prestiged essence for an ascended map) plus the
  loot of every room, the boss and the expected treasure rooms. Loot is
  credited at sell value; what remains is the cost of the essence
  (--alloc full: no credit).
* Craft (obj.Crafter:startCraft / obj.Craft): `cost` gold + ingredients.
  Equipment/map/consumable ingredients must have the same ascension level.
  An ascended craft (prestige p) also costs default.prestigeItemMaterial essence.
* Ascend an existing item (obj.AscendItem): item at p-1 + 4x essence, no gold.
* Sell value: Item:getSellValue (value * rarityMod, ascended value * 2p).
  Each prefix/suffix raises rarity one step (capped at 6, or 8 from rarity 7),
  so only the number of modifiers matters for the price.
* Modifier rolls (Item:determinePrefix/Suffix, default.__craftPrefixOdds/
  __craftSuffixOdds): a fresh craft rolls them from crafter level and craft
  grade; ev_sell / ev_profit are the expected values over those rolls.
  Crafted maps roll too, and their modifiers multiply essence yield.
  An ascended item keeps its modifiers; a modded item needs (4 + mods)x
  essence at its bumped rarity (see ascend_modded_*.csv).
* Enchanter (tools/enchant.py): expected cost of adding a first prefix or a
  +1 suffix to an owned item (Markov chain over the attempt counter).
  best_strategy picks the best of: sell as crafted, or enchant up to 1 or 2
  modifiers (topping up whatever the craft rolled). See enchant_*.csv.
* Map enchanting: a plain crafted map enchanted to suffix +N (essence x
  (1 + stats.atk), up to +16, or *8 on asc-1 maps) and/or a first prefix
  (x (1 + sell)) is another essence source; the cheapest per essence wins.
  The suffix also makes the map's enemies stronger; the grade is kept at
  --grade, so cap it with --map-suffix-max for a more cautious view.

Because maps need essences and give essences, costs are solved by repeated
relaxation until they stop changing.
"""

from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from pathlib import Path

from enchant import PREFIX_GEM, _band, add_prefix, add_suffix, enchant_essence, max_suffix_for, suffix_climb
from gamedata import PRESTIGE_TYPES, ROOT, Game, clamp, load_game, lua_round
from savegame import add_save_args, load_from_args

INF = math.inf
MAX_PRESTIGE = 2
# Maps only go up to ascension 1: normal maps drop asc-1 essences,
# asc-1 maps drop asc-2 essences, there are no asc-2 maps.
MAX_PRESTIGE_BY_TYPE = {"map": 1}


def asc_levels(itype):
    if itype not in PRESTIGE_TYPES:
        return [0]
    return range(MAX_PRESTIGE_BY_TYPE.get(itype, MAX_PRESTIGE) + 1)


# --------------------------------------------------------------- loot model
def expected_fixed_drop(reward, grade_bonus, luck):
    """E[quantity] of lootService.generateNormalItem."""
    lo = int(reward[1] * grade_bonus * 10)   # math.random truncates floats
    hi = int(reward[2] * grade_bonus * 10)
    if hi < lo:
        lo, hi = hi, lo
    vals = [clamp(lua_round((x + luck) / 10), 0, 5) for x in range(lo, hi + 1)]
    return sum(vals) / len(vals)


def expected_parcel(g: Game, pname, grade, luck):
    """{(itemType, id): expected amount} of lootService.generateParcelItem."""
    out = {}
    p = g.parcels.get(pname) if pname else None
    if not p:
        return out
    nil = max(p["nilOdds"] * g.grade_parcel_bonus[grade] - luck, 1)
    total = nil + sum(e["odds"] for e in p["itemList"])
    for e in p["itemList"]:
        prob = e["odds"] / total
        if len(e["id"]) > 1:
            key, amount = (e["id"][0], e["id"][1]), 1
        else:
            key = ("material", e["id"][0])
            a = e.get("amount") or [1]
            if len(a) > 1:
                pairs = list(zip(a[0::2], a[1::2]))
                amount = sum(x * w for x, w in pairs) / sum(w for _, w in pairs)
            else:
                amount = a[0]
        out[key] = out.get(key, 0) + prob * amount
    return out


def quest_loot(g: Game, qid, grade, luck, rare=False):
    q = g.quests[qid]
    fixed = ("rewardB1", "rewardB2") if rare else ("rewardA1", "rewardA2")
    parcels = ("rewardB3", "rewardB4") if rare else ("rewardA3", "rewardA4")
    out = defaultdict(float)
    for k in fixed:
        r = q.get(k)
        if isinstance(r, list) and r and r[0]:
            out[("material", r[0])] += expected_fixed_drop(r, g.grade_bonus[grade], luck)
    for k in parcels:
        for key, amt in expected_parcel(g, q.get(k), grade, luck).items():
            out[key] += amt
    return out


TREASURE_CHANCE = {1: 0, 2: 0, 3: 1, 4: 8, 5: 10}   # obj.Map treasurePerRoomPerGradeChance
TREASURE_ID = [99, 100, 101, 102, 103, 104]


def map_loot(g: Game, mid, grade, luck):
    """Expected room loot of one run (enemies + boss + treasure), excluding essence."""
    m = g.items["map"][mid]
    rooms = m["baseEnemyAmount"] + (-1 if grade <= 2 else 1 if grade >= 4 else 0)
    pool = []
    for e in m.get("enemyList", []):
        pool.extend(range(e[0], e[1] + 1) if isinstance(e, list) else [e])
    out = defaultdict(float)
    n_enemies = rooms - 1
    if pool:
        for qid in pool:
            rare_p = g.quests[qid].get("abRand", 0) / 100
            for rare, w in ((False, 1 - rare_p), (True, rare_p)):
                if w <= 0:
                    continue
                for key, amt in quest_loot(g, qid, grade, luck, rare).items():
                    out[key] += amt * w * n_enemies / len(pool)
    bosses = m.get("bossList", [])
    for b in bosses:
        for key, amt in quest_loot(g, b, grade, luck, bool(m.get("isRareBoss"))).items():
            out[key] += amt / len(bosses)
    treasures = TREASURE_CHANCE[grade] * rooms / 100
    tier = math.ceil(m["itemLevel"] / 10)
    if treasures and tier <= len(TREASURE_ID):   # game indexes past the list -> nil, no treasure
        tid = TREASURE_ID[tier - 1]
        for key, amt in quest_loot(g, tid, grade, luck).items():
            out[key] += amt * treasures
    return dict(out)


def map_essence(g: Game, mid, prestige, grade, outcomes=((1.0, 0, 0),)):
    """Expected essence of one run; `outcomes` = modifier roll distribution of the map."""
    br = g.items["map"][mid].get("baseReward", [])
    half = len(br) // 2
    out = {}
    for i in range(half):
        eid = g.prestiged_essence(br[i], prestige)
        if eid is None:
            continue
        out[("material", eid)] = sum(
            prob * lua_round(g.grade_bonus[grade] * br[i + half] * map_essence_multiplier(g, pf, sf))
            for prob, pf, sf in outcomes)
    return out


# ---------------------------------------------------------- modifier rolls
def roll_chance(odds):
    """P(odds > math.random(1, 100))."""
    return clamp(math.ceil(odds) - 1, 0, 100) / 100


def craft_grade(crafter_level, item_level, ingredient_grade):
    """obj.Craft:startCrafting with every ingredient at `ingredient_grade`."""
    start = clamp(round(1 + (crafter_level - item_level) / 4, 2), 1, 4.5)   # default.itemStartGrade
    mat_avg = ingredient_grade + 0.25
    return clamp(lua_round((start + mat_avg) / 2), 1, 5)


def _eligible(table, eff, prestige=0, need_weight=True):
    out = []
    for n, d in table.items():
        if n <= 0 or (need_weight and not d.get("weight")):
            continue
        if d.get("ascLevel") and prestige < d["ascLevel"]:
            continue
        if eff >= d.get("minLevel", 0) and (d.get("maxLevel") is None or eff <= d["maxLevel"]):
            out.append((n, d))
    return out


def modifier_outcomes(g: Game, itype, iid, crafter_level, ingredient_grade, prestige=0):
    """Outcomes of Item:determinePrefix then determineSuffix on a fresh craft.

    Returns [(prob, prefix_id|0, suffix_id|0)]. Equipment only rolls at craft
    grade > 2 and slot 6 never gets a suffix; maps always roll; consumables
    never do. Ingredients are assumed plain (no prefix/suffix boost)."""
    it = g.items[itype][iid]
    if itype not in ("equipment", "map"):
        return [(1.0, 0, 0)]
    level = it.get("itemLevel", 1)
    grade = craft_grade(crafter_level, level, ingredient_grade)
    if itype == "equipment" and grade <= 2:
        return [(1.0, 0, 0)]

    def eff_level(gr):
        return lua_round(crafter_level + gr * 2 - 4)

    def suffix_outcomes(gr):
        if itype == "equipment" and it.get("itemSlot") == 6:
            return [(1.0, 0)]
        eff = eff_level(gr)
        odds = min((eff - level) * 2, 40)                    # default.__craftSuffixOdds
        pool = _eligible(g.suffixes, eff, prestige)
        p_hit = roll_chance(odds) if pool else 0
        total_w = sum(d["weight"] for _, d in pool) or 1
        return [(1 - p_hit, 0)] + [(p_hit * d["weight"] / total_w, n) for n, d in pool if p_hit]

    eff = eff_level(grade)
    odds = min((eff - level) * 2, 25)                        # default.__craftPrefixOdds
    pool = _eligible(g.prefixes, eff)
    p_hit = roll_chance(odds) if pool else 0
    total_w = sum(d["weight"] for _, d in pool) or 1
    out = []
    for ps, sx in suffix_outcomes(grade):
        out.append(((1 - p_hit) * ps, 0, sx))
    for n, d in pool:
        pw = p_hit * d["weight"] / total_w
        if pw <= 0:
            continue
        new_grade = clamp(lua_round(grade + d["sell"] * 2), 1, 5)
        for ps, sx in suffix_outcomes(new_grade):
            out.append((pw * ps, n, sx))
    return [o for o in out if o[0] > 0]


def map_essence_multiplier(g: Game, prefix, suffix):
    """Map:applyPrefix / applySuffix effect on essenceBase."""
    m = 1.0
    if prefix:
        m *= 1 + g.prefixes[prefix].get("sell", 0)
    if suffix:
        m *= 1 + g.suffixes[suffix].get("stats", {}).get("atk", 0)
    return m


# ------------------------------------------------------------- cost solver
class Solver:
    def __init__(self, g: Game, grade=3, luck=0, alloc="value", hero_hour_cost=0.0, essence_from=None,
                 crafter_level=60, map_mods=True, enchanter_level=60, map_enchant=True, map_suffix_max=None):
        self.g, self.grade, self.luck, self.alloc = g, grade, luck, alloc
        self.crafter_level = crafter_level
        self.map_mods = map_mods
        self.enchanter_level = enchanter_level
        self.map_enchant = map_enchant and enchanter_level > 0
        self.map_suffix_max = map_suffix_max
        self.essence_choice: dict = {}   # essence id -> (map id, prestige, variant label)
        self._enchant_cache: dict = {}

        self.hero_hour_cost = hero_hour_cost
        self.essence_from = essence_from or {}   # essence id -> (map id, prestige)
        self.cost: dict = {}      # (type, id, p) -> best unit cost
        self.how: dict = {}       # (type, id, p) -> description of best method
        self.essence_sources: dict = defaultdict(list)  # essence key -> [(map, p, unit cost)]
        self._quest_sources = self._build_quest_sources()

    def enchant_step(self, kind, itype, iid, p, grade, mods_before):
        """add_prefix / add_suffix at final prices, memoized (call after solve())."""
        key = (kind, itype, iid, p, grade, mods_before)
        if key not in self._enchant_cache:
            fn = add_prefix if kind == "prefix" else add_suffix
            self._enchant_cache[key] = fn(self.g, lambda t, i: self.get(t, i, 0), itype, iid, p, grade,
                                          self.enchanter_level, mods_before)
        return self._enchant_cache[key]

    def sv(self, itype, iid, p=0):
        try:
            return self.g.sell_value(itype, iid, p)
        except KeyError:
            return 0

    # quests have a fixed gold cost, so their unit costs are computed once
    def _build_quest_sources(self):
        src = defaultdict(list)
        variants = [(qid, False) for qid in self.g.quests]
        # Rare variant (nameB/goldB, rewardB*): only offered at random, but the
        # only quest source of boss trophies.
        variants += [(qid, True) for qid, q in self.g.quests.items() if q.get("rewardB1") or q.get("rewardB3")]
        for qid, rare in variants:
            q = self.g.quests[qid]
            gold = (q.get("goldB", q.get("gold")) if rare else q.get("gold", 0)) or 0
            qname = (q.get("nameB") or q["name"]) + (" [rare]" if rare else "")
            time_h = q.get("time", 0) * self.g.grade_time[self.grade] / 3600
            run_cost = gold + time_h * self.hero_hour_cost
            loot = quest_loot(self.g, qid, self.grade, self.luck, rare)
            total_value = sum(a * self.sv(*k) for k, a in loot.items())
            for key, amt in loot.items():
                if amt <= 0:
                    continue
                if self.alloc == "full" or total_value == 0:
                    unit = run_cost / amt
                else:
                    unit = run_cost * self.sv(*key) / total_value
                src[key].append((unit, f"quest {qname} ({gold}g, {amt:.2f}/run)"))
        return src

    def _map_variants(self, mid, p):
        """[(label, extra_cost_fn, modifier outcomes, enchant seconds)] for one map.

        "as crafted": the map with its random craft rolls, no enchanting.
        "+N suffix[ & prefix]": a plain crafted map enchanted to suffix +N
        (and a first prefix), costed with tools/enchant.py."""
        g = self.g
        base = (modifier_outcomes(g, "map", mid, self.crafter_level, self.grade, p)
                if self.map_mods else [(1.0, 0, 0)])
        variants = [("as crafted", lambda: 0.0, base, 0.0)]
        if not self.map_enchant:
            return variants
        level = g.items["map"][mid].get("itemLevel", 1)
        grade = craft_grade(self.crafter_level, level, self.grade)
        top = max_suffix_for(g, p)
        if self.map_suffix_max is not None:
            top = min(top, self.map_suffix_max)
        eff = lua_round(self.enchanter_level + 5 + grade * 2)   # Enchant:enchantPrefix pool level
        pool = [(d["weight"], n) for n, d in g.prefixes.items()
                if n > 0 and d.get("weight") and eff >= d.get("minLevel", 0)
                and (d.get("maxLevel") is None or eff <= d["maxLevel"])]
        pool_w = sum(w for w, _ in pool)
        unit = lambda t, i: self.get(t, i, 0)
        gem_id = _band(PREFIX_GEM, level)

        def prefix_components(mods_before):
            """add_prefix cost is linear in prices: split it into gold, gems, essence units."""
            zero = lambda t, i: 0.0
            only = lambda target: (lambda t, i: 1.0 if i == target else 0.0)
            base = add_prefix(g, zero, "map", mid, p, grade, self.enchanter_level, mods_before)
            if base is None:
                return None
            eid, _ = enchant_essence(g, "map", mid, p, mods_before)
            gems = add_prefix(g, only(gem_id), "map", mid, p, grade, self.enchanter_level, mods_before)["cost"] - base["cost"]
            ess = (add_prefix(g, only(eid), "map", mid, p, grade, self.enchanter_level, mods_before)["cost"] - base["cost"]
                   if eid else 0.0)
            return base["cost"], gems, ess, eid

        prefix_comp = {m: prefix_components(m) for m in (0, 1)}
        for k in range(0, top + 1):
            climb = suffix_climb(g, "map", mid, p, grade, self.enchanter_level, k) if k else None
            if k and climb is None:
                continue
            for with_prefix in (False, True):
                if k == 0 and not with_prefix:
                    continue
                if with_prefix and not pool_w:
                    continue

                def extra(climb=climb, with_prefix=with_prefix, k=k):
                    total = 0.0
                    if climb:
                        total += climb["gold"] + climb["runes"] * unit("material", climb["rune_id"])
                        if climb["essence"]:
                            total += climb["essence"] * unit("material", climb["essence_id"])
                    if with_prefix:
                        comp = prefix_comp[int(k > 0)]
                        if comp is None:
                            return INF
                        gold, gems, ess, eid = comp
                        total += gold + gems * unit("material", gem_id)
                        if ess:
                            total += ess * unit("material", eid)
                    return total

                secs = (climb["seconds"] if climb else 0) + (level * 10 if with_prefix else 0)
                if with_prefix:
                    outcomes = [(w / pool_w, n, k) for w, n in pool]
                else:
                    outcomes = [(1.0, 0, k)]
                label = (f"+{k} suffix" if k else "") + (" & " if k and with_prefix else "") + ("prefix" if with_prefix else "")
                variants.append((label, extra, outcomes, secs))
        return variants

    def get(self, itype, iid, p=0):
        if itype not in PRESTIGE_TYPES:
            p = 0
        return self.cost.get((itype, iid, p), INF)

    def _try(self, key, value, how):
        if value < self.cost.get(key, INF) - 1e-9:
            self.cost[key] = value
            self.how[key] = how
            return True
        return False

    def solve(self, max_iter=500):
        g = self.g
        for key, sources in self._quest_sources.items():
            for unit, how in sources:
                self._try((key[0], key[1], 0), unit, how)
        map_loot_cache = {mid: map_loot(g, mid, self.grade, self.luck) for mid in g.items["map"]}
        # essence yield of each variant doesn't depend on prices: compute it once
        map_variants = {}
        for mid in g.items["map"]:
            for p in asc_levels("map"):
                map_variants[(mid, p)] = [(label, extra_fn, map_essence(g, mid, p, self.grade, outcomes), secs)
                                          for label, extra_fn, outcomes, secs in self._map_variants(mid, p)]
        for _ in range(max_iter):
            changed = False
            # crafted items / materials at every ascension level
            for itype, entries in g.items.items():
                levels = asc_levels(itype)
                for iid, it in entries.items():
                    rec = g.recipe(itype, iid)
                    for p in levels:
                        if p > 0 and it.get("lockPrestige"):
                            continue
                        if rec:
                            total = it.get("cost", 0) or 0
                            for mtype, mid, amt in rec:
                                total += amt * self.get(mtype, mid, p)
                            if p > 0:
                                eid, eamt = g.essence_for_ascension(itype, iid, p, upgrade=False)
                                total += eamt * self.get("material", eid)
                            if total < INF:
                                changed |= self._try((itype, iid, p), total, f"craft ({crafter_name(g, it)})" +
                                                     (f" at asc {p}" if p else ""))
                        if p > 0:
                            prev = self.get(itype, iid, p - 1)
                            eid, eamt = g.essence_for_ascension(itype, iid, p, upgrade=True)
                            total = prev + eamt * self.get("material", eid)
                            if total < INF:
                                changed |= self._try((itype, iid, p), total,
                                                     f"ascend asc{p - 1} item (+{eamt}x {g.name('material', eid)})")
            # essence from map runs
            self.essence_sources = defaultdict(list)
            for mid, m in g.items["map"].items():
                for p in asc_levels("map"):
                    map_cost = self.get("map", mid, p)
                    if map_cost == INF:
                        continue
                    run_cost = map_cost + m.get("baseMapTime", 0) / 3600 * self.hero_hour_cost
                    credit = 0 if self.alloc == "full" else sum(a * self.sv(*k) for k, a in map_loot_cache[mid].items())
                    # loot found only in maps is priced at its sell value
                    # (the gold you give up by using it instead of selling it)
                    for lkey, lamt in map_loot_cache[mid].items():
                        if lkey[0] in g.items and lkey[1] in g.items[lkey[0]] and lamt > 0:
                            changed |= self._try((lkey[0], lkey[1], 0), self.sv(*lkey),
                                                 f"map loot {m['name']} (valued at sell price)")
                    ess_value_of = lambda ess: sum(a * self.sv(*k) for k, a in ess.items()) or 1
                    best_per_essence = {}
                    for label, extra_fn, ess, secs in map_variants[(mid, p)]:
                        if not ess:
                            continue
                        extra = extra_fn()
                        if extra == INF:
                            continue
                        ess_value = ess_value_of(ess)
                        net = max(run_cost + extra + secs / 3600 * self.hero_hour_cost - credit, 0)
                        for key, amt in ess.items():
                            if amt <= 0:
                                continue
                            unit = net * self.sv(*key) / ess_value if len(ess) > 1 else net / amt
                            cur = best_per_essence.get(key)
                            if label == "as crafted" or cur is None or unit < cur[0]:
                                if label == "as crafted":
                                    self.essence_sources[key[1]].append((mid, p, unit, amt, run_cost, credit, label))
                                if cur is None or unit < cur[0]:
                                    best_per_essence[key] = (unit, amt, label, run_cost + extra)
                    for key, (unit, amt, label, total_cost) in best_per_essence.items():
                        if label != "as crafted":
                            self.essence_sources[key[1]].append((mid, p, unit, amt, total_cost, credit, label))
                        forced = self.essence_from.get(key[1])
                        if forced and forced != (mid, p):
                            continue
                        if self._try((key[0], key[1], 0), unit,
                                     f"map {m['name']}" + (f" asc{p}" if p else "") +
                                     ("" if label == "as crafted" else f" enchanted {label}") +
                                     f" ({amt:.0f} essence/run)"):
                            changed = True
                            self.essence_choice[key[1]] = (mid, p, label)
            if not changed:
                break
        return self


def crafter_name(g, it):
    c = g.crafters.get(it.get("crafterID"))
    return c["name"] if c else "?"


# ------------------------------------------------------- enchant strategies
def enchant_strategies(s: Solver, itype, iid, p, outcomes, sell_by_mods):
    """Expected value of "take the item as it comes out, then enchant up to k
    modifiers" for k = 1, 2. Returns {k: (ev_sell - ev_enchant_cost, ev_seconds)}."""
    g = s.g
    if itype != "equipment" or s.enchanter_level <= 0:
        return {}
    it = g.items[itype][iid]
    grade = craft_grade(s.crafter_level, it.get("itemLevel", 1), s.grade)
    def step(kind, mods_before):
        return s.enchant_step(kind, itype, iid, p, grade, mods_before)

    out = {}
    for k in (1, 2):
        total_value, total_time, feasible = 0.0, 0.0, True
        for prob, pf, sf in outcomes:
            has_p, has_s = bool(pf), bool(sf)
            cost = secs = 0.0
            mods = has_p + has_s
            # add the cheapest missing modifiers until k is reached
            while mods < k:
                options = []
                if not has_p and step("prefix", mods):
                    options.append(("p", step("prefix", mods)))
                if not has_s and step("suffix", mods):
                    options.append(("s", step("suffix", mods)))
                if not options:
                    feasible = False
                    break
                which, r = min(options, key=lambda o: o[1]["cost"])
                cost += r["cost"]
                secs += r["seconds"]
                has_p |= which == "p"
                has_s |= which == "s"
                mods += 1
            if not feasible:
                break
            total_value += prob * (sell_by_mods[mods] - cost)
            total_time += prob * secs
        if feasible:
            out[k] = (total_value, total_time)
    return out


# ------------------------------------------------------------------ report
def build_rows(s: Solver, types, owned=None):
    g = s.g
    rows = []
    for itype in types:
        levels = asc_levels(itype)
        for iid, it in g.items[itype].items():
            for p in levels:
                key = (itype, iid, p)
                cost = s.cost.get(key, INF)
                if cost == INF:
                    continue
                how = s.how.get(key, "")
                sell = g.sell_value(itype, iid, p)
                sell_by_mods = [g.sell_value(itype, iid, p, m) for m in range(3)]
                # Only a fresh craft rolls modifiers; an ascended plain item stays plain.
                if how.startswith("craft"):
                    outcomes = modifier_outcomes(g, itype, iid, s.crafter_level, s.grade, p)
                else:
                    outcomes = [(1.0, 0, 0)]
                p_pre = sum(o[0] for o in outcomes if o[1])
                p_suf = sum(o[0] for o in outcomes if o[2])
                p_two = sum(o[0] for o in outcomes if o[1] and o[2])
                ev_sell = sum(o[0] * sell_by_mods[bool(o[1]) + bool(o[2])] for o in outcomes)
                profit = sell - cost
                ev_profit = ev_sell - cost
                strategies = {"sell as crafted": (ev_profit, 0.0)}
                for k, (net_sell, secs) in enchant_strategies(s, itype, iid, p, outcomes, sell_by_mods).items():
                    strategies[f"enchant to {k} mod" + ("s" if k > 1 else "")] = (net_sell - cost, secs)
                best_name, (best_profit, best_secs) = max(strategies.items(), key=lambda kv: kv[1][0])
                ench1 = strategies.get("enchant to 1 mod")
                ench2 = strategies.get("enchant to 2 mods")
                run_h = (it.get("runTime") or 0) / 3600
                if p and how.startswith("ascend"):
                    run_h = it.get("itemLevel", 1) * 60 / 3600    # default.itemAscendTime
                rows.append({
                    "type": itype, "id": iid, "name": it["name"], "asc": p,
                    "level": it.get("itemLevel"), "rarity": it.get("rarity"),
                    "crafter": crafter_name(g, it) if it.get("crafterID") else "",
                    "sell": sell, "sell_1mod": sell_by_mods[1], "sell_2mod": sell_by_mods[2],
                    "p_prefix%": round(100 * p_pre, 1), "p_suffix%": round(100 * p_suf, 1),
                    "p_both%": round(100 * p_two, 1), "ev_sell": round(ev_sell, 1),
                    "cost": round(cost, 2), "profit": round(profit, 2),
                    "margin%": round(100 * profit / cost, 1) if cost > 0 else "",
                    "ev_profit": round(ev_profit, 2),
                    "ev_margin%": round(100 * ev_profit / cost, 1) if cost > 0 else "",
                    "craft_min": round(run_h * 60, 1),
                    "profit_per_craft_hour": round(profit / run_h, 1) if run_h else "",
                    "ev_profit_per_craft_hour": round(ev_profit / run_h, 1) if run_h else "",
                    "ench1_profit": round(ench1[0], 2) if ench1 else "",
                    "ench2_profit": round(ench2[0], 2) if ench2 else "",
                    "best_strategy": best_name, "best_profit": round(best_profit, 2),
                    "best_margin%": round(100 * best_profit / cost, 1) if cost > 0 else "",
                    "enchant_min": round(best_secs / 60, 1),
                    "how": how,
                })
                if owned is not None:
                    rows[-1]["owned"] = owned.get(key, 0)
    return rows


def build_ascend_modded_rows(s: Solver):
    """Should I ascend the item I already hold? Gain of one upgrade (AscendItem)
    for 0, 1 or 2 modifiers: sell after - sell before - essence at cost."""
    g = s.g
    rows = []
    for itype in ("equipment", "consumable"):
        for iid, it in g.items[itype].items():
            if it.get("lockPrestige") or (itype, iid, 0) not in s.cost:
                continue
            for p in range(1, MAX_PRESTIGE + 1):
                row = {"type": itype, "id": iid, "name": it["name"], "level": it.get("itemLevel"),
                       "rarity": it.get("rarity"), "from_asc": p - 1, "to_asc": p}
                for m in range(3 if itype == "equipment" else 1):
                    eid, eamt = g.essence_for_ascension(itype, iid, p, upgrade=True, mods=m)
                    ecost = eamt * s.get("material", eid)
                    gain = g.sell_value(itype, iid, p, m) - g.sell_value(itype, iid, p - 1, m) - ecost
                    row[f"essence_{m}mod"] = eamt
                    row[f"gain_{m}mod"] = round(gain, 1)
                row["essence"] = g.name("material", eid)
                rows.append(row)
    return rows


def build_enchant_rows(s: Solver):
    """Per equipment and ascension: odds, attempts, cost and time of a first
    prefix / +1 suffix on a plain item, and the price gain."""
    g = s.g
    rows = []
    for iid, it in g.items["equipment"].items():
        for p in asc_levels("equipment"):
            if (("equipment", iid, p) not in s.cost):
                continue
            grade = craft_grade(s.crafter_level, it.get("itemLevel", 1), s.grade)
            gain1 = g.sell_value("equipment", iid, p, 1) - g.sell_value("equipment", iid, p, 0)
            row = {"id": iid, "name": it["name"], "asc": p, "level": it.get("itemLevel"), "rarity": it.get("rarity"),
                   "item_grade": grade, "sell": g.sell_value("equipment", iid, p), "gain_1mod": gain1,
                   "gain_2mod": g.sell_value("equipment", iid, p, 2) - g.sell_value("equipment", iid, p, 0)}
            for kind in ("prefix", "suffix"):
                r = s.enchant_step(kind, "equipment", iid, p, grade, 0)
                row[f"{kind}_chance%"] = r["chance%"] if r else ""
                row[f"{kind}_attempts"] = round(r["attempts"], 2) if r else ""
                row[f"{kind}_cost"] = round(r["cost"], 1) if r else ""
                row[f"{kind}_min"] = round(r["seconds"] / 60, 1) if r else ""
                row[f"{kind}_net"] = round(gain1 - r["cost"], 1) if r else ""
            rows.append(row)
    return rows


def parse_essence_from(values, g: Game):
    out = {}
    by_name = {m["name"].lower(): mid for mid, m in g.items["material"].items()}
    maps_by_name = {m["name"].lower(): mid for mid, m in g.items["map"].items()}
    for v in values or []:
        ess, src = v.split("=", 1)
        mp, _, p = src.partition("@")
        eid = int(ess) if ess.isdigit() else by_name[ess.lower()]
        mid = int(mp) if mp.isdigit() else maps_by_name[mp.lower()]
        out[eid] = (mid, int(p or 0))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grade", type=int, default=3, choices=[1, 2, 3, 4, 5],
                    help="quest/map grade (3 = gradeBonus 1.0, the neutral case)")
    ap.add_argument("--luck", type=float, default=0, help="party luck")
    ap.add_argument("--alloc", choices=["value", "full"], default="value",
                    help="how a run's cost is split between its drops")
    ap.add_argument("--essence-from", action="append", metavar="ESSENCE=MAP[@ASC]",
                    help="force an essence source, e.g. 'Forest Essence=Hard Tuvale Map' or '33=2@0'")
    ap.add_argument("--hero-hour-cost", type=float, default=0,
                    help="gold charged per hour of quest/map run time (0 = time is free)")
    ap.add_argument("--type", action="append", choices=["equipment", "consumable", "map", "material"],
                    help="item types in the ranking (default: equipment, consumable, map)")
    ap.add_argument("--crafter-level", type=int, default=None,
                    help="crafter level (asc crafts: crafter prestige level); drives modifier odds and craft grade "
                         "(default 60, or the lowest crafter level in the save with --from-save)")
    ap.add_argument("--enchanter-level", type=int, default=None,
                    help="Enchanter level (asc items: its prestige level); 0 disables enchant strategies "
                         "(default 60, or the save's Enchanter level with --from-save)")
    ap.add_argument("--no-map-enchant", action="store_true",
                    help="don't consider enchanting maps (suffix tiers / prefix) for essence")
    ap.add_argument("--map-suffix-max", type=int, default=None,
                    help="highest map suffix tier to enchant to (suffixes also make enemies stronger)")
    ap.add_argument("--no-map-mods", action="store_true",
                    help="ignore prefix/suffix rolls on crafted maps when computing essence yield")
    ap.add_argument("--sort", default="best_profit",
                    choices=["best_profit", "best_margin%", "ev_profit", "ev_margin%", "ev_profit_per_craft_hour",
                             "profit", "margin%", "profit_per_craft_hour"])
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--out", default=ROOT / "reports")
    ap.add_argument("--from-save", action="store_true",
                    help="read the player's save: crafter/Enchanter levels and an 'owned' column "
                         "(implied by --save-dir / --save)")
    add_save_args(ap)
    args = ap.parse_args()

    g = load_game()
    owned = None
    if args.from_save or args.save_dir or args.save:
        try:
            sv = load_from_args(args)
        except FileNotFoundError as e:
            ap.error(str(e))
        owned = sv.owned()
        base = [c["level"] for cid, c in sv.crafters.items() if cid <= 6 and c.get("level")]
        if args.crafter_level is None and base:
            args.crafter_level = min(base)
        if args.enchanter_level is None:
            args.enchanter_level = sv.crafters.get(7, {}).get("level", 0)
        print(f"save: {sv.source} (copy {sv.path}), crafter levels "
              + ", ".join(f"{g.crafters.get(cid, {}).get('name', cid)} {c.get('level')}/asc{c.get('prestigeLevel', 0)}"
                          for cid, c in sorted(sv.crafters.items())))
    if args.crafter_level is None:
        args.crafter_level = 60
    if args.enchanter_level is None:
        args.enchanter_level = 60
    s = Solver(g, args.grade, args.luck, args.alloc, args.hero_hour_cost,
               parse_essence_from(args.essence_from, g), args.crafter_level, not args.no_map_mods,
               args.enchanter_level, not args.no_map_enchant, args.map_suffix_max).solve()
    types = args.type or ["equipment", "consumable", "map"]
    rows = build_rows(s, types, owned)
    rows.sort(key=lambda r: (r[args.sort] if r[args.sort] != "" else -INF), reverse=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tag = f"g{args.grade}_{args.alloc}"
    with open(out / f"profit_{tag}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    ess_rows = []
    for eid, srcs in sorted(s.essence_sources.items()):
        for mid, p, unit, amt, run_cost, credit, label in sorted(srcs, key=lambda x: x[2]):
            ess_rows.append({"essence": g.name("material", eid), "essence_id": eid,
                             "map": g.items["map"][mid]["name"], "map_id": mid, "map_asc": p,
                             "enchant": label, "essence_per_run": round(amt, 1),
                             "map_cost": round(run_cost, 1), "loot_credit": round(credit, 1),
                             "cost_per_essence": round(unit, 2),
                             "chosen": "yes" if s.essence_choice.get(eid) == (mid, p, label) else ""})
    with open(out / f"essence_sources_{tag}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(ess_rows[0].keys()))
        w.writeheader()
        w.writerows(ess_rows)

    asc_rows = build_ascend_modded_rows(s)
    with open(out / f"ascend_modded_{tag}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(asc_rows[0].keys()))
        w.writeheader()
        w.writerows(asc_rows)

    ench_rows = build_enchant_rows(s)
    with open(out / f"enchant_{tag}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(ench_rows[0].keys()))
        w.writeheader()
        w.writerows(ench_rows)

    unpriced = [(t, i) for t in types for i in g.items[t] if (t, i, 0) not in s.cost]
    print(f"grade {args.grade}, luck {args.luck}, alloc {args.alloc}, hero hour cost {args.hero_hour_cost}, "
          f"crafter level {args.crafter_level}, enchanter level {args.enchanter_level}, "
          f"map modifiers {'on' if not args.no_map_mods else 'off'}, map enchanting "
          f"{'off' if args.no_map_enchant or not args.enchanter_level else 'on'}"
          + (f" (max suffix +{args.map_suffix_max})" if args.map_suffix_max is not None else ""))
    print(f"{len(rows)} priced (item, ascension) rows; {len(unpriced)} items without a known source at asc 0\n")
    print("Essence: cheapest source")
    for eid in sorted(s.essence_sources):
        print(f"  {g.name('material', eid):22} {s.cost.get(('material', eid, 0), INF):8.2f} g  via {s.how.get(('material', eid, 0), '-')}")
    print(f"\nTop {args.top} by {args.sort}:")
    hdr = (f"{'name':30} {'asc':>3} {'lvl':>3} {'sell':>8} {'+1 mod':>8} {'+2 mod':>8} {'cost':>8} "
           f"{'ev_profit':>9} {'best_profit':>11} {'best_marg%':>10}  {'best strategy':18} how")
    print(hdr)
    for r in rows[:args.top]:
        print(f"{r['name'][:30]:30} {r['asc']:>3} {r['level']:>3} {r['sell']:>8} {r['sell_1mod']:>8} {r['sell_2mod']:>8} "
              f"{r['cost']:>8.0f} {r['ev_profit']:>9.0f} {r['best_profit']:>11.0f} {str(r['best_margin%']):>10}  "
              f"{r['best_strategy']:18} {r['how']}")
    print(f"\nFull tables in {out}: profit_{tag}.csv, enchant_{tag}.csv, essence_sources_{tag}.csv, ascend_modded_{tag}.csv")


if __name__ == "__main__":
    main()
