"""Merchant combat simulator: parties, skills and gear against quest enemies.

Fights run the game's own decompiled combat code (tools/sim/harness.lua) in
Lua 5.1, so stats, passives, skills, effects, hit/crit/defence and turn order
are exactly the game's. Heroes come from your save (tools/savegame.py).

    python3 tools/combat.py roster
    python3 tools/combat.py fight  --quest 80 --front 1,9 --back 6,2 [-n 500] [--rare]
    python3 tools/combat.py damage --hero 5 --quest 80 [-n 300]
    python3 tools/combat.py solo   [--heroes all] [--quests 1-104] [-n 100]
    python3 tools/combat.py skills --hero 5 --quest 80 [--front ... --back ...]   # best rotation + passive
    python3 tools/combat.py gear   --hero 5 --quest 80 [--pool owned|catalog] [--item-grade 5] [--asc 0]
    python3 tools/combat.py party  --quest 80 [--size 6] [--heroes all]
    python3 tools/combat.py map    --map 22 [--asc 1] --front 1,9,12 --back 6,2,5 [-n 100]
    python3 tools/combat.py map    --map inv:2 --front ... --back ...           # a map you own
    python3 tools/combat.py party  --map 22 --n-quick 15 --n-final 100          # best party for a map run
    python3 tools/combat.py maps   --front 1,9,12 --back 6,2,5 [-n 20]           # every map, asc 0 and 1
    python3 tools/combat.py map    --map 22 --front ... --back ... --scrolls 62,63,69   # with scrolls
    python3 tools/combat.py scrolls --map 22 --front ... --back ...                # best 3-scroll loadout

Heroes are referred to by their save id (see `roster`). Every evaluation uses
the same seeds for every candidate (common random numbers), so comparisons
are fair even with few fights.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from savegame import add_save_args, load_from_args  # noqa: E402
from sim.engine import Sim  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"


# ---------------------------------------------------------------- evaluation
def evaluate(sim: Sim, quest, front, back, n=200, rare=False, amount=1, seed0=1):
    """Monte-Carlo summary of n fights with seeds seed0..seed0+n-1."""
    wins, turns, turns_win, grades, enemy_frac, hp_frac = 0, [], [], [], [], []
    per_hero = defaultdict(lambda: {"dmg": 0.0, "taken": 0.0, "heal": 0.0, "deaths": 0, "skillDmg": defaultdict(float),
                                    "skillUses": defaultdict(float)})
    for k in range(n):
        r = sim.fight(quest, front, back, seed=seed0 + k, is_rare=rare, amount=amount)
        turns.append(r["turns"])
        if r["won"]:
            wins += 1
            turns_win.append(r["turns"])
            grades.append(r["grade"])
        enemy_frac.append(1 - max(r["enemyHP"], 0) / r["enemyMaxHP"])
        hp_frac.append(sum(max(h["hp"], 0) for h in r["heroes"]) / sum(h["maxHP"] for h in r["heroes"]))
        for h in r["heroes"]:
            ph = per_hero[h["slot"]]
            ph["name"], ph["class"] = h["name"], h["class"]
            ph["dmg"] += h["physicalDmgDealt"] + h["magicDmgDealt"]
            ph["taken"] += h["dmgTaken"]
            ph["heal"] += h["healingDone"]
            ph["deaths"] += 1 if h["dead"] else 0
            for sk, v in (h["skillDmg"] or {}).items():
                ph["skillDmg"][sk] += v
            for sk, v in (h["skillUses"] or {}).items():
                ph["skillUses"][sk] += v
    win = wins / n
    out = {
        "n": n, "win": win, "turns": st.mean(turns), "turns_win": st.mean(turns_win) if turns_win else None,
        "grade": st.mean(grades) if grades else 0, "enemy_dmg": st.mean(enemy_frac), "hp_left": st.mean(hp_frac),
        "heroes": {slot: {**v, "dmg": v["dmg"] / n, "taken": v["taken"] / n, "heal": v["heal"] / n,
                          "death_rate": v["deaths"] / n,
                          "skillDmg": {k: x / n for k, x in v["skillDmg"].items()},
                          "skillUses": {k: x / n for k, x in v["skillUses"].items()}}
                   for slot, v in per_hero.items()},
    }
    out["score"] = score(out)
    return out


SCROLL_IDS = list(range(60, 70))   # consumables with scrollsData behaviour (70 has no item)


def parse_scrolls(spec):
    """'61,63,69@1' -> [{"id": 61, "prestigeLevel": 0}, ...] (max 3 slots, as in the game UI)."""
    if not spec:
        return None
    out = []
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        sid, _, asc = part.partition("@")
        out.append({"id": int(sid), "prestigeLevel": int(asc or 0)})
    if len(out) > 3:
        raise SystemExit("a map takes at most 3 scrolls")
    return out


def scroll_names(sim, scrolls):
    if not scrolls:
        return "none"
    return ", ".join(sim.g.itemData.consumable[sc["id"]].name + (f" asc{sc['prestigeLevel']}" if sc["prestigeLevel"] else "")
                     for sc in scrolls)


def evaluate_map(sim, map_spec, front, back, n=100, seed0=1, scrolls=None):
    """Monte-Carlo summary of n map runs (each seed = a new layout and new fights)."""
    from gamedata import load_game
    global _GAME
    try:
        _GAME
    except NameError:
        _GAME = load_game()
    g = _GAME
    wins, cleared, grades, times, hp_left = 0, [], [], [], []
    fail_room = defaultdict(int)
    escapes = 0
    charges = defaultdict(float)
    loot_value, essence = [], defaultdict(float)
    per_hero = defaultdict(lambda: {"dmg": 0.0, "taken": 0.0, "heal": 0.0, "deaths": 0,
                                    "skillDmg": defaultdict(float), "skillUses": defaultdict(float)})
    rooms = []
    errors = []
    for k in range(n):
        try:
            r = sim.map_run(map_spec, front, back, seed=seed0 + k, scrolls=scrolls)
        except Exception as e:   # the game code itself failed (e.g. a map that can't be generated)
            errors.append(str(e).splitlines()[0])
            continue
        rooms.append(r["rooms"])
        escapes += 1 if r.get("escaped") else 0
        for sc in r.get("scrollsUsed") or []:
            charges[sc["id"]] += sc["chargesUsed"]
        cleared.append((r["cleared"] + r.get("lastEnemyRemoved", 0)) / r["rooms"])
        times.append(r["time"])
        if r["won"]:
            wins += 1
            grades.append(r["grade"])
        else:
            lost = next((c for c in r["combats"] if c["status"] == 2), None)
            if lost:
                fail_room[lost["name"] + (" (rare)" if lost["isRare"] else "")] += 1
        value = 0.0
        for it in r["rewards"]:
            itype, iid, amt = it["itemType"], it["itemID"], it["amount"]
            try:
                value += g.sell_value(itype, iid, it.get("prestigeLevel", 0) or 0) * (amt if itype == "material" else 1)
            except KeyError:
                pass
            if itype == "material" and g.items["material"].get(iid, {}).get("subType") == "essence":
                essence[g.name("material", iid)] += amt
        loot_value.append(value)
        hp_left.append(sum(max(h["hp"], 0) for h in r["heroes"]) / sum(h["maxHP"] for h in r["heroes"]))
        for h in r["heroes"]:
            ph = per_hero[h["slot"]]
            ph["name"] = h["name"]
            ph["dmg"] += h["physicalDmgDealt"] + h["magicDmgDealt"]
            ph["taken"] += h["dmgTaken"]
            ph["heal"] += h["healingDone"]
            ph["deaths"] += 1 if h["dead"] else 0
            for sk, v in (h["skillDmg"] or {}).items():
                ph["skillDmg"][sk] += v
            for sk, v in (h["skillUses"] or {}).items():
                ph["skillUses"][sk] += v
    if not rooms:
        raise RuntimeError(f"all {n} runs failed in game code: {errors[0]}")
    n_ok = len(rooms)
    n = n_ok
    out = {
        "errors": len(errors), "error": errors[0] if errors else "",
        "escaped": escapes / n_ok, "charges_used": {k: v / n_ok for k, v in charges.items()},
        "n": n, "win": wins / n, "cleared": st.mean(cleared), "rooms": st.mean(rooms),
        "grade": st.mean(grades) if grades else 0, "time_h": st.mean(times) / 3600,
        "hp_left": st.mean(hp_left), "loot_value": st.mean(loot_value),
        "essence": {k: v / n for k, v in essence.items()},
        "fail_room": dict(sorted(fail_room.items(), key=lambda kv: -kv[1])),
        "heroes": {slot: {**v, "dmg": v["dmg"] / n, "taken": v["taken"] / n, "heal": v["heal"] / n,
                          "death_rate": v["deaths"] / n,
                          "skillDmg": {k: x / n for k, x in v["skillDmg"].items()},
                          "skillUses": {k: x / n for k, x in v["skillUses"].items()}}
                   for slot, v in per_hero.items()},
    }
    # win first, then how far the party gets, then grade (more essence/loot), then HP left
    out["score"] = out["win"] * 1e6 + out["cleared"] * 1e4 + out["grade"] * 100 + out["hp_left"] * 5
    return out


def fmt_map(ev):
    ess = ", ".join(f"{v:.0f} {k}" for k, v in ev["essence"].items()) or "none"
    return (f"win {100 * ev['win']:5.1f}%  progress {100 * ev['cleared']:5.1f}% of {ev['rooms']:.1f} rooms  "
            f"grade {ev['grade']:.2f}  time {ev['time_h']:.2f} h  party HP left {100 * ev['hp_left']:5.1f}%\n"
            f"  per run: loot worth {ev['loot_value']:.0f} g (sell value), essence {ess}")


def parse_map(sim, roster, spec, asc, grade, prefix, suffix):
    """'inv:N' = Nth map of your map inventory (1-based), else a map id."""
    if str(spec).startswith("inv:"):
        m = roster.save.map_inventory[int(spec[4:]) - 1]
        return m["compact"], f"inventory map #{spec[4:]}"
    return {"id": int(spec), "prestigeLevel": asc, "grade": grade, "prefix": prefix or None,
            "suffix": suffix or None}, f"map {spec}"


def score(ev):
    """Win rate first; among equal win rates, faster fights, then more HP left;
    for lost fights, how much of the enemy's HP was removed."""
    return ev["win"] * 1e6 + ev["enemy_dmg"] * 1e4 - ev["turns"] * 10 + ev["hp_left"] * 5


