# Heritage detail pilot — not released

Two existing OSM footprints (Wat Phra Kaew ubosot 23482983 and Wat Pho
ubosot 23630098) drive an original schematic gable-roof prototype.
Enable only with `?heritagePilot=1&at=100.4926,13.7512,18`.
No existing buildings, cameras, maps or flood layers are removed.

The 48-strip native extrusion method passed finite-coordinate, closed-ring,
height-bound and immutable-input tests. TypeScript, 19 flood integrity tests
and the local asset verifier passed. **Browser appearance did not establish
that the added roofs render correctly; this is not a shipped detailed model.**
The six-metre roof rise is illustrative, not measured. OSM-derived geometry
retains ODbL attribution. Never use it as hydraulic obstacle geometry.

Remaining gates: diagnose rendering/occlusion, verify roof profiles against
architectural references, replace illustrative heights, test terrain and
2D toggles, inspect on a phone, obtain verified Chakri/Wat Arun footprints,
add visible per-building provenance, then commit/push/deploy/live-verify.

References (facts only; no third-party meshes, textures or code copied):
- https://www.royalgrandpalace.th/en/discover/history/
- https://www.royalgrandpalace.th/download/plan_eng.pdf
- https://seaarts.sac.or.th/artwork/9?lang=en
- https://ingetrazo.com/en/ — terrain, model provenance and preparation-sheet
  workflow inspiration. Its specific flood demo remains unidentified.

Separate audit observation: the local dashboard displayed a critical verdict
beside a FloodDash reading marked 13 days old. Investigate the verdict's
underlying source timestamp before making current travel-safety claims.
