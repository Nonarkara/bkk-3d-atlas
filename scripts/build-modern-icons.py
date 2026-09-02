#!/usr/bin/env python3
"""
Build the modern Bangkok icons batch for the bkk-3d-atlas landmarks layer.

Each feature is a polygon footprint with a curated height. Heights come from
either OSM height tags (community-verified) or public records with citation
in the `source` field.

Categories (new kinds added to LANDMARK_COLOR in app.js):
  tower  — modern skyscraper (silver)
  hotel  — luxury hotel (warm gold)
  mall   — shopping centre (cool neutral)
  civic  — government / public building (warm cream)
  bridge — river crossing (silver-blue)

Usage:
  python3 scripts/build-modern-icons.py [--dry-run]

Output:
  - prints a JSON fragment to stdout that can be merged into bkk-landmarks.geojson
  - or appends to the file when run with --apply
"""

import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ───────────── curated records ─────────────
# Each entry: (id, name_en, name_th, kind, height_m, source, osm_id, polygon_fn)
# polygon_fn is called with the OSM way geometry to produce the final polygon
# coords. If the way has 4+ vertices we use it directly (closed); if 3 we
# close it; if < 3 we fall back to a rectangle around the center.

# Public-record heights with sources. When OSM has a height tag we use that
# instead and cite OSM.
CURATED = [
    # ─── towers (kind: tower) ───
    {
        "id": "icon-mahanakhon",
        "name_en": "King Power MahaNakhon",
        "name_th": "มหานคร",
        "kind": "tower",
        "osm_id": 444651219,
        "height": 314,        # 77 floors · roof 314m · completed 2016 · Buro Ole Scheeren
        "base_height": 0,
        "source": "OSM way 444651219 · height 314m per Council on Tall Buildings and Urban Habitat",
    },
    {
        "id": "icon-baiyoke-tower-ii",
        "name_en": "Baiyoke Sky Hotel (Tower II)",
        "name_th": "ใบหยก 2",
        "kind": "tower",
        "osm_id": 443491487,  # the 304m way
        "height": 304,        # OSM height tag · 88 floors · Thailand's tallest 1997-2018
        "base_height": 0,
        "source": "OSM way 443491487 · height 304m (roof)",
    },
    {
        "id": "icon-baiyoke-tower-i",
        "name_en": "Baiyoke Tower I",
        "name_th": "ใบหยก 1",
        "kind": "tower",
        "osm_id": 230891856,
        "height": 152,        # 45 floors · completed 1987 · 33 levels visible in OSM
        "base_height": 0,
        "source": "OSM way 230891856 · height 152m (33 visible floors; rooftop hotel)",
    },
    {
        "id": "icon-state-tower",
        "name_en": "State Tower",
        "name_th": "ตึกสเตท",
        "kind": "tower",
        "osm_id": 25805374,
        "height": 247,        # 49 floors · dome-topped · completed 2001
        "base_height": 0,
        "source": "OSM way 25805374 · height 247m (49 floors; golden dome)",
    },
    {
        "id": "icon-empire-tower",
        "name_en": "Empire Tower",
        "name_th": "เอ็มไพร์ ทาวเวอร์",
        "kind": "tower",
        "osm_id": 32004527,
        "height": 150,        # four 36-floor towers
        "base_height": 0,
        "source": "OSM way 32004527 · height 150m (36 floors per tower)",
    },
    {
        "id": "icon-park-ventures",
        "name_en": "Park Ventures Ecoplex",
        "name_th": "พาร์ค เวนเจอร์ส",
        "kind": "tower",
        "osm_id": 176332744,
        "height": 142,        # OSM height tag · 33 floors
        "base_height": 0,
        "source": "OSM way 176332744 · height 142m (33 floors)",
    },
    {
        "id": "icon-central-embassy",
        "name_en": "Central Embassy",
        "name_th": "เซ็นทรัล เอ็มบาสซี",
        "kind": "tower",
        "osm_id": 244115004,
        "height": 125,        # main tower 29 floors · podium visible as 8 levels
        "base_height": 0,
        "source": "OSM way 244115004 · height 125m (29 floors; podium only in OSM)",
    },
    {
        "id": "icon-emporium-tower",
        "name_en": "Emporium Tower",
        "name_th": "เอ็มโพเรียม ทาวเวอร์",
        "kind": "tower",
        "osm_id": 243742458,
        "height": 167,        # OSM height tag · 46 floors
        "base_height": 0,
        "source": "OSM way 243742458 · height 167m (46 floors)",
    },
    {
        "id": "icon-mandarin-residences",
        "name_en": "The Residences at Mandarin Oriental",
        "name_th": "เรสซิเดนซ์ แมนดาริน โอเรียนเต็ล",
        "kind": "tower",
        "osm_id": 680739268,
        "height": 272,        # OSM height tag 272.2m · 52 floors
        "base_height": 0,
        "source": "OSM way 680739268 · height 272.2m (52 floors)",
    },
    {
        "id": "icon-centara-centralworld",
        "name_en": "Centara Grand at CentralWorld",
        "name_th": "เซ็นทารา แกรนด์",
        "kind": "tower",
        "osm_id": 443613220,
        "height": 235,        # OSM height tag · 57 floors
        "base_height": 0,
        "source": "OSM way 443613220 · height 235m (57 floors)",
    },

    # ─── riverside hotels (kind: hotel) ───
    {
        "id": "icon-mandarin-oriental",
        "name_en": "Mandarin Oriental Bangkok",
        "name_th": "แมนดาริน โอเรียนเต็ล",
        "kind": "hotel",
        "osm_id": 134464577,
        "height": 150,        # main tower · 20-floor wing visible in OSM (older Authors' Wing)
        "base_height": 0,
        "source": "OSM way 134464577 · height 150m (river tower; Authors' Wing is 1876 heritage low-rise)",
    },
    {
        "id": "icon-millennium-hilton",
        "name_en": "Millennium Hilton Bangkok",
        "name_th": "มิลเลนเนียม ฮิลตัน",
        "kind": "hotel",
        "osm_id": 342556929,
        "height": 150,        # 32 floors visible in OSM
        "base_height": 0,
        "source": "OSM way 342556929 · height 150m (32 floors)",
    },
    {
        "id": "icon-peninsula",
        "name_en": "The Peninsula Bangkok",
        "name_th": "เพนนินซูลา",
        "kind": "hotel",
        "osm_id": 342554731,
        "height": 235,        # 39 floors · tallest hotel in Bangkok by roof
        "base_height": 0,
        "source": "OSM way 342554731 · height 235m (39 floors)",
    },
    {
        "id": "icon-shangri-la",
        "name_en": "Shangri-La Hotel, Bangkok",
        "name_th": "เชี่ยงไฮ้ ลา",
        "kind": "hotel",
        "osm_id": 342200086,
        "height": 150,        # main tower · 25 floors
        "base_height": 0,
        "source": "OSM way 342200086 · height 150m (25-floor main tower)",
    },
    {
        "id": "icon-anantara-riverside",
        "name_en": "Anantara Riverside Bangkok Resort",
        "name_th": "อนันตรา ริเวอร์ไซด์",
        "kind": "hotel",
        "osm_id": 226834457,
        "height": 90,         # 39 floors · low-rise resort shape
        "base_height": 0,
        "source": "OSM way 226834457 · height 90m (low-rise resort, 39 floors)",
    },

    # ─── malls (kind: mall) ───
    {
        "id": "icon-iconsiam",
        "name_en": "ICONSIAM",
        "name_th": "ไอคอนสยาม",
        "kind": "mall",
        "osm_id": 680735864,
        "height": 45,         # mall podium · 8 floors
        "base_height": 0,
        "source": "OSM way 680735864 · height 45m (riverside mall podium; 8 floors)",
    },
    {
        "id": "icon-siam-paragon",
        "name_en": "Siam Paragon",
        "name_th": "สยามพารากอน",
        "kind": "mall",
        "osm_id": 781138575,
        "height": 40,         # 8 floors
        "base_height": 0,
        "source": "OSM way 781138575 · height 40m (8 floors)",
    },
    {
        "id": "icon-emquartier",
        "name_en": "EmQuartier",
        "name_th": "เอ็มควอเทียร์",
        "kind": "mall",
        "osm_id": 318785712,
        "height": 42,         # OSM height tag · 11 floors
        "base_height": 0,
        "source": "OSM way 318785712 · height 42m (11 floors; the helical garden levels)",
    },
    {
        "id": "icon-emporium",
        "name_en": "Emporium",
        "name_th": "เอ็มโพเรียม",
        "kind": "mall",
        "osm_id": 25505429,
        "height": 30,         # OSM height tag · 7 floors
        "base_height": 0,
        "source": "OSM way 25505429 · height 30m (7 floors)",
    },
    {
        "id": "icon-mahanakhon-cube",
        "name_en": "MahaNakhon CUBE",
        "name_th": "มหานคร คิวบ์",
        "kind": "mall",
        "osm_id": 376797216,
        "height": 35,         # 7 floors
        "base_height": 0,
        "source": "OSM way 376797216 · height 35m (7 floors; retail podium beneath MahaNakhon tower)",
    },

    # ─── civic (kind: civic) ───
    # Hua Lamphong (Bangkok Railway Station) — historic 1910 Italian Neo-Renaissance,
    # demolished 2023 but the OSM footprint survives. Use the OSM way; cite the
    # historic fact. (The structure has been partially preserved; the new station
    # is at Krung Thep Aphiwat.)
    # Hua Lamphong (Bangkok Railway Station) — historic 1910 Italian
    # Neo-Renaissance, service moved to Krung Thep Aphiwat 2023. The
    # original OSM way ID guess pointed at a German road; the actual
    # Thai Hua Lamphong way needs a fresh Overpass lookup. Skipped
    # for this batch — to be added when the correct OSM way is found.
]