def fmt_eval(ev):
    tw = f"{ev['turns_win']:.1f}" if ev["turns_win"] is not None else "-"
    return (f"win {100 * ev['win']:5.1f}%  turns {ev['turns']:5.1f} (wins {tw})  grade {ev['grade']:.2f}  "
            f"enemy HP removed {100 * ev['enemy_dmg']:5.1f}%  party HP left {100 * ev['hp_left']:5.1f}%")


# ---------------------------------------------------------------- roster
class Roster:
    def __init__(self, sim: Sim, save):
        self.sim, self.save = sim, save
        self.raw = {h["id"]: h for h in save.raw["hero"]}
        self._objs = {}

    def get(self, hid):
        """A fresh Lua hero for save id `hid` (cached; reset to the save state with reload())."""
        if hid not in self._objs:
            self._objs[hid] = self.sim.hero(self.raw[hid])
        return self._objs[hid]

    def reload(self, hid):
        self._objs.pop(hid, None)
        return self.get(hid)

    def ids(self, spec):
        if spec in (None, "", "all"):
            return sorted(self.raw)
        out = []
        for part in str(spec).split(","):
            part = part.strip()
            if "-" in part:
                a, b = part.split("-")
                out += [i for i in range(int(a), int(b) + 1) if i in self.raw]
            elif part:
                out.append(int(part))
        return out

    def label(self, hid):
        h = self.get(hid)
        cls = self.sim.g.heroList[h["class"]].name
        return f"#{hid} {h.name} ({cls} L{h.level} P{h.prestigeLevel})"


