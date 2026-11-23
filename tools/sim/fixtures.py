"""Record reference fights from the game's own combat code, for the TypeScript port.

Runs fights through tools/sim/harness.lua with the shared LCG generator
(sim.useLcg) and writes their inputs, results and action-by-action traces to
web/test/fixtures/. web/test/difftest.ts replays them with the TypeScript
engine and reports the first divergence.

Fixtures embed heroes from your save and outputs of the game code, so they
stay local (git-ignored).

    python3 tools/sim/fixtures.py --save saves/snapshot/PlayerData.txt [-n 600] [--seed 1]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "_vendor"))

from savegame import add_save_args, load_from_args  # noqa: E402
from sim.engine import Sim  # noqa: E402

OUT = ROOT / "web" / "test" / "fixtures"


def rotation(rnd: random.Random, skills: list[str], ap: dict[str, int], unlocked: int, max_ap: int) -> list[str]:
    """A random 5-slot rotation within the AP budget, favouring skills not used much yet."""
    pool = skills[:unlocked]
    out, spent = [], 0
    for _ in range(5):
        choices = [s for s in pool if spent + ap.get(s, 0) <= max_ap] + ["Basic"]
        s = rnd.choice(choices)
        spent += ap.get(s, 0) if s != "Basic" else 0
        out.append(s)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_save_args(ap)
    ap.add_argument("-n", type=int, default=600, help="number of fights")
    ap.add_argument("--seed", type=int, default=1, help="scenario generator seed")
    ap.add_argument("--out", default=str(OUT / "fights.json"))
    ap.add_argument("--maps", type=int, default=0, help="also record this many map runs (-> maps.json)")
    ap.add_argument("--items", type=int, default=0, help="also record this many makeItem rolls (-> items.json)")
    args = ap.parse_args()

    save = load_from_args(args)
    mode = save.raw.get("gameMode") or "Standard"
    sim = Sim(game_mode=mode, use_lcg=True)
    raws = list(save.raw["hero"])
    # Quests with a fightable enemy; rare fights only where a rare variant exists.
    qinfo = sim.to_py(sim.L.eval("""(function() local t = {}
      for k, q in pairs(questData) do
        if q.enemyHp and q.attackList then t[#t + 1] = {k, q.enemyHpB ~= nil and q.attackListB ~= nil} end
      end return t end)()"""))
    quests = sorted(int(q) for q, _ in qinfo)
    has_rare = {int(q): bool(r) for q, r in qinfo}
    rnd = random.Random(args.seed)

    used: dict[str, int] = {}
    fixtures = []
    for k in range(args.n):
        size = 1 if k % 3 == 0 else rnd.randint(2, 6)
        picks = rnd.sample(range(len(raws)), min(size, len(raws)))
        slots = rnd.sample(range(6), len(picks))
        front, back = [None] * 3, [None] * 3
        heroes, skills = [], []
        for idx, slot in zip(picks, slots):
            h = sim.hero(raws[idx])
            skill_override = None
            if rnd.random() < 0.7:   # most fights use a random rotation, for skill coverage
                info = sim.to_py(sim.api.skillInfo(h))
                names = [s["name"] for s in info["skills"]]
                costs = {s["name"]: s["ap"] for s in info["skills"]}
                rot = rotation(rnd, names, costs, info["unlocked"], info["maxAP"])
                passive = rnd.choice(info["passives"]) if info["passives"] else None
                sim.set_skills(h, rot, passive)
                skill_override = {"attackList": rot, "passive": passive}
            heroes.append(h)
            skills.append(skill_override)
            (front if slot < 3 else back)[slot % 3] = len(heroes) - 1
        quest = rnd.choice(quests)
        is_rare = has_rare[quest] and rnd.random() < 0.25
        amount = 1 if rnd.random() < 0.8 else rnd.randint(2, 4)
        seed = rnd.randint(1, 10**9)
        sim.api.traceStart()
        res = sim.fight(quest, [heroes[i] if i is not None else None for i in front],
                        [heroes[i] if i is not None else None for i in back],
                        seed=seed, is_rare=is_rare, amount=amount)
        trace = sim.to_py(sim.api.traceStop())
        res["rngCalls"] = sim.api.rngCalls()
        for s in skills:
            for name in (s or {}).get("attackList", []):
                used[name] = used.get(name, 0) + 1
        fixtures.append({
            "mode": mode, "quest": quest, "isRare": is_rare, "amount": amount, "seed": seed,
            "front": front, "back": back,
            "heroes": [raws[i] for i in picks], "skills": skills,
            "result": res, "trace": trace,
        })
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"fights": fixtures}, separators=(",", ":")))
    print(f"{len(fixtures)} fights -> {out} ({out.stat().st_size // 1024} KB); {len(used)} distinct hero skills used")
    if args.maps:
        record_maps(sim, raws, rnd, mode, args.maps, out.parent / "maps.json")
    if args.items:
        record_items(sim, rnd, mode, args.items, out.parent / "items.json")


ITEM_FIELDS = ["atk", "matk", "acc", "crit", "def", "mdef", "str", "int", "dex", "lckMod", "expMod", "speed",
               "atkBns", "matkBns", "accBns", "critBns", "defBns", "mdefBns", "hpBns", "atkPct", "matkPct",
               "defPct", "mdefPct", "accPct", "apMod", "critMod", "hpPct", "grade", "name"]


def record_items(sim, rnd, mode, n, path):
    """Fresh catalog items (sim.makeItem): base stats and bonus stats rolled in the game's order."""
    ids = sorted(int(k) for k in sim.to_py(sim.L.eval(
        "(function() local t = {} for k in pairs(itemData.equipment) do t[#t + 1] = k end return t end)()")))
    with_bonus = set(int(k) for k in sim.to_py(sim.L.eval(
        "(function() local t = {} for k, v in pairs(itemData.equipment) do if next(v.bonusStat or {}) then t[#t + 1] = k end end return t end)()")))
    cases = [(5, 5, 0, 60, 1), (200, 5, 0, 60, 1)]   # reference items checked by hand
    while len(cases) < n:
        pool = sorted(with_bonus) if rnd.random() < 0.8 else ids
        cases.append((rnd.choice(pool), rnd.randint(1, 5), rnd.choice([0, 0, 1, 2]), rnd.randint(1, 70), rnd.randint(1, 10**9)))
    items, errors = [], 0
    for iid, grade, asc, cl, seed in cases:
        before = sim.api.rngCalls()
        try:
            it = sim.api.makeItem(iid, grade, asc, cl, seed)
        except Exception:
            errors += 1
            continue
        stats = {f: it[f] for f in ITEM_FIELDS if it[f] is not None}
        items.append({"mode": mode, "id": iid, "grade": grade, "prestige": asc, "charLevel": cl, "seed": seed,
                      "stats": stats, "rngCalls": sim.api.rngCalls() - before})
    path.write_text(json.dumps({"items": items}, separators=(",", ":")))
    print(f"{len(items)} items -> {path}; {errors} failed in game code")


def record_maps(sim, raws, rnd, mode, n, path):
    """Full map runs (Campaign: rooms, HP carried over, scrolls, loot, essence)."""
    map_ids = sorted(int(k) for k in sim.to_py(sim.L.eval(
        "(function() local t = {} for k in pairs(itemData.map) do t[#t + 1] = k end return t end)()")))
    runs, errors = [], 0
    while len(runs) < n:
        size = rnd.randint(3, 6)
        picks = rnd.sample(range(len(raws)), min(size, len(raws)))
        slots = rnd.sample(range(6), len(picks))
        front, back = [None] * 3, [None] * 3
        heroes = []
        for idx, slot in zip(picks, slots):
            heroes.append(sim.hero(raws[idx]))
            (front if slot < 3 else back)[slot % 3] = len(heroes) - 1
        spec = {"id": rnd.choice(map_ids), "prestigeLevel": rnd.choice([0, 0, 1]), "grade": rnd.randint(1, 5)}
        scrolls = [{"id": rnd.randint(60, 69), "prestigeLevel": 0} for _ in range(rnd.choice([0, 0, 1, 3]))]
        seed = rnd.randint(1, 10**9)
        rng_start = sim.api.rngCalls()
        sim.api.traceStart()
        try:
            res = sim.map_run(spec, [heroes[i] if i is not None else None for i in front],
                              [heroes[i] if i is not None else None for i in back], seed=seed, scrolls=scrolls or None)
        except Exception as e:   # the game itself cannot generate some maps
            sim.api.traceStop()
            errors += 1
            continue
        trace = sim.to_py(sim.api.traceStop())
        res["rngCalls"] = sim.api.rngCalls()
        runs.append({"mode": mode, "map": spec, "scrolls": scrolls, "seed": seed, "rngStart": rng_start,
                     "front": front, "back": back,
                     "heroes": [raws[i] for i in picks], "result": res, "trace": trace})
    path.write_text(json.dumps({"runs": runs}, separators=(",", ":")))
    print(f"{len(runs)} map runs -> {path} ({path.stat().st_size // 1024} KB); {errors} runs failed in game code")


if __name__ == "__main__":
    main()
