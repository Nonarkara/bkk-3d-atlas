#!/usr/bin/env python3
"""
osm-buildings-to-geojson.py
---------------------------
Pull Bangkok building footprints from OpenStreetMap (Overpass or a local PBF)
and write a single GeoJSON file with `height` and `base_height` properties on
every feature. The output is the canonical BKKx 3D buildings asset that any
client can re-extrude:

  - MapLibre: GeoJSONSource + fill-extrusion layer
  - deck.gl:  PolygonLayer with getElevation = feature.properties.height
  - Cesium:   GeoJsonDataSource + entity.polygon.extrudedHeight
  - three.js: ExtrudeGeometry per feature
  - 3D Tiles: py3dtiles or obj2tiles over an OBJ intermediate

Heuristics for height (in priority order):
  1. `height` tag (if present and parseable)
  2. `building:levels` * 3 metres (1 level ≈ 3 m is the standard OSM rule)
  3. 9 metres (3-storey fallback)

`base_height` is set from `min_height` if present, else 0.

Usage:
    # From Overpass (any bbox, chunk if you hit timeouts)
    python3 scripts/osm-buildings-to-geojson.py \\
        --bbox 100.45,13.70,100.60,13.80 \\
        --output ./out/buildings-rattanakosin.geojson

    # From a local PBF
    python3 scripts/osm-buildings-to-geojson.py \\
        --pbf ./out/bangkok-latest.osm.pbf \\
        --output ./out/buildings-bangkok.geojson

Requires (for Overpass):
    pip install requests

Requires (for PBF):
    pip install pyrosm shapely
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from typing import Any, Iterable

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_USER_AGENT = "BKKx-3D-Atlas/1.0 (https://atlas.nonarkara.org; data extraction)"


def parse_levels(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value) * 3.0
    except ValueError:
        return None


def parse_height(value: str | None) -> float | None:
    if not value:
        return None
    raw = value.strip().lower().replace("m", "").strip()
    try:
        return float(raw)
    except ValueError:
        return None


def estimate_height(tags: dict[str, str]) -> tuple[float, float]:
    """Return (height, base_height) in metres."""
    h = parse_height(tags.get("height"))
    if h is None:
        levels = parse_levels(tags.get("building:levels") or tags.get("levels"))
        h = levels if levels is not None else 9.0
    base = parse_height(tags.get("min_height")) or 0.0
    return h, base


def fetch_overpass(bbox: tuple[float, float, float, float], *, retries: int = 3) -> dict[str, Any]:
    south, west, north, east = bbox
    query = (
        # `building:part` matters as much as `building` here: OSM maps tall
        # towers as a plain outline plus parts, and the parts are what carry
        # the height. Baiyoke Tower II is the case that caught this — its
        # 304 m geometry is tagged building:part only, so a building-only
        # query drops Bangkok's landmark tower entirely.
        "[out:json][timeout:120];\n"
        f"(way[\"building\"]({south},{west},{north},{east});"
        f"way[\"building:part\"]({south},{west},{north},{east});"
        "relation[\"building\"]({south},{west},{north},{east});"
        "relation[\"building:part\"]({south},{west},{north},{east}););"
        "out body geom;".format(south=south, west=west, north=north, east=east)
    )
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            import requests
            response = requests.post(
                OVERPASS_URL,
                data={"data": query},
                headers={"User-Agent": OVERPASS_USER_AGENT, "Accept": "application/json"},
                timeout=180,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            print(f"Overpass attempt {attempt} failed: {exc}", file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Overpass failed after {retries} attempts: {last_error}")


def fetch_pbf_features(pbf_path: str, *, bbox: tuple[float, float, float, float] | None) -> Iterable[dict[str, Any]]:
    try:
        from pyrosm import OSM
    except ImportError as exc:
        raise RuntimeError("pyrosm is required for PBF input. pip install pyrosm") from exc

    osm = OSM(pbf_path, bounding_box=bbox)
    buildings = osm.get_buildings()
    for _, row in buildings.iterrows():
        geom = row.geometry
        tags = {
            k: ("" if v is None else str(v))
            for k, v in row.to_dict().items()
            if k.startswith("building") or k in {"height", "min_height", "levels", "name"}
        }
        yield {"tags": tags, "geometry": geom}


def way_node_ring(coords: list[list[float]]) -> list[list[float]]:
    """Drop the duplicated closing vertex OSM uses for closed ways."""
    if len(coords) >= 2 and coords[0] == coords[-1]:
        return coords[:-1]
    return coords


def overpass_to_features(payload: dict[str, Any]) -> Iterable[dict[str, Any]]:
    for element in payload.get("elements", []):
        if element.get("type") != "way":
            continue
        geometry = element.get("geometry") or []
        if len(geometry) < 3:
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in geometry]
        ring = way_node_ring(coords)
        if len(ring) < 3:
            continue
        yield {
            "id": element.get("id"),
            "tags": element.get("tags", {}),
            "polygon": ring,
        }


def to_geojson_feature(element: dict[str, Any]) -> dict[str, Any]:
    tags = element.get("tags", {})
    height, base = estimate_height(tags)
    if "polygon" in element:
        ring = element["polygon"]
        polygon = [ring + [ring[0]]]
    else:
        geom = element["geometry"]
        from shapely.geometry import mapping
        polygon = [list(geom.exterior.coords)]
    properties: dict[str, Any] = {
        "id": f"bkk-building-{element.get('id', 0)}",
        "height": height,
        "base_height": base,
    }
    if "name" in tags and tags["name"]:
        properties["name"] = tags["name"]
    if "building" in tags and tags["building"] not in {"yes", ""}:
        properties["building_type"] = tags["building"]
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": {"type": "Polygon", "coordinates": polygon},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bbox", help="minLon,minLat,maxLon,maxLat (Overpass input)")
    parser.add_argument("--pbf", help="Path to a local .osm.pbf file (e.g. from geofabrik)")
    parser.add_argument("--output", required=True, help="Output .geojson path")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N features (0 = no limit)")
    args = parser.parse_args()

    if not args.bbox and not args.pbf:
        parser.error("either --bbox or --pbf is required")

    bbox: tuple[float, float, float, float] | None = None
    if args.bbox:
        bbox = tuple(float(piece) for piece in args.bbox.split(","))  # type: ignore[assignment]
        assert len(bbox) == 4

    features: list[dict[str, Any]] = []
    if args.pbf:
        raw_iter = fetch_pbf_features(args.pbf, bbox=bbox)
    else:
        assert bbox is not None
        payload = fetch_overpass(bbox)
        raw_iter = overpass_to_features(payload)

    for raw in raw_iter:
        features.append(to_geojson_feature(raw))
        if args.limit and len(features) >= args.limit:
            break

    geojson = {
        "type": "FeatureCollection",
        "name": "bkk-3d-buildings",
        "version": "2026-08-04",
        "license": "ODbL-1.0 (© OpenStreetMap contributors)",
        "source": "OpenStreetMap",
        "extrusion_strategy": "height from `height` tag, else building:levels * 3, else 9m; base_height from `min_height` else 0",
        "features": features,
    }

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(geojson, fh, ensure_ascii=False)

    print(f"Wrote {len(features)} building features to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
