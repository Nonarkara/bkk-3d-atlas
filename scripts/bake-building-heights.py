#!/usr/bin/env python3
"""
bake-building-heights.py
------------------------
Bake `render_height` and `render_min_height` onto every building in an
OSM-derived GeoJSON, using the atlas's own height rule.

Why this exists: the client already knows how tall a building is. The rule
lives in public/building-heights.js and is duplicated as a MapLibre
expression (HEIGHT_GET / MIN_HEIGHT_GET) so the map can extrude without
waiting for JavaScript. But the three.js massing layer cannot run a
MapLibre expression, and it needs a *number* per feature — so the tiles
carry the same number the expression would compute, baked at build time.

The rule, copied from public/building-heights.js (family "metro"):

  height = tagged height            if 1 <= height <= 500
         = levels * 3.15            if 1 <= levels <= 160
         = HEIGHT_BY_TYPE[building] if the type is known
         = 8.5                      otherwise
  base   = min_height               if min_height < height
         = height                   otherwise (the metro rule collapses
                                       the extrusion rather than drawing a
                                       zero-height box)

If this file and public/building-heights.js ever disagree, the map and the
massing layer disagree with each other — one building, two heights. There
is a test on the JavaScript side (scripts/test-building-heights.mjs) that
walks the same cases through both; keep them in step.

Usage:
    python3 scripts/bake-building-heights.py \\
        --input  ./out/bkk-buildings.geojson \\
        --output ./out/bkk-buildings-h.geojson

The output is a GeoJSON FeatureCollection whose features carry only the
attributes the atlas needs, so the tiles stay small.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Iterator

# public/building-heights.js — LEVEL_HEIGHT_M
LEVEL_HEIGHT_M = 3.15

# public/building-heights.js — DEFAULT_HEIGHT
DEFAULT_HEIGHT = 8.5

# public/building-heights.js — HEIGHT_BY_TYPE
HEIGHT_BY_TYPE = {
    "hotel": 28,
    "office": 25,
    "hospital": 22,
    "apartments": 21,
    "condominium": 24,
    "dormitory": 18,
    "commercial": 14,
    "retail": 14,
    "supermarket": 12,
    "mall": 20,
    "university": 16,
    "college": 16,
    "school": 12,
    "kindergarten": 8,
    "temple": 14,
    "pagoda": 24,
    "monastery": 14,
    "government": 18,
    "civic": 15,
    "train_station": 14,
    "transportation": 14,
    "industrial": 10,
    "warehouse": 10,
    "factory": 10,
    "house": 8.5,
    "residential": 8.5,
    "terrace": 8.5,
    "detached": 8.5,
}

# The attributes the atlas keeps. This is the same list the previous
# metro archive was built with, plus `osm_id` — the OpenStreetMap id of
# the way or relation the footprint came from.
#
# `osm_id` is not decoration. The atlas draws some buildings twice: once
# as a MapLibre extrusion and once as a three.js massing mesh, and the
# second has to be able to tell the map "hide this one". A vector tile's
# own feature id is local to its tile and changes with the zoom, so it
# cannot be used for that. The OSM id is the same everywhere, which is
# what lets the two layers agree.
KEEP = (
    "building",
    "amenity",
    "religion",
    "tourism",
    "historic",
    "denomination",
    "name",
    "name:en",
    "name:th",
)


def osm_id_of(feature: dict[str, Any]) -> int | None:
    """The numeric OSM id of a feature, from osmium's `type_id` form.

    osmium writes ids as "w1234" (way), "r1234" (relation), "n1234"
    (node) or "a1234" (an area promoted from a closed way). The number
    is the OSM id; the letter says which kind of object it was. Only
    ways and relations carry a building outline, and both are wanted
    here, so the letter is dropped and the number is kept.
    """
    raw = feature.get("id")
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    digits = "".join(char for char in text if char.isdigit())
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def number(value: Any) -> float:
    """Parse a height-ish value. OSM writes these in every shape."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().lower()
    if not text:
        return 0.0
    # "12 m", "12m", "12.5", "12'6\"" — take the leading number.
    digits = ""
    for char in text:
        if char.isdigit() or char in ".-+":
            digits += char
        else:
            break
    try:
        return float(digits)
    except ValueError:
        return 0.0


def resolve_height(props: dict[str, Any]) -> float:
    tagged = number(props.get("height"))
    if 1 <= tagged <= 500:
        return tagged
    levels = number(
        props.get("building:levels") or props.get("building_levels") or props.get("levels")
    )
    if 1 <= levels <= 160:
        return min(500.0, levels * LEVEL_HEIGHT_M)
    kind = str(props.get("building") or props.get("building_type") or "").strip()
    return HEIGHT_BY_TYPE.get(kind, DEFAULT_HEIGHT)


def resolve_base(props: dict[str, Any], height: float) -> float:
    raw = number(props.get("min_height") or props.get("base_height"))
    # The metro rule: a base at or above the height collapses the extrusion.
    return height if raw >= height else max(0.0, raw)


def read_features(path: str) -> Iterator[dict[str, Any]]:
    """Stream a GeoJSON file written one feature per line.

    osmium writes the FeatureCollection with one feature per line, so the
    file never has to sit in memory as one object — 478K buildings is a
    lot of Python dictionaries.
    """
    with open(path, "r", encoding="utf-8") as handle:
        first = handle.readline()
        if '"FeatureCollection"' not in first:
            raise SystemExit(f"{path} does not look like a GeoJSON FeatureCollection")
        for line in handle:
            line = line.strip()
            if not line or line in ("}", "]", "}"):
                continue
            if line.endswith(","):
                line = line[:-1]
            if not line.startswith("{"):
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--skip-no-building",
        action="store_true",
        help="drop features without a building tag (relation members)",
    )
    args = parser.parse_args()

    kept = 0
    dropped = 0
    with open(args.output, "w", encoding="utf-8") as out:
        out.write('{"type":"FeatureCollection","features":[\n')
        first = True
        for feature in read_features(args.input):
            props = feature.get("properties") or {}
            if args.skip_no_building and "building" not in props:
                dropped += 1
                continue
            geometry = feature.get("geometry")
            if not geometry or not geometry.get("coordinates"):
                dropped += 1
                continue
            height = resolve_height(props)
            base = resolve_base(props, height)
            keep = {key: props[key] for key in KEEP if key in props}
            keep["render_height"] = round(height, 3)
            keep["render_min_height"] = round(base, 3)
            osm_id = osm_id_of(feature)
            if osm_id is not None:
                keep["osm_id"] = osm_id
            record = {
                "type": "Feature",
                "geometry": geometry,
                "properties": keep,
            }
            if feature.get("id"):
                record["id"] = feature["id"]
            if not first:
                out.write(",\n")
            out.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            first = False
            kept += 1
        out.write("\n]}\n")

    print(f"Wrote {kept} buildings to {args.output} (dropped {dropped})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
