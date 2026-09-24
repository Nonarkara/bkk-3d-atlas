#!/usr/bin/env python3
"""
gba-buildings-to-pmtiles.py
---------------------------
Replace the atlas's 432,077 OSM footprints (most stuck on the 9 m default)
with GlobalBuildingAtlas LoD1 — ~2.19 M Bangkok footprints, each with a
modelled height — without downloading the 1.58 GB source tile.

Pipeline (all in DuckDB, streaming over HTTP Range):
  1. Read the GBA GeoParquet tile straight from its URL, pruned to the atlas
     bbox by the file's `bbox` column. Only the row groups inside the bbox
     are fetched.
  2. Optionally clip to a boundary polygon (geoBoundaries ADM1 Bangkok).
  3. Calibrate the GBA height. GBA squeezes heights toward the middle: close
     under 12 m, ~11 m short at 25-50 m, less than half the real height
     above 100 m, and never above 147 m in Bangkok. The table in
     scripts/data/gba-height-calibration.json undoes that squeeze
     (piecewise-linear, provisional).
  4. Fuse with OSM. A height a person surveyed beats a modelled one:
       OSM `height` tag  >  OSM `building:levels` x 3  >  calibrated GBA
     An OSM footprint overrides a GBA footprint when it contains the GBA
     footprint's interior point. OSM features with an explicit `height`
     tag are also written in their own right, so towers mapped as
     `building:part` (Baiyoke II 304 m, MahaNakhon 314 m) keep their
     real silhouette. GBA tops out at 147 m and cannot draw them.
  5. Write GeoJSONSeq with the same `render_height` / `render_min_height`
     contract the viewer already reads, plus provenance:
       height_src  "osm_tag" | "osm_levels" | "gba_cal" | "gba"
       gba_height  the raw GBA value, kept for audit
     tippecanoe then bakes the same `buildings` layer the viewer expects,
     so the R2 object is a drop-in replacement.

Run it on Colab or a laptop. The cloud sandbox this repo is edited in
can't reach source.coop.

    pip install duckdb
    # (optional) OSM heights to fuse, with height_src, from the sibling script
    python3 scripts/osm-buildings-to-geojson.py \\
        --bbox 100.30,13.45,100.95,14.10 --output out/osm.geojson

    # 0. look at the tile's columns first; names vary between releases
    python3 scripts/gba-buildings-to-pmtiles.py --gba-url "$GBA_URL" --describe

    # 1. extract + calibrate + fuse  (~5 min for the Bangkok bbox)
    python3 scripts/gba-buildings-to-pmtiles.py --gba-url "$GBA_URL" \\
        --osm out/osm.geojson --output out/bkk-gba.geojsonl

    # 2. bake + ship (same recipe as the OSM PMTiles in the README)
    tippecanoe -Z11 -z15 --no-tile-size-limit --no-feature-limit \\
        --simplification=20 --read-parallel --force \\
        --include=render_height --include=render_min_height \\
        --include=height_src --include=gba_height \\
        -o out/bkk-gba.pmtiles -l buildings out/bkk-gba.geojsonl
    npx wrangler r2 object put bkk-tiles/buildings/bangkok.pmtiles \\
        --file=out/bkk-gba.pmtiles --remote

$GBA_URL is the https URL of the GBA LoD1 GeoParquet tile that covers
100.5 E / 13.75 N on Source Cooperative (GlobalBuildingAtlas). It is one
tile of about 1.58 GB and 19.5 M buildings, running from the Central
Plain to Cambodia.

Licence: check the GBA terms before you publish. Most of the Bangkok
footprints come from Google Open Buildings (87.6%), which is CC BY 4.0 /
ODbL; attribute GBA, Google, Microsoft and OSM on the atlas About panel.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_BBOX = "100.30,13.45,100.95,14.10"  # atlas metro bbox, same as the OSM PMTiles
DEFAULT_CALIBRATION = Path(__file__).parent / "data" / "gba-height-calibration.json"


def load_calibration(path: Path | None) -> dict | None:
    if path is None:
        return None
    with open(path, encoding="utf-8") as fh:
        table = json.load(fh)
    points = table["points_gba_to_true"]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    if xs != sorted(xs) or ys != sorted(ys) or len(set(xs)) != len(xs):
        raise ValueError(f"{path}: points must be strictly increasing in both axes")
    return table


def calibrate(h: float, table: dict | None) -> float:
    """Pure-Python twin of calibration_sql(), used by the self-test."""
    if table is None or h < table["identity_below_m"]:
        return h
    pts = table["points_gba_to_true"]
    if h <= pts[0][0]:
        return h
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if h <= x1:
            return min(y0 + (h - x0) * (y1 - y0) / (x1 - x0), table["max_height_m"])
    x_last, y_last = pts[-1]
    return min(y_last + (h - x_last) * table["above_last_point_slope"], table["max_height_m"])


def calibration_sql(col: str, table: dict | None) -> str:
    """The same piecewise-linear map as calibrate(), as a SQL CASE."""
    if table is None:
        return col
    pts = table["points_gba_to_true"]
    parts = [f"WHEN {col} < {max(table['identity_below_m'], pts[0][0])} THEN {col}"]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        slope = (y1 - y0) / (x1 - x0)
        parts.append(f"WHEN {col} <= {x1} THEN {y0} + ({col} - {x0}) * {slope}")
    x_last, y_last = pts[-1]
    parts.append(f"ELSE {y_last} + ({col} - {x_last}) * {table['above_last_point_slope']}")
    return f"LEAST(CASE {' '.join(parts)} END, {table['max_height_m']})"


def connect():
    import duckdb

    con = duckdb.connect()
    for ext in ("httpfs", "spatial"):
        con.execute(f"INSTALL {ext}; LOAD {ext};")
    return con


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_sql(args, table: dict | None, *, drop_below: float | None = None) -> str:
    minx, miny, maxx, maxy = (float(v) for v in args.bbox.split(","))
    h = f'"{args.height_col}"'
    src = f'"{args.source_col}"' if args.source_col else "NULL"
    geom = "ST_GeomFromWKB(g_raw.geometry)" if args.wkb else "g_raw.geometry"
    cal = calibration_sql("GREATEST(gba_height, 0)", table)
    gba_src = "'gba_cal'" if table else "'gba'"

    clip = ""
    if args.clip:
        clip = f"AND ST_Intersects(g.geom, (SELECT ST_Union_Agg(geom) FROM ST_Read({sql_str(args.clip)})))"

    ctes = [f"""
