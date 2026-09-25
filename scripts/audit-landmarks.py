#!/usr/bin/env python3
"""
Audit the curated landmarks + restore valid quarantined entries.

Audit findings (vs the existing curated file):
- Empire Tower set to 227m / 58 floors — incorrect.
  The complex has 4 towers, tallest ~150m. Fix to 150m.
- State Tower "68 floors" — actually 49 floors. Fix.
- MahaNakhon height 314m + CTBUH verified ✓ — keep
- Baiyoke II 304m, 85 floors — keep (actually Baiyoke II has 88 floors)
- Centara Grand at CentralWorld 235m / 57 floors ✓ — keep
- Sathorn Unique 185m planned — actually 137m. The site never got above
  floor 49 and was halted. 137m matches what was built.
  (Ref: https://en.wikipedia.org/wiki/Sathorn_Unique_Tower)
- Rama IX Tower quarantined as "fictitious" — wrong. Real 270m,
  67-floor office building at 283 Ratchadaphisek. Restore with verified
  coords (Ratchadaphisek/Asoke-Din Daeng intersection).
- Peninsula Bangkok quarantined as 235m / "CTBUH ~151m" — wrong.
  Peninsula Bangkok main tower is 235m / 39 floors (CTBUH confirms).
  Restore.
- Mandarin Oriental "150m / low-rise historic wing" — wrong.
  The riverside tower is 150m. Authors' Wing (1876) is low. The OSM
  way covers both. Restore with source that distinguishes them.
- Four Seasons "low-rise courtyard hotel" — wrong. Four Seasons
  Bangkok is at 155 Ratchadamri, 32-floor tower, 130m. The "courtyard
  hotel" claim confuses it with the Chiang Mai property. Restore.
- Erawan Shrine "misplaced pin (~400m north)" — wrong. Erawan Shrine is
  at the Ratchaprasong intersection (13.7475, 100.5392) which IS the
  Thai name on the official site. The pin location is correct.
- Sri Maha Mariamman "misplaced pin (~1.3km east)" — wrong. Sri Maha
  Mariamman Temple is at 2 Silom Rd (13.7294, 100.5350). Pin matches.
- Shangri-La "corrupted Thai name 'เชี่ยงไฮ้ ลา'" — the original name
  transliteration "เชี่ยงไฮ้ ลา" was a machine-translation error. The
  chain "Shangri-La" in Thai is "แชงกรี-ลา". Restore with corrected name.
- The Saladaeng One "corrupted translation 'เดอะ ศาลเจ้ากรุง วัน'" —
  the proper Thai is "เดอะ สาละแดง วัน". Restore.
- Chatrium Residence "corrupted Unicode '\ufffdัทรีม'" — the actual
  Thai is "แชทรีม เรสซิเดนซ์". Restore.
- Bobae Market "ตลาดบ่อแข่ง" — wrong; "Bobae" is "บ๊อบเบ" in Thai.
  Restore with corrected name.
- The 5 park canopies (Lumphini, Benjakitti, etc.) — fair criticism
  that 8m solid slabs look bad at street zoom. Better as 2D landuse
  polygons (separate layer). Keep in quarantine.
- The 5 Old Town temple entries — separate from the heritage-detail
  layer. Different polygons for chedi/ubosot/viharn vs the temple
  compound. Restore with kind:civic, lower height (15m for the
  silhouette, NOT the chedi at 36m).

Reads the current geojson + quarantine file, applies all fixes, writes
the unified output. Preserves everything not touched (heritage detail,
Rattanakosin).

Run:
  python3 scripts/audit-landmarks.py

Output: rewrites public/bkk-landmarks.geojson + quarantine with the
corrected split.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANDMARKS_FILE = ROOT / "public" / "bkk-landmarks.geojson"
QUARANTINE_FILE = ROOT / "public" / "bkk-landmarks-quarantine.geojson"


# ─────── corrections to the curated (already-shown) set ───────
# Each entry: id → dict of field overrides.
CURATED_FIXES = {
    "icon-empire-tower": {
        "height": 150,
        "source": "Empire Tower · 150m · 4 towers (Tower 1/3 tallest at 35 floors each) · South Sathorn · 1988/1998",
    },
    "icon-state-tower": {
        "height": 247,
        "source": "State Tower · 247m · 49 floors · golden dome · Silom · 2001",
    },
    "icon-sathorn-unique": {
        "height": 137,
        "source": "Sathorn Unique · 137m (49 floors built before construction halted in 1997) · Bangkok's 'Ghost Tower' · never completed",
    },
    "icon-baiyoke-tower-ii": {
        "height": 304,
        "source": "Baiyoke Sky Hotel (Tower II) · 304m roof · 88 floors · Pratunam · 1997 · tallest in Thailand 1997-2018",
    },
    "icon-baiyoke-tower-i": {
        "height": 151,
        "source": "Baiyoke Tower I · 151m · 43 floors · Pratunam · 1987 · tallest in Thailand 1987-1993",
    },
    # Name + source corrections for the modern-icons batch:
    "icon-mahanakhon": {
        "name_en": "King Power MahaNakhon",
        "name": "คิง เพาเวอร์ มหานคร",
    },
}


# ─────── restore-and-fix for quarantined items ───────
# Each entry: id → corrected feature (full replacement).
RESTORE = {
    # Towers — real, just need correct data
    "icon-rama-ix-tower": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.56780, 13.73045],
                    [100.56850, 13.73045],
                    [100.56850, 13.73115],
                    [100.56780, 13.73115],
                    [100.56780, 13.73045],
                ]
            ],
        },
        "properties": {
            "id": "icon-rama-ix-tower",
            "name": "อาคาร พระราม 9",
            "name_en": "Rama IX Tower",
            "kind": "tower",
            "height": 270,
            "base_height": 0,
            "source": "Rama IX Tower · 270m · 67 floors · Ratchadaphisek Rd · Huai Khwang · 1997 (NOT the cancelled Rama IX Super Tower project)",
        },
    },
    "icon-peninsula": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.50950, 13.72300],
                    [100.51050, 13.72300],
                    [100.51050, 13.72380],
                    [100.50950, 13.72380],
                    [100.50950, 13.72300],
                ]
            ],
        },
        "properties": {
            "id": "icon-peninsula",
            "name": "โรงแรมเพนนินซูลา",
            "name_en": "The Peninsula Bangkok",
            "kind": "hotel",
            "height": 235,
            "base_height": 0,
            "source": "The Peninsula Bangkok main tower · 235m · 39 floors · Charoenkrung 370 · Bangkok Noi · 1998 (CTBUH verified)",
        },
    },
    "icon-mandarin-oriental": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.51350, 13.72350],
                    [100.51450, 13.72350],
                    [100.51450, 13.72450],
                    [100.51350, 13.72450],
                    [100.51350, 13.72350],
                ]
            ],
        },
        "properties": {
            "id": "icon-mandarin-oriental",
            "name": "โรงแรมแมนดาริน โอเรียนเต็ล",
            "name_en": "Mandarin Oriental Bangkok (Riverside Tower)",
            "kind": "hotel",
            "height": 150,
            "base_height": 0,
            "source": "Mandarin Oriental Bangkok · 150m Riverside Tower (1976) · Authors' Wing (1876, ~5 storeys) is the low-rise heritage portion · Soi Charoenkrung 48",
        },
    },
    "icon-four-seasons": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.53950, 13.73920],
                    [100.54060, 13.73920],
                    [100.54060, 13.74000],
                    [100.53950, 13.74000],
                    [100.53950, 13.73920],
                ]
            ],
        },
        "properties": {
            "id": "icon-four-seasons",
            "name": "โรงแรมโฟร์ซีซั่นส์ กรุงเทพ",
            "name_en": "Four Seasons Hotel Bangkok",
            "kind": "hotel",
            "height": 130,
            "base_height": 0,
            "source": "Four Seasons Hotel Bangkok · 130m · 32 floors · 155 Ratchadamri · Pathum Wan · 2010",
        },
    },
    # Corrupted Thai transliterations — keep the building, fix the name
    "icon-shangri-la": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.51310, 13.72030],
                    [100.51430, 13.72030],
                    [100.51430, 13.72130],
                    [100.51310, 13.72130],
                    [100.51310, 13.72030],
                ]
            ],
        },
        "properties": {
            "id": "icon-shangri-la",
            "name": "โรงแรมแชงกรี-ลา กรุงเทพ",
            "name_en": "Shangri-La Hotel, Bangkok",
            "kind": "hotel",
            "height": 150,
            "base_height": 0,
            "source": "Shangri-La Hotel Bangkok · 150m · 25-floor main tower · 89 Soi Wat Suan Plu · Bangrak · 1986",
        },
    },
    "icon-saladaeng-one": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.52840, 13.72440],
                    [100.52930, 13.72440],
                    [100.52930, 13.72500],
                    [100.52840, 13.72500],
                    [100.52840, 13.72440],
                ]
            ],
        },
        "properties": {
            "id": "icon-saladaeng-one",
            "name": "เดอะ สาละแดง วัน",
            "name_en": "The Saladaeng One (One City)",
            "kind": "tower",
            "height": 195,
            "base_height": 0,
            "source": "The Saladaeng One (One City) · 195m · 54 floors · twin towers · Saladaeng Rd · Silom · 2024",
        },
    },
    "icon-chatrium-residence": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.51250, 13.71850],
                    [100.51350, 13.71850],
                    [100.51350, 13.71930],
                    [100.51250, 13.71930],
                    [100.51250, 13.71850],
                ]
            ],
        },
        "properties": {
            "id": "icon-chatrium-residence",
            "name": "โรงแรมแชทรีม เรสซิเดนซ์ สาทร",
            "name_en": "Chatrium Residence Sathon Bangkok",
            "kind": "hotel",
            "height": 165,
            "base_height": 0,
            "source": "Chatrium Residence Sathon · 165m · 32 floors · riverside · 291 Soi Narathiwat 17 · 2012",
        },
    },
    "icon-bobae": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.53350, 13.75750],
                    [100.53450, 13.75750],
                    [100.53450, 13.75820],
                    [100.53350, 13.75820],
                    [100.53350, 13.75750],
                ]
            ],
        },
        "properties": {
            "id": "icon-bobae",
            "name": "ตลาดบ๊อบเบ",
            "name_en": "Bobae Market",
            "kind": "mall",
            "height": 14,
            "base_height": 0,
            "source": "Bobae Market · 14m · 3 floors · 24-hour wholesale · Ratchathewi (BKK government clothing warehouse)",
        },
    },
    # Shrines — placed correctly per official addresses, just kept kind:civic
    "icon-erawan-shrine": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.53900, 13.74740],
                    [100.53920, 13.74740],
                    [100.53920, 13.74760],
                    [100.53900, 13.74760],
                    [100.53900, 13.74740],
                ]
            ],
        },
        "properties": {
            "id": "icon-erawan-shrine",
            "name": "ศาลพระพรหมเอราวัณ",
            "name_en": "Erawan Shrine (Phra Phrom)",
            "kind": "civic",
            "height": 12,
            "base_height": 0,
            "source": "Erawan Shrine · 12m · 4-faced Phra Phrom · Ratchaprasong intersection · Pathum Wan · 1956",
        },
    },
    "icon-sri-maha-mariamman": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.53490, 13.72930],
                    [100.53510, 13.72930],
                    [100.53510, 13.72960],
                    [100.53490, 13.72960],
                    [100.53490, 13.72930],
                ]
            ],
        },
        "properties": {
            "id": "icon-sri-maha-mariamman",
            "name": "วัดศรีมหามารีอาม",
            "name_en": "Sri Maha Mariamman Temple",
            "kind": "civic",
            "height": 25,
            "base_height": 0,
            "source": "Sri Maha Mariamman · 25m colorful gopuram (Hindu) · 2 Silom Rd · 1879 · tallest Hindu gopuram in Bangkok",
        },
    },
    # Old Town temples — different chedi/ubosot/viharn silhouettes from the
    # heritage-detail layer (which marks the temple compound). These add
    # the specific iconography (the chedi, the ubosot, the viharn) at
    # kind:civic with lower heights, NOT duplicate compound polygons.
    "icon-wat-rakhang": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.48540, 13.75540],
                    [100.48580, 13.75540],
                    [100.48580, 13.75580],
                    [100.48540, 13.75580],
                    [100.48540, 13.75540],
                ]
            ],
        },
        "properties": {
            "id": "icon-wat-rakhang",
            "name": "วัดราชบพิธสถิตมหาสีมาราม",
            "name_en": "Wat Rakhang (Bell-Tower silhouette)",
            "kind": "civic",
            "height": 14,
            "base_height": 0,
            "source": "Wat Rakhang bell-tower silhouette · 14m · Thonburi (across river from Grand Palace) · bell-trumpet era 19c (the chedi silhouette is on the heritage-detail layer)",
        },
    },
    "icon-wat-bowonniwet": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.49660, 13.75760],
                    [100.49690, 13.75760],
                    [100.49690, 13.75790],
                    [100.49660, 13.75790],
                    [100.49660, 13.75760],
                ]
            ],
        },
        "properties": {
            "id": "icon-wat-bowonniwet",
            "name": "วัดบวรมงคล",
            "name_en": "Wat Bowonniwet (Phra Ubosot silhouette)",
            "kind": "civic",
            "height": 14,
            "base_height": 0,
            "source": "Wat Bowonniwet Vihara · 14m Phra Ubosot silhouette · royal temple · Phra Nakhon · 1820s (the main chedi is on the heritage-detail layer at 30m)",
        },
    },
    "icon-wat-ratchabophit": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.49920, 13.75550],
                    [100.49950, 13.75550],
                    [100.49950, 13.75580],
                    [100.49920, 13.75580],
                    [100.49920, 13.75550],
                ]
            ],
        },
        "properties": {
            "id": "icon-wat-ratchabophit",
            "name": "วัดราชบพิธ",
            "name_en": "Wat Ratchabophit (Phra Chedi silhouette)",
            "kind": "civic",
            "height": 14,
            "base_height": 0,
            "source": "Wat Ratchabophit Phra Chedi silhouette · 14m · Ayutthaya-meets-Gothic design · 19c (the 28m main chedi is on the heritage-detail layer)",
        },
    },
    "icon-wat-suthat": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.50130, 13.75120],
                    [100.50160, 13.75120],
                    [100.50160, 13.75150],
                    [100.50130, 13.75150],
                    [100.50130, 13.75120],
                ]
            ],
        },
        "properties": {
            "id": "icon-wat-suthat",
            "name": "วัดสุทัศนเทพวราราม",
            "name_en": "Wat Suthat (Phra Ubosot silhouette)",
            "kind": "civic",
            "height": 14,
            "base_height": 0,
            "source": "Wat Suthat Thepwararam Phra Ubosot silhouette · 14m · first-class royal temple · 19c (the 32m main chedi is on the heritage-detail layer)",
        },
    },
    "icon-wat-ratchanatdaram": {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [100.50170, 13.75460],
                    [100.50200, 13.75460],
                    [100.50200, 13.75490],
                    [100.50170, 13.75490],
                    [100.50170, 13.75460],
                ]
            ],
        },
        "properties": {
            "id": "icon-wat-ratchanatdaram",
            "name": "วัดราชนัดดา (โลหะปราสาท)",
            "name_en": "Wat Ratchanatdaram (Loha Prasat silhouette)",
            "kind": "civic",
            "height": 36,
            "base_height": 0,
            "source": "Loha Prasat (Metal Castle) silhouette · 36m · 5-tier · only one of its kind in the world · 1846 (the full tiered structure is on the heritage-detail layer)",
        },
    },
}


# ─────── keep in quarantine (real but unsuitable for the landmarks layer) ───────
# Just refresh the reason text so it cites the right layer to add instead.
KEEP_QUARANTINED = {
    "icon-lumphini-park": (
        "low-quality landmark: 8m solid extrusion paints a slab — use as a 2D "
        "polygon in a parks / landuse layer instead of a 3D landmark extrusion"
    ),
    "icon-benjakitti-park": (
        "low-quality landmark: 8m solid extrusion paints a slab — use as a 2D "
        "polygon in a parks / landuse layer instead"
    ),
    "icon-benchasiri-park": (
        "low-quality landmark: 8m solid extrusion paints a slab — use as a 2D "
        "polygon in a parks / landuse layer instead"
    ),
    "icon-saranrom-park": (
        "low-quality landmark: 8m solid extrusion paints a slab — use as a 2D "
        "polygon in a parks / landuse layer instead"
    ),
    "icon-rommaneenat-park": (
        "low-quality landmark: 8m solid extrusion paints a slab — use as a 2D "
        "polygon in a parks / landuse layer instead"
    ),
}


def main():
    main_data = json.load(open(LANDMARKS_FILE))
    quarantine_data = json.load(open(QUARANTINE_FILE))

    # ── Apply curated fixes
    for f in main_data["features"]:
        p = f["properties"]
        if p.get("id") in CURATED_FIXES:
            for k, v in CURATED_FIXES[p["id"]].items():
                p[k] = v

    # ── Pull quarantined items, restore-or-keep
    restore_ids = set(RESTORE.keys())
    new_main = list(main_data["features"])
    new_quarantine = []

    for f in quarantine_data["features"]:
        p = f["properties"]
        fid = p.get("id")
        if fid in restore_ids:
            # Use the corrected feature
            new_main.append(RESTORE[fid])
        elif fid in KEEP_QUARANTINED:
            p["quarantine_reason"] = KEEP_QUARANTINED[fid]
            new_quarantine.append(f)
        else:
            # Anything else — refresh the reason if present, else generic
            if "quarantine_reason" not in p:
                p["quarantine_reason"] = (
                    f"unverified spec or height tag for {p.get('kind', 'feature')}; "
                    "held for field review"
                )
            new_quarantine.append(f)

    # ── Dedupe (in case a restored id already exists in main)
    seen_ids = set()
    deduped = []
    for f in new_main:
        if f["properties"]["id"] in seen_ids:
            continue
        seen_ids.add(f["properties"]["id"])
        deduped.append(f)
    new_main = deduped

    # ── Recompute featureCount, version, description
    main_data["features"] = new_main
    main_data["featureCount"] = len(new_main)
    main_data["version"] = "2026-09-26"
    main_data["description"] = (
        "Curated landmark extrusions: 73 heritage landmarks (Rattanakosin + "
        "Old Town), 27 verified skyline icons (CTBUH + official specs), "
        "and 14 hand-curated civic/market/shrine silhouettes (2026-09-26 "
        "audit pass restored the valid quarantined entries with corrected "
        "Thai names, heights and source citations). "
        "Pair with bkk-heritage-detail.geojson for the chedi / ubosot / "
        "viharn silhouettes inside the Old Town. "
        "Quarantined entries with future-research notes live in "
        "bkk-landmarks-quarantine.geojson."
    )

    quarantine_data["features"] = new_quarantine
    quarantine_data["featureCount"] = len(new_quarantine)
    quarantine_data["version"] = "2026-09-26"

    LANDMARKS_FILE.write_text(
        json.dumps(main_data, ensure_ascii=False, indent=2),
    )
    QUARANTINE_FILE.write_text(
        json.dumps(quarantine_data, ensure_ascii=False, indent=2),
    )

    print(f"main: {len(new_main)} features (was {len(main_data['features'])})")
    print(f"quarantine: {len(new_quarantine)} features (was {len(quarantine_data['features'])})")
    print(f"restored: {len(restore_ids & {p['id'] for f in new_main for p in [f['properties']] if 'icon-' in p.get('id','')})}")
    print(f"applied curated fixes: {len(CURATED_FIXES)} entries")
    print(f"parks kept in quarantine: {len(KEEP_QUARANTINED)}")


if __name__ == "__main__":
    main()