def parse_rows(roster, front, back):
    f = [roster.get(i) if i else None for i in roster.ids(front)] if front else []
    b = [roster.get(i) if i else None for i in roster.ids(back)] if back else []
    return f, b


def enemy_power(sim, q, rare=False):
    """Rough threat of a quest enemy: HP x (atk + matk), rare stats if asked."""
    d = sim.g.questData[q]
    sfx = "B" if rare and d["enemyHpB"] else ""
    hp, atk, matk = d["enemyHp" + sfx] or 0, d["enemyAtk" + sfx] or 0, d["enemyMatk" + sfx] or 0
    return hp * (atk + matk)


def quest_name(sim, q):
    return sim.g.questData[q].name


# ---------------------------------------------------------------- commands
def cmd_roster(sim, roster, args):
    print(f"{'id':>3} {'name':14} {'class':12} {'lvl':>3} {'P':>2} {'HP':>6} {'atk':>5} {'matk':>5} {'acc':>5} "
          f"{'crit':>4} {'def':>5} {'mdef':>5} {'AP':>5}  rotation / passive")
    for hid in roster.ids("all"):
        h = roster.get(hid)
        s = sim.stats(h)
        print(f"{hid:>3} {h.name[:14]:14} {sim.g.heroList[h['class']].name[:12]:12} {h.level:>3} {h.prestigeLevel:>2} "
              f"{s['maxHP']:>6.0f} {s['atk']:>5.0f} {s['matk']:>5.0f} {s['acc']:>5.0f} {s['crit']:>4.0f} {s['def']:>5.0f} "
              f"{s['mdef']:>5.0f} {s['maxActionPoints'] - s['actionPoints']:>2}/{s['maxActionPoints']:<2}  "
              f"{', '.join(sim.to_py(h.attackList))} / {h.passiveSelect}")


def print_party_detail(sim, ev, unit="fight"):
    print(f"  {'slot':7} {'hero':16} {'dmg/' + unit:>10} {'taken':>8} {'heal':>7} {'death%':>7}  damage by skill (per {unit})")
    for slot, v in sorted(ev["heroes"].items()):
        skills = sorted(v["skillDmg"].items(), key=lambda kv: -kv[1])
        sk = ", ".join(f"{k} {x:.0f} ({v['skillUses'].get(k, 0):.1f}x)" for k, x in skills)
        print(f"  {slot:7} {v['name'][:16]:16} {v['dmg']:>10.0f} {v['taken']:>8.0f} {v['heal']:>7.0f} "
              f"{100 * v['death_rate']:>6.1f}%  {sk}")


