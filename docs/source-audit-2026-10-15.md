# Source audit — bounded pass, 15 October 2026

This is a checkpoint, **not a claim that the attached source list is exhausted**.
Preserve existing maps, cameras, observations, forecasts and landmark slots.

## Shipped change: ingest health

The live sources-health API reported 42 sources: 34 ok, 6 degraded, 6 stale,
2 skipped. These counts incorrectly sum to 48: degraded and stale were the
same combined counter. Six slow-refresh feeds were also falsely stale under
a blanket 180-minute threshold (including weekly PCD water quality).

`src/source-health.ts` now partitions statuses and evaluates each cached
response against its original last-success timestamp. A feed becomes stale
after two scheduled intervals, with a 15-minute minimum; unknown cadence
uses the explicit legacy 180-minute fallback. Failed attempts remain degraded.
Missing/future successful-ingest timestamps cannot turn green. This is an
ingest-schedule policy, **not validation of underlying observation freshness**.
The public panel labels that distinction and includes the stale count.

Tests: `npm run test:sources` covers cadence boundaries, disjoint counters,
future/missing timestamps and ageing a cached response without renewing it.

## BMA CKAN flood search

Probe: https://data.bangkok.go.th/api/3/action/package_search?q=flood&rows=100

All nine returned packages were inspected at metadata level; this completes
that one English search, not Thai synonyms or the full catalogue.

| Package ID | Content | Finding |
| --- | --- | --- |
| 25bc3f04-5707-4b60-a885-5ad45aa38cd6 | Flood-risk points 68 | CSV returns 200; `UTM_X/UTM_Y` values look like longitude/latitude (100.x,13.x), **not UTM metres**. Confirm CRS before ingestion. Licence unspecified. |
| 79d52d29-942d-43c0-b864-223c46491dc2 | Flood prevention areas | CSV; licence unspecified. Geometry/content not yet checked. |
| 3fcbe9f7-d2b0-4442-b110-4a5620ebdce3 | Flood-risk points | CSV; licence unspecified. |
| aa651095-a57b-47f7-ad92-83e52fc2ff65 | Floodgates | ArcGIS item 848fcba5674045fe98e2a60545bd3df6; licence unspecified. |
| 83ae5639-a37f-4e19-bd37-e1c97930f39d | Floodgate locations | ZIP/GML/CSV; licence unspecified; compare with existing gate feed before adding. |
| 0e5dee69-b4e4-4584-83f7-e8e560ca4160 | Flood-risk points | CSV; licence unspecified. |
| a1cc1d7a-6d87-4dd2-a662-79ed58c2623c | Risk/watch points | CSV; catalogue says Creative Commons Attribution; validate resource content/date and exact licence version. |
| 0b5acfeb-b028-42e1-b1b7-6b03c947c8ce | Water levels | DOCX; metadata from 2022, not established as telemetry. |
| 36256cdf-5576-4b17-9c4a-ddde6c7ff343 | Flood weak points | ZIP/KML/GML; 2021 metadata; licence unspecified. |

No new records from these packages were published. Download availability is
not a redistribution licence, and historical risk points are not active flooding.

## Photos-to-3D pilot: native engine works; input set does not yet qualify

Executed on this Mac:

```
swift -e 'import RealityKit; print("photogrammetry_supported=\(PhotogrammetrySession.isSupported)")'
photogrammetry_supported=true
```

Apple's local Object Capture is therefore an available candidate without a
paid service or cloud photo upload. No reconstruction was run and no mesh
was replaced. Existing Grand Palace GLB remains an explicitly approximate,
OSM-based schematic stand-in, not a photo reconstruction.

The sibling heritage `site/public/heritage/photos.json` provides one photo
each for Grand Palace, Wat Arun and the Wat Pho slot—not an overlapping
multiview capture. Worse, the Wat Pho record names **Wat Khun Inthapramun,
Ang Thong**. Reject that record as a Bangkok reconstruction input; do not
silently use it as the reclining Buddha at Wat Pho. Sibling assets were not
modified in this operational release.

Primary method: https://colmap.github.io/tutorial.html — overlap, translated
camera viewpoints and similar lighting are essential; reflective temple
surfaces make arbitrary tourist-photo mixtures especially risky.
Native support contract:
https://developer.apple.com/documentation/realitykit/photogrammetrysession/issupported

Next pilot gate: acquire and inspect a consistently licensed overlapping set
for one specific structure, record author/source/licence/file hashes, test
camera registration, then validate scale/orientation and optimise into the
existing metre-scaled Grand Palace GLB slot. A single attractive photo cannot
justify invented rear geometry. Do not install heavy alternative engines
until this input-quality gate passes.

## Remaining audit coverage

Existing live source inventory already includes HII/ThaiWater, RID, TMD,
DDS, GISTDA, air quality, traffic and cameras. Reuse the D1 relay rather
than creating duplicate ingestion. HII seasonal-history audit is separately
complete in `hii-seasonal-history.md`.

Still pending: full Thai/English BMA and national CKAN catalogue comparison;
dataset-level NSO/DOPA/access/licence review; operator transit/GTFS currency;
satellite and CAMS/FIRMS coverage; public facilities/budget/procurement;
GISTDA key-gated product coverage and rights. SWMM/Delft3D/WRF-Chem and
other solvers in the attachment are modelling engines, not ready-made feeds.
