# Wang Thonglang drainage pilot — step 1 of the hydraulic-twin roadmap

Why this district: BMA and Mott MacDonald already modelled its pipes, canals
and pumps for the Smart Flood Management pilot, so the data exists inside BMA.
One district, calibrated against its own gauges, before anything citywide.

## What we already hold (`inventory.geojson`, built 2026-10-14)

| Layer | Count | Source | Has | Missing for SWMM |
|---|---|---|---|---|
| Canal segments | 28 | BMA Drainage (via the BKKx drainage companion) | name, width, length, from/to | cross-sections, bed levels, Manning n |
| Pump stations | 10 | same | name, location, year | capacity (m³/s), pump curves, on/off levels, operating log |
| Gates | 2 | same | name, location, year | dimensions, sill level, operating rules/log |
| Sumps | 11 | same | location | storage volume, invert |
| Known flood-risk points | 14 | same | street, problem | — (calibration targets) |
| Live gauges | 5 | BMA KlongMap via BKK FloodWatch | level (m MSL), bank level, 5-min | a year of history exists at HII for most |
| Pipes / manholes | 0 | — | — | **everything**: network, diameters, inverts, slopes |
| Ground elevation | 30 m global DEM | — | — | **≤1 m LiDAR DEM** (Bangkok varies under 1 m) |

The five gauges: WL.CKS.01, WL.CKS.03 (Khlong Chao Khun Sing), WL.KJN.01
(Khlong Chan), WL.LPW.01 (Lat Phrao gate), WL.SSB.06 (Saen Saep at Chao Khun
Sing). These are the calibration points.

## The ask

`request-to-bma-drainage.th.md` — a letter for Dr Non to send (not sent).
It asks only for what is missing above, for this one district, and offers
the model and results back to BMA.

## When data arrives

1. Build the SWMM network (PySWMM) from the pipes + this inventory.
2. Replay 25–28 Sep 2026 rain (ThaiWater gauges) and compare simulated canal
   levels with the five gauges. Publish the error, not just the picture.
3. Only if it holds: wire the gates/pumps as controls and test operating rules.