def cmd_fight(sim, roster, args):
    front, back = parse_rows(roster, args.front, args.back)
    ev = evaluate(sim, args.quest, front, back, args.n, args.rare, args.amount)
    print(f"Quest {args.quest} {quest_name(sim, args.quest)}{' (rare)' if args.rare else ''}, {args.n} fights")
    print("  " + fmt_eval(ev))
    print_party_detail(sim, ev)


def cmd_damage(sim, roster, args):
    h = roster.get(args.hero)
    ev = evaluate(sim, args.quest, [h], [], args.n, args.rare, args.amount)
    v = next(iter(ev["heroes"].values()))
    print(f"{roster.label(args.hero)} vs {quest_name(sim, args.quest)}, {args.n} fights: {fmt_eval(ev)}")
    print(f"  damage per fight {v['dmg']:.0f}, per turn {v['dmg'] / ev['turns']:.0f}")
    print(f"  {'skill':22} {'uses/fight':>10} {'dmg/fight':>10} {'dmg/use':>9}")
    for k, x in sorted(v["skillDmg"].items(), key=lambda kv: -kv[1]):
        uses = v["skillUses"].get(k, 0)
        print(f"  {k:22} {uses:>10.2f} {x:>10.0f} {x / uses if uses else 0:>9.0f}")


def cmd_solo(sim, roster, args):
    hids = roster.ids(args.heroes)
    quests = roster.ids(args.quests) if args.quests else sorted(int(k) for k in sim.to_py(sim.g.questData).keys()) \
        if isinstance(sim.to_py(sim.g.questData), dict) else list(range(1, len(sim.to_py(sim.g.questData)) + 1))
    REPORTS.mkdir(exist_ok=True)
    rows = []
    for hid in hids:
        h = roster.get(hid)
        for q in quests:
            ev = evaluate(sim, q, [h], [], args.n, args.rare)
            rows.append({"hero_id": hid, "hero": h.name, "class": sim.g.heroList[h["class"]].name, "level": h.level,
                         "prestige": h.prestigeLevel, "quest_id": q, "quest": quest_name(sim, q),
                         "quest_level": sim.g.questData[q].levelReq,
                         "enemy_power": enemy_power(sim, q, args.rare), "win%": round(100 * ev["win"], 1),
                         "turns": round(ev["turns"], 1), "grade": round(ev["grade"], 2),
                         "enemy_hp_removed%": round(100 * ev["enemy_dmg"], 1), "hp_left%": round(100 * ev["hp_left"], 1)})
        print(f"  {roster.label(hid)} done", file=sys.stderr)
    out = REPORTS / f"solo{'_rare' if args.rare else ''}.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    by_hero = defaultdict(list)
    for r in rows:
        by_hero[r["hero_id"]].append(r)
    print(f"Solo viability ({args.n} fights each, win >= {args.threshold}% counts as soloable; "
          f"enemy power = HP x (atk + matk)):")
    for hid, rs in by_hero.items():
        ok = [r for r in rs if r["win%"] >= args.threshold]
        hardest = max(ok, key=lambda r: r["enemy_power"]) if ok else None
        fails = sorted((r for r in rs if r["win%"] < args.threshold), key=lambda r: r["enemy_power"])
        print(f"  {roster.label(hid):44} soloes {len(ok):>3}/{len(rs)}"
              + (f"; toughest beaten: {hardest['quest']} ({hardest['win%']}%)" if hardest else "")
              + (f"; weakest failed: {', '.join(r['quest'] + ' (' + str(r['win%']) + '%)' for r in fails[:3])}" if fails else ""))
    by_class = defaultdict(list)
    for r in rows:
        by_class[r["class"]].append(r)
    print("\nBy class (average over its heroes):")
    print(f"  {'class':12} {'heroes':>6} {'soloable':>9} {'avg win%':>9} {'avg turns (wins)':>17}")
    for cls, rs in sorted(by_class.items(), key=lambda kv: -st.mean(r["win%"] for r in kv[1])):
        heroes = len({r["hero_id"] for r in rs})
        soloable = sum(r["win%"] >= args.threshold for r in rs) / heroes
        wins = [r["turns"] for r in rs if r["win%"] >= args.threshold]
        print(f"  {cls:12} {heroes:>6} {soloable:>9.1f} {st.mean(r['win%'] for r in rs):>9.1f} "
              f"{st.mean(wins) if wins else 0:>17.1f}")
    print(f"\nFull matrix: {out}")


def rotations(skill_names, ap_costs, max_ap):
    """All 5-slot rotations (order matters) of unlocked skills + Basic within the AP budget."""
    options = ["Basic"] + skill_names
    cost = {"Basic": 0, **dict(zip(skill_names, ap_costs))}
    for combo in itertools.combinations_with_replacement(options, 5):
        if sum(cost[c] for c in combo) <= max_ap:
            yield combo, cost


