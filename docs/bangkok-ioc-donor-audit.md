# Bangkok IOC donor: first useful transfer

Approved 23 October 2026. Donor: Nonarkara/smart-city-thailand-monitor,
revision 8110db99e3984b0994e97f0399183456b57b7def.

Adapted ideas: independently failing source reads, typed status, last-good copy
with its original fetch time, normalized and bounded output. No donor seed,
confidence score, generated project record or synthetic city indicator is used.

`src/location-evidence.ts` validates Bangkok points, complaint summaries and
nearby catalog records. `src/location-worker.ts` exposes these at
`/api/location/evidence?lat=&lng=` through `wrangler.location.toml`.

Deployment is a separate Worker with a narrow route on the Atlas hostname.
It reads the existing civic D1 table and makes an hourly cached aggregate-only
Traffy request. It does not upload any Atlas map asset, change either existing
Worker, modify a database schema or install another ingestion loop. This avoids
replacing current live map files, which differ from the recovered Git revision.
Cloudflare supports routes in front of a Custom Domain:
https://developers.cloudflare.com/workers/configuration/routing/routes/ .

Counts are within 800 m of a rounded point, not a walking catchment. Complaint
recent counts cover 12 months; open counts are all-time. Zero reports is not
proof of good conditions. The civic catalog does not include all daily services;
import time is not observation time. No property risk or walkability verdict is
produced. Provider attribution is returned; individual complaint details are not
requested or stored. One-hour freshness and a seven-day last-good cache; isolated
source failure produces stale/unavailable evidence. The in-isolate 30/minute
request brake resets on cold starts and is not a global abuse guarantee.

Quarantined donor material: BMA generated roads/canals/drainage and public
statistics labeled live; inspected AlphaEarth file with NaN/Infinity; dated
forecast files without a connected validated model. TAT/TCEB discovery is held
until their endpoints and useful geographic resources are verified. Legacy
place seeds include placeholders and cannot become an editorial recommendation.

Checks: `npm run typecheck`; `node --test scripts/test-location-evidence.mjs`;
`npx wrangler deploy --dry-run --config wrangler.location.toml`.
Deploy only this service: `npx wrangler deploy --config wrangler.location.toml`.
Rollback: remove this narrow route or deploy the previous evidence Worker version;
the original Atlas Worker and all existing map URLs remain independent.
