# Contributing

Thanks for looking. The atlas is a static viewer plus one Worker script deployed twice. Small, sourced patches are easier to review than a new layer with guessed numbers.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you open a pull request

1. Fork the repository and branch from `main`.
2. Use Node.js 22, the version in [`.github/workflows/verify.yml`](.github/workflows/verify.yml).
3. Run the same checks CI runs:

```sh
npm ci
npm run verify
npm run typecheck
npm run test:flood
```

`npm run verify` is a local smoke check (JSON, Worker invariants, no network). `npm run test:flood` checks flood-report expiry and related honesty rules. Neither check proves a flood prediction.

4. If you touch `/api/atlas/*`, `/api/traffic`, `/api/city-events`, or the scoreboard, also run `npm run smoke` against a running `npm run dev` (`ATLAS_URL=http://localhost:8787`). The script hits the live site if `ATLAS_URL` is unset.
5. Do not commit `.env`, Wrangler secrets, `*.pbf`, or `public/*.pmtiles`. PMTiles belong in R2. See [`.env.example`](.env.example) and [`.gitignore`](.gitignore).

## Data rules

These are the rules already enforced in the Worker and the static files:

- Real observations only. A missing feed stays missing. Do not invent coordinates, depths, road clearance, or a city-centre pin.
- News pins exist only when a name in `public/bkk-venues.geojson` is found in the headline or summary. Store the matched phrase.
- City-event pins keep the coordinates the Longdo / iTIC feed sent. Do not geocode a title that arrived without a point.
- Flood envelopes in `public/bkk-flood-envelope.geojson` are schematic (`CC0-1.0` in that file) and are not a DDPM or BMA map.
- Boat lines in `public/bkk-water-transit.geojson` are scheduled corridors, not live vessels.
- OSM-derived files stay © OpenStreetMap contributors, ODbL 1.0. Say so in the file header when you add one.
- UI chrome in `public/style.css` uses ink `#11120f`, paper `#f1efe8`, and signal yellow `#c9ff38`, with sharp corners. That palette is the atlas UI. It is separate from the README hero, which uses Palette plate 052.

## Where to change things

| Task | Start here |
| --- | --- |
| A new map layer | The `LAYERS` array in `public/app.js` |
| A new HTTP route | `fetch` in `src/index.ts`, then the catalog in `apiCatalog` |
| Ingest on a timer | `scheduled` in `src/index.ts` and `wrangler.cron.toml` only |
| Civic tables | `db/schema.sql`, then `scripts/ingest-bma-open-data.py` |
| Building extract | `scripts/osm-buildings-to-geojson.py` and `scripts/generate-3d-tiles.sh` |

Deploy the cron Worker before the request Worker. The reason is in [Cost guards](README.md#cost-guards).

## Issues

Use the templates. A data correction should name the file or endpoint, the value you saw, and the source you checked. A security report goes to the address in [SECURITY.md](SECURITY.md), not to a public issue.

## Pull requests

Fill in the template. Say what you ran. If you could not run the browser against a map change, say that too. One concern per PR is easier to review than a restyle mixed with a new feed.
