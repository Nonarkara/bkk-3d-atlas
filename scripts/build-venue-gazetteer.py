#!/usr/bin/env python3
"""
build-venue-gazetteer.py
------------------------
Build public/bkk-venues.geojson — the gazetteer the news layer matches
headlines against.

Why this file exists at all: news headlines carry no coordinates. The only
honest way to put a story on a map is to find a REAL place name in the text
and resolve it against a REAL gazetteer. Every coordinate here comes from
OpenStreetMap; nothing is invented. If a headline matches nothing here, it
gets no pin (see src/index.ts) rather than being dumped at city centre.

Matching quality rules (the whole point of this script):
  * A venue only becomes matchable if its name is distinctive enough that
    finding it in prose almost certainly means the article is about it.
    Short generic names in the raw OSM pull — "Forum", "Supreme", "feast",
    "Parade", "Alien" — would match unrelated sentences constantly, so they
    are dropped unless they are a recognisable all-caps acronym (BITEC).
  * A stoplist removes names that are ordinary English or Thai words.
  * Curated areas from bkk-areas.json are included at lower precision:
    "Silom" is a real, useful signal for a traffic story, but it locates a
    neighbourhood, not a building — so it is labelled `area`, not `venue`.

Usage:
    python3 scripts/build-venue-gazetteer.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "bkk-venues.geojson"
AREAS = ROOT / "public" / "bkk-areas.json"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org; venue gazetteer)"

BBOX = (13.40, 100.20, 14.20, 101.10)  # Bangkok metro incl. Muang Thong Thani

QUERY = f"""
[out:json][timeout:120];
(
  nwr["amenity"="exhibition_centre"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["amenity"="conference_centre"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["amenity"="convention_centre"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["leisure"="stadium"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["shop"="mall"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["amenity"="university"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["tourism"="attraction"]["name:en"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out center tags;
"""

# Names that are ordinary words first and venues second — matching these in
# prose says nothing about location. Checked against the live OSM pull.
STOPLIST = {
    "forum", "parade", "supreme", "feast", "alien", "maison", "old car",
    "sundial", "urbis", "phenix", "kurv7", "doggies", "habito", "auan",
    "the mall", "market", "the market", "central", "the park", "park",
    "arena", "stadium", "university", "mall", "plaza", "tower", "the hub",
    "city", "one", "terminal", "gateway", "square", "the street", "avenue",
}

# Short names kept anyway: distinctive acronyms/brands where a match is
# effectively unambiguous in Bangkok news.
# "ics" was here and is a real mall, but at 3 characters it is below the
# matcher's own 4-char floor — it could never match, and it tripped the
# gazetteer sanity check. Keep this list and the matcher in agreement.
SHORT_ALLOW = {"bitec", "iconsiam", "zpell", "jj mall", "mbk", "emquartier"}

MIN_NAME_LEN = 8


def fetch_overpass() -> dict:
    req = Request(OVERPASS, data=QUERY.encode("utf-8"), headers={"User-Agent": UA})
    with urlopen(req, timeout=180) as res:
        return json.loads(res.read())


def is_matchable(name: str) -> bool:
    n = name.strip()
    low = n.lower()
    if low in STOPLIST:
        return False
    if low in SHORT_ALLOW:
        return True
    if len(n) < MIN_NAME_LEN:
        # Keep only clearly-an-acronym short names (BITEC, MBK).
        return bool(re.fullmatch(r"[A-Z0-9]{4,}", n))
    # Reject anything that is a single very common word.
    if " " not in n and len(n) < 10 and low in STOPLIST:
        return False
    return True


def venue_kind(tags: dict) -> str:
    for key in ("amenity", "leisure", "shop", "tourism"):
        if key in tags:
            return tags[key]
    return "venue"


def main() -> int:
    # Overpass 504s under load often enough that a rebuild shouldn't depend
    # on it being healthy: --raw reuses a previously saved Overpass dump.
    raw_arg = None
    for i, a in enumerate(sys.argv[1:]):
        if a == "--raw" and i + 2 <= len(sys.argv[1:]):
            raw_arg = sys.argv[i + 2]
    if raw_arg:
        print(f"using cached Overpass dump: {raw_arg}", file=sys.stderr)
        data = json.loads(Path(raw_arg).read_text(encoding="utf-8"))
    else:
        print("fetching venues from Overpass…", file=sys.stderr)
        data = fetch_overpass()
    features = []
    seen: set[str] = set()
    dropped = 0

    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name_en = (tags.get("name:en") or "").strip()
        name_th = (tags.get("name:th") or "").strip()
        name = name_en or (tags.get("name") or "").strip()
        if not name:
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        if not is_matchable(name):
            dropped += 1
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(float(lon), 6), round(float(lat), 6)]},
            "properties": {
                "name": name,
                "nameTh": name_th or (tags.get("name") if tags.get("name") != name else "") or "",
                "kind": venue_kind(tags),
                "precision": "venue",
                "osmId": f"{el.get('type')}/{el.get('id')}",
            },
        })

    # Curated areas — real neighbourhood anchors, honestly lower precision.
    areas = json.loads(AREAS.read_text(encoding="utf-8")).get("areas", [])
    for a in areas:
        # "Bangkok from above" is a camera preset, not a place — pinning a
        # story to it would be meaningless.
        if a.get("category") == "city-scale":
            continue
        name = (a.get("name") or "").strip()
        center = a.get("center")
        if not name or not center:
            continue
        # Compound labels carry several real, separately-mentioned places:
        # "Silom / Sathorn" → Silom, Sathorn; "Yaowarat (Chinatown)" →
        # Yaowarat, Chinatown. News says one of them, not the label.
        aliases = []
        for part in re.split(r"\s*/\s*", re.sub(r"[()]", "|", name)):
            for piece in part.split("|"):
                piece = piece.strip()
                # 3-letter area names ("Ari") match far too much ordinary
                # prose to be worth a pin, even with word boundaries.
                if len(piece) >= 4 and piece.lower() not in STOPLIST:
                    aliases.append(piece)
        if not aliases:
            continue
        key = aliases[0].lower()
        if key in seen:
            continue
        seen.add(key)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(center[0], 6), round(center[1], 6)]},
            "properties": {
                "name": aliases[0],
                "nameTh": a.get("thai", ""),
                "aliases": aliases[1:],
                "kind": "area",
                "precision": "area",
                "osmId": None,
            },
        })

    out = {
        "type": "FeatureCollection",
        "name": "bkk-venues",
        "source": "OpenStreetMap via Overpass + curated areas from bkk-areas.json",
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
        "note": (
            "Gazetteer used to resolve place names found in news headlines to real "
            "coordinates. Names too short or too generic to match unambiguously are "
            "excluded at build time; see scripts/build-venue-gazetteer.py."
        ),
        "count": len(features),
        "features": features,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    kinds = {}
    for f in features:
        kinds[f["properties"]["kind"]] = kinds.get(f["properties"]["kind"], 0) + 1
    print(f"wrote {len(features)} venues to {OUT}", file=sys.stderr)
    print(f"  dropped {dropped} as too generic/short to match safely", file=sys.stderr)
    print(f"  kinds: {sorted(kinds.items(), key=lambda x: -x[1])}", file=sys.stderr)
    print(f"  size: {OUT.stat().st_size/1024:.0f} KB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
