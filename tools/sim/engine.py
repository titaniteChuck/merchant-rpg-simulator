"""Python front-end to the headless Merchant combat code (harness.lua).

    from sim.engine import Sim
    s = Sim()
    hero = s.hero(raw_hero_dict)              # a save entry: Save.raw["hero"][i]
    r = s.fight(quest_id, front=[hero], back=[], seed=1)
    r["won"], r["turns"], r["heroes"][0]["physicalDmgDealt"]

Every rule (stats, passives, skills, hit/crit/defence, effects, turn order)
is the game's own decompiled Lua, run in Lua 5.1 through lupa.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE.parent / "_vendor"))   # optional local copy: pip install --target tools/_vendor

from lupa import lua51  # noqa: E402

DEFAULT_SRC = ROOT / "decompiled"


class Sim:
    def __init__(self, src: str | Path = DEFAULT_SRC, game_mode: str = "Standard", use_lcg: bool = False):
        """game_mode: the save's gameMode ("Standard", "Hard Enemies", ...).
        use_lcg: draw every random number from the LCG shared with the TypeScript port."""
        self.L = lua51.LuaRuntime(unpack_returned_tuples=True)
        g = self.L.globals()
        g.SRC = str(src)
        g.GAME_MODE = game_mode
        g.USE_LCG = use_lcg
        self.L.execute((HERE / "harness.lua").read_text(encoding="utf-8"))
        self.g = g
        self.api = g.sim
        errors = self.to_py(self.api.loadErrors)
        if errors:
            raise RuntimeError("game code failed to load: " + "; ".join(errors))

    # ------------------------------------------------------------ conversion
    def to_lua(self, obj):
        """Python dict/list -> Lua table (lists become 1-based arrays)."""
        if isinstance(obj, dict):
            return self.L.table_from({k: self.to_lua(v) for k, v in obj.items()})
        if isinstance(obj, (list, tuple)):
            return self.L.table_from({i + 1: self.to_lua(v) for i, v in enumerate(obj)})
        return obj

    def to_py(self, obj):
        """Lua table -> dict, or list when keys are 1..n."""
        if self.L.eval("type")(obj) != "table":
            return obj
        items = {k: self.to_py(v) for k, v in obj.items()}
        if items and all(isinstance(k, int) for k in items) and sorted(items) == list(range(1, len(items) + 1)):
            return [items[i] for i in range(1, len(items) + 1)]
        return items if items else []

    # ------------------------------------------------------------ heroes
    def hero(self, raw: dict):
        """Hero from a raw save entry (compact item strings, skill indices)."""
        return self.api.newHero(self.to_lua(copy.deepcopy(raw)))

    def set_skills(self, hero, attack_list, passive=None):
        """attack_list: 5 skill names or class-skill indices (0 = Basic)."""
        return self.to_py(self.api.setSkills(hero, self.to_lua(list(attack_list)), passive))

    def stats(self, hero) -> dict:
        return self.to_py(self.api.heroStats(hero))

    def skill_list(self, hero) -> list[str]:
        return self.to_py(self.g.heroList[hero["class"]].skillList)

    def passive_list(self, hero) -> list[str]:
        return self.to_py(self.g.heroList[hero["class"]].passiveList)

    # ------------------------------------------------------------ fights
    def fight(self, quest_id: int, front=(), back=(), seed=None, is_rare=False, amount=1) -> dict:
        """One battle. front/back: up to 3 heroes each (None for an empty slot)."""
        def row(heroes):
            return self.L.table_from({i + 1: h for i, h in enumerate(heroes) if h is not None})
        opts = {"isRare": is_rare, "amount": amount}
        if seed is not None:
            opts["seed"] = seed
        return self.to_py(self.api.fight(quest_id, row(front), row(back), self.to_lua(opts)))

    # ------------------------------------------------------------ map runs
    def map_run(self, map_spec, front=(), back=(), seed=1, scrolls=None) -> dict:
        """One full map run (game Campaign). map_spec: compact save string or
        {"id", "prestigeLevel", "grade", "prefix", "suffix"}. The seed fixes the
        map layout (rooms, enemies, rares) and the fights."""
        def row(heroes):
            return self.L.table_from({i + 1: h for i, h in enumerate(heroes) if h is not None})
        spec = map_spec if isinstance(map_spec, str) else self.to_lua(map_spec)
        opts = {"seed": seed}
        if scrolls:   # [{"id": 61, "prestigeLevel": 0}, ...]  (consumable ids 60-69)
            opts["scrolls"] = [dict(sc) for sc in scrolls]
        return self.to_py(self.api.mapRun(spec, row(front), row(back), self.to_lua(opts)))
