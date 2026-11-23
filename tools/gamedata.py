"""Load the Merchant game data from the decompiled Lua files.

Usage:
    from gamedata import load_game
    g = load_game()            # defaults to ../decompiled
    g.items["equipment"][1]    # dicts with the original Lua field names
"""

from __future__ import annotations

import glob
from dataclasses import dataclass, field
from pathlib import Path

from luadata import Env, LuaTable, to_py

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "decompiled"

ITEM_TYPES = ("material", "equipment", "consumable", "map")
STACKABLE = {"material", "consumable"}            # default.isStack
PRESTIGE_TYPES = {"equipment", "consumable", "map"}  # default.itemTypesAvailableForPrestige


@dataclass
class Game:
    items: dict[str, dict[int, dict]]
    quests: dict[int, dict]
    parcels: dict[str, dict]
    crafters: dict[int, dict]
    heroes: dict[int, dict]
    prefixes: dict[int, dict]   # prefixList, id -> entry (0 = none)
    suffixes: dict[int, dict]   # suffixList, id -> entry (-1 = Worn, 0 = none)
    rarity_mod: dict[int, list]
    grade_bonus: dict[int, float]
    grade_parcel_bonus: dict[int, float]
    grade_time: dict[int, float]
    prestige_item_id: dict[int, list]   # ascLevel -> essence id per region
    skipped: list = field(default_factory=list)

    # ---------------------------------------------------------------- helpers
    def item(self, itype: str, iid: int) -> dict:
        return self.items[itype][iid]

    def name(self, itype: str, iid: int) -> str:
        it = self.items.get(itype, {}).get(iid)
        return it["name"] if it else f"{itype}#{iid}?"

    def recipe(self, itype: str, iid: int):
        """[(ingredient_type, ingredient_id, amount), ...] or None if not craftable."""
        it = self.items[itype][iid]
        mids = it.get("materialID")
        if not mids or not it.get("crafterID"):
            return None
        mtypes = it.get("materialType") or []
        amounts = it.get("materialAmount") or []
        out = []
        for n, mid in enumerate(mids):
            mtype = mtypes[n] if n < len(mtypes) and mtypes[n] else "material"
            out.append((mtype, mid, amounts[n] if n < len(amounts) else 1))
        return out

    def rarity(self, itype: str, iid: int, mods: int = 0) -> int:
        """Item rarity after `mods` modifiers (Item:applyPrefix / applySuffix):
        each one adds a step, capped at 6 below rarity 7 and at 8 above."""
        r = self.items[itype][iid].get("rarity", 1)
        for _ in range(mods):
            r = min(r + 1, 6) if r < 7 else min(r + 1, 8)
        return r

    def sell_value(self, itype: str, iid: int, prestige: int = 0, mods: int = 0) -> float:
        """Base price a customer pays (Item:getSellValue / Customer:getSellInfo
        before preference and counter-location bonuses). `mods` = number of
        modifiers (prefix and/or suffix); only their count matters, via rarity."""
        it = self.items[itype][iid]
        mult = prestige * 2 if prestige > 0 else 1
        if itype in STACKABLE:
            s = it.get("sell") or [0, 0]
            return lua_round((s[0] * mult + s[1] * mult) / 2)
        value = it.get("value", it.get("cost", 0)) * mult
        return lua_round(value * self.rarity_mod.get(self.rarity(itype, iid, mods), [1])[0])

    def essence_for_ascension(self, itype: str, iid: int, asc_level: int, upgrade: bool, mods: int = 0):
        """default.prestigeItemMaterial -> (essence_id, amount). `mods` raises the
        rarity used for the amount and, on upgrade, the multiplier (4 + mods)."""
        it = self.items[itype][iid]
        level = it.get("itemLevel", 1)
        region, frac = divmod((level - 1) / 10, 1)
        region = clamp(int(region) + 1, 1, 6)
        ess_id = self.prestige_item_id[asc_level][region - 1]
        amount = 2 + frac * 5 if itype == "consumable" else 20 + frac * 50
        rarity = self.rarity(itype, iid, mods)
        if rarity in self.rarity_mod:
            amount = lua_round(self.rarity_mod[rarity][0] * amount)
        if upgrade:
            amount *= 4 + mods
        return ess_id, lua_round(amount)

    def prestiged_essence(self, base_id: int, map_prestige: int) -> int:
        if map_prestige == 0:
            return base_id
        base = self.prestige_item_id[1]
        if base_id in base:
            tier = self.prestige_item_id.get(map_prestige + 1)
            return tier[base.index(base_id)] if tier else None   # no such tier in the game
        return base_id


def lua_round(x: float) -> int:
    """math.round / round() in this codebase: floor(x + 0.5)."""
    import math
    return math.floor(x + 0.5)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _int_keys(d):
    return {int(k): v for k, v in d.items()}


def _indexed(tbl) -> dict[int, dict]:
    """Lua array-ish table -> {id: entry} keeping the original ids."""
    if isinstance(tbl, list):
        return {i + 1: v for i, v in enumerate(tbl)}
    return {int(k): v for k, v in tbl.items()}


def load_game(src: str | Path = DEFAULT_SRC) -> Game:
    src = Path(src)
    env = Env()
    env.globals["itemData"] = LuaTable()
    for f in sorted(glob.glob(str(src / "data.*.lua"))):
        env.load(f)
    g = env.globals
    items = {t: _indexed(to_py(g["itemData"].get(t, LuaTable()))) for t in ITEM_TYPES}
    for t, entries in items.items():
        for iid, it in entries.items():
            it["id"], it["itemType"] = iid, t
    quests = _indexed(to_py(g["questData"]))
    for qid, q in quests.items():
        q["id"] = qid
    crafters = _indexed(to_py(g["crafterData"]))
    heroes = _indexed(to_py(g["heroList"]))
    gb = to_py(g["gradeBonus"])
    return Game(
        items=items,
        quests=quests,
        parcels=to_py(g["parcelData"]),
        crafters=crafters,
        heroes=heroes,
        prefixes={int(k): v for k, v in to_py(g.get("prefixList", {})).items()},
        suffixes={int(k): v for k, v in to_py(g.get("suffixList", {})).items()},
        rarity_mod=_indexed(to_py(g["rarityMod"])),
        grade_bonus=_int_keys(gb) if isinstance(gb, dict) else {i + 1: v for i, v in enumerate(gb)},
        grade_parcel_bonus=_indexed(to_py(g["gradeParcelBonus"])),
        grade_time=_indexed(to_py(g["gradeTime"])),
        prestige_item_id=_indexed(to_py(env.file_locals["data.Default"]["prestigeItemID"])),
        skipped=env.skipped,
    )
