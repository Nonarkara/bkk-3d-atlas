// Grand Palace / Wat Phra Kaew stand-in.
//
// Swap in a surveyed or captured model by replacing public/models/grand-palace.glb.
// The file is metres, Y-up. Origin is GRAND_PALACE_ANCHOR (OSM way 23482983,
// the ubosot centroid). +X is east, +Z is south, -Z is north. Yaw is radians
// CCW from above if the replacement's +X is not east. scale is an extra
// uniform multiplier (1 = metres). meshopt (EXT_meshopt_compression) and
// Draco both load. Keep the file under 3 MB. No API key, no texture account.
//
// hideIds are the heritage-detail features this model stands in for. Their
// fill-extrusions (and the matching ubosot roof steps) hide while it is showing.
// Footprints are © OpenStreetMap contributors, ODbL. The mesh is a schematic
// stand-in, not an official survey.

export const GRAND_PALACE_SLOT = {
  id: 'grand-palace',
  file: '/models/grand-palace.glb',
  name: 'Grand Palace · Wat Phra Kaew',
  note: 'Approximate model, not an official survey.',
  anchorFeatureId: 'bkk-building-23482983',
  // Centroid of the ubosot ring, closing point excluded.
  anchor: [100.49260603, 13.75117745],
  yaw: 0,
  scale: 1,
  hideIds: [
    'bkk-building-229771450',
    'bkk-building-229771451',
    'bkk-building-229771456',
    'bkk-building-23482983',
    'bkk-building-23482988',
    'bkk-building-23482989',
    'bkk-building-23482990',
    'bkk-building-23482994',
    'bkk-building-23482995',
    'bkk-building-23482996',
    'bkk-building-23482997',
    'bkk-building-23482998',
    'bkk-building-782214614',
    'bkk-building-782214624',
    'bkk-building-782214631',
    'bkk-building-782453374',
    'bkk-building-782453375',
    'bkk-building-782453376',
    'bkk-building-782453377',
    'bkk-building-782453378',
    'bkk-building-782453379',
    'bkk-building-782453380',
    'bkk-building-782453381',
    'bkk-building-782453382',
    'bkk-building-782453383',
    'bkk-building-782453384',
    'bkk-building-782453385',
    'bkk-building-782453386',
    'bkk-building-782453387',
    'bkk-building-782453388',
    'bkk-building-782453389',
    'bkk-building-782453390',
    'bkk-building-782453410',
    'bkk-building-82541135',
  ],
};

export const PALACE_ROOF_NAME = 'Wat Phra Kaew · Ubosot';
