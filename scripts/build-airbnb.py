#!/usr/bin/env python3
"""Inside Airbnb Bangkok listings -> public/bkk-airbnb.geojson.

    python3 scripts/build-airbnb.py <listings.csv> <snapshot-date>

Source: https://insideairbnb.com/get-the-data/ (Bangkok, visualisations/
listings.csv), CC BY 4.0. Of the 1,541 Tableau Public vizzes that mention
Bangkok, 172 map Airbnb, and all of them start from this file; the atlas
reads it at the source instead.

Kept: room type, nightly price, minimum nights, review counts, last review,
days available in the next year, how many listings the host runs, whether a
licence number is given. Dropped: listing name, host name and host ids.
Airbnb already shifts each point up to ~150 m to hide the address.
"""
import csv
import json
import sys
from pathlib import Path

src, snapshot = sys.argv[1], sys.argv[2]
out = Path(__file__).resolve().parents[1] / "public/bkk-airbnb.geojson"
ROOM = {"Entire home/apt": "E", "Private room": "P", "Shared room": "S", "Hotel room": "H"}


def num(v, cast=int):
    try:
        return cast(float(v)) if v not in ("", None) else None
    except ValueError:
        return None


features = []
with open(src, encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        lat, lng = num(r["latitude"], float), num(r["longitude"], float)
        if lat is None or lng is None or not (13.4 <= lat <= 14.2 and 100.2 <= lng <= 101.0):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lng, 4), round(lat, 4)]},
            "properties": {
                "id": r["id"],
                "r": ROOM.get(r["room_type"], "E"),
                "p": num(r["price"]),
                "mn": num(r["minimum_nights"]),
                "n": num(r["number_of_reviews"]) or 0,
                "n12": num(r["number_of_reviews_ltm"]) or 0,
                "lr": r["last_review"] or None,
                "av": num(r["availability_365"]),
                "h": num(r["calculated_host_listings_count"]),
                "lic": 1 if (r.get("license") or "").strip() else 0,
            },
        })

features.sort(key=lambda f: f["properties"]["id"])
out.write_text(json.dumps({
    "type": "FeatureCollection",
    "name": "bkk-airbnb",
    "snapshot": snapshot,
    "source": f"https://data.insideairbnb.com/thailand/central-thailand/bangkok/{snapshot}/visualisations/listings.csv",
    "license": "CC BY 4.0 · Inside Airbnb",
    "note": "Listings as scraped by Inside Airbnb on the snapshot date. Points are shifted by Airbnb up to ~150 m. A listing is not a guest, and not proof the room is let.",
    "count": len(features),
    "features": features,
}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"{len(features)} listings -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
