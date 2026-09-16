#!/usr/bin/env python3
"""
Build the Bangkok rain station network geojson from ThaiWater's v3 API.

Endpoint: provinces/rain24?include_zero=1&province_code=10
Source:    Hydro-Informatics Institute (HII) / Thai Water
Provider:  https://api-v3.thaiwater.net/api/v1/thaiwater30/

Each feature is a Point at the station's lat/lon with the rain_24h,
rain_1h, agency attribution, station id, amphoe/tumbon, and basin
properties baked in. Steals the BKK provincial rain-station network
that powers bangkok.thaiwater.net/dashboard so the atlas can render
the same gauge points with honest attribution.

Run from a clean checkout:
  python3 scripts/build-bkk-rain-stations.py

Output: public/bkk-rain-stations.geojson (replaces if present)
"""

import json
import sys
import urllib.request
from pathlib import Path

API_BASE = "https://api-v3.thaiwater.net/api/v1/thaiwater30"
PROVINCE_CODE = 10  # Bangkok
SOURCE_PATH = "public/bkk-rain-stations.geojson"
FETCH_URL = f"{API_BASE}/provinces/rain24?include_zero=1&province_code={PROVINCE_CODE}"


def main():
    out_path = Path(SOURCE_PATH)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Fetching {FETCH_URL}…", file=sys.stderr)
    req = urllib.request.Request(
        FETCH_URL,
        headers={"User-Agent": "Mavis-bkk-3d-atlas/1.0 (research)"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.load(r)

    raw = payload.get("data") or []
    print(f"Got {len(raw)} raw stations", file=sys.stderr)

    features = []
    skipped = 0
    for r in raw:
        st = r.get("station") or {}
        geo = r.get("geocode") or {}
        ag = r.get("agency") or {}
        basin = r.get("basin") or {}
        ag_name = ag.get("agency_name") or {}
        ag_short = ag.get("agency_shortname") or {}
        area = geo.get("area_name") or {}
        am = geo.get("amphoe_name") or {}
        tu = geo.get("tumbon_name") or {}
        st_name = st.get("tele_station_name") or {}

        lat = st.get("tele_station_lat")
        lng = st.get("tele_station_long")
        if lat is None or lng is None:
            skipped += 1
            continue
        try:
            lat_f = float(lat)
            lng_f = float(lng)
        except (TypeError, ValueError):
            skipped += 1
            continue

        rain_24 = r.get("rain_24h")
        rain_1 = r.get("rain_1h")
        try:
            rain_24 = float(rain_24) if rain_24 is not None else None
        except (TypeError, ValueError):
            rain_24 = None
        try:
            rain_1 = float(rain_1) if rain_1 is not None else None
        except (TypeError, ValueError):
            rain_1 = None

        # Self-describing "severity" label — the dashboard inverts this
        # but for the atlas we use the absolute mm scale because that is
        # what the station actually reports.
        if rain_24 is None:
            severity = "unknown"
        elif rain_24 == 0:
            severity = "none"
        elif rain_24 < 10:
            severity = "light"
        elif rain_24 < 35:
            severity = "moderate"
        elif rain_24 < 90:
            severity = "heavy"
        else:
            severity = "very-heavy"

        feat = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lng_f, 6), round(lat_f, 6)]},
            "properties": {
                "id": f"bkk-rain-{st.get('id') or r.get('id')}",
                "station_id": st.get("id"),
                "station_oldcode": st.get("tele_station_oldcode"),
                "name": st_name.get("th") or st_name.get("en") or "(unnamed)",
                "name_en": st_name.get("en") or "",
                "agency": ag_name.get("en") or ag_short.get("en") or "HII",
                "agency_th": ag_name.get("th") or "",
                "amphoe": am.get("th") or "",
                "amphoe_en": am.get("en") or "",
                "tumbon": tu.get("th") or "",
                "tumbon_en": tu.get("en") or "",
                "basin": basin.get("basin_name", {}).get("en") or basin.get("basin_name", {}).get("th") or "",
                "rain_24h_mm": rain_24,
                "rain_1h_mm": rain_1,
                "severity": severity,
                "observed_at": r.get("rainfall_datetime"),
                "station_type": r.get("station_type"),
                "sub_basin_id": st.get("sub_basin_id"),
                "warning_zone": geo.get("warning_zone"),
                "source": "ThaiWater v3 API · provinces/rain24?province_code=10",
            },
        }
        features.append(feat)

    fc = {
        "type": "FeatureCollection",
        "name": "bkk-rain-stations",
        "version": "2026-09-16",
        "description": (
            "Bangkok rain gauge network — 133 stations from the Hydro-Informatics "
            "Institute (HII) via api-v3.thaiwater.net. Live rain_24h and rain_1h "
            "readings, geocoded to the station lat/lon. Steals the BKK provincial "
            "station list that powers bangkok.thaiwater.net/dashboard."
        ),
        "attribution": (
            "Data: Hydro-Informatics Institute (สสน.) / ThaiWater v3 API · "
            "Royal Irrigation Department · Department of Drainage, Bangkok (BMA). "
            "Endpoint: api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24"
        ),
        "featureCount": len(features),
        "features": features,
    }

    out_path.write_text(json.dumps(fc, ensure_ascii=False, indent=2))
    print(f"Wrote {len(features)} features → {out_path} (skipped {skipped})", file=sys.stderr)
    # Print a summary so the run is auditable
    by_sev = {}
    for f in features:
        sev = f["properties"]["severity"]
        by_sev[sev] = by_sev.get(sev, 0) + 1
    print("by severity:", by_sev, file=sys.stderr)
    maxr = max((f["properties"]["rain_24h_mm"] or 0 for f in features), default=0)
    print(f"max rain_24h_mm: {maxr}", file=sys.stderr)


if __name__ == "__main__":
    main()
