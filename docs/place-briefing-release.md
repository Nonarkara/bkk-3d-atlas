# Place briefing — 15 October 2026

Approved scope: a place-first entry to the existing operational twin, not a
replacement map or a hydraulic-model claim.

Preserved: maps, live overlays, camera wall, heritage GLB, all advanced layer
controls, schematic experiments and flood-freshness safeguards. No files
collapsed and no new external service, account or credential introduced.

## What changed

- Three map-side task buttons: Check a place, Water now, Explore.
- Tap an unclaimed map point or use the keyboard-operable Check map centre.
  Existing camera/gauge/heritage/transit overlays still own their clicks.
- The inspector now leads with district, dated city context, dated nearby
  gauge evidence, loaded road reports within 500m, rail/boat reference-network
  proximity, next available hourly rain forecast and explicit travel unknowns.
- Sources reused: `/api/risk`, `/api/atlas/at-this-point`,
  `/api/weather/google` (legacy URL, actual Open-Meteo model), loaded FloodDash
  roads and camera catalogue. No duplicate ingestion pipeline.
- Nearest camera buttons use the loaded catalogue only (up to 1.5km). Missing
  catalogue coverage and unverified image freshness are explicit.
- Gauge API includes its original observedAt, not just a cached relative age.
- Current city context expires at 30 minutes; gauge context at 120 minutes;
  loaded roads expire after 24 hours and forecasts retain valid time. Briefing
  reevaluates every 30 seconds without renewing source timestamps.
- Sequence guard prevents old asynchronous selections replacing new ones;
  Clear invalidates pending responses too.
- Phone sheet close is now a real button. Task links open their actual section
  and expose it to accessibility APIs; reduced-motion users avoid smooth
  inspection scrolling and camera flight animation.
- Water-line legend explicitly says the motion is illustrative, not measured
  velocity or hydraulic simulation; blue is not proof of safe or dry streets.

## Limits

Geometric network proximity is not a walkable path or live transit status.
Gauge level is not depth at the selected point. The rain model does not
predict road clearance. Historical/schematic scores remain under Advanced
and are not promoted into the briefing. Officially licensed new datasets and
photo-reconstructed landmark meshes remain separate work; none claimed here.

## Verification

`npm run test:place`: missing/future/stale evidence, forecast zero vs missing,
expiry, segment-distance road association, and out-of-order selections.
Existing flood integrity/history/source-health/massing checks are retained.
Browser path: task button → Check map centre → dated briefing → Clear;
Water now and Explore; phone sheet opening/closing and viewport overflow.
Production is released with `npm run deploy:live`, followed by exact asset
hash and live API observation-time checks.
