# bkk-3d-atlas

A 3D browser atlas of Bangkok, hosted on Cloudflare Workers. Real Esri
satellite imagery, OpenStreetMap buildings extruded in BKKx signal
yellow, tiered roads, and **quick-jump buttons to 15 curated key areas**
(historic cores, transit hubs, market districts, the university campus,
the airport). No Minecraft, no install.

**Live:** https://atlas.nonarkara.org

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
3. **`scripts/generate-3d-tiles.sh`** — turn the same OSM data into
   a PMTiles archive (MVT, gzipped) that the live viewer streams
   via the `pmtiles` JS lib + HTTP Range requests. The 432,077-feature
   Bangkok metro PMTiles lives in the Cloudflare R2 bucket
   `bkk-tiles/buildings/bangkok.pmtiles` (~17 MB) and is served at
   `/bkk-buildings.pmtiles` with full Range passthrough. Until
   this PMTiles is uploaded, the viewer falls back to OpenFreeMap's
   MVT buildings (sparse at city-scale zoom 10–11).
4. **`src/index.ts`** has a `serveBuildingsPmtiles` route at
   `/bkk-buildings.pmtiles` that handles the three Range shapes
   the `pmtiles` lib issues (closed, open-ended, suffix) and
   ETag/If-None-Match for 304 caching. The Workers `[assets]`
   binding does NOT honor HTTP Range requests, so large binary
   blobs have to live in R2 + the proxy — never in `public/`.

## Stack

- **Frontend** — vanilla HTML + ES module JS. No build step. MapLibre
  GL 4.7.1 from unpkg, Esri World Imagery from
  `services.arcgisonline.com`, OpenFreeMap dark style as the
  base style, OpenStreetMap `transportation` for roads,
  **432,077 OSM buildings streamed from our own PMTiles** for 3D
  extrusions (see `bkk-buildings.pmtiles` at the R2 route below).
- **Worker** — `src/index.ts` is a Cloudflare Worker that handles
  three things: (1) proxies `/api/traffic` to the iTIC/Longdo feed
  with a secret API key, (2) serves `/bkk-buildings.pmtiles` from
  R2 with HTTP Range passthrough so the `pmtiles` JS lib can stream
  tile-by-tile, and (3) falls back to the static asset binding for
  everything else.
- **Hosting** — Cloudflare Workers + R2 on the custom domain
  `atlas.nonarkara.org`. R2 bucket `bkk-tiles` holds the 17 MB
  PMTiles.

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

### 3. PMTiles — the streaming format (live now)

432,077 Bangkok OSM building footprints, baked into a single
gzipped MVT PMTiles (~17 MB, 2,863 tiles, zoom 11–15). Hosted on
Cloudflare R2 and served at `/bkk-buildings.pmtiles` with full
HTTP Range passthrough. The browser's `pmtiles` JS lib
(<https://unpkg.com/pmtiles@4.4.1/dist/pmtiles.js>) registers a
`pmtiles://` protocol handler and issues per-tile Range requests
that the Worker passes through to R2.

**Why PMTiles over a single GeoJSON**: the same data as one
GeoJSON is ~120 MB, unworkable in a browser. PMTiles streams
tile-by-tile based on the viewport, so 17 MB serves 432K buildings
smoothly at every zoom.

**Why R2 over the `[assets]` static binding**: the Workers static
asset binding does NOT honor HTTP Range requests — every GET
returns the full 17 MB. The `pmtiles` lib streams by issuing
Range requests for the directory and individual tiles, so a
Range-honoring source is mandatory. R2 is the obvious fit; the
Worker proxy just translates the `Range` header into a R2
`get({ range })` call and writes the 206 back.

**Regenerate** (when the upstream OSM data changes):

```sh
# 1. extract Bangkok from a fresh Thailand PBF
python3 scripts/osm-buildings-to-geojson.py \
  --bbox 100.30,13.45,100.95,14.10 \
  --output /tmp/bkk-buildings/bangkok-buildings.geojson

# 2. add height defaults (residential=9m, apartments=18m, office=24m, hotel=30m, ...)
python3 scripts/preprocess-buildings.py \
  --input /tmp/bkk-buildings/bangkok-buildings.geojson \
  --output /tmp/bkk-buildings/bangkok-buildings-h.geojson

# 3. tippecanoe → PMTiles
tippecanoe -Z11 -z15 --no-tile-size-limit --no-feature-limit \
  --simplification=20 --read-parallel --force \
  --include=render_height --include=render_min_height \
  -o /tmp/bkk-buildings/bangkok-buildings-h.pmtiles \
  -l buildings /tmp/bkk-buildings/bangkok-buildings-h.geojson

# 4. push to R2
npx wrangler r2 object put bkk-tiles/buildings/bangkok.pmtiles \
  --file=/tmp/bkk-buildings/bangkok-buildings-h.pmtiles --remote
```

The `scripts/generate-3d-tiles.sh` wrapper runs all four stages.

## Live traffic layer (iTIC / Longdo)

The atlas includes a "Live traffic" layer in the side panel that
shows Bangkok's expressways colored by traffic level (red / yellow
/ green). The data comes from the iTIC Foundation, which exposes:

- **Historical archive** (2017–2023, ~1–18 GB/month tar files)
  under CC-BY 4.0 at <https://itic.longdo.com/opendata/traffic-status-feeds/>.
- **Live feed** at <https://traffic.longdo.com/api/feed/itsth>
  (Longdo map's `TRAFFIC` layer, members-only).
- **Documentation** at <http://traffic.longdo.com/feed/>.

The atlas Worker exposes a `/api/traffic` endpoint that proxies
the live feed using a Longdo API key. Until you set the key, the
client falls back to a static sample of ~1.9K OSM-derived
Bangkok motorway/trunk line segments (1,302 km of road) with
mock traffic levels, generated by Overpass and committed as
`public/bkk-traffic-sample.geojson`. The fallback is enough to
prove the wiring and tune the styling; the live feed replaces it
when configured.

### Enabling the live feed

```sh
# 1. Register a free Longdo Map key at https://map.longdo.com/
# 2. Set it as a Cloudflare secret on the worker:
npx wrangler secret put LONGDO_KEY
# 3. Redeploy:
npx wrangler deploy
```

The next request to `/api/traffic` will hit
`https://traffic.longdo.com/api/feed/itsth?key=<your-key>`, and the
client will swap the static sample for the live feed (90-second
edge cache). The 503 fallback to the sample is automatic if the
key is missing or the upstream fails.

## Layer stack

1. Esri World Imagery (raster, desaturated −0.45, opacity 0.78) — real
   Bangkok.
2. `transportation` minor roads (OpenFreeMap, ink-dim) — fill the gaps.
3. `transportation` major roads (OpenFreeMap, paper-dim) — the grid.
4. `transportation` motorways (OpenFreeMap, **signal yellow**) — the
   expressways.
5. `building` fill-extrusion (**our own 432K PMTiles, signal yellow**,
   0.32 → 0.82 opacity ramp from z11 → z17) — the entire Bangkok
   metro extruded, not just the OpenFreeMap city-scale outline.
   Falls back to OpenFreeMap's MVT if the PMTiles is unreachable.

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
