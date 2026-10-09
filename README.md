# bkk-3d-atlas

A 3D browser atlas of Bangkok, hosted on Cloudflare Workers. Real Esri
satellite imagery, OpenStreetMap buildings extruded in BKKx signal
yellow, tiered roads, and **quick-jump buttons to 16 curated key areas**
(historic cores, transit hubs, market districts, the university campus,
the airport). Click any building to inspect height/type plus the nearest
Treasury land-price zone. No Minecraft, no install.

**Live:** https://atlas.nonarkara.org

The atlas is one of three deliverables. The other two are **reusable
data files** that Dr Non's other projects (Chula dashboards, UNL
dashboards, anything else that needs Bangkok) can pull in:

1. **`public/bkk-areas.json`** — 16 curated Bangkok areas with
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
  land-price + risk APIs, traffic proxy, PMTiles Range from R2, and
  static assets. `/api/risk` scores land × schematic flood × live PM2.5.
- **Hosting** — Cloudflare Workers + R2 on the custom domain
  `atlas.nonarkara.org`. R2 bucket `bkk-tiles` holds the 17 MB
  PMTiles.

## Local dev

```sh
npm install        # one time, installs wrangler
npm run verify     # laptop smoke check (JSON, stack helpers, no network)
npm run typecheck  # Worker TypeScript
npm run dev        # http://localhost:8787
npm run smoke      # 11-check live smoke test of the /api/atlas/* mirror
```

The atlas is sized for a single laptop: static GeoJSON in `public/`,
free tile APIs (Esri, RainViewer, Open-Meteo), and Cloudflare Workers
+ R2 for PMTiles Range. Heavy layers (khlongs, traffic) load after the
city paints. Inspect falls back to client-side nearest land-price when
`/api/land-price` is unreachable. Layer toggles soft-hide instead of
tearing down WebGL sources, so re-toggling rain/AQI stays cheap.
Presets stack city + rain / 10 m wind / heat / AQI / flood without losing
the silhouette.

## Deploy

Live custom domain: **https://atlas.nonarkara.org** (Worker `bkk-3d-atlas`,
account `74ad6bf8dfaaccf82de6f0847f7d2d54`).

Preferred local deploy (pull → marker check → whoami → deploy → wait for
edge cache → verify). Do **not** trust the first `curl` right after
upload — Workers assets often return a stale `cf-cache-status: HIT`
for ~10s:

```sh
npm run deploy:live
```

Or by hand:

```sh
git checkout main && git pull origin main
grep -n 'id="atlas-about"' public/index.html   # must match before deploy
npx wrangler whoami                            # account must be 74ad6bf8…
npx wrangler deploy --config wrangler.cron.toml # bkk-3d-atlas-cron first
npx wrangler deploy                            # must list atlas.nonarkara.org
sleep 12
curl -sL https://atlas.nonarkara.org/ | grep -c 'id="atlas-about"'   # expect 1
curl -sL https://atlas.nonarkara.org/ | grep -c 'id="atlas-labs"'    # expect 0
```

Requests and the 5-minute ingest cron are separate Workers. A cold
cron pass is ~800 ms of CPU (venue matching, khlong geometry,
flood-road snapping), so `wrangler.toml` caps the request Worker
(`bkk-3d-atlas`) at `cpu_ms` 200 and `wrangler.cron.toml` runs
`bkk-3d-atlas-cron` at `cpu_ms` 30000. Deploy the cron config first.

There is also a GitHub Action (`.github/workflows/deploy-cloudflare.yml`)
that deploys both Workers on push to `main` once `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` secrets are set. Until then, use local
`deploy:live`.

## Reuse for Chula / UNL / other dashboards

Three ways, in order of how heavy the lift is:

### 1. `bkk-areas.json` — the curated tour

```js
import atlas from "https://atlas.nonarkara.org/bkk-areas.json";
const ratchathewi = atlas.areas.find((a) => a.id === "ratchathewi");
map.flyTo({ center: ratchathewi.center, zoom: ratchathewi.zoom });
```

Same data, same camera angles, no rebuild.

### 1b. `/api/land-price` — nearest Treasury zone

