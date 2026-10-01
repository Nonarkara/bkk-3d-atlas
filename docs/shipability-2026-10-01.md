# Flood integrity release — 1 October 2026

Scope: a bounded audit of operational Atlas, not a rewrite of the separate BKKx heritage site. Preserve maps, cameras, gauges, animations and navigation.

## Release corrections

- Expire individual road reports and heat observations at response time, including during upstream outages. Completed or expired Traffy tickets cannot re-enter the map through the fallback cache.
- Nearby fresh, high-confidence gauges provide context, not confirmation of street flooding, depth, clearance or passability. Missing, future or stale observation times cannot supply fresh context.
- Label relay age separately from the report window and expose failed road-report sources.
- Expire unplaced DDS reports; cached district/hourly totals become unavailable after 20 minutes instead of being presented as current counts.
- Preserve the cinematic 72-hour tour as an explicitly illustrative scenario. Remove invented numerical depths, road counts and dated river-crest predictions. No calibrated inundation forecast is claimed.

## Evidence

- Ten executable regression tests exercise actual server modules and extracted client rendering functions, including failed fetches, advancing clocks and removal of stale aggregate UI values.
- TypeScript, client JavaScript syntax and existing asset verification pass locally.
- Production baseline: 29 API smoke checks pass; feeds included 77 CCTV entries, 123 playable-URL Maholan entries, 39 gauges and 36 dams. These counts are a snapshot, not availability guarantees; stream playback was not validated.
- Dependency audit reports zero production vulnerabilities. Independent diff review reproduced the stale-aggregate issue; this release adds a failing-case regression and correction.
- Recent GitHub workflows failed before steps ran. Local checks and direct deployment verification are required; no CI pass is claimed.

## Live release proof

Code commit `bab8c6b`, pushed to main. Cloudflare version `7fc844e5-e74e-42bb-ba09-61a7869bc1ca` deployed to `atlas.nonarkara.org`.

- Three independent custom-domain asset probes matched the local SHA-256 of `public/app.js` (`e8d5132be5bf4695…`). Existing deploy checks also passed three times.
- Live road API excluded observations older than 24 hours or over five minutes in the future; counts matched active geometry and unplaced reports. Aggregate-availability and nearby-gauge disclaimers were present.
- All 29 API smoke checks passed after deployment. This is contract/reachability evidence, not validation of physical flood predictions or camera playback. DDS requests took about 25–26 seconds; other relay requests sometimes took eight seconds, a latency gap for a future pass.
- Real Chrome interaction: map canvas loaded, scenario started, pause changed to resume, exit returned to live and concealed the scenario HUD. All scenario metrics remained “Not calculated.” A narrow-viewport check showed no document overflow at the browser's effective 433 CSS-pixel width; viewport override was reset. This is not a 390-pixel device certification.

## Not certified by this release

Unmarked roads remain unknown, never safe. Gauge proximity cannot certify a journey. A real flood forecast still needs validated rainfall/wind/storm inputs, upstream-flow propagation, tide and drainage interactions, terrain uncertainty, and retrospective validation against observed inundation.

Source gaps remain: stale DDS bulletins, an empty canal-gate bulletin, failed Traffy fetches, and an unconfigured traffic provider. Degraded sources must remain visible. Separate heritage-site weather adapters are outside this patch. This release is an integrity improvement, not emergency-navigation certification.
