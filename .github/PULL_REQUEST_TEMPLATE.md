## What changed

<!-- One or two sentences. Name the files or endpoints. -->

## Why

<!-- The bug, the missing credit, or the layer this adds. Link an issue if there is one. -->

## Data and honesty

- [ ] No new coordinates, depths, or “safe road” states were invented
- [ ] OSM-derived data is still attributed as © OpenStreetMap contributors, ODbL 1.0
- [ ] Secrets from `.env.example` are not in the diff

## Checks

- [ ] `npm run verify`
- [ ] `npm run typecheck`
- [ ] `npm run test:flood`
- [ ] `npm run smoke` against local or live, if an `/api` contract changed
- [ ] Browser check of the map, if `public/` behaviour changed — or an explicit note that it was not run

## Deploy note

Request Worker and cron Worker are separate configs. If this changes `scheduled` or `wrangler.*.toml`, cron (`wrangler.cron.toml`) deploys before `wrangler.toml`.
