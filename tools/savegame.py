"""Find, snapshot and parse Merchant save files.

The game (Solar2D/Corona, Steam app 346750) writes its saves to
`system.DocumentsDirectory`, which on Windows is
`%APPDATA%\\Retora\\Merchant\\Documents`. This module looks for that folder on
the current OS, copies the save files into a local snapshot and parses
the copy. It never opens a game file for writing.

Files (GameObject:saveGame / saveInfoFile, saveSlotsHelper.saveFileNames):
    PlayerData.txt, Slot2Data.txt .. Slot5Data.txt   save slots 1-5
    ScribeExpData.txt                                 Scribe expansion slot
    <slot>Backup1..4.txt                              daily backups that rotate
    UserInfo.usr                                      settings, achievements, purchases
    camp_*.clog2, quest_*.clog2                       combat logs (not parsed)

Format: on PC a slot file is JSON encoded with base64 in a custom alphabet
(Utilities.baseEncode). Items are compact pipe strings (obj.ItemCompact).

Usage:
    python3 tools/savegame.py                       # auto-detect, slot 1, summary
    python3 tools/savegame.py --list                # show candidate folders and slots
    python3 tools/savegame.py --save-dir "/mnt/c/Users/me/AppData/Roaming/Retora/Merchant/Documents"
    python3 tools/savegame.py --save some/PlayerData.txt --json out.json

    from savegame import load_save
    sv = load_save()                 # or load_save(save_dir=..., slot=2) / load_save(save_file=...)
    sv.gold, sv.inventory[0], sv.crafters[7]["level"]
"""

from __future__ import annotations

import argparse
import base64
import glob
import json
import os
import platform
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = ROOT / "saves" / "snapshot"

STEAM_APP_ID = "346750"                      # config.lua steamAppId
COMPANY, APP = "Retora", "Merchant"
SLOT_NAMES = ["PlayerData", "Slot2Data", "Slot3Data", "Slot4Data", "Slot5Data"]   # saveSlotsHelper
SCRIBE_SLOT = "ScribeExpData"
INFO_FILE = "UserInfo.usr"
ENV_VAR = "MERCHANT_SAVE_DIR"

# Utilities.lua: baseEncode/baseDecode is plain base64 with this alphabet.
_GAME_B64 = "ABva12+rsKghixL6EueCl78fV5OPQmnopzTUyWXYZwb/RHIJqcdD0FG9MN34Sjkt"
_STD_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_TO_STD = str.maketrans(_GAME_B64, _STD_B64)
_NOT_ALPHABET = re.compile("[^" + re.escape(_GAME_B64) + "=]")


# --------------------------------------------------------------------------- decoding
def base_decode(text: str) -> bytes:
    """Utilities.baseDecode: drop characters outside the alphabet, then decode."""
    data = _NOT_ALPHABET.sub("", text).rstrip("=")
    data += "=" * (-len(data) % 4)
    return base64.b64decode(data.translate(_TO_STD))


def decode_save_text(text: str) -> dict:
    """GameObject:decodeSaveFile. PC saves are always encoded; mobile ones may be raw JSON."""
    if "{" in text:
        return json.loads(text)
    return json.loads(base_decode(text).decode("utf-8"))


ITEM_TYPES = {1: "material", 2: "consumable", 3: "equipment", 4: "map"}   # itemTypeToString
GRADES = "DCBAS"                                                          # gradeString, 1..5
EQUIP_BONUS = ["atkBns", "matkBns", "accBns", "critBns", "defBns", "mdefBns", "hpBns", "str", "int",
               "dex", "UNUSED", "lckMod", "expMod", "speed", "atkPct", "matkPct", "defPct", "mdefPct",
               "accPct", "critMod", "hpPct", "apMod"]
_FIELDS = {
    "material": ["itemType", "id", "amount", "grade"],
    "consumable": ["itemType", "id", "amount", "grade", "prestigeLevel"],
    "map": ["itemType", "id", "seed", "grade", "prefix", "suffix", "enchantAttempt", "prestigeLevel"],
    "equipment": ["itemType", "id", "grade", "itemSlot", "prefix", "suffix", "stats", "bns",
                  "enchantAttempt", "prestigeLevel"],
}
_TAIL_KEYS = {"S": {"S": "sellPrice", "B": "sellTime", "C": "startTime"},   # sale slot
              "C": {"C": "startTime", "B": "craftTime"}}


