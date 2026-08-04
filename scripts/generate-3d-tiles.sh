#!/usr/bin/env bash
# generate-3d-tiles.sh — produce Bangkok 3D Tiles from OSM data, upload to R2.
#
# Pipeline:
#   1. Download Bangkok PBF (OpenStreetMap)         geofabrik.de or BBBike
#   2. Extract building footprints + heights         osmium / osmconvert
#   3. Extrude to 3D (OBJ intermediate)              Python (trimesh)
#   4. Tile into 3D Tiles (b3dm)                    py3dtiles
#   5. Upload to Cloudflare R2                       wrangler r2 object put
#   6. Document the tileset JSON for the worker
#
# This is intentionally a placeholder. The full pipeline is a separate
# project; for now the live atlas uses OpenFreeMap's MVT building data
# (already 3D-extruded client-side) as the primary source. Run this
# script when you need a self-contained 3D Tiles dataset for offline
# use or for non-MapLibre clients (deck.gl, Cesium, three-tile-loader).
#
# Usage:
#   BKKX_R2_BUCKET=bkk-3d-tiles \
#   BKKX_TILESET_OUT=./out/bkk-3d-tiles \
#   ./scripts/generate-3d-tiles.sh
#
# Prerequisites (install once):
#   brew install osmium-tool tippecanoe
#   pip install trimesh py3dtiles shapely

set -euo pipefail

BBOX="${BKKX_BBOX:-100.30,13.45,100.95,14.10}"  # Bangkok metropolitan bbox
OUT="${BKKX_TILESET_OUT:-./out/bkk-3d-tiles}"
R2_BUCKET="${BKKX_R2_BUCKET:-bkk-3d-tiles}"
R2_PREFIX="${BKKX_R2_PREFIX:-v1}"
PBF="${BKKX_PBF:-./out/bangkok-latest.osm.pbf}"

say() { printf '\n[bkk-3d-tiles] %s\n' "$1"; }
fail() { printf '\n[bkk-3d-tiles] ERROR: %s\n' "$1" >&2; exit 1; }

mkdir -p "$OUT" "$(dirname "$PBF")"

say "Step 1/6 — Download Bangkok OSM PBF (geofabrik Bangkok province)"
say "  if you already have a PBF, set BKKX_PBF to its path"
curl -fL --fail -o "$PBF" \
  "https://download.geofabrik.de/asia/thailand/massachusetts-bangkok-latest.osm.pbf" \
  || curl -fL --fail -o "$PBF" \
    "https://overpass-turbo.eu/api/interpreter?data=area[name=\"Bangkok\"];out;" \
  || fail "OSM PBF download failed. Set BKKX_PBF to a local file or pre-stage it."

say "Step 2/6 — Extract building footprints with height tags (osmium)"
osmium tags-filter \
  "$PBF" \
  w/building \
  -o "$OUT/buildings.osm.pbf" \
  || fail "osmium extract failed"

say "Step 3/6 — Convert OSM buildings to GeoJSON with estimated heights"
python3 scripts/osm-buildings-to-geojson.py \
  "$OUT/buildings.osm.pbf" \
  "$OUT/buildings.geojson" \
  || fail "OSM → GeoJSON conversion failed"

say "Step 4/6 — Extrude to OBJ (per-tile, partitioned by H3 r8)"
python3 scripts/extrude-buildings.py \
  "$OUT/buildings.geojson" \
  "$OUT/obj/" \
  || fail "Extrusion failed"

say "Step 5/6 — Convert OBJ partition to 3D Tiles (py3dtiles)"
python3 scripts/obj-to-3dtiles.py \
  "$OUT/obj/" \
  "$OUT/tiles/" \
  --tileset_name bkk-3d-buildings \
  || fail "py3dtiles conversion failed"

say "Step 6/6 — Upload 3D Tiles to Cloudflare R2"
if command -v wrangler >/dev/null 2>&1; then
  npx wrangler r2 object put "$R2_BUCKET/$R2_PREFIX/$(basename "$OUT/tiles/")/" \
    --file="$OUT/tiles/" \
    --content-type="application/octet-stream" \
    || say "  R2 upload failed; you can rerun with: npx wrangler r2 object put $R2_BUCKET/$R2_PREFIX/ --file=$OUT/tiles/"
else
  say "  wrangler not on PATH; upload manually with:"
  say "  npx wrangler r2 object put $R2_BUCKET/$R2_PREFIX/ --file=$OUT/tiles/"
fi

say "Done. 3D Tiles at: $OUT/tiles/"
say "      R2 prefix:   $R2_BUCKET/$R2_PREFIX/"
say "      tileset.json: $OUT/tiles/tileset.json"
