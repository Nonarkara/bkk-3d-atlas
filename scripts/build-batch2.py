#!/usr/bin/env python3
"""
Batch 2 of the modern Bangkok icons — bridges, civic, more towers and malls.
Uses cached OSM data where we have it; hand-curates rectangles from public
records otherwise (with proper proportions and the source field cited).
"""

import json
import math
from pathlib import Path

# ───────────── helpers ─────────────
def rect(center_lat, center_lng, width_m, depth_m, rotation_deg=0):
    """Build a closed rectangular polygon around a center point, optionally
    rotated. width_m is the east-west extent, depth_m is the north-south
    extent before rotation. Returns a closed ring of [[lng, lat], ...].
    """
    # 1m of latitude ≈ 1/111000 deg
    # 1m of longitude at lat L ≈ 1/(111000 * cos(L)) deg
    lat0 = center_lat
    cos_lat = math.cos(math.radians(lat0))
    dlat_per_m = 1.0 / 111000.0
    dlng_per_m = 1.0 / (111000.0 * cos_lat)

    # half-extents in local east/north meters, then rotate
    w, d = width_m / 2.0, depth_m / 2.0
    corners_local = [(-w, -d), (w, -d), (w, d), (-w, d)]
    theta = math.radians(rotation_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    out = []
    for ex, ny in corners_local:
        # rotate (east, north) by theta
        rx = ex * cos_t - ny * sin_t
        ry = ex * sin_t + ny * cos_t
        dlat = ry * dlat_per_m
        dlng = rx * dlng_per_m
        out.append([round(center_lng + dlng, 7), round(center_lat + dlat, 7)])
    out.append(out[0])  # close the ring
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


# ───────────── records ─────────────
# Each entry: id, name_en, name_th, kind, height, source, polygon
# polygon is either "OSM:<way_id>" (looked up from cache) or a 4-tuple
# (center_lat, center_lng, width_m, depth_m, rotation_deg)
RECORDS = [
    # ─── civic (kind: civic) ───
    {
        "id": "icon-hua-lamphong",
        "name_en": "Hua Lamphong (old Bangkok Railway Station)",
        "name_th": "หัวลำโพง",
        "kind": "civic",
        "height": 30,
        "source": "Hua Lamphong · 1910 Italian Neo-Renaissance · 30m visible · service moved to Krung Thep Aphiwat 2023 (partial retention as museum)",
        "polygon": (13.73780, 100.51640, 165, 65, 12),
    },
    {
        "id": "icon-bangkok-city-hall",
        "name_en": "Bangkok City Hall (Sala Lai Thai)",
        "name_th": "ศาลาว่าการกรุงเทพมหานคร",
        "kind": "civic",
        "height": 50,
        "source": "Bangkok City Hall · Italianate facade · ~50m · 4 floors",
        "polygon": (13.76008, 100.50105, 130, 50, 25),
    },

    # ─── malls (kind: mall) ───
    {
        "id": "icon-siam-center",
        "name_en": "Siam Center",
        "name_th": "สยามเซ็นเตอร์",
        "kind": "mall",
        "height": 35,
        "source": "OSM way 25701334 · height 35m (6 floors)",
        "polygon": "OSM:25701334",
    },
    {
        "id": "icon-centralworld",
        "name_en": "CentralWorld",
        "name_th": "เซ็นทรัลเวิลด์",
        "kind": "mall",
        "height": 35,
        "source": "OSM way 157482067 · height 35m (OSM height tag; 7 floors; 550,000 m² GFA)",
        "polygon": "OSM:157482067",
    },
    {
        "id": "icon-gaysorn",
        "name_en": "Gaysorn Village",
        "name_th": "เกษร วิลเลจ",
        "kind": "mall",
        "height": 50,
        "source": "Gaysorn Village · 2019 rebuild · 6 floors above + 7 below · ~50m visible above ground",
        "polygon": (13.74555, 100.53970, 80, 70, 10),
    },
    {
        "id": "icon-central-chidlom",
        "name_en": "Central Chidlom",
        "name_th": "เซ็นทรัล ชิดลม",
        "kind": "mall",
        "height": 35,
        "source": "Central Chidlom · 6 floors · ~35m · 2007 rebuild",
        "polygon": (13.74470, 100.54440, 80, 50, 5),
    },

    # ─── towers (kind: tower) ───
    {
        "id": "icon-one-bangkok",
        "name_en": "One Bangkok (Tower 1 — tallest)",
        "name_th": "วัน แบงค็อก (อาคาร 1)",
        "kind": "tower",
        "height": 215,
        "source": "OSM way 608350816 · height 215m (One Bangkok complex; tallest of 4 office towers)",
        "polygon": "OSM:608350816",
    },
    {
        "id": "icon-rama-ix-tower",
        "name_en": "Rama IX Tower",
        "name_th": "อาคาร พระราม 9",
        "kind": "tower",
        "height": 270,
        "source": "Rama IX Tower · 270m · 67 floors · completed 1997 · distinctive crown",
        "polygon": (13.73065, 100.56830, 70, 70, 0),
    },
    {
        "id": "icon-sindhorn-tower",
        "name_en": "Sindhorn Tower",
        "name_th": "สินธร ทาวเวอร์",
        "kind": "tower",
        "height": 130,
        "source": "Sindhorn Tower · ~130m · 33 floors · Langsuan · 2018",
        "polygon": (13.73985, 100.54485, 50, 50, 0),
    },
    {
        "id": "icon-m-thai-tower",
        "name_en": "M Thai Tower (All Seasons Place)",
        "name_th": "เอ็ม ไทย ทาวเวอร์ (ออล ซีซั่นส์ เพลส)",
        "kind": "tower",
        "height": 130,
        "source": "M Thai Tower (formerly CRC Tower / All Seasons Place) · 130m · 29 floors · 1996",
        "polygon": (13.74005, 100.54910, 60, 60, 0),
    },
    {
        "id": "icon-scb-park-plaza",
        "name_en": "SCB Park Plaza (East Tower)",
        "name_th": "เอสซีบี พาร์ค พลาซ่า",
        "kind": "tower",
        "height": 130,
        "source": "SCB Park Plaza · 130m · twin towers · Ratchadaphisek · 2006",
        "polygon": (13.73635, 100.56160, 55, 55, 0),
    },

    # ─── riverside hotels (kind: hotel) ───
    {
        "id": "icon-chatrium-residence",
        "name_en": "Chatrium Residence Sathon Bangkok",
        "name_th": "�ัทรีม สาทร",
        "kind": "hotel",
        "height": 165,
        "source": "Chatrium Residence Sathon · 165m · 32 floors · riverside",
        "polygon": (13.71885, 100.51285, 50, 50, 0),
    },
    {
        "id": "icon-marriott-queens-park",
        "name_en": "Bangkok Marriott Marquis Queen's Park",
        "name_th": "แมริออท ควีนส์ พาร์ค",
        "kind": "hotel",
        "height": 110,
        "source": "Bangkok Marriott Marquis Queen's Park · 110m · 30 floors · Sukhumvit 22 · 2014",
        "polygon": (13.72890, 100.56530, 60, 60, 0),
    },

    # ─── bridges (kind: bridge) ───
    # Rama VIII — cable-stayed, 2.5 km total, inverted-Y pylon at center.
    # Deck: thin rectangle along river direction. Pylon: small square.
    {
        "id": "icon-bridge-rama-viii",
        "name_en": "Rama VIII Bridge (deck)",
        "name_th": "สะพานพระราม 8 (พื้นสะพาน)",
        "kind": "bridge",
        "height": 12,
        "source": "Rama VIII Bridge · cable-stayed · 12m deck height · 2,450m total · opened 2002",
        "polygon": "OSM:965040447",
    },
    {
        "id": "icon-bridge-rama-viii-pylon",
        "name_en": "Rama VIII Bridge (inverted-Y pylon)",
        "name_th": "สะพานพระราม 8 (เสาไพลอน)",
        "kind": "bridge",
        "height": 160,
        "source": "Rama VIII Bridge inverted-Y pylon · 160m · located west of the cable-stayed span, near Bang Yi Khan",
        "polygon": (13.76900, 100.49710, 30, 30, 0),
    },
    {
        "id": "icon-bridge-memorial",
        "name_en": "Memorial Bridge (Phra Phuttha Yodfa)",
        "name_th": "สะพานพระพุทธยอดฟ้า",
        "kind": "bridge",
        "height": 12,
        "source": "Memorial Bridge · through-truss · 12m deck · 678m · opened 1932 · first bridge across Chao Phraya",
        "polygon": (13.73975, 100.49550, 16, 460, -45),  # rotation -45° aligns to river
    },
    {
        "id": "icon-bridge-krung-thon",
        "name_en": "Krung Thon Bridge",
        "name_th": "สะพานกรุงธน",
        "kind": "bridge",
        "height": 14,
        "source": "Krung Thon Bridge · steel-truss · 14m deck · 1958",
        "polygon": (13.77750, 100.50100, 14, 480, -35),
    },
]


def main():
    # Load cached Overpass dumps
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
            # hand-curated rectangle
            c_lat, c_lng, w, d, rot = poly
            ring = rect(c_lat, c_lng, w, d, rot)

        # Sanity: must be in Bangkok bbox
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

    # Apply
    path = Path("public/bkk-landmarks.geojson")
    d = json.load(open(path))
    existing_ids = {f["properties"].get("id") for f in d["features"]}
    new = [f for f in features if f["properties"]["id"] not in existing_ids]
    d["features"].extend(new)
    d["featureCount"] = len(d["features"])
    d["version"] = "2026-09-02b"
    d["description"] = (
        "Curated landmark extrusions: Victory Monument 50 m shaft, "
        "Democracy Monument, Golden Mount (~60 m), Rattanakosin heritage "
        "height overrides, modern Bangkok icons (towers, hotels, malls, "
        "civic, bridges). Pair with bkk-heritage-detail.geojson."
    )
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2))
    print(f"\nAppended {len(new)} features → {path} (total {d['featureCount']})", file=sys.stderr)


import sys
if __name__ == "__main__":
    main()
