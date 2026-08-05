#!/usr/bin/env python3
"""Rebuild bkk-land-price.geojson display positions.

The original file laid 477 UTMMAP3 zones along two diagonal
"space-filling" trails inside the Bangkok bbox — which rendered as
awkward yellow/red columns when the land-price circle layer was on.

We do not have official cadastral centroids yet. Until then, place
each zone in a rectangular grid inside an approximate map-sheet
bbox derived from the zone_id prefix (5035 / 5036 / 5135 / 5136).
Properties (price, parcel counts) are preserved exactly.

Usage:
  python3 scripts/rebuild-land-price-positions.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "bkk-land-price.geojson"

# Approximate Bangkok-metro extents for the four UTMMAP3 sheet prefixes
# present in the Treasury extract. These are civic-demo display boxes,
# not official sheet corners.
SHEET_BBOX = {
    "5035": (100.30, 13.45, 100.52, 13.68),  # SW fringe
    "5036": (100.30, 13.68, 100.55, 14.05),  # west / northwest
    "5135": (100.55, 13.45, 100.95, 13.70),  # southeast
    "5136": (100.48, 13.62, 100.95, 14.08),  # core + east (majority)
}
DEFAULT_BBOX = (100.30, 13.49, 100.95, 14.10)


def sheet_key(zone_id: str) -> str:
    return zone_id.split("-", 1)[0]


def grid_positions(n: int, bbox: tuple[float, float, float, float]) -> list[tuple[float, float]]:
    """Fill bbox with an n-point rectangular grid (row-major)."""
    if n <= 0:
        return []
    min_lng, min_lat, max_lng, max_lat = bbox
    cols = max(1, math.ceil(math.sqrt(n * (max_lng - min_lng) / max(max_lat - min_lat, 1e-6))))
    rows = max(1, math.ceil(n / cols))
    # Inset so edge points aren't on the coastline clip.
    pad_lng = (max_lng - min_lng) * 0.04
    pad_lat = (max_lat - min_lat) * 0.04
    left, right = min_lng + pad_lng, max_lng - pad_lng
    bottom, top = min_lat + pad_lat, max_lat - pad_lat
    positions: list[tuple[float, float]] = []
    for i in range(n):
        r, c = divmod(i, cols)
        x = left if cols == 1 else left + (right - left) * (c / (cols - 1))
        y = bottom if rows == 1 else bottom + (top - bottom) * (r / (rows - 1))
        # Tiny deterministic jitter from index so equal-spaced dots don't
        # read as a perfect lattice (still not centroids).
        jitter_lng = ((i * 37) % 11 - 5) * (right - left) * 0.0015
        jitter_lat = ((i * 53) % 11 - 5) * (top - bottom) * 0.0015
        positions.append((x + jitter_lng, y + jitter_lat))
    return positions


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    features = data["features"]

    by_sheet: dict[str, list] = {}
    for feature in features:
        key = sheet_key(feature["properties"]["zone_id"])
        by_sheet.setdefault(key, []).append(feature)

    for sheet, group in by_sheet.items():
        group.sort(key=lambda f: f["properties"]["zone_id"])
        bbox = SHEET_BBOX.get(sheet, DEFAULT_BBOX)
        positions = grid_positions(len(group), bbox)
        for feature, (lng, lat) in zip(group, positions):
            feature["geometry"] = {
                "type": "Point",
                "coordinates": [round(lng, 6), round(lat, 6)],
            }

    data["notes"] = (
        "Aggregated from 2,281,482 parcels to 477 UTMMAP3 zones. "
        "Display positions are approximate rectangular grids inside "
        "map-sheet bboxes derived from zone_id prefixes (5035/5036/5135/5136) "
        "— NOT cadastral centroids. Rebuild with "
        "scripts/rebuild-land-price-positions.py. Replace with Royal Thai "
        "Survey Department polygons when available."
    )
    data["layout"] = "sheet-grid-v2"
    data["layoutWarning"] = (
        "Visual proxy only. Nearest-zone lookups are approximate until "
        "official centroids/polygons ship."
    )

    SRC.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"rewrote {SRC} ({len(features)} features, sheets={sorted(by_sheet)})")


if __name__ == "__main__":
    main()
