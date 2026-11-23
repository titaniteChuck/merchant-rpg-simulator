"""Export the game data tables used by the TypeScript simulator to inventory/gamedata.json.

Tables keep their Lua shape: every table becomes a JSON object with the same keys
(1-based integer keys stay keys), so ported code reads them exactly like the game
does (heroList[cls].hpPlv[prestigeLevel]). Only literal data is exported; the
game's functions are re-implemented in web/src/sim/.

    python3 tools/export_gamedata.py [--src decompiled] [--out inventory/gamedata.json]
"""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

from luadata import Env, LuaTable

ROOT = Path(__file__).resolve().parent.parent

GLOBALS = [
    "itemData", "abilityData", "passiveData", "heroList", "questData", "parcelData",
    "prefixList", "suffixList", "rarityMod", "gradeBonus", "gradeParcelBonus", "gradeTime",
    "heroLevelRequirement", "itemFormula", "default", "currentQuestType", "crafterData",
]
DEFAULT_LOCALS = ["av", "ascStat", "potionStat", "potionStatPlaces", "bonusStatNames", "prestigeItemID",
                  "mapPrestigeMod", "mapPercentStats", "mapModStats", "fibo"]
# Text only the UI needs.
DROP_KEYS = {"desc", "desc1", "desc2", "lockedDesc", "image", "sheet", "icon"}


def to_json(v):
    if isinstance(v, LuaTable) or isinstance(v, dict):
        return {str(k): to_json(x) for k, x in v.items() if k not in DROP_KEYS}
    if isinstance(v, (list, tuple)):
        return {str(i + 1): to_json(x) for i, x in enumerate(v)}
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    return None   # functions and other non-literals


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=str(ROOT / "decompiled"))
    ap.add_argument("--out", default=str(ROOT / "inventory" / "gamedata.json"))
    args = ap.parse_args()
    env = Env()
    env.globals["itemData"] = LuaTable()
    for f in sorted(glob.glob(str(Path(args.src) / "data.*.lua"))):
        env.load(f)
    out = {name: to_json(env.globals[name]) for name in GLOBALS if name in env.globals}
    missing = [n for n in GLOBALS if n not in env.globals]
    locals_ = env.file_locals.get("data.Default", {})
    out["defaultLocals"] = {k: to_json(locals_[k]) for k in DEFAULT_LOCALS if k in locals_}
    # Keep source order: Lua pairs() order over constructor tables depends on it.
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")))
    print(f"{args.out}: {Path(args.out).stat().st_size // 1024} KB" + (f"; missing {missing}" if missing else ""))


if __name__ == "__main__":
    main()
