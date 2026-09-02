#!/usr/bin/env python3
"""
Apply the modern Bangkok icons batch using CACHED OSM data from the
local Overpass dump files in /tmp/icons*.json (from a prior fetch).

No network call. Pure local composition.
"""

import json
from pathlib import Path

# Re-define the curated records here (same as build-modern-icons.py but
# without the network fetch). Heights come from OSM height tags when
# present, otherwise from public records with source citation.
CURATED = [
    # ─── towers ───
    {"id": "icon-mahanakhon", "name_en": "King Power MahaNakhon", "name_th": "มหานคร", "kind": "tower", "osm_id": 444651219, "height": 314, "source": "OSM way 444651219 · height 314m per CTBUH"},
    {"id": "icon-baiyoke-tower-ii", "name_en": "Baiyoke Sky Hotel (Tower II)", "name_th": "ใบหยก 2", "kind": "tower", "osm_id": 443491487, "height": 304, "source": "OSM way 443491487 · height 304m (roof)"},
    {"id": "icon-baiyoke-tower-i", "name_en": "Baiyoke Tower I", "name_th": "ใบหยก 1", "kind": "tower", "osm_id": 230891856, "height": 152, "source": "OSM way 230891856 · height 152m (33 visible floors)"},
    {"id": "icon-state-tower", "name_en": "State Tower", "name_th": "ตึกสเตท", "kind": "tower", "osm_id": 25805374, "height": 247, "source": "OSM way 25805374 · height 247m (49 floors; golden dome)"},
    {"id": "icon-empire-tower", "name_en": "Empire Tower", "name_th": "เอ็มไพร์ ทาวเวอร์", "kind": "tower", "osm_id": 32004527, "height": 150, "source": "OSM way 32004527 · height 150m (36 floors per tower)"},
    {"id": "icon-park-ventures", "name_en": "Park Ventures Ecoplex", "name_th": "พาร์ค เวนเจอร์ส", "kind": "tower", "osm_id": 176332744, "height": 142, "source": "OSM way 176332744 · height 142m (33 floors)"},
    {"id": "icon-central-embassy", "name_en": "Central Embassy", "name_th": "เซ็นทรัล เอ็มบาสซี", "kind": "tower", "osm_id": 244115004, "height": 125, "source": "OSM way 244115004 · height 125m (29 floors; podium only in OSM)"},
    {"id": "icon-emporium-tower", "name_en": "Emporium Tower", "name_th": "เอ็มโพเรียม ทาวเวอร์", "kind": "tower", "osm_id": 243742458, "height": 167, "source": "OSM way 243742458 · height 167m (46 floors)"},
    {"id": "icon-mandarin-residences", "name_en": "The Residences at Mandarin Oriental", "name_th": "เรสซิเดนซ์ แมนดาริน โอเรียนเต็ล", "kind": "tower", "osm_id": 680739268, "height": 272, "source": "OSM way 680739268 · height 272.2m (52 floors)"},
    {"id": "icon-centara-centralworld", "name_en": "Centara Grand at CentralWorld", "name_th": "เซ็นทารา แกรนด์", "kind": "tower", "osm_id": 443613220, "height": 235, "source": "OSM way 443613220 · height 235m (57 floors)"},
    # ─── riverside hotels ───
    {"id": "icon-mandarin-oriental", "name_en": "Mandarin Oriental Bangkok", "name_th": "แมนดาริน โอเรียนเต็ล", "kind": "hotel", "osm_id": 134464577, "height": 150, "source": "OSM way 134464577 · height 150m (river tower)"},
    {"id": "icon-millennium-hilton", "name_en": "Millennium Hilton Bangkok", "name_th": "มิลเลนเนียม ฮิลตัน", "kind": "hotel", "osm_id": 342556929, "height": 150, "source": "OSM way 342556929 · height 150m (32 floors)"},
    {"id": "icon-peninsula", "name_en": "The Peninsula Bangkok", "name_th": "เพนนินซูลา", "kind": "hotel", "osm_id": 342554731, "height": 235, "source": "OSM way 342554731 · height 235m (39 floors)"},
    {"id": "icon-shangri-la", "name_en": "Shangri-La Hotel, Bangkok", "name_th": "เชี่ยงไฮ้ ลา", "kind": "hotel", "osm_id": 342200086, "height": 150, "source": "OSM way 342200086 · height 150m (25-floor main tower)"},
    {"id": "icon-anantara-riverside", "name_en": "Anantara Riverside Bangkok Resort", "name_th": "อนันตรา ริเวอร์ไซด์", "kind": "hotel", "osm_id": 226834457, "height": 90, "source": "OSM way 226834457 · height 90m (low-rise resort, 39 floors)"},
    # ─── malls ───
    {"id": "icon-iconsiam", "name_en": "ICONSIAM", "name_th": "ไอคอนสยาม", "kind": "mall", "osm_id": 680735864, "height": 45, "source": "OSM way 680735864 · height 45m (8 floors)"},
    {"id": "icon-siam-paragon", "name_en": "Siam Paragon", "name_th": "สยามพารากอน", "kind": "mall", "osm_id": 781138575, "height": 40, "source": "OSM way 781138575 · height 40m (8 floors)"},
    {"id": "icon-emquartier", "name_en": "EmQuartier", "name_th": "เอ็มควอเทียร์", "kind": "mall", "osm_id": 318785712, "height": 42, "source": "OSM way 318785712 · height 42m (11 floors)"},
    {"id": "icon-emporium", "name_en": "Emporium", "name_th": "เอ็มโพเรียม", "kind": "mall", "osm_id": 25505429, "height": 30, "source": "OSM way 25505429 · height 30m (7 floors)"},
    {"id": "icon-mahanakhon-cube", "name_en": "MahaNakhon CUBE", "name_th": "มหานคร คิวบ์", "kind": "mall", "osm_id": 376797216, "height": 35, "source": "OSM way 376797216 · height 35m (7 floors)"},
]