```js
const res = await fetch(
  "https://atlas.nonarkara.org/api/land-price?lng=100.5321&lat=13.7367"
);
const { nearestZone } = await res.json();
// nearestZone.price_per_wah, zone_id, min_price, max_price, distanceM
```

Property-tech lite. Zone display points are grid approximations until
cadastral polygons ship; see the `notes` field on the response.

### 1c. `/api/risk` — land × flood × PM2.5

```js
const res = await fetch(
  "https://atlas.nonarkara.org/api/risk?lng=100.5321&lat=13.7367"
);
const { score, band, factors } = await res.json();
// factors.floodInside, factors.pm25, factors.landPricePerWah
```

Civic demo score (0–100). Optional `?pm25=` override. Flood envelopes in
`public/bkk-flood-envelope.geojson` are **schematic** — not official
DDPM/BMA maps. Do not underwrite insurance from this.

### 1d. `/api/atlas/*` — the AI-readable mirror

Six thin GETs that return what an LLM agent, a research script, or a
future MCP server would actually ask the city. All additive — none of
the endpoints above change.

| Endpoint | What it returns |
| --- | --- |
| `GET /api/atlas/areas?bbox=&category=` | The 16 curated areas, filterable by viewport or category. |
| `GET /api/atlas/districts` | All 50 khet, joined to Treasury land-price data, with centroids. |
| `GET /api/atlas/at-this-point?lng=&lat=` | The generalised "click the city" — district, land price, flood status, nearest transit, summary band. One call. |
| `GET /api/atlas/transit?lng=&lat=&radius=&limit=` | Nearest rail segments, scheduled boat corridors and passenger piers, with distances and sources. |
| `GET /api/atlas/buildings?bbox=&limit=` | Honest pointer to the 432K PMTiles + the 9,275-feature Rattanakosin detail (no fake server-side bbox query yet). |
| `GET /api/atlas/scoreboard` | Single object: live feed health, counts, district/rail/building totals, traffic-feed configured status, last civic-data ingest. |

```js
// "What's at this point, in one call?"
const r = await fetch(
  "https://atlas.nonarkara.org/api/atlas/at-this-point?lng=100.4914&lat=13.7500"
).then((r) => r.json());
// r.district.nameEn  → "Phra Nakhon District"
// r.landPrice.peakNewPrice → 1000000
// r.nearestTransit.line → "MRT-Blue", distanceM → 476
// r.flood.inside → true, severity → "high"
// r.summary → { landPriceBand: "premium", transitBand: "walkable", floodBand: "high" }
```

```sh
# Smoke test — operator-runnable, end-to-end, hits all 6 + edge cases.
npm run smoke                                    # default: live URL
ATLAS_URL=http://localhost:8787 npm run smoke    # local wrangler dev
```

The script exits non-zero on any failure and prints a one-line
PASS/FAIL summary. Run it after every deploy to know the city is
still answering. **17 checks total**: 6 `/api/atlas/*` endpoints +
the scoreboard's `cityEvents` contract + the `/api/traffic`
`configured:false` body shape + the `/api/city-events` "no
fabricated coordinates" bbox promise + filter + bad-bbox +
malformed-bbox + the legacy feed shapes.

### 1e. `/api/city-events` — live breaking incidents

The "God Mode" layer. Real-time Thai road/city incidents with
reporter-supplied lat/lng from the Longdo / iTIC public event feed.
Nothing here is geocoded by us — an event arrives with coordinates
or it isn't stored.

```js
const r = await fetch("https://atlas.nonarkara.org/api/city-events").then((r) => r.json());
// r.count         → number of live pins (0 = no breaking events right now)
// r.ttlMinutes    → 60 (a pin self-clears after this OR the source's stop time)
// r.features      → GeoJSON points, all inside the Bangkok bbox
// r.ingestWarning → optional upstream hiccup; the response still serves D1 data
```

Two editorial rules in the data, not in the code: only `accident |
flood | fire | trafficjam | roadclosed | rain | earthquake |
protest | warning` icons get a pin (the feed is dominated by
multi-month `diversion` roadworks), and any event whose
source-declared window exceeds 24h is dropped on duration as
infrastructure. Persisted to D1 because the upstream is a rolling
20-item window for all of Thailand; a 5-minute cron
(`[triggers] crons = ["*/5 * * * *"]` in `wrangler.cron.toml`) keeps the
store fresh between visitors.

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