gba AS (
  SELECT {geom} AS geom,
         CAST({h} AS DOUBLE) AS gba_height,
         CAST({src} AS VARCHAR) AS gba_source
  FROM read_parquet({sql_str(args.gba_url)}) AS g_raw
  WHERE g_raw.bbox.xmax >= {minx} AND g_raw.bbox.xmin <= {maxx}
    AND g_raw.bbox.ymax >= {miny} AND g_raw.bbox.ymin <= {maxy}
),
gba_clipped AS (
  SELECT row_number() OVER () AS gid, g.*
  FROM gba g WHERE g.gba_height IS NOT NULL {clip}
)"""]

    if args.osm:
        ctes.append(f"""
osm AS (
  SELECT geom, CAST(height AS DOUBLE) AS osm_height,
         CAST(COALESCE(base_height, 0) AS DOUBLE) AS osm_base, height_src
  FROM ST_Read({sql_str(args.osm)})
  WHERE height_src IN ('tag', 'levels')
),
osm_best AS (
  -- one OSM observation per GBA footprint: an explicit tag beats a
  -- level count, then the tallest wins
  SELECT g.gid,
         arg_max(o.osm_height, (o.height_src = 'tag')::INT * 1e6 + o.osm_height) AS osm_height,
         arg_max(o.height_src, (o.height_src = 'tag')::INT * 1e6 + o.osm_height) AS osm_src
  FROM gba_clipped g
  JOIN osm o ON ST_Contains(o.geom, ST_PointOnSurface(g.geom))
  GROUP BY g.gid
),
fused AS (
  SELECT g.geom,
         ROUND(COALESCE(b.osm_height, {cal}), 1) AS render_height,
         0.0 AS render_min_height,
         CASE b.osm_src WHEN 'tag' THEN 'osm_tag' WHEN 'levels' THEN 'osm_levels' ELSE {gba_src} END AS height_src,
         ROUND(g.gba_height, 1) AS gba_height,
         g.gba_source
  FROM gba_clipped g LEFT JOIN osm_best b USING (gid)
  UNION ALL
  -- surveyed towers and building:parts in their own right
  SELECT geom, ROUND(osm_height, 1), osm_base, 'osm_tag', NULL, 'osm'
  FROM osm
  WHERE height_src = 'tag'
    AND ST_Intersects(geom, ST_MakeEnvelope({minx}, {miny}, {maxx}, {maxy}))
)""")
    else:
        ctes.append(f"""
