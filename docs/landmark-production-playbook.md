# Bangkok landmark production: research and repeatable workflow

Research date:29 October2026. Question: which publicly available tools can
repeatedly produce recognisable, geographically anchored Bangkok landmarks
without confusing attractive reconstruction with measured flood geometry?

This is a researched production plan and a tested input-audit tool, not a
claim that a new Wat Arun/Grand Palace reconstruction has been completed.
No weights were downloaded, photos uploaded, paid GPU job started or live
rendering library changed in this pass. Primary sources were checked below;
upstream capabilities are not benchmarks on our photographs or our phones.

## What is actually limiting this repository

`node scripts/audit-landmark-inputs.mjs` reports9275 polygon parts in the shipped
Old Town extract. It contains zero populated roof:shape, roof:height,
roof:material or building:material fields.1606 outer rings are concave.
The extract has zero interior rings; that does not prove there are no real
courtyards. Merely increasing polygon resolution cannot recover missing tags,
interior spaces or the appearance of a temple.

Existing work to preserve:

- Photo intake validates hashes, rights metadata and human coverage approval.
- The local Apple Object Capture runner stages only approved photos and keeps
  candidate USDZ files outside public/. It is available as a platform-specific
  route, **not** an open-source reconstruction engine.
- Native extrusion fallback and shared MapLibre depth remain the operating map.
- Palace GLB slot already declares metres, Y-up, east+X/south+Z, anchor and the
  footprint IDs it replaces. Its existing target is under3MB.
- Procedural forms are labelled schematic; convex-hull fitting is not a
  courtyard-preserving compound model. Previous phone/action and multiple-popup
  findings remain open; new dependencies do not fix them.

See [existing intake instructions](digital-twin-pilot.md). No new overlapping,
rights-reviewed capture set was supplied in this request. Do not claim the
20-photo intake minimum establishes sufficient capture or a successful model.

## Open-source shortlist and decisions

The licence column describes upstream declarations, not a legal clearance of
every dependency, photo, model checkpoint or output. Pin exact releases/commits
and retain their licences when an actual backend is installed.