## Layer registry

Layers are declared in a single `LAYERS` array at the top of
`public/app.js`. Each entry is an object with:

- `id` / `name` / `description` — what shows in the toggle panel
- `defaultOn` — whether the layer starts visible
- `layers` — the MapLibre layer IDs to flip visibility on/off
- `install(map)` / `uninstall(map)` — async hooks for source +
  layer wiring (AQI fetches Open-Meteo, terrain calls `setTerrain`,
  rain fetches RainViewer's manifest, etc.)
- `legend?` — optional colour swatch set rendered in the panel
  when the layer is on

This means new layers are a one-object addition; the toggle UI,
visibility flipping, and legend rendering are all generic.

## R2 objects in this project

- `bkk-tiles/buildings/bangkok.pmtiles` — 20.3 MB, 432,077 features,
  zoom 11–15. The metro-level buildings layer.
- `bkk-tiles/buildings/bangkok-rattanakosin.pmtiles` — 1.27 MB,
  9,275 features, zoom 14–18. The Old Town detail layer.

Both are served via the Worker at `/bkk-buildings.pmtiles` and
`/bkk-buildings-rattanakosin.pmtiles` with full HTTP Range
passthrough. The Worker proxy is in `src/index.ts` (`servePmtilesFromR2`).

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
edge cache). The endpoint is a **200 with `configured: false`** when
no key is set — the no-key state is the known steady state (no
Longdo/iTIC key is registered anywhere in the workspace), not a
service failure. The client treats a body without `features` as
"fall back to the static sample", and the layer keeps its honest
"mock levels (not live)" label in the panel.

## Traffic CCTV layer (iTIC / Longdo)

Public **road / intersection** cameras — not the closed BMA security
network (~60k+ cameras). The same iTIC ecosystem that powers
[live.iticfoundation.org](https://live.iticfoundation.org) publishes:

- **Camera catalog (JSON)** — no API key —
  <https://camera.longdo.com/feed/?command=json> (~280 cameras
  nationwide; ~80–110 in the Bangkok metro with HLS).
- **Live HLS** — `camerai1.iticfoundation.org` playlists (CORS open).
- **JPEG / MJPEG** endpoints exist but often return empty bodies;
  the atlas plays **HLS** in a click popup (`hls.js` on Chromium,
  native HLS on Safari).

The Worker exposes `/api/cctv`, which filters the catalog to the
Bangkok metro bbox and returns GeoJSON points. The client falls
back to `public/bkk-cctv.geojson` when the Worker is offline.

Toggle **Traffic CCTV** in Layers (or use the Full pulse preset).
Click a signal-yellow pin to watch the live stream. Attribution:
iTIC Foundation / Longdo.

What this is **not**: free access to BMA/police investigative CCTV
at `cctv.bangkok.go.th`. Those remain request-only after a police
report.

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
6. **Rattanakosin detail** (z14–18 PMTiles, 9,275 features) — auto-
   loaded with the buildings layer. Covers the Grand Palace, Wat
   Pho, Wat Phra Kaew, Wat Suthat, the royal field. The metro
   PMTiles maxes at z15; this layer takes over to z18 for the Old
   Town's temple geometry.
7. **Building type colors** (sub-toggle) — switches the 3D buildings
   from signal-yellow monochrome to a category-coloured paint
   expression by OSM `building` tag (temple=gold, school=blue,
   hotel=pink, museum=purple, hospital=green, commercial=paper,
   house=light yellow, apartments=orange, industrial=gray, etc.).
8. **3D terrain** (AWS Terrarium DEM, free, no key) — toggleable
   `setTerrain({ source, exaggeration: 1.5 })`. Bangkok is mostly
   flat but Khao San / old town sit on a ~5 m ridge and the
   neighbouring provinces have real hills.
