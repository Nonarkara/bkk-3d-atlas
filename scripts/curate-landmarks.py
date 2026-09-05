#!/usr/bin/env python3
"""curate-landmarks.py
-------------------
Resolves the landmark audit findings:
1. Retains all 73 authentic heritage landmarks (591f301).
2. Curates 27 iconic skyline buildings, bridges, and civic anchors with:
   - Corrected coordinates (e.g. Sathorn Unique on Charoen Krung 51,
     Rama VIII pylon on the west bank).
   - Cited heights (CTBUH / official specs, e.g. Sathorn Unique planned 185 m).
   - Authentic, native Thai names (removing corrupted machine translations).
   - Honest, verified source strings (removing false collapse claims).
3. Quarantines the remaining 58 unverified/fictitious/misplaced/duplicated features
   into `public/bkk-landmarks-quarantine.geojson` with explicit `quarantine_reason`
   properties for future research.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANDMARKS_FILE = ROOT / "public/bkk-landmarks.geojson"
QUARANTINE_FILE = ROOT / "public/bkk-landmarks-quarantine.geojson"

# Curated Skyline IDs to retain with verified specs
SKYLINE_SPECS = {
    "icon-mahanakhon": {
        "name": "คิง เพาเวอร์ มหานคร",
        "height": 314,
        "source": "King Power MahaNakhon · 314m · 78 floors · CTBUH verified · Chong Nonsi · 2016",
    },
    "icon-baiyoke-tower-ii": {
        "name": "ใบหยก 2",
        "height": 304,
        "source": "Baiyoke Tower II · 304m roof · 85 floors · Pratunam · 1997",
    },
    "icon-state-tower": {
        "name": "สเตท ทาวเวอร์",
        "height": 247,
        "source": "State Tower · 247m · 68 floors · golden dome · Silom · 2001",
    },
    "icon-mandarin-residences": {
        "name": "เดอะ เรสซิเดนเซส แอท แมนดาริน โอเรียนเต็ล",
        "height": 272,
        "source": "The Residences at Mandarin Oriental Bangkok (ICONSIAM) · 272m · 52 floors · 2019",
    },
    "icon-centara-centralworld": {
        "name": "เซ็นทารา แกรนด์ แอท เซ็นทรัลเวิลด์",
        "height": 235,
        "source": "Centara Grand at CentralWorld · 235m · 57 floors · Ratchaprasong · 2008",
    },
    "icon-empire-tower": {
        "name": "เอ็มไพร์ ทาวเวอร์",
        "height": 227,
        "source": "Empire Tower · 227m · 58 floors · South Sathorn · 1999",
    },
    "icon-one-bangkok": {
        "name": "วัน แบงค็อก",
        "height": 215,
        "source": "One Bangkok (Tower 4) · 215m · 50 floors · Rama IV / Lumphini · 2024",
    },
    "icon-sathorn-square": {
        "name": "สาทร สแควร์",
        "height": 195,
        "source": "Sathorn Square · 195m · 40 floors · North Sathorn · 2011",
    },
    "icon-sathorn-unique": {
        "name": "สาทร ยูนีค ทาวเวอร์ (ตึกร้าง 1997)",
        "height": 185,
        "source": "Sathorn Unique · 185m planned · 49 floors · construction halted in 1997 Asian financial crisis; never completed",
        "center": [100.51465, 13.71725],
        "polygon_offset": True,
    },
    "icon-emporium-tower": {
        "name": "เอ็มโพเรียม ทาวเวอร์",
        "height": 167,
        "source": "Emporium Tower · 167m · 41 floors · Sukhumvit 24 · 1998",
    },
    "icon-bhiraj-tower": {
        "name": "ภิรัช ทาวเวอร์ แอท เอ็มควอเทียร์",
        "height": 165,
        "source": "Bhiraj Tower at EmQuartier · 165m · 45 floors · Sukhumvit · 2015",
    },
    "icon-the-line": {
        "name": "เดอะ ไลน์ สาทร",
        "height": 165,
        "source": "The Line Sathorn · 165m · 46 floors · BTS Surasak · 2021",
    },
    "icon-baiyoke-tower-i": {
        "name": "ใบหยก 1",
        "height": 151,
        "source": "Baiyoke Tower I · 151m · 43 floors · Pratunam · 1987 (tallest in Thailand 1987-1993)",
    },
    "icon-bangkok-city-tower": {
        "name": "บางกอก ซิตี้ ทาวเวอร์",
        "height": 150,
        "source": "Bangkok City Tower · 150m · 32 floors · South Sathorn · 1995",
    },
    "icon-park-ventures": {
        "name": "ปาร์ค เวนเชอร์ส อีโคเพล็กซ์",
        "height": 142,
        "source": "Park Ventures Ecoplex · 142m · 34 floors · Ploenchit / Wireless · 2011",
    },
    "icon-chamchuri-square": {
        "name": "จัตุรัสจามจุรี",
        "height": 130,
        "source": "Chamchuri Square · 130m · 40 floors · Sam Yan · 2008",
    },
    "icon-scb-park-plaza": {
        "name": "เอสซีบี ปาร์ค พลาซ่า",
        "height": 130,
        "source": "SCB Park Plaza · 130m · 37 floors · Ratchayothin · 1996",
    },
    "icon-sindhorn-tower": {
        "name": "สินธร ทาวเวอร์",
        "height": 130,
        "source": "Sindhorn Tower · 130m · 33 floors · Wireless Road · 1994",
    },
    "icon-m-thai-tower": {
        "name": "เอ็มไทย ทาวเวอร์ (ออล ซีซั่นส์ เพลส)",
        "height": 130,
        "source": "M Thai Tower (All Seasons Place) · 130m · 29 floors · Wireless Road · 2002",
    },
    "icon-bridge-rama-viii-pylon": {
        "name": "เสาไพลอน สะพานพระราม 8",
        "height": 160,
        "source": "Rama VIII Bridge single inverted-Y pylon · 160m · west bank footing, Bang Yi Khan · 2002",
        "center": [100.49620, 13.76940],
        "polygon_offset": True,
    },
    "icon-bridge-rama-viii": {
        "name": "สะพานพระราม 8 (ช่วงสะพานแขวน)",
        "height": 12,
        "source": "Rama VIII Bridge cable-stayed main span deck · 12m clearance · 475m span · opened 2002",
    },
    "icon-bridge-memorial": {
        "name": "สะพานพระพุทธยอดฟ้า",
        "height": 12,
        "source": "Memorial Bridge (Saphan Phut) · through-truss steel bridge · 12m deck · opened 1932",
    },
    "icon-iconsiam": {
        "name": "ไอคอนสยาม",
        "height": 45,
        "source": "ICONSIAM retail complex podium · 45m · Khlong San riverfront · opened 2018",
    },
    "icon-siam-paragon": {
        "name": "สยามพารากอน",
        "height": 40,
        "source": "Siam Paragon shopping complex · 40m · Pathum Wan · opened 2005",
    },
    "icon-centralworld": {
        "name": "เซ็นทรัลเวิลด์",
        "height": 35,
        "source": "CentralWorld complex podium · 35m · Ratchaprasong · opened 1990 / renovated 2006",
    },
    "icon-hua-lamphong": {
        "name": "สถานีรถไฟกรุงเทพ (หัวลำโพง)",
        "height": 30,
        "source": "Hua Lamphong Railway Terminal · 30m Neo-Renaissance arch dome · opened 1916",
    },
    "icon-bangkok-city-hall": {
        "name": "ศาลาว่าการกรุงเทพมหานคร (เสาชิงช้า)",
        "height": 50,
        "source": "Bangkok City Hall · 50m clock tower / administrative complex · Phra Nakhon · 1956",
    },
}

# Explicit quarantine rationales for the rest
QUARANTINE_REASONS = {
    "icon-rama-ix-tower": "fictitious building: cancelled 615m Rama IX Super Tower conflated with nonexistent 1997 270m tower placed at EmQuartier",
    "icon-mandarin-oriental": "unverified height: OSM tag lists 150m for low-rise historic riverside hotel wing (~4-10 storeys)",
    "icon-peninsula": "unverified height: tag lists 235m (CTBUH verified height is ~151m, 37-39 floors)",
    "icon-four-seasons": "unverified height: 130m / 32 floors claimed on Ratchadamri, where the property is a low-rise courtyard hotel",
    "icon-erawan-shrine": "misplaced pin (~400m north at CentralWorld) and color law violation (#d946a0 pink)",
    "icon-sri-maha-mariamman": "misplaced pin (~1.3km east at Chong Nonsi) and color law violation (#d946a0 pink)",
    "icon-shangri-la": "corrupted Thai name 'เชี่ยงไฮ้ ลา' (Shanghai La) and unverified 150m height",
    "icon-saladaeng-one": "corrupted Thai translation 'เดอะ ศาลเจ้ากรุง วัน' (The City Shrine One)",
    "icon-chatrium-residence": "corrupted Unicode character in Thai name '\ufffdัทรีม'",
    "icon-bobae": "corrupted Thai name 'ตลาดบ่อแข่ง' (Bor Khaeng instead of ตลาดโบ๊เบ๊)",
    "icon-wat-rakhang": "duplicate geometry on Old Town layer with Wat Ratchabophit ceremonial name",
    "icon-wat-bowonniwet": "duplicate geometry on Old Town layer with incorrect name 'วัดบวรมงคล'",
    "icon-wat-ratchabophit": "duplicate geometry on Old Town layer already present in heritage detail",
    "icon-wat-suthat": "duplicate geometry on Old Town layer already present in heritage detail",
    "icon-wat-ratchanatdaram": "duplicate geometry on Old Town layer already present in heritage detail",
    "icon-lumphini-park": "park canopy: 8m solid extruded slab covering lake; belongs in 2D landuse layer",
    "icon-benjakitti-park": "park canopy: 8m solid extruded slab; belongs in 2D landuse layer",
    "icon-benchasiri-park": "park canopy: 8m solid extruded slab; belongs in 2D landuse layer",
    "icon-saranrom-park": "park canopy: 8m solid extruded slab; belongs in 2D landuse layer",
    "icon-rommaneenat-park": "park canopy: 8m solid extruded slab; belongs in 2D landuse layer",
}


def make_rect(center, width_m, height_m):
    """Generates a closed polygon ring around a center [lng, lat]."""
    lng, lat = center
    d_lat = (height_m / 2.0) / 110540.0
    d_lng = (width_m / 2.0) / (111320.0 * 0.971)  # cos(13.7 deg)
    return [
        [round(lng - d_lng, 7), round(lat - d_lat, 7)],
        [round(lng + d_lng, 7), round(lat - d_lat, 7)],
        [round(lng + d_lng, 7), round(lat + d_lat, 7)],
        [round(lng - d_lng, 7), round(lat + d_lat, 7)],
        [round(lng - d_lng, 7), round(lat - d_lat, 7)],
    ]


def main():
    with open(LANDMARKS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data["features"]
    heritage_features = []
    retained_skyline = []
    quarantined = []

    for f in features:
        props = f["properties"]
        fid = props["id"]

        if not fid.startswith("icon-"):
            heritage_features.append(f)
            continue

        if fid in SKYLINE_SPECS:
            spec = SKYLINE_SPECS[fid]
            props["name"] = spec["name"]
            props["height"] = spec["height"]
            props["source"] = spec["source"]

            # Relocate coordinates if corrected center is specified
            if spec.get("polygon_offset") and "center" in spec:
                new_poly = make_rect(spec["center"], 45, 45)
                f["geometry"]["coordinates"] = [new_poly]

            retained_skyline.append(f)
        else:
            reason = QUARANTINE_REASONS.get(
                fid,
                f"unverified spec or height tag for {props.get('kind', 'feature')}; held for field review",
            )
            props["quarantine_reason"] = reason
            quarantined.append(f)

    curated_features = heritage_features + retained_skyline

    print(f"Original heritage: {len(heritage_features)}")
    print(f"Retained verified skyline icons: {len(retained_skyline)}")
    print(f"Total curated landmarks: {len(curated_features)}")
    print(f"Quarantined features: {len(quarantined)}")

    # Save curated landmarks
    with open(LANDMARKS_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {
                "type": "FeatureCollection",
                "name": "bkk-landmarks",
                "features": curated_features,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    # Save quarantined landmarks
    with open(QUARANTINE_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {
                "type": "FeatureCollection",
                "name": "bkk-landmarks-quarantine",
                "description": "Quarantined landmark features held for field review, verified heights, and cited provenance.",
                "features": quarantined,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print("Successfully wrote bkk-landmarks.geojson and bkk-landmarks-quarantine.geojson.")


if __name__ == "__main__":
    main()