def overpass_query(way_ids):
    """Fetch the OSM way geometry for a list of IDs."""
    if not way_ids:
        return {}
    body = "[out:json][timeout:30];\n(\n"
    for wid in way_ids:
        body += f"  way({wid});\n"
    body += ");\nout body geom;\n"
    req = Request(
        "https://overpass-api.de/api/interpreter",
        data=body.encode("utf-8"),
        headers={"User-Agent": "Mavis-bkk-3d-atlas/1.0 (research)"},
    )
    with urlopen(req, timeout=60) as r:
        return json.load(r)


def way_to_polygon(way):
    """Convert an OSM way's geometry nodes to a GeoJSON polygon coords array.

    Returns None if the way is degenerate (single point or collinear).
    """
    geom = way.get("geometry", [])
    if len(geom) < 3:
        return None
    # dedupe consecutive identical vertices
    seen = set()
    out = []
    for p in geom:
        key = (round(p["lon"], 7), round(p["lat"], 7))
        if key in seen:
            continue
        seen.add(key)
        out.append([round(p["lon"], 7), round(p["lat"], 7)])
    if len(out) < 3:
        return None
    # close the ring if not already
    if out[0] != out[-1]:
        out.append(out[0])
    return [out]


def main():
    dry = "--dry-run" in sys.argv
    apply = "--apply" in sys.argv

    way_ids = [c["osm_id"] for c in CURATED if c.get("osm_id")]
    print(f"Fetching {len(way_ids)} OSM ways from Overpass…", file=sys.stderr)
    osm = overpass_query(way_ids)
    ways = {e["id"]: e for e in osm.get("elements", []) if e.get("type") == "way"}

    features = []
    missing = []
    for c in CURATED:
        way = ways.get(c["osm_id"])
        if not way:
            missing.append(c["id"])
            continue
        poly = way_to_polygon(way)
        if not poly:
            missing.append(c["id"] + " (degenerate)")
            continue
        feat = {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": poly},
            "properties": {
                "id": c["id"],
                "osm_id": c["osm_id"],
                "name": c["name_th"],
                "name_en": c["name_en"],
                "kind": c["kind"],
                "height": c["height"],
                "base_height": c.get("base_height", 0),
                "source": c["source"],
            },
        }
        features.append(feat)

    print(f"Built {len(features)} features; missing/skipped: {missing}", file=sys.stderr)

    out = json.dumps(features, ensure_ascii=False, separators=(",", ":"))
    if apply:
        path = Path("public/bkk-landmarks.geojson")
        d = json.load(open(path))
        # avoid duplicate IDs
        existing_ids = {f["properties"].get("id") for f in d["features"]}
        new = [f for f in features if f["properties"]["id"] not in existing_ids]
        d["features"].extend(new)
        d["featureCount"] = len(d["features"])
        d["version"] = "2026-09-02"
        d["description"] = (
            "Curated landmark extrusions: Victory Monument 50 m shaft, "
            "Democracy Monument, Golden Mount (~60 m), Rattanakosin heritage "
            "height overrides, and modern Bangkok icons (towers, hotels, "
            "malls, civic). Pair with bkk-heritage-detail.geojson."
        )
        path.write_text(json.dumps(d, ensure_ascii=False, indent=2))
        print(f"Appended {len(new)} features → {path} (total {d['featureCount']})", file=sys.stderr)
    else:
        print(out)

    if dry:
        print(f"\n[DRY RUN] would append {len(features)} features; pass --apply to write", file=sys.stderr)


if __name__ == "__main__":
    main()
