# Landmark reconstruction and traffic-vision pilot

## Release boundary

This release builds the intake and local reconstruction path. It does **not** contain a reconstructed Wat Arun or Grand Palace. The existing palace GLB remains an approximate OSM-footprint model. No new geometry has been promoted to the live map and no building fallback has been removed.

The curated heritage collection has individual reference photographs, not a verified overlapping capture set. Targeted Commons searches for each landmark plus “photogrammetry” did not locate a suitable set; this is not an exhaustive claim about all public photographs. Mixing unrelated tourist photos does not establish coverage. The Wat Pho reference in the sibling collection names Wat Khun Inthapramun in Ang Thong and must not enter a Bangkok reconstruction.

## Local photo reconstruction

Apple RealityKit Object Capture is available on this Mac. `scripts/reconstruct-landmark.swift` type-checks against the installed SDK. No paid inference service or photo upload is used.

1. Prepare a folder with a `manifest.json` and original photographs. At least 20 unique images are required by our intake policy; this minimum does not guarantee overlap or a successful reconstruction. Prefer one structure first, with overlapping views around it, consistent lighting and minimal moving occluders.
2. Each photo entry carries `file`, `source` (HTTPS), `author`, `license`, `sha256`; written permissions need `permission`. Root fields: `landmark` (`wat-arun` or `grand-palace`), `photos`, `coverageReviewed: true`, `licenseReviewed: true`. Review obligations for every licence, especially mixed/share-alike sets, before marking reviewed.
3. `npm run photos:check -- /absolute/path/manifest.json` checks provenance fields, allowed licence identifiers, unique file hashes and path containment. It does not decode photographs or establish legal permission or geometric coverage.
4. `npm run reconstruct:landmark -- /absolute/path/manifest.json /absolute/path/candidate.usdz` validates intake, stages only the listed photographs, rechecks their hashes, compiles the local Swift runner and asks RealityKit for medium-detail reconstruction. It refuses existing outputs and publication into `public/`. Temporary staged copies and executable are removed on normal exit.
5. Inspect the candidate for holes, distorted roofs, moving objects and texture artefacts. Measure scale against an independently sourced dimension, align axes and geographic anchor, record the method and uncertainty. Convert to GLB, simplify, generate distance-based detail, and verify phone performance before proposing publication. These promotion steps remain pending a real candidate.

Audit hardening: the runner uses a frozen snapshot of the once-validated manifest; it never re-reads approvals during staging. Reconstruction writes to a private temporary USDZ first, then publishes the candidate with exclusive creation. Existing files and dangling symlinks are refused. This is a local workflow guard, not isolation from a malicious process with the same filesystem permissions.

Source: [Apple's photogrammetry command-line guide](https://developer.apple.com/documentation/realitykit/creating-a-photogrammetry-command-line-app). Existing map contract: `public/grand-palace-slot.js` (metres, Y-up, east +X, south +Z; <3 MB target). Preserve original extrusions until a replacement has loaded successfully. Candidate models must not become hydraulic obstacles merely because they look detailed.

## Traffic experiment

Append `?trafficPilot=1` to the atlas URL and open Camera wall. Only the first three operator-source still-image tiles with road/junction names (excluding labelled water-level gauges) receive an on-demand experimental vehicle-count button. This name filter selects test candidates, not three calibrated/validated traffic cameras. Ordinary visitors see no traffic-analysis UI and download no inference runtime or weights.

The experiment uses pinned TensorFlow.js 4.22.0 and COCO-SSD 2.2.3, lite MobileNet v2, loaded only after a click. CDN/runtime/model availability is an external dependency. COCO-SSD is a general-purpose detector; results below confidence 0.6 and all non-vehicle classes are discarded. The displayed classes are car, bus, truck, motorcycle and bicycle. Bounding-box validity is checked; numbers describe this picture, not flows per minute. No identity, face, plate recognition, cross-camera tracking, speed, accident detection, flood-depth estimation or road-clearance verdict is implemented.

Model documentation: [TensorFlow COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), Apache-2.0. Its pretrained model can internally predict other classes; this application neither exposes nor retains those predictions. A still with unknown capture time remains unknown after inference. No detections are written to D1 or used in flood warnings.

| Data | Purpose | Location | Retention / deletion |
| --- | --- | --- | --- |
| Existing public camera still | User-requested experimental vehicle count | Browser memory; existing same-origin snapshot proxy unchanged | Temporary canvas cleared after inference; wall media removed on close |
| Vehicle class totals | Inspect model behaviour | Browser DOM only | Removed on wall close; no analytics/upload/storage added |
| Model/runtime files | On-device inference | Downloaded from jsDelivr and upstream weight host | Browser cache policy; model remains in tab memory for reuse |

This is a technical minimisation register, not a legal compliance determination or a new licence to redistribute camera imagery.

The UI has a 45-second deadline covering both model loading and inference. A timeout cannot cancel a TensorFlow GPU task: the shared inference lock remains held until the real task settles, including across wall close/reopen. Late or hidden-page results are not displayed. Reload after a failed or stuck model download. The loaded detector is deliberately cached in tab memory for reuse; it is not a per-camera tracker.

The October 15 audit also versioned the entry script and CV import, with revalidation headers on both files. An edge SHA match alone did not prove the browser had executed the new module: a returning browser ran the cached old import during verification. Keep versioned imports current on subsequent CV releases.

The real phone test then found `loadGraphModel is not a function`. A truthy partial TensorFlow global was accepted by the old loader. Readiness now checks `loadGraphModel` and `browser.fromPixels`, not object presence; a CDN-bundle VM experiment reproduced that failure and confirmed that loading the full runtime repairs the partial object. The origin of the partial global in the browser was not established.

## Validation and promotion gate

Automated tests check class filtering, malformed detections, unknown capture age, default-off operation, photo-set minimum and tamper rejection. They do not measure detector accuracy. Swift SDK type-check is not a reconstruction test.

Before any congestion label or default-on CV: select three stable road views, manually annotate independent frames including rain/night/occlusion, measure precision/recall and count error, document failure conditions and operator review. Sustained queues require temporally distinct frames, a calibrated road region, trustworthy capture times and motion validation. A cached still cannot establish a queue. Do not present a zero as “clear”.