| Tool | Role and upstream declaration | Decision for this stack |
| --- | --- | --- |
| [COLMAP](https://github.com/colmap/colmap) | SfM/MVS, new BSD; [CPU SIFT and learned feature alternatives](https://colmap.github.io/faq.html) | First open-source reconstruction baseline. CPU sparse reconstruction is possible; built-in dense reconstruction needs CUDA. Do not promise the full pipeline runs on this Mac. |
| [OpenMVS](https://github.com/cdcseacave/openMVS) | Dense reconstruction/meshing/texturing; AGPL-3.0 | Evaluate after camera alignment. Review the pinned build/dependencies and deployment obligations; not silently added to the public Worker. |
| [OpenDroneMap](https://github.com/OpenDroneMap/ODM) | Aerial imagery to textured mesh, point cloud, orthophoto and DEM; AGPL-3.0 | Use for a permissioned aerial compound survey, not unrelated tourist shots. Georeferencing/control and independent accuracy checks still needed. |
| [Nerfstudio](https://github.com/nerfstudio-project/nerfstudio) + [gsplat](https://github.com/nerfstudio-project/gsplat) | Neural reconstruction framework and CUDA Gaussian rasterization; Apache-2.0 repositories | Candidate photorealistic capture branch. Requires an appropriate GPU workflow and a coherent image set; not the default operational map. |
| [Spark](https://github.com/sparkjsdev/spark) + [SPZ](https://github.com/nianticlabs/spz) | Three.js splat viewer and compressed splat format; MIT | Candidate close-up heritage viewer. Spark lists mesh/splat integration and SPZ support. Atlas shared-renderer, occlusion, CSP and phone performance remain untested. Do not paste its second-canvas example over MapLibre. |
| [glTF Transform](https://github.com/donmccurdy/glTF-Transform) | MIT glTF SDK/CLI for repeatable asset processing | Preferred mesh delivery tooling to evaluate: deduplication, pruning and carefully reviewed simplification. Preserve coordinate frame and compare silhouettes before/after. |
| [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | Image-to-3D generation; upstream declares model/code MIT, dependencies separately licensed | Illustrative prototype only. Official prerequisites are Linux and NVIDIA≥24GB VRAM. A plausible unseen facade is not evidence of the actual facade. No default-on landmark replacement from a single image. |

### Newer geometry models worth a bounded experiment

[VGGT](https://github.com/facebookresearch/vggt) offers learned scene geometry
and a COLMAP export demo. Its repository distinguishes a commercial-use
checkpoint from the original non-commercial checkpoint, under custom licence
terms; do not classify it as unrestricted MIT/Apache software. Review and
approve the exact checkpoint before downloading or using it.

The authors' [VGGT-Omega page](https://vggt-omega.github.io/) points to2026
work and a18 September2026 replacement reference checkpoint. That matters:
benchmark claims should not be copied from an older checkpoint. Candidate
experiment: compare its camera/depth estimates against COLMAP on exactly the
same reviewed set. Its published memory improvements do not prove Mac support,
accurate temple finials or measured scale. No local benchmark was run.

[MASt3R](https://github.com/naver/mast3r) is a useful matching/reconstruction
research comparator but declares CC BY-NC-SA4.0 code. Park it for this reusable
public/commercial-capable pipeline pending an appropriate licence decision.

## Recommended rendering architecture (our inference)

Keep three products separate:

1. **City context:** existing tiled native extrusions, source-tagged height
   fallback, compact optional roof forms. No new per-building network request.
2. **Recognisable landmark:** reviewed textured GLB mesh, zoom-gated in the
   map's existing rendering/depth system, with cheap distant detail and the
   original extrusion retained until successful rendering.
3. **Immersive capture:** optional splat close-up for an individual site, not
   a mandatory city-wide payload. Defer integration until one genuine capture
   and target-device measurements justify it.

Splat appearance, generated meshes and decorative roof surfaces do not become
hydraulic barriers, terrain elevations, passable routes or flood-depth evidence.
Do not replace the whole MapLibre stack with Cesium just to add one landmark.
Reconsider geospatial tiling infrastructure only when measured asset count,
loading costs and geographic coverage exceed the existing model-slot approach.

## Repeatable capture-to-publication recipe

1. **One identifiable structure.** Start with one accessible chedi, hall or
   shophouse facade before attempting the entire Grand Palace compound. Record
   exact site, capture date, access/photography conditions and source IDs.
2. **Coherent, licensed capture.** Planning target:80–150 sharp overlapping
   views around that structure, with different heights where permitted. This is
   a capture brief, not a universal algorithm threshold. Never trespass or fly
   an unapproved drone. Avoid people/plates; no public CCTV used as training
   material. Texture source rights must permit the intended reuse.
3. **Intake.** Use the existing manifest/hash/rights gates. Separate construction
   periods and scaffolding changes. Public visibility is not a reuse licence;
   do not extract commercial satellite basemap tiles as model textures without
   confirmed rights. OSM can anchor plans, not supply unseen facade detail.
4. **Reconstruct privately.** Run existing Object Capture or a pinned, evaluated
   COLMAP/dense-mesh backend outside public/. Record tool/checkpoint versions,
   commands, source hashes, registration failures and unobserved surfaces.
5. **Align and measure.** Establish scale from an independently sourced physical
   dimension/control, then align geographic anchor, axes, yaw and base elevation.
   Do not blindly fit a scan to a bounding box or treat EXIF GPS as a survey.
6. **Clean and package.** Review mesh/texture defects, simplify at several detail
   levels, inspect with glTF Transform and validate GLB with the
   [Khronos glTF validator](https://github.com/KhronosGroup/glTF-Validator)
   before promotion. Compression codecs must be supported by the
   existing loader; do not enable KTX2 solely because an exporter can write it.
7. **Review on the map.** Compare independent reference photos and footprint
   overlays from multiple bearings. Check finial count, roof tiers, compound
   gaps, clipping, scale and ground placement. Explicitly label reconstructed,
   inferred and unobserved sections; keep source credits discoverable.
8. **Budget and promote.** Initial per-landmark targets: existing<3MB GLB budget,
   cheap distant representation, detailed download only at close zoom/on demand.
   These are proposed gates, not achieved benchmark results. Measure actual
   360/390px phone and desktop frame time/memory/bytes, toggle off/on, context
   loss, pan/zoom and failed asset load. Native fallback must survive every case.

For each asset retain: source-photo manifest hash, tool versions, model hash,
metres/axes, anchor/yaw, alignment basis and uncertainty, capture date, licences,
replacement IDs, detail-level sizes, screenshots and independent review.

## Pilot order and stop conditions

First: one supplied/permissioned small structure, comparing Object Capture
with the open-source baseline. Next: Wat Arun central prang and surrounding
structures as separately anchored assets, then Wat Phra Kaew/Grand Palace by
individual building. Those are selection recommendations, not capture approvals
or promises that remote imagery is sufficient.

Stop if there is no coherent rights-reviewed photo set, no suitable compute,
unresolved scale, severe holes/occlusion or failed phone budget. Retain the
labelled schematic rather than replacing a known approximation with an
unlabelled hallucination. No paid compute purchase is authorised by this plan.

What would change the recommendation: a genuinely reusable surveyed/open model
of the exact site with compatible rights, or a same-input benchmark showing a
newer backend improves completeness and independent dimensional error within
the delivery budget. Attractive upstream demos alone do not meet that bar.

## Re-run the local evidence audit

```sh
node scripts/audit-landmark-inputs.mjs
node scripts/audit-landmark-inputs.mjs /absolute/path/to/new-extract.geojson
node --test scripts/test-landmark-inputs.mjs
```

Read-only; no network, uploads, dependencies or production mutations. Counts
are diagnostic, not a reconstruction or topology validator. Three tests cover
unknown/zero tags, unchanged concave/holed input, multipolygons and malformed
coordinates. New backend installation, actual reconstruction and runtime
visual improvements are still pending; this research/tool-only commit does
not require redeploying identical production assets.
