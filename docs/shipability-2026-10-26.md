# Compact map and resilient heritage rendering

Scope: operational Atlas, main. This is not a claim that every historical
branch, every interface, or the flood prediction system has been fully audited.

## Reconciliation

Started at ae5a897. Retained MiniMax/Mavis's a45e0e0 type-scale, emoji/glass
cleanup and prior contributions. The only initial uncommitted file was
scripts/render-check.mjs: a source-readiness wait. Incorporated that work rather
than overwriting it. No branches, public layers, sources or earned content were
deleted. No changes to the separate BKKx heritage deployment in this release.

## Space belongs to the map

Same viewport dimensions, measured before/after in a real browser:

| Viewport | Before map frame | After map frame | Share before → after |
| --- | --- | --- | --- |
| 1440×900 | 1080×645 | 1160×675 | 53.8% → 60.4% |
| 1024×768 | 664×513 | 1024×543 | 43.3% → 70.7% |
| 390×844 | 390×688 | unchanged | 81.5% |

Desktop rail: 360→280px. Desktop bottom allocation: 210→180px. At ≤1280px,
the same rail becomes an on-demand drawer. No map/control or type-size reduction
was used to earn this space. Full area names wrap instead of being ellipsized.
Headline statistics pair label and value, with context below. The first three
desktop news records remain initially visible; all eight original records are
available on expansion. Source credit becomes a native disclosure and its full
text is unclamped when opened. The live strip retains internal scrolling for
expanded warnings and the full situation board; the default map-frame share
does not mean every expanded section fits the first screen.

Fixed an existing accessibility defect: desktop rail was aria-hidden=true.
Closed drawers are inert; open drawers have dialog semantics and a focus loop;
Escape closes and returns focus. Resizing restores the desktop complementary
region. Six-width pointer/keyboard checks cover 1440/1280/1024/768/390/375.
When the upstream returns fewer than four news items, expansion is explicitly
reported unverified rather than clicking an intentionally hidden button.

## Disappearing models

Initial production pixel test: heritage forms 0.44%, massing 0.90%, detail
extrusions 0.47%, landmarks 0.22%; all expected layers draw. The superseded roof
pilot is correctly hidden. These are visibility thresholds, not model accuracy.

Two concrete defects/gaps were identified:

1. Rattanakosin overview opens at zoom14.6, below heritage forms15 and detailed
   massing16. New Grand Palace/Wat Arun shortcuts open at16.4/17, enable
   buildings and the reference-based monument layer. The overview stays intact.
2. Native footprints could be hidden before the first successful custom draw.
   Handoff now waits for both custom render passes. Missing projection data
   restores native geometry; a draw failure deactivates the replacement. WebGL
   loss restores the fallback and restoration rearms the renderer. Unsupported
   tower geometry is never added to the hidden-ID set.

The exact cause of the owner's previous-night incident remains unproven; do not
present these verified failure paths as a replay of that incident. The projection
matrix contract is retained, not reverted to the earlier incorrect frustum fix.

Visual comparison exposed an additional paint-order defect: FORMS_LAYER and
WIRE_LAYER_ID were absent from LAYER_STACK. Reconciliation could therefore move
imagery above both architectural layers. Both now participate in the explicit
3D stack above imagery. Before/after captures confirm the formerly faint model
becomes opaque; see /tmp/atlas-solid-stack-proof/wat-arun.png. This also restores
the visibility of existing temple roofs and stupas across the river.

Preview pixel check after the handoff repair: forms0.85%, massing0.57%, detail
8.93%, landmarks0.45%, pilot hidden. Layout/canvas dimensions changed, so these
percentages must not be interpreted as a before/after quality score.

## Wat Arun: no monument footprint in the detail extract

The detailed Old Town GeoJSON contains no Wat Arun monument; its only Arun-name
match is an unrelated commercial building. The landmark drawing is separate.
That layer also lacked its required checkbox: setLayerToggle silently returned
without installing it. Added the missing monument control and an exhaustive
registry/control check. The check found five other registered but unreachable
layers (live views, rain gauges, incident reports, dams and Maholan cameras);
their controls now live in an opt-in Additional public evidence disclosure.
None is enabled by default, and their source/uncertainty labels remain explicit.
Added solid surfaces to its existing loft rings: one central prang and four
satellites. No height, anchor, footprint envelope or evidence tier was enlarged.
Other monument line drawings remain. No native footprints are hidden for this
new surface, and the model is never a hydraulic obstacle.