def _num(s: str):
    try:
        f = float(s)
    except ValueError:
        return s
    return int(f) if f.is_integer() and "." not in s else f


def _letter_pairs(word: str):
    return [(m.group(1), _num(m.group(2))) for m in re.finditer(r"([A-Za-z])(-?[\d.]+)", word)]


def _grade(word: str):
    """readCompactGrade: a plain number, or a stack split by grade, e.g. 'B93A100' -> {B: 93, A: 100}."""
    if not re.search(r"[A-Za-z]", word):
        return _num(word)
    return {g: n for g, n in _letter_pairs(word)}


def parse_item(compact: str) -> dict:
    """itemCompact.readCompact. Sale slots carry an extra tail ('S<price>B<time>C<start>')."""
    words = [w for w in compact.split("|") if w != ""]
    itype = ITEM_TYPES.get(int(words[0]), words[0])
    fields = _FIELDS.get(itype, _FIELDS["material"])
    out: dict = {"compact": compact}
    for name, word in zip(fields, words):
        if name == "itemType":
            out[name] = itype
        elif name == "id":
            out[name] = int(word, 16)
        elif name == "grade" and itype != "equipment":
            out[name] = _grade(word)
        elif name == "enchantAttempt":
            out[name] = [v for _, v in _letter_pairs(word)] or [0, 0, 0]
        elif name == "stats":
            keys = ({"A": "atk", "B": "matk", "C": "acc", "D": "crit"} if out.get("itemSlot") == 1
                    else {"A": "def", "B": "mdef"} if out.get("itemSlot") != 6 else {})
            out.update({keys[k]: v for k, v in _letter_pairs(word) if k in keys})
        elif name == "bns":
            if not word.startswith("0"):
                out.update({EQUIP_BONUS[ord(k) - 65]: v for k, v in _letter_pairs(word)})
        else:
            out[name] = _num(word)
    tail = words[len(fields):]
    if tail:
        keys = _TAIL_KEYS.get(tail[0][:1], {})
        out.update({keys[k]: v for k, v in _letter_pairs(tail[0]) if k in keys})
    return out


def parse_craft(compact: str) -> dict:
    """itemCompact.readCompactCraft: the item a crafter is working on."""
    names = ["itemType", "id", "grade", "amount", "startTime", "craftTime", "prestigeLevel",
             "_suffixBoost", "_prefixBoost"]
    out: dict = {}
    for name, word in zip(names, compact.split("|")):
        out[name] = (ITEM_TYPES.get(int(word), word) if name == "itemType"
                     else int(word, 16) if name == "id" else _num(word))
    return out


def stack_amount(item: dict) -> int:
    """Total count of a material/consumable stack (its grade may be split per grade letter)."""
    if item.get("itemType") in ("material", "consumable"):
        return item.get("amount", 0)
    return 1


# --------------------------------------------------------------------------- locating
def detect_os() -> str:
    """'windows', 'wsl', 'macos' or 'linux'."""
    if os.name == "nt":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    if "microsoft" in platform.release().lower() or os.environ.get("WSL_DISTRO_NAME"):
        return "wsl"
    return "linux"


