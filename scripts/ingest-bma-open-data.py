#!/usr/bin/env python3
"""
ingest-bma-open-data.py
------------------------
Pull civic point-of-interest data from Thailand's national and Bangkok
open-data portals, normalize it to one schema, assign each point to a
real Bangkok district (point-in-polygon against public/bkk-districts.geojson,
not the source's own numeric dcode — one less mapping table to trust), and
emit a SQL seed file for the CIVIC_DB D1 database (db/schema.sql).

Datasets (all Creative Commons, public):
  school       data.bangkok.go.th/dataset/59530916-...  (BMA schools, 2566)
  sportsground data.go.th/dataset/158364ff-...           (สถานที่ตั้งลานกีฬา)
  carpark      data.go.th/dataset/7e594dfb-...            (สถานที่จอดรถ กทม.)
  museum       data.go.th/dataset/a27f06cf-...             (พิพิธภัณฑ์ท้องถิ่น)
  waterway     data.bangkok.go.th/dataset/349be276-...    (สถานที่สำคัญริมน้ำ)

sportsground/carpark/museum ship as GeoServer WFS JSON in EPSG:32647 (UTM
zone 47N) — reprojected to WGS84 here with pyproj. school/waterway already
ship with lat/lon columns.

Usage:
    pip install pyproj openpyxl
    python3 scripts/ingest-bma-open-data.py --out db/seed.sql

Then apply:
    npx wrangler d1 execute bkkx-civic-data --remote --file=db/schema.sql
    npx wrangler d1 execute bkkx-civic-data --remote --file=db/seed.sql
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DISTRICTS_PATH = ROOT / "public" / "bkk-districts.geojson"
USER_AGENT = "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org; civic data ingest)"

SOURCES = {
    "school": {
        "url": "https://data.bangkok.go.th/dataset/59530916-28b0-445e-9206-da873c46ce63/resource/872273ec-7610-40c5-971f-e2dcb2dd5f16/download/address2566.xlsx",
        "dataset": "addressschoolbma",
        "format": "xlsx",
    },
    "sportsground": {
        "url": "https://data.go.th/dataset/158364ff-9306-4281-a737-9805483eb813/resource/d89f9021-cb02-46fd-9d29-d54621bf5623/download/groundsport.json",
        "dataset": "groundsport",
        "format": "wfs_json",
    },
    "carpark": {
        "url": "https://data.go.th/dataset/7e594dfb-b96a-4d24-8bbf-95b6b33a43ba/resource/cfaf84e7-04f0-4012-ab7d-08a2be90fc35/download/car_park.json",
        "dataset": "car_park",
        "format": "wfs_json",
    },
    "museum": {
        "url": "https://data.go.th/dataset/a27f06cf-be02-4271-b85a-888012b94cb0/resource/8859c3fd-5950-4320-8f94-34dbda66fdeb/download/local_museum.json",
        "dataset": "local_museum",
        "format": "wfs_json",
    },
    "waterway": {
        "url": "https://data.bangkok.go.th/dataset/349be276-7ef6-4f15-b9b4-4eafc971228e/resource/852fd783-54ba-4c73-8639-e878daeaa69e/download/csv-.csv",
        "dataset": "cl_625392d715de6",
        "format": "csv",
    },
}


def fetch(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=30) as res:
        return res.read()


# ---------------------------------------------------------------------------
# District matching — ray-cast point-in-polygon against our own real district
# polygons (Nominatim-sourced, see bkk-districts.geojson), same algorithm as
# the flood-envelope point-in-polygon check already in the Worker/client.
# ---------------------------------------------------------------------------

def point_in_ring(lng: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def point_in_feature(lng: float, lat: float, geometry: dict) -> bool:
    if geometry["type"] == "Polygon":
        rings = geometry["coordinates"]
        if not point_in_ring(lng, lat, rings[0]):
            return False
        return not any(point_in_ring(lng, lat, hole) for hole in rings[1:])
    if geometry["type"] == "MultiPolygon":
        for poly in geometry["coordinates"]:
            if point_in_ring(lng, lat, poly[0]) and not any(
                point_in_ring(lng, lat, hole) for hole in poly[1:]
            ):
                return True
    return False


def load_districts() -> list[dict]:
    data = json.loads(DISTRICTS_PATH.read_text(encoding="utf-8"))
    return data["features"]


def find_district(lng: float, lat: float, districts: list[dict]) -> tuple[int | None, str | None]:
    for feat in districts:
        if point_in_feature(lng, lat, feat["geometry"]):
            p = feat["properties"]
            return p["id"], p["name_en"].replace(" District", "")
    return None, None


# ---------------------------------------------------------------------------
# Per-format readers → list of (name, lat, lng, address, properties dict)
# ---------------------------------------------------------------------------

THAILAND_BBOX = (97.0, 5.0, 106.0, 21.0)  # generous, just catches sentinel/garbage values


def read_wfs_json(raw: bytes) -> list[dict]:
    import math
    from pyproj import Transformer

    data = json.loads(raw)
    to_wgs84 = Transformer.from_crs("EPSG:32647", "EPSG:4326", always_xy=True)
    rows = []
    skipped = 0
    for feat in data.get("features", []):
        geom = feat.get("geometry")
        if not geom or geom.get("type") != "Point":
            continue
        x, y = geom["coordinates"]
        lng, lat = to_wgs84.transform(x, y)
        # Some source rows carry a -DBL_MAX null-geometry sentinel instead of
        # an actual point — reprojecting that produces inf, not a usable POI.
        if (
            not math.isfinite(lat) or not math.isfinite(lng)
            or not (THAILAND_BBOX[0] <= lng <= THAILAND_BBOX[2])
            or not (THAILAND_BBOX[1] <= lat <= THAILAND_BBOX[3])
        ):
            skipped += 1
            continue
        props = dict(feat.get("properties") or {})
        name = props.pop("name", None) or "Unnamed"
        address = props.pop("address", None) or props.pop("location", None)
        rows.append({"name": name, "lat": lat, "lng": lng, "address": address, "properties": props})
    if skipped:
        print(f"  ↳ skipped {skipped} row(s) with invalid/sentinel coordinates", file=sys.stderr)
    return rows


def read_school_xlsx(raw: bytes) -> list[dict]:
    import tempfile

    import openpyxl

    # openpyxl needs a real file path, not a bytes buffer — write to a
    # proper OS temp file (auto-cleaned) rather than a path inside the repo.
    with tempfile.NamedTemporaryFile(suffix=".xlsx") as tmp:
        tmp.write(raw)
        tmp.flush()
        wb = openpyxl.load_workbook(tmp.name, read_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter)
    idx = {name: i for i, name in enumerate(header)}
    rows = []
    for r in rows_iter:
        try:
            lat = float(r[idx["Latitude"]])
            lng = float(r[idx["Longitude"]])
        except (TypeError, ValueError):
            continue
        rows.append({
            "name": r[idx["School"]],
            "lat": lat,
            "lng": lng,
            "address": r[idx["Addresss"]],
            "properties": {
                "district_th": r[idx["District"]],
                "tumbon": r[idx["Tumbon"]],
                "postoff": r[idx["Postoff"]],
                "tel": r[idx["Tel"]],
                "website": r[idx["Website"]],
                "class_open": r[idx["Class_Open"]],
            },
        })
    return rows


def read_waterway_csv(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines())
    rows = []
    for r in reader:
        try:
            lat = float(r["latitude"])
            lng = float(r["longitude"])
        except (TypeError, ValueError, KeyError):
            continue
        rows.append({
            "name": r["place_name"],
            "lat": lat,
            "lng": lng,
            "address": r.get("place"),
            "properties": {"added": r.get("adddate")},
        })
    return rows


def sql_quote(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(ROOT / "db" / "seed.sql"))
    parser.add_argument("--cache-dir", default=None, help="reuse downloaded files from this dir instead of re-fetching")
    args = parser.parse_args()

    districts = load_districts()
    now = datetime.now(timezone.utc).isoformat()
    statements = ["DELETE FROM civic_pois;", "DELETE FROM ingestion_runs;"]
    total = 0

    for category, src in SOURCES.items():
        print(f"[{category}] fetching {src['url']}", file=sys.stderr)
        cache_path = Path(args.cache_dir) / f"{category}.raw" if args.cache_dir else None
        if cache_path and cache_path.exists():
            raw = cache_path.read_bytes()
        else:
            raw = fetch(src["url"])
            if cache_path:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_bytes(raw)

        if src["format"] == "wfs_json":
            rows = read_wfs_json(raw)
        elif src["format"] == "xlsx":
            rows = read_school_xlsx(raw)
        elif src["format"] == "csv":
            rows = read_waterway_csv(raw)
        else:
            raise ValueError(src["format"])

        print(f"[{category}] {len(rows)} rows, matching districts...", file=sys.stderr)
        n_matched = 0
        for i, row in enumerate(rows):
            did, dname = find_district(row["lng"], row["lat"], districts)
            if did is not None:
                n_matched += 1
            poi_id = f"{category}:{i}"
            statements.append(
                "INSERT INTO civic_pois "
                "(id, category, name, lat, lng, district_id, district_name_en, address, properties, source_dataset, source_url, ingested_at) "
                "VALUES ("
                + ", ".join([
                    sql_quote(poi_id),
                    sql_quote(category),
                    sql_quote(row["name"]),
                    sql_quote(row["lat"]),
                    sql_quote(row["lng"]),
                    sql_quote(did),
                    sql_quote(dname),
                    sql_quote(row["address"]),
                    sql_quote(json.dumps(row["properties"], ensure_ascii=False)),
                    sql_quote(src["dataset"]),
                    sql_quote(src["url"]),
                    sql_quote(now),
                ])
                + ");"
            )
        print(f"[{category}] {n_matched}/{len(rows)} matched to a district", file=sys.stderr)
        statements.append(
            "INSERT INTO ingestion_runs (dataset, source_url, row_count, ingested_at, notes) VALUES ("
            + ", ".join([
                sql_quote(src["dataset"]),
                sql_quote(src["url"]),
                str(len(rows)),
                sql_quote(now),
                sql_quote(f"{n_matched}/{len(rows)} matched to a district"),
            ])
            + ");"
        )
        total += len(rows)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(statements) + "\n", encoding="utf-8")
    print(f"wrote {len(statements)} statements ({total} POIs) to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
