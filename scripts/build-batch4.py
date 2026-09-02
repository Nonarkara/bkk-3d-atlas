#!/usr/bin/env python3
"""
Batch 4 — parks (new kind), the Sathorn Unique ghost tower, the
Erawan Shrine, the Hindu Sri Maha Mariamman, and a few more
headline buildings.
"""

import json
import math
import sys
from pathlib import Path


def rect(center_lat, center_lng, width_m, depth_m, rotation_deg=0):
    lat0 = center_lat
    cos_lat = math.cos(math.radians(lat0))
    dlat_per_m = 1.0 / 111000.0
    dlng_per_m = 1.0 / (111000.0 * cos_lat)
    w, d = width_m / 2.0, depth_m / 2.0
    corners_local = [(-w, -d), (w, -d), (w, d), (-w, d)]
    theta = math.radians(rotation_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    out = []
    for ex, ny in corners_local:
        rx = ex * cos_t - ny * sin_t
        ry = ex * sin_t + ny * cos_t
        dlat = ry * dlat_per_m
        dlng = rx * dlng_per_m
        out.append([round(center_lng + dlng, 7), round(center_lat + dlat, 7)])
    out.append(out[0])
    return [out]


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


RECORDS = [
    # ─── parks (kind: park) — new kind ───
    {
        "id": "icon-lumphini-park",
        "name_en": "Lumphini Park",
        "name_th": "สวนลุมพินี",
        "kind": "park",
        "height": 8,
        "source": "Lumphini Park · 8m tree canopy · 57 ha · 1920s · Bangkok's 'Central Park' · Pathum Wan",
        "polygon": (13.73080, 100.54130, 750, 380, 10),
    },
    {
        "id": "icon-benjakitti-park",
        "name_en": "Benjakitti Park",
        "name_th": "สวนเบญจกิติ",
        "kind": "park",
        "height": 8,
        "source": "Benjakitti Park · 8m canopy · 130 ha · 2004 + 2022 extension · Asok",
        "polygon": (13.72730, 100.55900, 900, 300, 0),
    },
    {
        "id": "icon-benchasiri-park",
        "name_en": "Benchasiri Park",
        "name_th": "สวนเบญจศิริ",
        "kind": "park",
        "height": 8,
        "source": "Benchasiri Park · 8m canopy · 7.5 ha · Sukhumvit 24 · 1993 (Queen's Park)",
        "polygon": (13.73120, 100.56530, 220, 200, 0),
    },
    {
        "id": "icon-saranrom-park",
        "name_en": "Saranrom Park",
        "name_th": "สวนสราญรมย์",
        "kind": "park",
        "height": 8,
        "source": "Saranrom Park · 8m canopy · 12 ha · 1860s royal garden · Phra Nakhon",
        "polygon": (13.75630, 100.49620, 250, 160, 0),
    },
    {
        "id": "icon-rommaneenat-park",
        "name_en": "Rommaneenat Park",
        "name_th": "สวนรมณีนาถ",
        "kind": "park",
        "height": 8,
        "source": "Rommaneenat Park · 8m canopy · 7 ha · beside Grand Palace · Phra Nakhon",
        "polygon": (13.75630, 100.49230, 220, 200, 0),
    },

    # ─── more towers (Sathorn Unique = Bangkok's ghost tower) ───
    {
        "id": "icon-sathorn-unique",
        "name_en": "Sathorn Unique (the Ghost Tower)",
        "name_th": "สาทร ยูนีค (ตึกผี)",
        "kind": "tower",
        "height": 137,
        "source": "Sathorn Unique · 137m · 49 floors · abandoned 1996 (construction stop) · never completed · 2014 collapse",
        "polygon": (13.72100, 100.51080, 55, 55, 0),
    },
    {
        "id": "icon-bangkok-city-tower",
        "name_en": "Bangkok City Tower (Sathorn)",
        "name_th": "แบงค็อก ซิตี้ ทาวเวอร์",
        "kind": "tower",
        "height": 150,
        "source": "Bangkok City Tower · 150m · 32 floors · South Sathorn · 1993",
        "polygon": (13.72090, 100.52810, 50, 50, 0),
    },
    {
        "id": "icon-sathorn-city-tower",
        "name_en": "Sathorn City Tower",
        "name_th": "สาทร ซิตี้ ทาวเวอร์",
        "kind": "tower",
        "height": 110,
        "source": "Sathorn City Tower · 110m · 34 floors · South Sathorn · 1994",
        "polygon": (13.72110, 100.52450, 50, 50, 0),
    },
    {
        "id": "icon-chamchuri-square",
        "name_en": "Chamchuri Square",
        "name_th": "จามจุรี สแควร์",
        "kind": "tower",
        "height": 130,
        "source": "Chamchuri Square · 130m · 40 floors · Phaya Thai Rd · 1997",
        "polygon": (13.74430, 100.53100, 55, 55, 0),
    },
    {
        "id": "icon-rhythm-sukhumvit",
        "name_en": "Rhythm Sukhumvit 50",
        "name_th": "ริธึ่ม สุขุมวิท 50",
        "kind": "tower",
        "height": 130,
        "source": "Rhythm Sukhumvit 50 · 130m · 38 floors · Phra Khanong · 2019",
        "polygon": (13.71410, 100.58320, 45, 45, 0),
    },

    # ─── shrines (kind: shrine) — new kind ───
    {
        "id": "icon-erawan-shrine",
        "name_en": "Erawan Shrine (Phra Phrom)",
        "name_th": "ศาลพระพรหมเอราวัณ",
        "kind": "shrine",
        "height": 12,
        "source": "Erawan Shrine · 12m · 4-faced Phra Phrom · 1956 · Ratchaprasong intersection",
        "polygon": (13.74750, 100.53900, 18, 18, 0),
    },
    {
        "id": "icon-sri-maha-mariamman",
        "name_en": "Sri Maha Mariamman Temple",
        "name_th": "วัดศรีมหามารีอาม",
        "kind": "shrine",
        "height": 25,
        "source": "Sri Maha Mariamman · 25m colorful gopuram · 1879 · Silom's Hindu temple",
        "polygon": (13.72940, 100.53500, 16, 30, 0),
    },
    {
        "id": "icon-devaraja-shrine",
        "name_en": "Devaraja Shrine (City Pillar)",
        "name_th": "ศาลหลักเมือง (เทพารักษ์)",
        "kind": "shrine",
        "height": 15,
        "source": "Bangkok City Pillar Shrine · 15m · 1782 · Phra Nakhon · Brahma-faced",
        "polygon": (13.75430, 100.49380, 18, 18, 0),
    },

    # ─── markets/wholesale ───
    {
        "id": "icon-pratunam",
        "name_en": "Pratunam Market",
        "name_th": "ตลาดประตูน้ำ",
        "kind": "mall",
        "height": 18,
        "source": "Pratunam Market area · 18m · 4-storey shophouses · clothing wholesale",
        "polygon": (13.75000, 100.54100, 200, 150, 0),
    },
    {
        "id": "icon-bobae",
        "name_en": "Bobae Market (Hat Yai-style)",
        "name_th": "ตลาดบ่อแข่ง",
        "kind": "mall",
        "height": 14,
        "source": "Bobae Market · 14m · 3 floors · 24-hour · clothing wholesale · Ratchathewi",
        "polygon": (13.75800, 100.53400, 130, 100, 0),
    },
]


def main():
    ways = {}
    for path in Path("/tmp").glob("icons*.json"):
        try:
            d = json.load(open(path))
        except Exception:
            continue
        for e in d.get("elements", []):
            if e.get("type") == "way":
                ways[e["id"]] = e
    print(f"Loaded {len(ways)} cached ways", file=sys.stderr)

    features = []
    skipped = []
    for r in RECORDS:
        poly = r["polygon"]
        if isinstance(poly, str) and poly.startswith("OSM:"):
            wid = int(poly.split(":")[1])
            way = ways.get(wid)
            if not way:
                skipped.append((r["id"], f"OSM way {wid} not in cache"))
                continue
            ring = way_to_polygon(way)
            if not ring:
                skipped.append((r["id"], f"OSM way {wid} degenerate"))
                continue
        else:
            c_lat, c_lng, w, d, rot = poly
            ring = rect(c_lat, c_lng, w, d, rot)

        lats = [p[1] for p in ring[0]]
        lngs = [p[0] for p in ring[0]]
        c_lat = sum(lats) / len(lats)
        c_lng = sum(lngs) / len(lngs)
        if not (13.45 <= c_lat <= 14.10 and 100.30 <= c_lng <= 100.95):
            skipped.append((r["id"], f"outside bbox ({c_lat:.4f}, {c_lng:.4f})"))
            continue

        feat = {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": ring},
            "properties": {
                "id": r["id"],
                "name": r["name_th"],
                "name_en": r["name_en"],
                "kind": r["kind"],
                "height": r["height"],
                "base_height": 0,
                "source": r["source"],
            },
        }
        features.append(feat)

    print(f"\nBuilt {len(features)} features; skipped {len(skipped)}", file=sys.stderr)
    for sid, reason in skipped:
        print(f"  - {sid}: {reason}", file=sys.stderr)

    path = Path("public/bkk-landmarks.geojson")
    d = json.load(open(path))
    existing_ids = {f["properties"].get("id") for f in d["features"]}
    new = [f for f in features if f["properties"]["id"] not in existing_ids]
    d["features"].extend(new)
    d["featureCount"] = len(d["features"])
    d["version"] = "2026-09-02d"
    d["description"] = (
        "Curated landmark extrusions: Victory Monument 50 m shaft, "
        "Democracy Monument, Golden Mount (~60 m), Rattanakosin heritage "
        "height overrides, modern Bangkok icons (towers, hotels, malls, "
        "civic, bridges, parks, shrines, markets, stadiums). "
        "Pair with bkk-heritage-detail.geojson."
    )
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2))
    print(f"\nAppended {len(new)} features → {path} (total {d['featureCount']})", file=sys.stderr)


if __name__ == "__main__":
    main()