def _steam_roots_linux() -> list[Path]:
    home = Path.home()
    roots = [home / ".steam/steam", home / ".steam/root", home / ".local/share/Steam",
             home / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
             home / "snap/steam/common/.local/share/Steam"]
    libs = []
    for r in roots:
        vdf = r / "steamapps/libraryfolders.vdf"
        libs.append(r)
        if vdf.is_file():
            libs += [Path(p) for p in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(errors="ignore"))]
    seen, out = set(), []
    for p in libs:
        key = str(p.resolve()) if p.exists() else str(p)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def candidate_dirs(os_name: str | None = None) -> list[Path]:
    """Folders where the game may keep its Documents directory, most likely first."""
    os_name = os_name or detect_os()
    rel = Path(COMPANY, APP, "Documents")
    out: list[Path] = []
    if os.environ.get(ENV_VAR):
        out.append(Path(os.environ[ENV_VAR]).expanduser())
    if os_name == "windows":
        if os.environ.get("APPDATA"):
            out.append(Path(os.environ["APPDATA"]) / rel)
        out.append(Path.home() / "AppData/Roaming" / rel)
    elif os_name == "wsl":
        # Windows user names need not match the Linux one: try every profile on each mounted drive.
        out += [Path(p) for p in sorted(glob.glob(f"/mnt/*/Users/*/AppData/Roaming/{COMPANY}/{APP}/Documents"))]
    elif os_name == "macos":
        # Solar2D macOS builds; not checked against a real install.
        sup = Path.home() / "Library/Application Support"
        out += [sup / APP / "Documents", sup / COMPANY / APP / "Documents"]
        out += [Path(p) for p in glob.glob(str(Path.home() / f"Library/Containers/*/Data/Library/Application Support/{APP}/Documents"))]
    if os_name in ("linux", "wsl"):
        # Steam Play / Proton prefix.
        for lib in _steam_roots_linux():
            out.append(lib / f"steamapps/compatdata/{STEAM_APP_ID}/pfx/drive_c/users/steamuser/AppData/Roaming" / rel)
    seen, uniq = set(), []
    for p in out:
        if str(p) not in seen:
            seen.add(str(p))
            uniq.append(p)
    return uniq


def slot_files(save_dir: Path) -> dict[str, Path]:
    """Slot name -> main save file present in `save_dir`."""
    return {n: save_dir / f"{n}.txt" for n in SLOT_NAMES + [SCRIBE_SLOT] if (save_dir / f"{n}.txt").is_file()}


def find_save_dir(save_dir: str | Path | None = None) -> Path:
    """The override if given (must hold a save), else the candidate with the newest slot file."""
    if save_dir is not None:
        p = Path(save_dir).expanduser()
        if not p.is_dir():
            raise FileNotFoundError(f"save folder not found: {p}")
        if not slot_files(p):
            raise FileNotFoundError(f"no save slot (*.txt from {SLOT_NAMES + [SCRIBE_SLOT]}) in {p}")
        return p
    found = [p for p in candidate_dirs() if p.is_dir() and slot_files(p)]
    if not found:
        raise FileNotFoundError(
            "no Merchant save folder found. Looked in:\n  " + "\n  ".join(map(str, candidate_dirs()))
            + f"\nPass --save-dir / --save or set {ENV_VAR}.")
    return max(found, key=lambda p: max(f.stat().st_mtime for f in slot_files(p).values()))


def resolve_slot(slot) -> str:
    """1-5, 'scribe', or a file stem such as 'PlayerData' / 'PlayerDataBackup2'."""
    s = str(slot)
    if s.isdigit() and 1 <= int(s) <= len(SLOT_NAMES):
        return SLOT_NAMES[int(s) - 1]
    if s.lower() == "scribe":
        return SCRIBE_SLOT
    return s


# --------------------------------------------------------------------------- snapshot
def snapshot(files: list[Path], dest: Path = SNAPSHOT_DIR) -> list[Path]:
    """Copy game files into `dest` (read-only access to the sources) and return the copies."""
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    out = []
    for src in files:
        src = src.resolve()
        if src.parent == dest:
            out.append(src)              # already a local copy
            continue
        target = dest / src.name
        with open(src, "rb") as fin, open(target, "wb") as fout:
            shutil.copyfileobj(fin, fout)
        shutil.copystat(src, target)
        out.append(target)
    return out


# --------------------------------------------------------------------------- model
@dataclass
class Save:
    source: Path            # original file in the game folder (never written)
    path: Path              # local copy that was parsed
    slot: str
    raw: dict
    info: dict | None = None
    inventory: list[dict] = field(default_factory=list)
    map_inventory: list[dict] = field(default_factory=list)
    sales: list[dict | None] = field(default_factory=list)
    heroes: list[dict] = field(default_factory=list)
    crafters: dict[int, dict] = field(default_factory=dict)   # crafterData id -> save entry

    @property
    def gold(self) -> int:
        return self.raw.get("gold", 0)

    @property
    def save_time(self) -> int:
        return self.raw.get("saveTime", 0)

    def owned(self, include_heroes: bool = True, include_sales: bool = True) -> dict[tuple[str, int, int], int]:
        """(itemType, id, ascension level) -> count over inventory, maps, sale slots and hero gear."""
        pools = [self.inventory, self.map_inventory]
        if include_sales:
            pools.append([s for s in self.sales if s])
        if include_heroes:
            pools += [h["heroInventory"] for h in self.heroes]
        out: dict[tuple[str, int, int], int] = {}
        for pool in pools:
            for it in pool:
                key = (it["itemType"], it["id"], it.get("prestigeLevel", 0) or 0)
                out[key] = out.get(key, 0) + stack_amount(it)
        return out