def way_to_polygon(way):
    geom = way.get("geometry", [])
    if len(geom) < 3:
        return None
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
    if out[0] != out[-1]:
        out.append(out[0])
    return [out]


def main():
    # Load all cached Overpass dumps
    ways = {}
    for path in Path("/tmp").glob("icons*.json"):
        try:
            d = json.load(open(path))
        except Exception:
            continue
        for e in d.get("elements", []):
            if e.get("type") == "way":
                ways[e["id"]] = e

    print(f"Loaded {len(ways)} cached ways from /tmp/icons*.json")

    features = []
    missing = []
    for c in CURATED:
        way = ways.get(c["osm_id"])
        if not way:
            missing.append((c["id"], "no way in cache"))
            continue
        poly = way_to_polygon(way)
        if not poly:
            missing.append((c["id"], "degenerate geometry"))
            continue
        # Sanity: must be in Bangkok bbox
        lats = [p[1] for p in poly[0]]
        lngs = [p[0] for p in poly[0]]
        c_lat = sum(lats) / len(lats)
        c_lng = sum(lngs) / len(lngs)
        if not (13.45 <= c_lat <= 14.10 and 100.30 <= c_lng <= 100.95):
            missing.append((c["id"], f"outside Bangkok bbox ({c_lat:.4f}, {c_lng:.4f})"))
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
                "base_height": 0,
                "source": c["source"],
            },
        }
        features.append(feat)

    print(f"Built {len(features)} features; skipped: {len(missing)}")
    for mid, reason in missing:
        print(f"  - {mid}: {reason}")

    # Apply to existing file
    path = Path("public/bkk-landmarks.geojson")
    d = json.load(open(path))
    existing_ids = {f["properties"].get("id") for f in d["features"]}
    new = [f for f in features if f["properties"]["id"] not in existing_ids]
    d["features"].extend(new)
    d["featureCount"] = len(d["features"])
    d["version"] = "2026-09-02"
    d["description"] = (
        "Curated landmark extrusions: Victory Monument 50 m shaft, "
        "Democracy Monument, Golden Mount (~60 m), Rattanakosin heritage "
        "height overrides, and modern Bangkok icons (towers, hotels, "
        "malls). Pair with bkk-heritage-detail.geojson."
    )
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2))
    print(f"\nAppended {len(new)} features → {path} (total {d['featureCount']})")


if __name__ == "__main__":
    main()
