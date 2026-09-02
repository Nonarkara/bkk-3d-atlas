#!/usr/bin/env python3
"""
Batch 3 — more hotels, malls, towers, bridges, markets, temples, stadiums.
Hand-curated rectangles with proper proportions; OSM data used where
the cached dump has it.
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
    # ─── more towers ───
    {
        "id": "icon-saladaeng-one",
        "name_en": "The Saladaeng One (One City)",
        "name_th": "เดอะ ศาลเจ้ากรุง วัน",
        "kind": "tower",
        "height": 195,
        "source": "One City · 195m · 54 floors · twin towers · Silom · 2024",
        "polygon": (13.72470, 100.52890, 70, 70, 0),
    },
    {
        "id": "icon-sathorn-square",
        "name_en": "Sathorn Square",
        "name_th": "สาทร สแควร์",
        "kind": "tower",
        "height": 195,
        "source": "Sathorn Square · 195m · 40 floors · North Sathorn · 2011",
        "polygon": (13.72380, 100.52100, 65, 65, 0),
    },
    {
        "id": "icon-bhiraj-tower",
        "name_en": "Bhiraj Tower at EmQuartier",
        "name_th": "ภิรัช ทาวเวอร์ แอท เอ็มควอเทียร์",
        "kind": "tower",
        "height": 165,
        "source": "Bhiraj Tower · 165m · 36 floors · Sukhumvit · 2016",
        "polygon": (13.73040, 100.57020, 55, 55, 0),
    },
    {
        "id": "icon-aia-east",
        "name_en": "AIA East Gateway",
        "name_th": "เอไอเอ อีสท์ เกตเวย์",
        "kind": "tower",
        "height": 130,
        "source": "AIA East Gateway · 130m · 33 floors · Sukhumvit 35 · 2015",
        "polygon": (13.73210, 100.56500, 55, 55, 0),
    },
    {
        "id": "icon-the-line",
        "name_en": "The Line Sathorn",
        "name_th": "เดอะ ไลน์ สาทร",
        "kind": "tower",
        "height": 165,
        "source": "The Line Sathorn · 165m · 48 floors · Wiphahadi · 2022",
        "polygon": (13.72050, 100.51650, 50, 50, 0),
    },
    {
        "id": "icon-lumpini-tower",
        "name_en": "Lumpini Place Rama IX",
        "name_th": "ลุมพินี เพลส พระราม 9",
        "kind": "tower",
        "height": 152,
        "source": "Lumpini Place Rama IX · ~152m · 45 floors · 1994",
        "polygon": (13.75130, 100.56600, 50, 50, 0),
    },

    # ─── more hotels ───
    {
        "id": "icon-four-seasons",
        "name_en": "Four Seasons Hotel Bangkok",
        "name_th": "โฟร์ซีซั่น",
        "kind": "hotel",
        "height": 130,
        "source": "Four Seasons Hotel Bangkok · 130m · 32 floors · Ratchadamri · 2010",
        "polygon": (13.73950, 100.54090, 55, 55, 0),
    },
    {
        "id": "icon-okura",
        "name_en": "Hotel Okura Prestige Bangkok",
        "name_th": "โอกุระ เพรสทีจ",
        "kind": "hotel",
        "height": 130,
        "source": "Hotel Okura Prestige · 130m · 34 floors · Wireless Road · 2012",
        "polygon": (13.74310, 100.54670, 50, 50, 0),
    },
    {
        "id": "icon-banyan-tree",
        "name_en": "Banyan Tree Bangkok",
        "name_th": "บันยันทรี",
        "kind": "hotel",
        "height": 170,
        "source": "Banyan Tree Bangkok · 170m · 61 floors · Sathorn/South · 1996",
        "polygon": (13.72270, 100.52950, 45, 45, 0),
    },
    {
        "id": "icon-w-bangkok",
        "name_en": "W Bangkok",
        "name_th": "ดับเบิลยู แบงค็อก",
        "kind": "hotel",
        "height": 100,
        "source": "W Bangkok Hotel · 100m · 31 floors · North Sathorn · 2012",
        "polygon": (13.72450, 100.52300, 50, 50, 0),
    },
    {
        "id": "icon-st-regis",
        "name_en": "The St. Regis Bangkok",
        "name_th": "เดอะ เซนต์ รีจีส",
        "kind": "hotel",
        "height": 145,
        "source": "The St. Regis Bangkok · 145m · 43 floors · Ratchadamri · 2011",
        "polygon": (13.73950, 100.53900, 50, 50, 0),
    },
    {
        "id": "icon-conrad-bangkok",
        "name_en": "Conrad Bangkok",
        "name_th": "คอนราด",
        "kind": "hotel",
        "height": 130,
        "source": "Conrad Bangkok · 130m · 32 floors · Wireless Road · 2003",
        "polygon": (13.74050, 100.54830, 55, 55, 0),
    },
    {
        "id": "icon-puliman-king-power",
        "name_en": "Pullman Bangkok King Power",
        "name_th": "พูลแมน คิง พาวเวอร์",
        "kind": "hotel",
        "height": 110,
        "source": "Pullman Bangkok King Power · 110m · 30 floors · Rang Nam · 2007",
        "polygon": (13.75780, 100.53730, 50, 50, 0),
    },

    # ─── more malls ───
    {
        "id": "icon-mbk",
        "name_en": "MBK Center",
        "name_th": "เอ็มบีเค",
        "kind": "mall",
        "height": 50,
        "source": "MBK Center · 50m · 8 floors · 1986 · flagship Thai mall",
        "polygon": (13.74490, 100.53020, 90, 50, 5),
    },
    {
        "id": "icon-terminal-21",
        "name_en": "Terminal 21 Asok",
        "name_th": "เทอร์มินัล 21 อโศก",
        "kind": "mall",
        "height": 45,
        "source": "Terminal 21 Asok · 45m · 9 floors · 2011 · airport-themed mall",
        "polygon": (13.73780, 100.56040, 65, 55, 0),
    },
    {
        "id": "icon-emsphere",
        "name_en": "EmSphere",
        "name_th": "เอ็มสเฟียร์",
        "kind": "mall",
        "height": 35,
        "source": "EmSphere · 35m · 6 floors · Phrom Phong · 2023 (newest EmDistrict)",
        "polygon": (13.73020, 100.56920, 60, 50, 0),
    },
    {
        "id": "icon-platinum",
        "name_en": "Platinum Fashion Mall",
        "name_th": "แพลทินัม แฟชั่น มอลล์",
        "kind": "mall",
        "height": 45,
        "source": "Platinum Fashion Mall · 45m · 6 floors · Pratunam wholesale",
        "polygon": (13.74970, 100.53950, 80, 35, 0),
    },
    {
        "id": "icon-central-rama-9",
        "name_en": "Central Rama 9 (Fortune Town)",
        "name_th": "เซ็นทรัล พระราม 9",
        "kind": "mall",
        "height": 50,
        "source": "Central Rama 9 / Fortune Town · 50m · 9 floors · 1996",
        "polygon": (13.75730, 100.56670, 80, 60, 0),
    },
    {
        "id": "icon-esplanade",
        "name_en": "Esplanade Ratchadaphisek",
        "name_th": "เอสพลานาด รัชดาภิเษก",
        "kind": "mall",
        "height": 35,
        "source": "Esplanade Ratchadaphisek · 35m · 7 floors · Ratchadaphisek · 2007",
        "polygon": (13.76620, 100.57030, 80, 60, 0),
    },

    # ─── more bridges ───
    {
        "id": "icon-bridge-taksin",
        "name_en": "Taksin Bridge (Phra Ram 3)",
        "name_th": "สะพานตากสิน (พระราม 3)",
        "kind": "bridge",
        "height": 14,
        "source": "Taksin Bridge · 14m deck · 1,661m · cable-stayed over Chao Phraya · 1982",
        "polygon": (13.71980, 100.51400, 14, 800, 30),
    },
    {
        "id": "icon-bridge-rama-iii",
        "name_en": "Rama III Bridge",
        "name_th": "สะพานพระราม 3",
        "kind": "bridge",
        "height": 12,
        "source": "Rama III Bridge · 12m deck · steel-box · 1992",
        "polygon": (13.70850, 100.49920, 14, 600, 18),
    },
    {
        "id": "icon-bridge-phra-pok-klao",
        "name_en": "Phra Pok Klao Bridge",
        "name_th": "สะพานพระปกเกล้า",
        "kind": "bridge",
        "height": 12,
        "source": "Phra Pok Klao Bridge · 12m deck · 1984 · 6-lane road · connects Phra Nakhon to Thonburi",
        "polygon": (13.73900, 100.49680, 14, 460, 0),
    },

    # ─── markets (kind: mall) ───
    {
        "id": "icon-chatuchak",
        "name_en": "Chatuchak Weekend Market",
        "name_th": "ตลาดจตุจักร",
        "kind": "mall",
        "height": 12,
        "source": "Chatuchak Weekend Market · 12m · 27 sections · 8,000+ stalls · largest weekend market in SE Asia",
        "polygon": (13.79990, 100.55050, 480, 130, 5),
    },
    {
        "id": "icon-pak-khlong-talat",
        "name_en": "Pak Khlong Talat (Flower Market)",
        "name_th": "ปากคลองตลาด",
        "kind": "mall",
        "height": 10,
        "source": "Pak Khlong Talat · 10m · 24-hour flower market · Phra Nakhon",
        "polygon": (13.74350, 100.49800, 90, 320, 0),
    },
    {
        "id": "icon-sampeng",
        "name_en": "Sampeng Lane (wholesale market)",
        "name_th": "ซอกก๋ง ตลาดสำเพ็ง",
        "kind": "mall",
        "height": 18,
        "source": "Sampeng Lane · 18m · 2-storey shophouses · Yaowarat · narrow wholesale street",
        "polygon": (13.73900, 100.51000, 14, 480, 0),
    },
    {
        "id": "icon-or-tor-kor",
        "name_en": "Or Tor Kor Market",
        "name_th": "ตลาด อ.ต.ก.",
        "kind": "mall",
        "height": 14,
        "source": "Or Tor Kor Market · 14m · 3 sections · Chatuchak side · government wholesale market",
        "polygon": (13.80550, 100.55300, 200, 100, 0),
    },

    # ─── civic/religious not in Rattanakosin ───
    {
        "id": "icon-wat-rakhang",
        "name_en": "Wat Rakhang Kositaram",
        "name_th": "วัดราชบพิธสถิตมหาสีมาราม",
        "kind": "civic",
        "height": 22,
        "source": "Wat Rakhang · 22m main chedi · Thonburi · 19c · bell-trumpet era",
        "polygon": (13.75560, 100.48550, 90, 70, 0),
    },
    {
        "id": "icon-wat-bowonniwet",
        "name_en": "Wat Bowonniwet",
        "name_th": "วัดบวรมงคล",
        "kind": "civic",
        "height": 30,
        "source": "Wat Bowonniwet · 30m chedi · royal temple · Phra Nakhon · 1820s",
        "polygon": (13.75770, 100.49670, 90, 60, 0),
    },
    {
        "id": "icon-wat-ratchabophit",
        "name_en": "Wat Ratchabophit",
        "name_th": "วัดราชบพิธ",
        "kind": "civic",
        "height": 28,
        "source": "Wat Ratchabophit · 28m phra chedi · 19c · Ayutthaya-meets-Gothic design",
        "polygon": (13.75560, 100.49930, 90, 50, 0),
    },
    {
        "id": "icon-wat-suthat",
        "name_en": "Wat Suthat Thepwararam",
        "name_th": "วัดสุทัศนเทพวราราม",
        "kind": "civic",
        "height": 32,
        "source": "Wat Suthat · 32m principal chedi · 19c · first-class royal temple",
        "polygon": (13.75130, 100.50140, 100, 80, 0),
    },
    {
        "id": "icon-wat-ratchanatdaram",
        "name_en": "Wat Ratchanatdaram (Loha Prasat)",
        "name_th": "วัดราชนัดดา (โลหะปราสาท)",
        "kind": "civic",
        "height": 36,
        "source": "Loha Prasat · 36m · 5-tier metal-castle chedi · only one of its kind in the world · 1846",
        "polygon": (13.75470, 100.50180, 60, 50, 0),
    },

    # ─── stadiums/sports (kind: civic) ───
    {
        "id": "icon-rajamangala",
        "name_en": "Rajamangala National Stadium",
        "name_th": "ราชมังคลากีฬาสถาน",
        "kind": "civic",
        "height": 35,
        "source": "Rajamangala National Stadium · 35m · 65,000 seats · 1998 Asian Games · Hua Mark",
        "polygon": (13.75540, 100.62200, 220, 180, 0),
    },
    {
        "id": "icon-thunderdome",
        "name_en": "Thunderdome (Muang Thong Thani)",
        "name_th": "ธันเดอร์โดม",
        "kind": "civic",
        "height": 30,
        "source": "Thunderdome · 30m dome · 12,000 seats · 1998 · Muang Thong Thani",
        "polygon": (13.90430, 100.54770, 130, 110, 0),
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
    d["version"] = "2026-09-02c"
    d["description"] = (
        "Curated landmark extrusions: Victory Monument 50 m shaft, "
        "Democracy Monument, Golden Mount (~60 m), Rattanakosin heritage "
        "height overrides, modern Bangkok icons (towers, hotels, malls, "
        "civic, bridges, markets, stadiums). Pair with bkk-heritage-detail.geojson."
    )
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2))
    print(f"\nAppended {len(new)} features → {path} (total {d['featureCount']})", file=sys.stderr)


if __name__ == "__main__":
    main()