def cmd_skills(sim, roster, args):
    h = roster.get(args.hero)
    front, back = parse_rows(roster, args.front, args.back)
    if h not in front and h not in back:
        front = [h] + front
    info = sim.to_py(sim.api.skillInfo(h))
    skills = info["skills"][:info["unlocked"]]
    names, costs = [s["name"] for s in skills], [s["ap"] for s in skills]
    passives = info["passives"] if h.level >= 10 else ["None"]
    current = (sim.to_py(h.attackList), h.passiveSelect)
    base = evaluate(sim, args.quest, front, back, args.n_final, args.rare, args.amount)
    print(f"{roster.label(args.hero)} vs {quest_name(sim, args.quest)}; AP budget {info['maxAP']}; "
          f"unlocked: {', '.join(f'{n} ({c})' for n, c in zip(names, costs))}")
    print(f"  current  {', '.join(current[0])} / {current[1]}: {fmt_eval(base)}")

    # Stage 1: every multiset of skills within budget, in one canonical order, current passive.
    combos = list(rotations(names, costs, info["maxAP"]))
    print(f"  stage 1: {len(combos)} skill combinations x {args.n_quick} fights", file=sys.stderr)
    scored = []
    for combo, _ in combos:
        sim.set_skills(h, list(combo), current[1])
        scored.append((evaluate(sim, args.quest, front, back, args.n_quick, args.rare, args.amount)["score"], combo))
    scored.sort(reverse=True)
    # Stage 2: orderings of the best combos (rotation order matters: buffs before hits...).
    cands = set()
    for _, combo in scored[:args.top]:
        cands.update(set(itertools.permutations(combo)))
    print(f"  stage 2: {len(cands)} orderings x {args.n_quick} fights", file=sys.stderr)
    scored2 = []
    for perm in cands:
        sim.set_skills(h, list(perm), current[1])
        scored2.append((evaluate(sim, args.quest, front, back, args.n_quick, args.rare, args.amount)["score"], perm))
    scored2.sort(reverse=True)
    # Stage 3: best orderings x every passive, with more fights.
    final = []
    for _, perm in scored2[:args.top]:
        for p in passives:
            sim.set_skills(h, list(perm), p)
            final.append((evaluate(sim, args.quest, front, back, args.n_final, args.rare, args.amount), perm, p))
    final.sort(key=lambda t: -t[0]["score"])
    print(f"  best rotations ({args.n_final} fights each):")
    for ev, perm, p in final[:5]:
        print(f"    {', '.join(perm):60} / {p:20} {fmt_eval(ev)}")
    sim.set_skills(h, current[0], current[1])   # leave the hero as in the save


def gear_candidates(sim, roster, h, args):
    """{slot: [(label, item)]} from the chosen pool, usable at the hero's level."""
    cands = defaultdict(list)
    if args.pool == "catalog":
        eq = sim.to_py(sim.g.itemData.equipment)
        items = eq.items() if isinstance(eq, dict) else enumerate(eq, 1)
        for iid, it in items:
            if not isinstance(it, dict) or not it.get("itemSlot") or it.get("itemLevel", 99) > h.level:
                continue
            if it.get("itemLevel", 0) < h.level - args.level_window:
                continue
            item = sim.api.makeItem(int(iid), args.item_grade, args.asc, args.crafter_level, 1)
            cands[it["itemSlot"]].append((f"{it['name']} (catalog, grade {args.item_grade}, asc {args.asc})", item))
    else:
        for where, items in [("inventory", roster.save.inventory), ("sale slot", [x for x in roster.save.sales if x])]:
            for it in items:
                if it.get("itemType") == "equipment" and it.get("itemSlot"):
                    cands[it["itemSlot"]].append((f"{where}", it["compact"]))
        for hid, raw in roster.raw.items():
            if hid == args.hero:
                continue
            for it in raw.get("heroInventory", []):
                if isinstance(it, str):
                    slot = int(it.split("|")[3])
                    cands[slot].append((f"worn by #{hid} {raw.get('name', '')}", it))
    return cands