This is an interpretive, photo-guided procedural silhouette, not photogrammetry,
a surveyed conservation model or a newly acquired OSM compound plan. Existing
height disagreements remain explicit in the popup. Reference and attribution:
[Juanitoooww, The Prang of Wat Arun, CC BY-SA4.0](https://commons.wikimedia.org/wiki/File:The_Prang_of_Wat_Arun.jpg).
The source and licence were rechecked on26 October2026. No image texture was
downloaded or redistributed in this change. More detailed measured compound
models still require appropriate source plans and field/photo validation.

Geometry tests cover finite coordinates, unchanged70m maximum, envelope,
five-spire composition and triangle budget at phone/desktop detail levels.
Geometry/material resources are disposed when the layer is removed.
Fixed a profile-sampling bug too: sampling sin(t*rows*pi) only at t=i/rows
made every intended moulding zero. Half-step sampling preserves the existing
envelope but reveals the corn-cob profile; the existing terrace rings now have
solid faces rather than just outlines. These remain illustrative details.

## Audit integrity and remaining verification

Preserved the previous agent's source-readiness wait. Removed inherited cleanup
that closed other matching Atlas tabs; only the audit-owned tab is now closed,
through finally on success/failure. An audit timeout is not a passing render.

Before screenshots: /tmp/atlas-msh-20261026-before; preview geometry and control
captures: /tmp/atlas-space-20261026-final. Host load exceeded330; a screenshot
timed out after the six-width interaction checks. Final solid-model visual
capture and production release receipt must be recorded after verification.

The stricter shortcut check exposed cold-start readiness issues as well: camera
movement no longer waits for initial tile completion, and layer installation
awaits a single initial-load promise. It does not subscribe to a second 'load'
event when isStyleLoaded becomes false during a fly-to. Only the latest requested
landmark wins. Independent read-only review reports no confirmed blocker.
Targeted browser verification now requires an actual monument render announcement
and nonzero solid-triangle count, not merely a camera zoom. Both shortcuts passed
with rendered geometry; capture /tmp/atlas-solid-wired/wat-arun.png.
The first release attempt passed178 tests but correctly refused deployment
because the stronger QA changes were not yet committed. No unverified version
was deployed by that attempt.

The subsequent in-flight release was cancelled before the main worker publish
when the visual paint-order correction was identified. Cron code was unchanged.
Release guards now freeze the checked HEAD and stamped public/src diff, recheck
between cron and main uploads, and refuse mixed-agent assets. No other agent's
process or service was stopped. The final release must use the frozen revision;
only documentation and QA-only receipts should follow it.

## Production receipt

Published build `bkk-atlas-20261026-1792989375-e62b417`, source e62b417,
stamp commit deb792b. Main worker version
401363f5-0fa6-4499-bbeb-e8f6ad4c728c. All181 tests, typecheck and repository
verification passed. Three consecutive matching production-byte probes and
34/34 live smoke checks passed. Main and origin/main matched after publishing.

Production pointer/keyboard checks passed at all six listed widths, including
drawer focus, Escape return, inert closed state and no horizontal overflow.
The full source credit, situation board and warning expanded successfully.
Both landmark shortcuts reached the correct camera and an actual monument
render announcement with nonzero solid triangles. Production captures:
`/tmp/atlas-live-20261026/`. Independent visual review found no confirmed
blocker in desktop, phone and both landmark captures. It does not certify
survey accuracy or every other interface/branch.

Final QA also exposed weaknesses in the older measurement scripts: the phone
capture could catch a closing drawer mid-transition, and a visible base-road
layer was wrongly assumed empty for noise calibration. QA now waits for the
closed drawer to leave the viewport and measures unchanged-state repaint noise
inside the actual map rectangle. Late custom geometry must settle before the
pixel gate runs; an unsettled map fails as unproven, never as a blank layer.
These QA/documentation-only corrections do not change deployed runtime bytes.
