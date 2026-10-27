// The zoom floors and ceilings the building layers share.
//
// These numbers used to live as literals in app.js, which let them drift.
// The drift was expensive, and in two directions at once:
//
//   The map allowed zoom 10 and the buildings layer started at 11, and the
//   atlas OPENS at z10.6 — so the city was hidden exactly where a first-time
//   visitor looks first. The opening view showed satellite, roads and
//   khlongs and no city at all.
//
//   And lowering the LAYER's floor did not fix it, because the fault was a
//   level deeper: MapLibre switches a SOURCE off entirely when the map zoom
//   is below that source's own minzoom, and the metro archive's TileJSON
//   declares minzoom 11. Below 11 the source cache never asks the archive
//   for a tile, so the layer is not "late" — it is never consulted. Measured:
//   2 archive requests (header + metadata) and no tile, ever.
//
// So the rule is one rule, and the floors are one number:
//
//   THE MAP MAY NOT ALLOW A ZOOM THE DATA DOES NOT REACH.
//
// The archive's floor is 11. The map's floor is therefore 11, and the city
// layer's floor is 11. Below that there is no city to draw, and rather than
// showing a hole, the atlas does not offer the zoom.
//
// The archive's own ceiling is separate and lives with the archive: the
// metro PMTiles has native tiles to z17, so at map zoom 10 the source zoom
// is clamped to 11 and the whole-city z11 tile is fetched. That is the price
// of showing the city at the opening view, and it is paid once and cached.
export const ATLAS_MIN_ZOOM = 11;
export const ATLAS_MAX_ZOOM = 19;
export const ATLAS_MAX_PITCH = 75;

// The archive's own floors and ceiling. The metro PMTiles carries native
// tiles from z11 to z17.
export const BUILDINGS_SOURCE_MIN_ZOOM = 11;
export const BUILDINGS_SOURCE_MAX_ZOOM = 17;

// The layer's ceiling must sit ABOVE the source's deepest zoom. A layer
// capped at 17 is not drawn at zoom 17, and because MapLibre only asks a
// source for tiles when a visible layer needs them, the whole city
// disappears at exactly z17: no tiles are requested, so nothing is drawn.
export const BUILDINGS_LAYER_MAX_ZOOM = 24;

// The floor of the city layer: the archive's floor, and never below the
// map's own floor.
export const BUILDINGS_LAYER_MIN_ZOOM = BUILDINGS_SOURCE_MIN_ZOOM;

// The band (13–80 m) and the massing mesh are street-zoom work: they only
// exist where the facades are drawn. An invisible band layer over the whole
// metro would cost a pass over every building in the city.
export const BAND_LAYER_MIN_ZOOM = 16;
export const MASSING_LAYER_MIN_ZOOM = 16;