def cmd_gear(sim, roster, args):
    h = roster.get(args.hero)
    front, back = parse_rows(roster, args.front, args.back)
    if h not in front and h not in back:
        front = [h] + front
    base = evaluate(sim, args.quest, front, back, args.n, args.rare, args.amount)
    print(f"{roster.label(args.hero)} vs {quest_name(sim, args.quest)}, pool {args.pool}")
    print(f"  current gear: {fmt_eval(base)}")
    cands = gear_candidates(sim, roster, h, args)
    best_score = base["score"]
    chosen = {}
    for pass_no in range(args.passes):
        improved = False
        for slot in range(1, 7):
            current = h.heroInventory[slot]
            best = None
            for label, item in cands.get(slot, []):
                if isinstance(item, str):
                    sim.api.equip(h, slot, item)
                else:
                    sim.api.equipItem(h, slot, item)
                if h.heroInventory[slot].itemLevel > h.level:
                    sim.api.equipItem(h, slot, current)
                    continue
                sc = evaluate(sim, args.quest, front, back, args.n, args.rare, args.amount)["score"]
                if sc > best_score + 1e-9 and (best is None or sc > best[0]):
                    best = (sc, label, h.heroInventory[slot])
            if best:
                best_score = best[0]
                sim.api.equipItem(h, slot, best[2])
                chosen[slot] = (best[1], best[2].name)
                improved = True
            else:
                sim.api.equipItem(h, slot, current)
        if not improved:
            break
    final = evaluate(sim, args.quest, front, back, args.n, args.rare, args.amount)
    print(f"  best gear:    {fmt_eval(final)}")
    slot_names = {1: "weapon", 2: "head", 3: "body", 4: "hands", 5: "feet", 6: "trinket"}
    for slot in range(1, 7):
        it = h.heroInventory[slot]
        mark = f"  <- {chosen[slot][0]}" if slot in chosen else "  (keep)"
        print(f"    {slot_names[slot]:8} {it.name}{mark}")
    roster.reload(args.hero)


def cmd_map(sim, roster, args):
    front, back = parse_rows(roster, args.front, args.back)
    spec, label = parse_map(sim, roster, args.map, args.asc, args.map_grade, args.prefix, args.suffix)
    scrolls = parse_scrolls(args.scrolls)
    m = sim.api.makeMap(spec if isinstance(spec, str) else sim.to_lua(spec), 1)
    print(f"{m.name} (asc {m.prestigeLevel}, enemy mod {m.enemyMod}), {label}, {args.n} runs, "
          f"scrolls: {scroll_names(sim, scrolls)}")
    ev = evaluate_map(sim, spec, front, back, args.n, scrolls=scrolls)
    print("  " + fmt_map(ev))
    if scrolls:
        used = ", ".join(f"{sim.g.itemData.consumable[k].name} {v:.2f}" for k, v in ev["charges_used"].items())
        print(f"  scroll charges used per run: {used or 'none'}; escaped {100 * ev['escaped']:.0f}% of runs")
    if ev["errors"]:
        print(f"  {ev['errors']} runs crashed in the game code: {ev['error']}")
    if ev["fail_room"]:
        print("  lost at: " + ", ".join(f"{k} {100 * v / args.n:.0f}%" for k, v in list(ev["fail_room"].items())[:6]))
    print_party_detail(sim, ev, "run")


def cmd_maps(sim, roster, args):
    """Survey every map (asc 0 and 1) with one party -> reports/maps_survey.csv."""
    from gamedata import load_game
    g = load_game()
    front, back = parse_rows(roster, args.front, args.back)
    rows = []
    for mid, m in sorted(g.items["map"].items()):
        if not m.get("bossList"):
            continue
        if m.get("itemLevel", 0) > 60 and not args.include_70:
            continue   # level-70 maps (ids 27-32) can't be crafted: crafters cap at level 60
        for asc in (0, 1):
            spec = {"id": mid, "prestigeLevel": asc, "grade": args.map_grade}
            try:
                ev = evaluate_map(sim, spec, front, back, args.n, scrolls=parse_scrolls(args.scrolls))
            except RuntimeError as e:
                print(f"  {m['name']:26} asc {asc}: game error - {e}")
                continue
            ess_total = sum(ev["essence"].values())
            rows.append({"map_id": mid, "map": m["name"], "asc": asc, "level": m.get("itemLevel"),
                         "win%": round(100 * ev["win"], 1), "progress%": round(100 * ev["cleared"], 1),
                         "grade": round(ev["grade"], 2), "time_h": round(ev["time_h"], 2),
                         "essence_per_run": round(ess_total, 1),
                         "essence": ", ".join(f"{k}" for k in ev["essence"]),
                         "essence_per_hour": round(ess_total / ev["time_h"], 1) if ev["time_h"] else 0,
                         "loot_value_per_run": round(ev["loot_value"]),
                         "loot_value_per_hour": round(ev["loot_value"] / ev["time_h"]) if ev["time_h"] else 0,
                         "lost_at": ", ".join(list(ev["fail_room"])[:2]),
                         "game_errors": ev["errors"], "game_error": ev["error"]})
            print(f"  {m['name']:26} asc {asc}: win {rows[-1]['win%']:5.1f}%  progress {rows[-1]['progress%']:5.1f}%  "
                  f"grade {rows[-1]['grade']:.2f}  {rows[-1]['essence_per_hour']:7.1f} essence/h  "
                  f"{rows[-1]['loot_value_per_hour']:6d} g loot/h" + (f"  lost at {rows[-1]['lost_at']}" if rows[-1]['lost_at'] else "")
                  + (f"  [{ev['errors']}/{args.n} runs crashed in game code]" if ev["errors"] else ""))
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / "maps_survey.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\nFull table: {out}")