9. **Live traffic** (iTIC / Longdo) — proxy at `/api/traffic`.
10. **Rail lines** (BTS / MRT / ARL / SRT) — 9 lines in official colors.
11. **Boat routes & piers** — four maintained passenger corridors and
    16 named piers across the Chao Phraya, Khlong Saen Saep and the
    Tha Tien–Wat Arun crossing. Dotted lines mean scheduled orientation
    geometry, explicitly not live vessel tracking or navigation channels.
12. **Canals & rivers** (Chao Phraya + 3,026 khlongs).
13. **Air quality** (Open-Meteo CAMS) — heatmap of PM2.5 from an
    8×8 grid over the Bangkok bbox, EPA-style colour ramp.
14. **Rain radar** (RainViewer) — most-recent past frame from
    `api.rainviewer.com/public/weather-maps.json`, 5-min client
    cache, opacity 0.65.
15. **Current wind field** (Open-Meteo) — 36 current 10 m model cells
    across Bangkok, rendered as clickable downwind arrows with speed
    colours and gust values. This is a forecast-model field, explicitly
    not presented as a street-level sensor network.
16. **Land price (ราคาประเมิน)** — Treasury Department 2024–2028
    assessment, aggregated from 2.28M parcels to 477 UTMMAP3 zones.
    Each zone is a point on the map coloured by average appraisal
    price (500–435,000 ฿/sq.wah). Six-step ramp from cream to dark
    amber.
17. **Live incidents** (Longdo / iTIC event feed, D1-backed) — red
    "!" pins for breaking city events with reporter-supplied
    coordinates. Source: `https://event.longdo.com/feed/json` — real
    lat/lng from the reporter, no geocoding guesswork. Pinned
    incidents are filtered two ways: only `accident | flood | fire |
    trafficjam | roadclosed | rain | earthquake | protest | warning`
    icons get a pin (diversion roadworks are dropped — the feed is
    dominated by multi-month diversions, not breaking news), and any
    event whose source-declared window exceeds 24h is dropped on
    duration as standing infrastructure. A pin lives 60 minutes
    from first sight or until the source's own stop time, whichever
    comes first. Persisted to D1 (not proxied) because the upstream
    is a rolling 20-item window for all of Thailand; a 5-minute cron
    in `wrangler.cron.toml` keeps the store fresh between visitors.
    Endpoint: `/api/city-events`.
18. **Buzz** (Bangkok Post + Khaosod English RSS, D1-backed) — amber
    "●" pins for "what the city is talking about": motor shows,
    concerts, gatherings, the things that draw crowds and wreck
    traffic. **No fabricated coordinates.** A pin only exists when a
    real place name from `public/bkk-venues.geojson` (599 OSM venues
    + 13 curated areas) is found in the article's headline or
    summary; the matching phrase is stored on every row so any pin
    can be audited back to the words that put it there. Articles
    that match nothing get no pin — they are simply not stored.
    `precision` is either `venue` (a specific named place — IMPACT
    Arena, BITEC) or `area` (a neighbourhood — Silom, Chatuchak);
    the client labels both, so nobody reads an area pin as a street
    address. 14-day rolling window. Endpoint: `/api/news-events`.
19. **Curated landmarks** (`public/bkk-landmarks.geojson`) —
    100 curated features: 73 ancient monuments & historic cores (Victory
    Monument 50 m shaft, Phu Khao Thong 45 m, Phra Sumen Fort 60 m, Grand
    Palace) plus 27 verified modern skyline icons with cited heights and
    accurate pins (MahaNakhon 314 m, Baiyoke II 304 m, State Tower 247 m,
    One Bangkok 215 m, Sathorn Unique 185 m planned). Unverified or
    misplaced features are quarantined in `public/bkk-landmarks-quarantine.geojson`.
    Rendered as 3D fill-extrusions with the buildings stack. Always on
    with buildings; not a separate toggle. The Rattanakosin Old Town detail
    PMTiles (`bkk-heritage-detail.geojson`, 3.8 MB) takes over at z14+ to
    show the temple geometry of the Grand Palace, Wat Pho, Wat Phra Kaew,
    and the royal field.

BKKx aesthetic: signal yellow stays the only saturated color in the
frame — **except alarm red** on the incidents layer (the one
breaking-news color) and **amber** on the Buzz layer (the one
discourse color). Sharp edges. No rounded corners. No shadows.

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
