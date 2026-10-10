#!/usr/bin/env python3
"""Bring BKKx's architectural models into the atlas, drawn once.

BKKx (Nonarkara/BKKx) re-masses Old Town buildings by type:
  site/public/data/bkk-temple-roofs.geojson   — 350+ temple halls with
      tiered roofs, chedis as bell stacks, Wat Pho's eight prangs
  site/public/data/bkk-hero-monuments.geojson — Wat Arun (redented
      prangs on the Fine Arts Department's 82 m envelope), Wat Phra
      Kaew, the Golden Mount and other hero structures

Each model replaces a box in bkk-heritage-detail.geojson (and sometimes
its twin in bkk-landmarks.geojson). BKKx records that by setting
`hide_3d: true` + `hidden_by` on the box; the atlas filters hide_3d, so
copying those flags is what keeps a building from being drawn twice —
a box enclosing its own roof.

The atlas detail file is the same OSM extract as BKKx's (same ids, same
geometry), so flags are copied by id. BKKx's `row-strip:` flags are NOT
copied: the shophouse-strip layer they defer to is not served here.

  python3 scripts/sync-bkkx-models.py --bkkx ../BKKx          # write
  python3 scripts/sync-bkkx-models.py --bkkx ../BKKx --check  # CI-style

The model files are copied byte-for-byte; nothing is re-derived here.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
MODEL_FILES = ("bkk-temple-roofs.geojson", "bkk-hero-monuments.geojson")
FLAGGED_FILES = ("bkk-heritage-detail.geojson", "bkk-landmarks.geojson")
NOT_SERVED_HERE = ("row-strip:",)


def dump(data: dict, like: bytes) -> bytes:
    """Serialise in the style the file already uses, so diffs stay small."""
    if like.startswith(b"{\n"):
        text = json.dumps(data, ensure_ascii=False, indent=2)
    else:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return (text + ("\n" if like.endswith(b"\n") else "")).encode("utf-8")


def bkkx_flags(path: pathlib.Path) -> dict[str, str]:
    """id -> hidden_by, for every BKKx hide this atlas also draws."""
    flags = {}
    for f in json.loads(path.read_text("utf-8"))["features"]:
        p = f.get("properties") or {}
        by = str(p.get("hidden_by") or "")
        if p.get("hide_3d") is True and by and not by.startswith(NOT_SERVED_HERE):
            flags[str(p.get("id"))] = by
    return flags


def apply_flags(raw: bytes, flags: dict[str, str]) -> tuple[bytes, int, int]:
    data = json.loads(raw)
    hidden = cleared = 0
    for f in data["features"]:
        p = f.setdefault("properties", {})
        fid = str(p.get("id"))
        if fid in flags:
            if p.get("hide_3d") is not True or p.get("hidden_by") != flags[fid]:
                p["hide_3d"] = True
                p["hidden_by"] = flags[fid]
            hidden += 1
        elif "hidden_by" in p:
            # A flag this script set earlier whose BKKx model is gone.
            p.pop("hidden_by")
            p.pop("hide_3d", None)
            cleared += 1
    return dump(data, raw), hidden, cleared


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bkkx", required=True, type=pathlib.Path, help="BKKx checkout")
    ap.add_argument("--check", action="store_true", help="fail if anything would change")
    args = ap.parse_args()
    src = args.bkkx / "site" / "public" / "data"
    if not src.is_dir():
        print(f"no BKKx data at {src}", file=sys.stderr)
        return 2

    stale = []
    for name in MODEL_FILES:
        if not (PUBLIC / name).exists() or (PUBLIC / name).read_bytes() != (src / name).read_bytes():
            stale.append(name)
            if not args.check:
                shutil.copyfile(src / name, PUBLIC / name)
        print(f"{name}: {len(json.loads((src / name).read_text('utf-8'))['features'])} parts")

    for name in FLAGGED_FILES:
        flags = bkkx_flags(src / name)
        raw = (PUBLIC / name).read_bytes()
        out, hidden, cleared = apply_flags(raw, flags)
        missing = len(flags) - hidden
        print(f"{name}: {hidden} boxes yield to a model, {cleared} stale flags cleared"
              + (f", {missing} BKKx ids not in this file" if missing else ""))
        if out != raw:
            stale.append(name)
            if not args.check:
                (PUBLIC / name).write_bytes(out)

    if args.check and stale:
        print("out of date: " + ", ".join(stale), file=sys.stderr)
        return 1
    print("in sync" if not stale else "updated: " + ", ".join(stale))
    return 0


if __name__ == "__main__":
    sys.exit(main())