def cmd_scrolls(sim, roster, args):
    """Best loadout of up to 3 scrolls for one map and party."""
    front, back = parse_rows(roster, args.front, args.back)
    spec, label = parse_map(sim, roster, args.map, args.asc, args.map_grade, args.prefix, args.suffix)
    pool = [int(x) for x in args.pool.split(",")] if args.pool else SCROLL_IDS
    loadouts = [()]
    for k in (1, 2, 3):
        loadouts += list(itertools.combinations_with_replacement(pool, k))
    # crafted cost of each scroll (profit solver at grade 3)
    try:
        from gamedata import load_game
        from profit import Solver
        solver = Solver(load_game()).solve()
        price = {sid: solver.get("consumable", sid, args.scroll_asc) for sid in pool}
    except Exception as e:   # pricing is a convenience, not required
        print(f"  (no scroll prices: {e})", file=sys.stderr)
        price = {sid: 0.0 for sid in pool}
    as_scrolls = lambda lo: [{"id": sid, "prestigeLevel": args.scroll_asc} for sid in lo]
    print(f"  stage 1: {len(loadouts)} loadouts x {args.n_quick} runs", file=sys.stderr)
    scored = []
    for lo in loadouts:
        ev = evaluate_map(sim, spec, front, back, args.n_quick, scrolls=as_scrolls(lo) or None)
        scored.append((ev["score"], lo))
    scored.sort(reverse=True)
    final = []
    for _, lo in scored[:args.top]:
        ev = evaluate_map(sim, spec, front, back, args.n_final, scrolls=as_scrolls(lo) or None)
        final.append((ev, lo))
    if () not in [lo for _, lo in final]:
        final.append((evaluate_map(sim, spec, front, back, args.n_final), ()))
    final.sort(key=lambda t: -t[0]["score"])
    print(f"Best scroll loadouts for {label} ({args.n_final} runs each):")
    for ev, lo in final:
        cost = sum(price.get(sid, 0) for sid in lo)
        name = scroll_names(sim, as_scrolls(lo)) if lo else "no scrolls"
        ess = sum(ev["essence"].values())
        print(f"  {name:55} cost {cost:6.0f} g  win {100 * ev['win']:5.1f}%  progress {100 * ev['cleared']:5.1f}%  "
              f"grade {ev['grade']:.2f}  essence/run {ess:6.1f}  loot {ev['loot_value']:6.0f} g  "
              f"time {ev['time_h']:.2f} h  escaped {100 * ev['escaped']:.0f}%")


