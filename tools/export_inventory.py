"""Export the Merchant game inventory to inventory/ (JSON + CSV).

    python3 tools/export_inventory.py [--src decompiled] [--out inventory]

Writes:
    inventory.json      everything, raw field names from the game data
    equipment.csv       items with value, sell price, craft cost, recipe
    materials.csv       materials, recipe if crafted, where they drop
    consumables.csv
    maps.csv            maps with essence reward, enemies, boss, recipe
    quests.csv          enemies/quests: launch gold, time, stats, drops
    parcels.csv         loot tables, one row per entry
    crafters.csv, classes.csv
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

from gamedata import DEFAULT_SRC, ROOT, load_game


def recipe_str(g, itype, iid):
    rec = g.recipe(itype, iid)
    if not rec:
        return ""
    return " + ".join(f"{amt}x {g.name(t, i)}" + ("" if t == "material" else f" [{t}]") for t, i, amt in rec)


def drop_sources(g):
    """material id -> list of 'Quest (how)' strings."""
    src = defaultdict(list)
    for q in g.quests.values():
        for key in ("rewardA1", "rewardA2", "rewardB1", "rewardB2"):
            r = q.get(key)
            if isinstance(r, list) and r and r[0]:
                src[r[0]].append(f"{q['name']} ({key}, {r[1]}-{r[2]})")
        for key in ("rewardA3", "rewardA4", "rewardB3", "rewardB4"):
            pname = q.get(key)
            p = g.parcels.get(pname) if pname else None
            if not p:
                continue
            total = p["nilOdds"] + sum(e["odds"] for e in p["itemList"])
            for e in p["itemList"]:
                if len(e["id"]) == 1:
                    src[e["id"][0]].append(f"{q['name']} ({key} {pname}, {100 * e['odds'] / total:.1f}%)")
    for m in g.items["map"].values():
        for i in range(0, len(m.get("baseReward", [])) // 2):
            src[m["baseReward"][i]].append(f"{m['name']} (map essence x{m['baseReward'][i + len(m['baseReward']) // 2]})")
    return src


def write_csv(path, rows):
    if not rows:
        return
    cols = list(dict.fromkeys(k for r in rows for k in r))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=ROOT / "inventory")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    g = load_game(args.src)
    crafter = {cid: c["name"] for cid, c in g.crafters.items()}
    sources = drop_sources(g)

    json.dump({
        "items": {t: {str(k): v for k, v in d.items()} for t, d in g.items.items()},
        "quests": {str(k): v for k, v in g.quests.items()},
        "parcels": g.parcels,
        "crafters": {str(k): v for k, v in g.crafters.items()},
        "classes": {str(k): v for k, v in g.heroes.items()},
        "prefixes": g.prefixes,
        "suffixes": g.suffixes,
        "constants": {
            "rarityMod": g.rarity_mod, "gradeBonus": g.grade_bonus,
            "gradeParcelBonus": g.grade_parcel_bonus, "gradeTime": g.grade_time,
            "prestigeItemID": g.prestige_item_id,
        },
    }, open(out / "inventory.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    def base_row(it, itype):
        return {
            "id": it["id"], "name": it["name"], "subType": it.get("subType", ""),
            "itemLevel": it.get("itemLevel", ""), "rarity": it.get("rarity", ""),
            "crafter": crafter.get(it.get("crafterID"), ""),
            "craftGold": it.get("cost", ""), "runTime_s": it.get("runTime", ""),
            "craftXP": it.get("experience", ""),
            "sellValue": g.sell_value(itype, it["id"]),
            "recipe": recipe_str(g, itype, it["id"]),
        }

    rows = []
    for it in g.items["equipment"].values():
        r = base_row(it, "equipment")
        r.update({"tier": it.get("tier", ""), "slot": it.get("itemSlot", ""), "value": it.get("value", ""),
                  "sellValue_asc1": g.sell_value("equipment", it["id"], 1),
                  "sellValue_asc2": g.sell_value("equipment", it["id"], 2),
                  "lockPrestige": it.get("lockPrestige", "")})
        rows.append(r)
    write_csv(out / "equipment.csv", rows)

    rows = []
    for it in g.items["material"].values():
        r = base_row(it, "material")
        r["sources"] = " | ".join(sources.get(it["id"], []))
        rows.append(r)
    write_csv(out / "materials.csv", rows)

    rows = []
    for it in g.items["consumable"].values():
        r = base_row(it, "consumable")
        r["stat"] = json.dumps(it.get("stat", {}))
        rows.append(r)
    write_csv(out / "consumables.csv", rows)

    rows = []
    for it in g.items["map"].values():
        r = base_row(it, "map")
        br = it.get("baseReward", [])
        half = len(br) // 2
        r.update({
            "value": it.get("value", ""),
            "enemyMod": it.get("enemyMod"), "baseMapTime_s": it.get("baseMapTime"),
            "baseEnemyAmount": it.get("baseEnemyAmount"),
            "enemies": ", ".join(f"{g.quests[a]['name']}..{g.quests[b]['name']}" if isinstance(e, list) and len(e) == 2 and (a := e[0]) and (b := e[1]) else str(e)
                                 for e in it.get("enemyList", [])),
            "boss": ", ".join(g.quests[b]["name"] for b in it.get("bossList", [])),
            "rareBoss": it.get("isRareBoss"),
            "essence": ", ".join(f"{br[i + half]}x {g.name('material', br[i])}" for i in range(half)),
        })
        rows.append(r)
    write_csv(out / "maps.csv", rows)

    rows = []
    for q in g.quests.values():
        def rew(k):
            r = q.get(k)
            if isinstance(r, list) and r and r[0]:
                return f"{g.name('material', r[0])} {r[1]}-{r[2]}"
            return r or ""
        rows.append({
            "id": q["id"], "name": q["name"], "nameRare": q.get("nameB", ""), "region": q.get("region"),
            "questType": q.get("questType"), "levelReq": q.get("levelReq"), "party": q.get("party"),
            "launchGold": q.get("gold", 0), "launchGoldRare": q.get("goldB", ""),
            "time_s": q.get("time"), "exp": q.get("exp"), "rareChance%": q.get("abRand"),
            "hp": q.get("enemyHp"), "atk": q.get("enemyAtk"), "matk": q.get("enemyMatk"),
            "def": q.get("enemyDef"), "mdef": q.get("enemyMdef"), "eva": q.get("enemyEva"),
            "drop1": rew("rewardA1"), "drop2": rew("rewardA2"), "parcel1": q.get("rewardA3", ""), "parcel2": q.get("rewardA4", ""),
            "rareDrop1": rew("rewardB1"), "rareDrop2": rew("rewardB2"), "rareParcel1": q.get("rewardB3", ""), "rareParcel2": q.get("rewardB4", ""),
        })
    write_csv(out / "quests.csv", rows)

    rows = []
    for pname, p in g.parcels.items():
        total = p["nilOdds"] + sum(e["odds"] for e in p["itemList"])
        for e in p["itemList"]:
            if len(e["id"]) > 1:
                itype, iid = e["id"][0], e["id"][1]
            else:
                itype, iid = "material", e["id"][0]
            rows.append({"parcel": pname, "nilOdds": p["nilOdds"], "itemType": itype, "itemID": iid,
                         "item": g.name(itype, iid), "odds": e["odds"], "chance%_grade3": round(100 * e["odds"] / total, 2),
                         "amount": json.dumps(e.get("amount", []))})
    write_csv(out / "parcels.csv", rows)

    write_csv(out / "crafters.csv", [{k: v for k, v in c.items() if not isinstance(v, (list, dict))} | {"id": cid}
                                     for cid, c in g.crafters.items()])
    write_csv(out / "classes.csv", [{k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in h.items()}
                                    for h in g.heroes.values()])
    print(f"Wrote inventory to {out}")
    for f in sorted(out.iterdir()):
        print(f"  {f.name:18} {f.stat().st_size:>9,} bytes")


if __name__ == "__main__":
    main()
