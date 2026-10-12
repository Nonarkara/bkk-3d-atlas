# Security

## Report a vulnerability

Email **nonsmartcity@gmail.com**. Please do not open a public issue for an
undisclosed vulnerability, a leaked credential, or a way to read data the
Worker is not supposed to return.

Include the endpoint or file, what you observed, and a minimal way to
reproduce it. There is no bug-bounty program documented in this repository.

## In scope

- `src/` — the Cloudflare Worker (`fetch` and `scheduled`)
- `public/` — the static atlas, including anything an unauthenticated visitor can request
- `scripts/` and `db/` — ingest and schema, where a change could expose or corrupt stored rows
- Secrets named in [`.env.example`](.env.example): `LONGDO_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_WEATHER_API_KEY`, and the GitHub Actions names `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`

Do not commit those values. Wrangler secrets are set with `npx wrangler secret put`, not in git.

## Out of scope

- Upstream feeds the Worker proxies or the browser calls directly (Longdo / iTIC, FloodDash, ThaiWater, Traffy Fondue, RainViewer, Open-Meteo, NASA GIBS, Esri, OpenFreeMap, YouTube embeds). Report those to the operator of that feed.
- Camera streams. Public traffic cameras and the Maholan aggregator are other people’s systems. This repo does not provide access to the closed BMA security-camera network.
- “The flood layer is wrong.” Flood envelopes in `public/bkk-flood-envelope.geojson` are a schematic civic demo. Road highlights are reports snapped to streets, not a surveyed extent. Those are data-honesty bugs: open a data-correction issue, or read [docs/shipability-2026-10-01.md](docs/shipability-2026-10-01.md). Do not use the atlas as an emergency service.

## What the Worker already refuses to invent

A missing upstream, a missing `LONGDO_KEY`, or a missing TimesFM service is returned as an explicit unavailable or unconfigured body. Please treat a patch that fills those gaps with guessed coordinates, guessed depths, or a hard-coded “safe road” as a security and safety defect.
