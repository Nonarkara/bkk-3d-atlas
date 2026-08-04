# bkk-3d-atlas

A 3D browser atlas of Bangkok, hosted on Cloudflare Workers. Real Esri
satellite imagery, OpenStreetMap buildings extruded in BKKx signal
yellow, tiered roads, and **quick-jump buttons to 15 curated key areas**
(historic cores, transit hubs, market districts, the university campus,
the airport). No Minecraft, no install.

The atlas is one of three deliverables. The other two are **reusable
data files** that Dr Non's other projects (Chula dashboards, UNL
dashboards, anything else that needs Bangkok) can pull in:

1. **`public/bkk-areas.json`** — 15 curated Bangkok areas with
   centre, zoom, pitch, bearing, key stats, and tags. Used by the
   viewer's quick-jump panel; load it from any other project to do
   the same curated tour.
2. **`scripts/osm-buildings-to-geojson.py`** — pulls all OSM
   building footprints in any Bangkok bbox and emits a single
   GeoJSON with `height` + `base_height` on every feature. Drop
   it into MapLibre, deck.gl, Cesium, or three.js; extrude on the
   client. The script is the canonical Bangkok 3D buildings asset.
3. **`scripts/generate-3d-tiles.sh`** — turn the same OSM data
   into 3D Tiles (b3dm) for streaming into deck.gl, Cesium, or
   three-tile-loader. Currently a placeholder pipeline; the script
   is runnable but the OBJ / py3dtiles stages need to be wired up
   in a follow-up. Until then, the live viewer uses
   OpenFreeMap's MVT buildings (already 3D-extruded client-side).

## Stack

- **Frontend** — vanilla HTML + ES module JS. No build step. MapLibre
  GL 4.7.1 from unpkg, Esri World Imagery from
  `services.arcgisonline.com`, OpenFreeMap dark style as the
  base style, OpenStreetMap `transportation` for roads,
  OpenStreetMap `building` for 3D extrusions.
- **Worker** — `src/index.ts` is a thin Cloudflare Worker that
  passes the request to the static asset binding. Future server-side
  logic (analytics ingest, geocoding, R2 reads for 3D Tiles) has
  a place to land here.
- **Hosting** — Cloudflare Workers. Initial URL is on
  `*.workers.dev`; a custom domain (`atlas.nonarkara.org` or
  similar) can be added in `wrangler.toml` + Cloudflare DNS.

## Local dev

```sh
npm install        # one time, installs wrangler
npm run dev        # http://localhost:8787
```

## Deploy

```sh
npm run deploy
```

Wrangler will print the `*.workers.dev` URL. If the URL needs to be
fixed to a custom domain, edit the `routes` block in `wrangler.toml`
and add the corresponding CNAME at the registrar.

## Reuse for Chula / UNL / other dashboards

Three ways, in order of how heavy the lift is:

### 1. `bkk-areas.json` — the curated tour

```js
import atlas from "https://atlas.nonarkara.org/bkk-areas.json";
const ratchathewi = atlas.areas.find((a) => a.id === "ratchathewi");
map.flyTo({ center: ratchathewi.center, zoom: ratchathewi.zoom });
```

Same data, same camera angles, no rebuild.

### 2. `osm-buildings-to-geojson.py` — the building extrusions

```sh
python3 scripts/osm-buildings-to-geojson.py \
  --bbox 100.30,13.45,100.95,14.10 \
  --output ./out/bkk-buildings.geojson
```

Emits a single GeoJSON `FeatureCollection` with `height` and
`base_height` on every feature. The same file works in:

```ts
// MapLibre
map.addSource("bkk", { type: "geojson", data: "/bkk-buildings.geojson" });
map.addLayer({ id: "bkk-3d", type: "fill-extrusion", source: "bkk",
  paint: { "fill-extrusion-height": ["get", "height"],
           "fill-extrusion-base": ["get", "base_height"],
           "fill-extrusion-color": "#c9ff38" } });

// deck.gl
new PolygonLayer({ data: bkkFeatures, extruded: true,
  getElevation: (f) => f.properties.height, ... });

// Cesium
Cesium.GeoJsonDataSource.load("/bkk-buildings.geojson", { clampToGround: false })
  .then((ds) => viewer.dataSources.add(ds));
```

### 3. 3D Tiles — the streaming format (follow-up)

`scripts/generate-3d-tiles.sh` is the placeholder. When the OBJ /
py3dtiles stages are wired up, the resulting `tileset.json` can be
hosted on Cloudflare R2 and consumed by deck.gl `Tile3DLayer`,
Cesium `Cesium3DTileset`, or `three-tile-loader`. The script
documents the full pipeline; the missing pieces are the
extrusion-to-OBJ and py3dtiles conversion.

## Layer stack

1. Esri World Imagery (raster, desaturated −0.45, opacity 0.78) — real
   Bangkok.
2. `transportation` minor roads (OpenFreeMap, ink-dim) — fill the gaps.
3. `transportation` major roads (OpenFreeMap, paper-dim) — the grid.
4. `transportation` motorways (OpenFreeMap, **signal yellow**) — the
   expressways.
5. `building` fill-extrusion (OpenFreeMap, **signal yellow**, 0.7
   opacity, vertical gradient) — the city silhouette.

BKKx aesthetic: signal yellow stays the only saturated color in the
frame. Sharp edges. No rounded corners. No shadows.

## Why this is separate from the public BKKx site

The public BKKx atlas at `bkk.nonarkara.org` is hosted on the OpenAI
Codex hosting platform, which is great for a marketing site but
doesn't let us deploy from a Mavis session. This repo is the
**data and infrastructure** counterpart:

- **Reusable data files** (`bkk-areas.json`, the OSM GeoJSON) — pull
  these from any other project on any host.
- **Cloudflare Workers + R2** — gives us a deploy target we control
  end to end. Future: stream 3D Tiles from R2 to the viewer.
- **Private repo** — building extrusions can carry a per-block
  curated layer (e.g. Chula's campus) without leaking it on the
  public site.

## Hard rules (this project)

- BKKx aesthetic: signal yellow `#c9ff38` for primary signals, paper
  `#f1efe8` for text, ink `#11120f` for the chrome. Sharp edges. No
  rounded corners. No shadows. No blur.
- Reusable data: every data file must be self-describing (schema,
  version, license, source).
- Real data only — no placeholders, no "lorem ipsum" buildings, no
  made-up stats.
- Data licensing: OSM data is © OpenStreetMap contributors under
  ODbL 1.0. Esri imagery is © Esri, Maxar, Earthstar Geographics
  (free for non-commercial use, attribution required).
- One screen, one screen. No multi-window confusion.
