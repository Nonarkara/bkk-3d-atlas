# Bangkok release gates — 25 November 2026

Atlas is the operational map; BKKx is the heritage site. Their releases are independent, as is the narrow Atlas location-evidence Worker. No schema or zone changes were needed.

## Verify the job, not just the bundle

- Atlas: run `npm run typecheck`, `npm run verify`, and `npm test`, then use `bash scripts/deploy-live.sh`. The script checks the deployed bytes and runs the public smoke checks, including the isolated location route. The latter admits honest upstream outages; blank coordinates must return 400 and unavailable sources must not publish counts. To include location in a smoke run against a non-production preview that has that Worker routed, set `ATLAS_SMOKE_LOCATION=1`.
- Open **Check a place → Check map centre → Nearby evidence** on phone and desktop. The map launches without a location-evidence request. Opening the disclosure sends one request and shows independent source states and Bangkok retrieval times. Clear, change places or close the drawer; a late result must not appear. These distances are straight-line and not an access or route verdict.
- Open and close **Camera wall**. The map alone must not download HLS.js or camera video. In a browser without native HLS, the first visible video requests the pinned player once. Pending players count toward the existing 12-slot cap. Count and close tests are not proof an individual operator stream is on air.
- With an accessible Chrome debugging port, run `CHROME_DEBUG_PORT=<port> node scripts/render-check.mjs --wat-arun`. It uses the existing Wat Arun waypoint, compares the same camera with architectural detail on, off and restored, and fails when the change is no greater than repaint noise. On 25 November the off delta was 0.40% against a 0.020% floor. This tests the live drawing, not geometric accuracy or a forced style reload.
- BKKx: run `npm --prefix site test`, then `bash site/scripts/deploy.sh` from its repo. Verify build headers on the origin, BKKx and shophouses, and probe road evidence, DDS bulletin and warnings. ThaiWater 429 must leave the warning count unknown; the retry cooldown lives in each Worker isolate, not a distributed cache.

## Previous independently verified versions

Record the current IDs before each deployment with `wrangler deployments list --config <config>`. The values below are checkpoints for this change, not evergreen rollback targets.

| Worker | Config | Verified version before the indicated change |
| --- | --- | --- |
| Atlas request | `wrangler.toml` | `bbb0d4fa-5038-4a89-ad2b-45994d60a54c` (place UI live, before lazy HLS) |
| Atlas cron | `wrangler.cron.toml` | `a62d9fad-0c6f-4229-a78d-332728c31257` (paired with place UI) |
| Atlas location | `wrangler.location.toml` | `42bbb026-7da7-4f76-b61a-baaa120a72d3` (before cache isolation) |
| BKKx | `site/dist/server/wrangler.json` from BKKx repo | `22b06b61-768e-40bc-b3a4-a574fdc97d19` (before warning cooldown) |

Rollback is an operator action, not part of the smoke test: `npx wrangler rollback <version-id> --config <config>`. For a paired Atlas release restore cron before the request Worker, and verify the deployed build and smoke checks afterward. Do not roll back the separately routed location Worker unless that service regressed. If reverting a production version, reconcile Git before the next rollout so it cannot silently reintroduce the failed version.

## What this did not change

No geometry, camera catalog, flood verdict policy, source licensing or main layout was replaced. The Wat Arun model remains schematic. Startup still has substantially larger tile and waterway payloads than the deferred camera library; optimize them only with a measured first-map and layer-visibility comparison. Keep dependency updates separate: Atlas PR #30 and BKKx #31/#32 were open when checked, and were not merged in this release.