def cmd_party(sim, roster, args):
    pool = roster.ids(args.heroes)
    slots = [("front", i) for i in range(3)] + [("back", i) for i in range(3)]
    placed = {}   # (row, i) -> hero id

    def rows():
        front = [roster.get(placed[("front", i)]) if ("front", i) in placed else None for i in range(3)]
        back = [roster.get(placed[("back", i)]) if ("back", i) in placed else None for i in range(3)]
        return front, back

    if args.map:
        spec, _ = parse_map(sim, roster, args.map, args.asc, args.map_grade, args.prefix, args.suffix)

    def ev_of(n):
        front, back = rows()
        if args.map:
            return evaluate_map(sim, spec, front, back, n, scrolls=parse_scrolls(args.scrolls))
        return evaluate(sim, args.quest, front, back, n, args.rare, args.amount)

    # Greedy: add the hero + slot that improves the score most, until the party
    # is full or another hero stops helping.
    best = None
    for step in range(args.size):
        cand_best = None
        for hid in pool:
            if hid in placed.values():
                continue
            for slot in slots:
                if slot in placed:
                    continue
                placed[slot] = hid
                sc = ev_of(args.n_quick)["score"]
                del placed[slot]
                if cand_best is None or sc > cand_best[0]:
                    cand_best = (sc, hid, slot)
        if cand_best is None or (best is not None and cand_best[0] <= best + 1e-9):
            break
        best, hid, slot = cand_best
        placed[slot] = hid
        print(f"  + {roster.label(hid)} in {slot[0]} {slot[1] + 1}", file=sys.stderr)

    # Local search: replace a placed hero by an unused one, or move a hero to an empty slot.
    improved = True
    while improved:
        improved = False
        base = ev_of(args.n_quick)["score"]
        for slot in list(placed):
            cur = placed[slot]
            options = [("swap", hid) for hid in pool if hid not in placed.values()]
            options += [("move", s2) for s2 in slots if s2 not in placed]
            for kind, x in options:
                if kind == "swap":
                    placed[slot] = x
                else:
                    del placed[slot]
                    placed[x] = cur
                sc = ev_of(args.n_quick)["score"]
                if sc > base + 1e-9:
                    base, improved = sc, True
                    break
                if kind == "swap":
                    placed[slot] = cur
                else:
                    del placed[x]
                    placed[slot] = cur
            if improved:
                break

    final = ev_of(args.n_final)
    target = f"map {args.map}" if args.map else quest_name(sim, args.quest)
    print(f"Best party found for {target} ({args.n_final} {'runs' if args.map else 'fights'}):")
    for row in ("front", "back"):
        cells = [roster.label(placed[(row, i)]) if (row, i) in placed else "-" for i in range(3)]
        print(f"  {row:5}: " + " | ".join(cells))
    if args.map:
        print("  " + fmt_map(final))
        print_party_detail(sim, final, "run")
    else:
        print("  " + fmt_eval(final))
        print_party_detail(sim, final)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_save_args(ap)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, hero=False, rows=False, n=200):
        p.add_argument("--quest", type=int, required=p.prog.split()[-1] not in ("roster", "solo", "map", "party", "maps", "scrolls"))
        p.add_argument("--rare", action="store_true", help="fight the rare variant (B stats/skills)")
        p.add_argument("--amount", type=int, default=1, help="number of enemies (HP multiplier)")
        p.add_argument("-n", type=int, default=n, help="fights per evaluation")
        if hero:
            p.add_argument("--hero", type=int, required=True)
        if rows:
            p.add_argument("--front", help="hero ids for front row slots 1-3, e.g. 1,9 (0 = empty)")
            p.add_argument("--back", help="hero ids for back row slots 1-3")

    sub.add_parser("roster")
    p = sub.add_parser("fight"); common(p, rows=True, n=500)
    p = sub.add_parser("damage"); common(p, hero=True, n=300)
    p = sub.add_parser("solo"); common(p, n=100)
    p.add_argument("--heroes", default="all")
    p.add_argument("--quests", help="quest ids, e.g. 1-60,80")
    p.add_argument("--threshold", type=float, default=90)
    p = sub.add_parser("skills"); common(p, hero=True, rows=True, n=0)
    p.add_argument("--n-quick", type=int, default=30)
    p.add_argument("--n-final", type=int, default=300)
    p.add_argument("--top", type=int, default=8)
    p = sub.add_parser("gear"); common(p, hero=True, rows=True, n=60)
    p.add_argument("--pool", choices=["owned", "catalog"], default="owned")
    p.add_argument("--item-grade", type=int, default=5, choices=[1, 2, 3, 4, 5])
    p.add_argument("--asc", type=int, default=0, choices=[0, 1, 2])
    p.add_argument("--crafter-level", type=int, default=60)
    p.add_argument("--level-window", type=int, default=15, help="catalog: only items within N levels of the hero")
    p.add_argument("--passes", type=int, default=2)
    def map_opts(p, required):
        p.add_argument("--map", required=required, help="map id, or inv:N for the Nth map of your map inventory")
        p.add_argument("--asc", type=int, default=0, choices=[0, 1], help="map ascension (map id only)")
        p.add_argument("--map-grade", type=int, default=3, help="map grade (map id only)")
        p.add_argument("--prefix", type=int, default=0, help="map prefix id (map id only)")
        p.add_argument("--suffix", type=int, default=0, help="map suffix id, e.g. 9 for +9 (map id only)")
        p.add_argument("--scrolls", help="up to 3 scroll ids (consumables 60-69), ID@ASC for ascended, e.g. 61,63,69@1")

    p = sub.add_parser("map"); common(p, rows=True, n=100)
    map_opts(p, True)
    p = sub.add_parser("party"); common(p, n=0)
    map_opts(p, False)
    p = sub.add_parser("scrolls"); common(p, rows=True, n=0)
    map_opts(p, True)
    p.add_argument("--pool", help="scroll ids to consider (default 60-69)")
    p.add_argument("--scroll-asc", type=int, default=0, choices=[0, 1, 2])
    p.add_argument("--n-quick", type=int, default=10)
    p.add_argument("--n-final", type=int, default=100)
    p.add_argument("--top", type=int, default=8)
    p = sub.add_parser("maps"); common(p, rows=True, n=20)
    p.add_argument("--scrolls", help="scrolls used on every map, e.g. 61,62,63")
    p.add_argument("--map-grade", type=int, default=3, help="grade of the surveyed maps")
    p.add_argument("--include-70", action="store_true", help="also survey the uncraftable level-70 maps")
    p.add_argument("--heroes", default="all")
    p.add_argument("--size", type=int, default=6)
    p.add_argument("--n-quick", type=int, default=40)
    p.add_argument("--n-final", type=int, default=500)
    args = ap.parse_args()

    save = load_from_args(args)
    sim = Sim(game_mode=save.raw.get("gameMode") or "Standard")
    roster = Roster(sim, save)
    {"roster": cmd_roster, "fight": cmd_fight, "damage": cmd_damage, "solo": cmd_solo, "skills": cmd_skills,
     "gear": cmd_gear, "party": cmd_party, "map": cmd_map, "maps": cmd_maps, "scrolls": cmd_scrolls}[args.cmd](sim, roster, args)


if __name__ == "__main__":
    main()