fused AS (
  SELECT geom,
         ROUND({cal}, 1) AS render_height,
         0.0 AS render_min_height,
         {gba_src} AS height_src,
         ROUND(gba_height, 1) AS gba_height,
         gba_source
  FROM gba_clipped
)""")

    # Below 1 m the viewer falls back to its 9 m default, so a GBA sliver
    # (53,446 of them in Bangkok) would draw as a three-storey block.
    where = f"\nWHERE render_height >= {drop_below}" if drop_below is not None else ""
    return "WITH " + ",".join(ctes) + "\nSELECT * FROM fused" + where


def self_test() -> int:
    table = load_calibration(DEFAULT_CALIBRATION)
    cases = {
        0.5: 0.5,     # the 53,446 sub-1 m slivers are not "corrected" upward
        6.0: 6.0,     # shophouses: GBA is within ~1-2.5 m, left alone
        12.9: 18.0,
        25.0: 36.0,
        52.5: 126.0,  # the published >100 m bin mean: GBA 52 vs ICESat-2 126
        147.0: 220.5, # Bangkok's GBA maximum
        400.0: 350.0, # clamp
    }
    failures = 0
    for gba, want in cases.items():
        got = round(calibrate(gba, table), 1)
        mark = "ok " if abs(got - want) < 0.05 else "BAD"
        failures += mark == "BAD"
        print(f"  {mark} gba {gba:6.1f} m -> {got:6.1f} m (want {want})")
    heights = [calibrate(x / 10, table) for x in range(0, 2000)]
    if any(b < a for a, b in zip(heights, heights[1:])):
        print("  BAD calibration is not monotonic")
        failures += 1
    # the SQL twin must agree with the Python map on the same breakpoints
    sql = calibration_sql("h", table)
    for bp in ("WHEN h < 10 THEN h", "WHEN h <= 52.5 THEN", "LEAST(CASE", ", 350)"):
        if bp not in sql:
            print(f"  BAD SQL is missing {bp!r}")
            failures += 1
    print("self-test", "passed" if not failures else f"FAILED ({failures})")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gba-url", help="https URL (or local path) of the GBA LoD1 GeoParquet tile")
    parser.add_argument("--bbox", default=DEFAULT_BBOX, help=f"minLon,minLat,maxLon,maxLat (default {DEFAULT_BBOX})")
    parser.add_argument("--clip", help="Boundary polygon to clip to (e.g. geoBoundaries THA ADM1 Bangkok .geojson)")
    parser.add_argument("--osm", help="GeoJSON from osm-buildings-to-geojson.py (needs its height_src field)")
    parser.add_argument("--calibration", default=str(DEFAULT_CALIBRATION),
                        help="Calibration JSON; pass 'none' to keep raw GBA heights")
    parser.add_argument("--height-col", default="height", help="GBA height column (see --describe)")
    parser.add_argument("--source-col", default="source", help="GBA footprint-source column, '' if absent")
    parser.add_argument("--wkb", action="store_true",
                        help="Geometry column is raw WKB, not GEOMETRY (see --describe)")
    parser.add_argument("--min-height", type=float, default=1.0,
                        help="Drop footprints whose final height is below this (default 1 m)")
    parser.add_argument("--output", help="Output .geojsonl (GeoJSONSeq, one feature per line, for tippecanoe)")
    parser.add_argument("--describe", action="store_true", help="Print the tile's schema and exit")
    parser.add_argument("--stats", action="store_true", help="Print height-source counts and height bins, no output file")
    parser.add_argument("--print-sql", action="store_true", help="Print the SQL and exit")
    parser.add_argument("--self-test", action="store_true", help="Check the calibration map offline and exit")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.gba_url:
        parser.error("--gba-url is required")

    table = None if args.calibration == "none" else load_calibration(Path(args.calibration))
    sql = build_sql(args, table, drop_below=None if args.stats else args.min_height)
    if args.print_sql:
        print(sql)
        return 0

    con = connect()
    if args.describe:
        print(con.sql(f"DESCRIBE SELECT * FROM read_parquet({sql_str(args.gba_url)})"))
        return 0

    if args.stats:
        con.execute(f"CREATE TEMP TABLE out AS {sql}")
        print(con.sql("SELECT height_src, COUNT(*) AS n FROM out GROUP BY 1 ORDER BY 2 DESC"))
        print(con.sql("""
            SELECT CASE WHEN render_height < 1 THEN '0 <1 (dropped)' WHEN render_height < 6 THEN 'a 1-6' WHEN render_height < 12 THEN 'b 6-12'
                        WHEN render_height < 25 THEN 'c 12-25' WHEN render_height < 50 THEN 'd 25-50'
                        WHEN render_height < 100 THEN 'e 50-100' ELSE 'f 100+' END AS bin,
                   COUNT(*) AS n, ROUND(AVG(gba_height), 1) AS mean_gba, ROUND(AVG(render_height), 1) AS mean_render,
                   MAX(render_height) AS max_render
            FROM out GROUP BY 1 ORDER BY 1"""))
        return 0

    if not args.output:
        parser.error("--output is required (or use --describe / --stats / --print-sql)")
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY ({sql}) TO {sql_str(args.output)} WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq')")
    n = con.sql(f"SELECT COUNT(*) FROM ST_Read({sql_str(args.output)})").fetchone()[0]
    print(f"Wrote {n:,} building features to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