def parse_save(raw: dict) -> dict:
    """Expand the compact strings of a decoded save into dicts."""
    heroes = []
    for h in raw.get("hero", []):
        h = dict(h)
        h["heroInventory"] = [parse_item(c) for c in h.get("heroInventory", []) if isinstance(c, str)]
        heroes.append(h)
    crafters = {}
    for c in raw.get("crafter", []):
        if c:
            c = dict(c)
            if isinstance(c.get("isCrafting"), str):
                c["isCrafting"] = parse_craft(c["isCrafting"])
            crafters[c["id"]] = c
    return {
        "inventory": [parse_item(c) for c in raw.get("inventory", []) if isinstance(c, str)],
        "map_inventory": [parse_item(c) for c in raw.get("mapInventory", []) if isinstance(c, str)],
        "sales": [parse_item(c) if isinstance(c, str) else None for c in raw.get("sales", [])],
        "heroes": heroes,
        "crafters": crafters,
    }


def parse_info(text: str) -> dict:
    """GameObject:loadInfoFile: JSON with purchaseList / moreInfo encoded inside."""
    info = json.loads(text)
    for k in ("purchaseList", "moreInfo"):
        if isinstance(info.get(k), str):
            try:
                info[k] = json.loads(base_decode(info[k]).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                pass
    return info


def load_save(save_dir: str | Path | None = None, slot=1, save_file: str | Path | None = None,
              snapshot_dir: Path = SNAPSHOT_DIR) -> Save:
    """Locate a save, copy it (plus UserInfo.usr) to `snapshot_dir` and parse the copy.

    save_file: a specific .txt (slot or backup); its folder is used for UserInfo.usr.
    save_dir:  the game's Documents folder; default = auto-detected.
    slot:      1-5, 'scribe' or a file stem like 'PlayerDataBackup2'.
    """
    if save_file is not None:
        src = Path(save_file).expanduser()
        if not src.is_file():
            raise FileNotFoundError(f"save file not found: {src}")
        folder = src.parent
    else:
        folder = find_save_dir(save_dir)
        src = folder / f"{resolve_slot(slot)}.txt"
        if not src.is_file():
            raise FileNotFoundError(f"{src.name} not in {folder}; slots present: {', '.join(slot_files(folder)) or 'none'}")
    files = [src] + ([folder / INFO_FILE] if (folder / INFO_FILE).is_file() else [])
    copies = snapshot(files, snapshot_dir)
    raw = decode_save_text(copies[0].read_text(encoding="utf-8", errors="replace"))
    info = parse_info(copies[1].read_text(encoding="utf-8")) if len(copies) > 1 else None
    return Save(source=src, path=copies[0], slot=src.stem, raw=raw, info=info, **parse_save(raw))


# --------------------------------------------------------------------------- named tables
SLOT_LABELS = {1: "weapon", 2: "head", 3: "body", 4: "hands", 5: "feet", 6: "trinket"}   # itemSlot


def grade_label(gr) -> str:
    """5 -> 'S'; {'B': 93, 'A': 100} -> 'B93 A100'."""
    if isinstance(gr, dict):
        return " ".join(f"{k}{v}" for k, v in gr.items())
    return GRADES[int(gr) - 1] if isinstance(gr, (int, float)) and 1 <= gr <= 5 else str(gr)


def mod_names(g, it) -> tuple[str, str]:
    pre = g.prefixes.get(it.get("prefix") or 0, {}).get("name") or ""
    suf = g.suffixes.get(it.get("suffix") or 0, {}).get("name") or ("Worn" if it.get("suffix") == -1 else "")
    return pre, suf


def item_label(g, it) -> str:
    """Display name with prefix and suffix, e.g. 'Strong Undertaker +10'."""
    if g is None:
        return f"{it['itemType']}#{it['id']}"
    pre, suf = mod_names(g, it)
    return " ".join(x for x in (pre, g.name(it["itemType"], it["id"]), suf) if x)


def _item_row(g, it) -> dict:
    """Columns shared by every item table."""
    itype, iid = it["itemType"], it["id"]
    data = g.items.get(itype, {}).get(iid, {})
    asc = it.get("prestigeLevel", 0) or 0
    pre, suf = mod_names(g, it)
    mods = bool(it.get("prefix")) + bool(it.get("suffix") and it["suffix"] > 0)
    amount = stack_amount(it)
    unit = g.sell_value(itype, iid, asc, mods) if data else ""
    return {
        "type": itype, "id": iid, "name": item_label(g, it), "base_name": data.get("name", "?"),
        "subtype": data.get("subType", ""), "item_level": data.get("itemLevel", ""), "asc": asc,
        "grade": grade_label(it.get("grade")), "prefix": pre, "suffix": suf, "mods": mods,
        "rarity": g.rarity(itype, iid, mods) if data else "", "amount": amount,
        "unit_sell": unit, "total_sell": unit * amount if unit != "" else "",
    }


def inventory_rows(sv: Save, g, include_sales: bool = True) -> list[dict]:
    """Inventory stacks (save order) then items on the sale counter."""
    rows = [{"where": "inventory", "slot": n, **_item_row(g, it)} for n, it in enumerate(sv.inventory, 1)]
    if include_sales:
        for n, it in enumerate(sv.sales, 1):
            if it:
                rows.append({"where": "counter", "slot": n, **_item_row(g, it),
                             "sale_price": it.get("sellPrice", "")})
    return rows


def map_rows(sv: Save, g) -> list[dict]:
    from profit import map_essence     # lazy: profit imports this module
    rows = []
    for n, it in enumerate(sv.map_inventory, 1):
        data = g.items["map"].get(it["id"], {})
        ea = it.get("enchantAttempt") or [0, 0, 0]
        grade = it.get("grade") if isinstance(it.get("grade"), int) else 3
        ess = map_essence(g, it["id"], it.get("prestigeLevel", 0) or 0, grade,
                          ((1.0, it.get("prefix") or 0, max(it.get("suffix") or 0, 0)),)) if data else {}
        rows.append({"slot": n, **_item_row(g, it),
                     "essence": ", ".join(f"{amt:g}x {g.name(t, eid)}" for (t, eid), amt in ess.items()),
                     "boss": ", ".join(g.quests[b]["name"] for b in data.get("bossList", []) if b in g.quests),
                     "rare_boss": data.get("isRareBoss", ""),
                     "enemies": data.get("baseEnemyAmount", ""), "enemy_mod": data.get("enemyMod", ""),
                     "base_time_min": round((data.get("baseMapTime") or 0) / 60, 1),
                     "enchant_attempts": "/".join(str(x) for x in ea), "seed": it.get("seed", "")})
    return rows


def skill_names(g, hero_class, attack_list) -> list[str]:
    """Hero:returnSaveData stores attacks as indices into heroList[class].skillList, 0 = 'Basic'."""
    skills = g.heroes.get(hero_class, {}).get("skillList") or []
    out = []
    for a in attack_list:
        if isinstance(a, str):
            out.append(a)
        elif a == 0:
            out.append("Basic")
        else:
            out.append(skills[a - 1] if 0 < a <= len(skills) else f"#{a}")
    return out


def hero_rows(sv: Save, g) -> list[dict]:
    """One row per hero (summary)."""
    rows = []
    for n, h in enumerate(sv.heroes, 1):
        status = (f"campaign {h['campaignID']}" if (h.get("campaignID") or -1) > 0
                  else f"quest {h['questListID']}" if (h.get("questListID") or -1) > 0 else "idle")
        sets = h.get("skillSet") or []
        cur = sets[(h.get("currentSkillSet") or 1) - 1] if sets else {}
        gear = h.get("heroInventory", [])
        rows.append({"n": n, "name": h.get("name"), "class": g.heroes.get(h.get("class"), {}).get("name", h.get("class")),
                     "level": h.get("level"), "asc": h.get("prestigeLevel", 0), "exp": h.get("exp"),
                     "quests": h.get("totalQuests", 0), "deaths": h.get("totalDeath", 0), "status": status,
                     "skill_set": h.get("currentSkillSet"), "passive": cur.get("passive", ""),
                     "attacks": " / ".join(skill_names(g, h.get("class"), cur.get("attackList", []))),
                     "gear_min_ilvl": min((g.items["equipment"].get(i["id"], {}).get("itemLevel", 0) for i in gear), default=""),
                     "gear_mods": sum(bool(i.get("prefix")) + bool((i.get("suffix") or 0) > 0) for i in gear)})
    return rows


def hero_gear_rows(sv: Save, g) -> list[dict]:
    """One row per equipped item; stats as stored in the save."""
    rows = []
    stat_keys = ["atk", "matk", "acc", "crit", "def", "mdef"] + [k for k in EQUIP_BONUS if k != "UNUSED"]
    for n, h in enumerate(sv.heroes, 1):
        for it in h.get("heroInventory", []):
            r = {"hero_n": n, "hero": h.get("name"), "class": g.heroes.get(h.get("class"), {}).get("name", h.get("class")),
                 "slot": SLOT_LABELS.get(it.get("itemSlot"), it.get("itemSlot")), **_item_row(g, it)}
            r.update({k: it.get(k, "") for k in stat_keys})
            rows.append(r)
    return rows


def export_csv(sv: Save, g, out_dir: Path) -> list[Path]:
    """Write inventory.csv, maps.csv, heroes.csv, hero_gear.csv into `out_dir` (never the game folder)."""
    import csv
    out_dir = Path(out_dir).resolve()
    if out_dir == sv.source.parent.resolve():
        raise ValueError("refusing to write into the game's save folder")
    out_dir.mkdir(parents=True, exist_ok=True)
    tables = {"inventory": inventory_rows(sv, g), "maps": map_rows(sv, g),
              "heroes": hero_rows(sv, g), "hero_gear": hero_gear_rows(sv, g)}
    written = []
    for name, rows in tables.items():
        path = out_dir / f"{name}.csv"
        fields = list(dict.fromkeys(k for r in rows for k in r)) or ["empty"]
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
        written.append(path)
    return written


# --------------------------------------------------------------------------- CLI helpers
def add_save_args(ap: argparse.ArgumentParser) -> None:
    """Shared options for the tools that read a save."""
    g = ap.add_argument_group("save file")
    g.add_argument("--save-dir", metavar="DIR",
                   help=f"game Documents folder (default: auto-detect; env {ENV_VAR} also works)")
    g.add_argument("--save", metavar="FILE", help="a specific save .txt (slot or backup) instead of --save-dir/--slot")
    g.add_argument("--slot", default="1", help="save slot: 1-5, 'scribe', or a file stem like PlayerDataBackup2")


def load_from_args(args) -> Save:
    return load_save(save_dir=args.save_dir, slot=args.slot, save_file=args.save)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_save_args(ap)
    ap.add_argument("--list", action="store_true", help="show the detected OS, candidate folders and slots, then exit")
    ap.add_argument("--json", metavar="OUT", help="write the decoded and parsed save as JSON")
    ap.add_argument("--show", action="append", choices=SECTIONS,
                    help="sections to print (repeatable; default: all)")
    ap.add_argument("--export", metavar="DIR", nargs="?", const=str(ROOT / "saves"),
                    help="write inventory.csv, maps.csv, heroes.csv, hero_gear.csv (default dir: saves/)")
    args = ap.parse_args()

    if args.list:
        print(f"OS: {detect_os()}")
        for p in candidate_dirs():
            slots = slot_files(p) if p.is_dir() else {}
            state = (", ".join(slots) if slots else "no slots") if p.is_dir() else "missing"
            print(f"  {p}  [{state}]")
        return

    try:
        sv = load_from_args(args)
    except FileNotFoundError as e:
        sys.exit(str(e))

    if args.json:
        out = {"source": str(sv.source), "slot": sv.slot, "raw": sv.raw, "info": sv.info,
               "inventory": sv.inventory, "map_inventory": sv.map_inventory, "sales": sv.sales,
               "heroes": sv.heroes, "crafters": sv.crafters}
        Path(args.json).write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")

    from gamedata import load_game
    g = load_game()

    if args.export:
        for path in export_csv(sv, g, Path(args.export)):
            print(f"wrote {path}")
        print()

    show = set(args.show or SECTIONS)
    print_report(sv, g, show)


SECTIONS = ["summary", "crafters", "heroes", "gear", "maps", "inventory"]


def print_report(sv: Save, g, show) -> None:
    import datetime as dt
    if "summary" in show:
        when = dt.datetime.fromtimestamp(sv.save_time).strftime("%Y-%m-%d %H:%M") if sv.save_time else "?"
        print(f"{sv.slot} from {sv.source}\n  parsed copy: {sv.path}")
        print(f"  version {sv.raw.get('version')}, mode {sv.raw.get('gameMode')}, saved {when}")
        print(f"  gold {sv.gold:,}, total gold earned {sv.raw.get('totalGoldEarned', 0):,}, "
              f"crafted {sv.raw.get('totalCrafted', 0):,}, sales {sv.raw.get('totalSales', 0):,}")
        print(f"  inventory {len(sv.inventory)} stacks, maps {len(sv.map_inventory)}/{sv.raw.get('mapSlotsUnlocked', '?')}, "
              f"sale slots {sum(1 for s in sv.sales if s)}/{len(sv.sales)}")

    if "crafters" in show:
        print("\nCrafters:")
        for cid, c in sorted(sv.crafters.items()):
            busy = c.get("isCrafting")
            work = (f"  crafting {busy['amount']}x {item_label(g, busy)} (asc {busy.get('prestigeLevel', 0)})"
                    if isinstance(busy, dict) else "")
            print(f"  {g.crafters.get(cid, {}).get('name', cid):12} lvl {c.get('level'):>2}  asc {c.get('ascLevel', 0)}"
                  f"  prestige lvl {c.get('prestigeLevel', 0)}{work}")

    if "heroes" in show or "gear" in show:
        print("\nHeroes:")
        gear = hero_gear_rows(sv, g) if "gear" in show else []
        for h in hero_rows(sv, g):
            print(f"  {h['n']:>2} {h['name'][:14]:14} {str(h['class'])[:11]:11} lvl {h['level']:>2} asc {h['asc']}"
                  f"  quests {h['quests']:>4} deaths {h['deaths']:>3}  {h['status']:11} passive {h['passive']}")
            for r in (x for x in gear if x["hero_n"] == h["n"]):
                print(f"       {r['slot']:8} {r['name'][:38]:38} ilvl {r['item_level']:>2} {r['grade']} asc {r['asc']}")

    if "maps" in show:
        rows = map_rows(sv, g)
        print(f"\nMaps ({len(rows)}/{sv.raw.get('mapSlotsUnlocked', '?')} slots):")
        print(f"  {'name':30} {'lvl':>3} {'asc':>3} {'grd':>3} {'foes':>4} {'min':>5} {'sell':>6}  {'essence/run':24} boss")
        for r in rows:
            print(f"  {r['name'][:30]:30} {r['item_level']:>3} {r['asc']:>3} {r['grade']:>3} {r['enemies']:>4} "
                  f"{r['base_time_min']:>5} {r['unit_sell']:>6}  {r['essence'][:24]:24} {r['boss']}")

    if "inventory" in show:
        rows = inventory_rows(sv, g)
        by_type: dict[str, list] = {}
        for r in rows:
            by_type.setdefault("counter" if r["where"] == "counter" else r["type"], []).append(r)
        total = sum(r["total_sell"] or 0 for r in rows)
        print(f"\nInventory ({len(sv.inventory)} stacks, base sell value {total:,.0f} g):")
        for t in ("equipment", "consumable", "material", "map", "counter"):
            part = by_type.get(t)
            if not part:
                continue
            print(f"  -- {t} ({len(part)}, {sum(r['total_sell'] or 0 for r in part):,.0f} g)")
            for r in part:
                price = f"  listed {r['sale_price']}" if r.get("sale_price") else ""
                print(f"    {r['name'][:38]:38} {r['subtype'][:10]:10} ilvl {r['item_level']!s:>2} asc {r['asc']}"
                      f"  {r['grade']:<16} x{r['amount']:<5} {r['total_sell']!s:>8} g{price}")


if __name__ == "__main__":
    main()
