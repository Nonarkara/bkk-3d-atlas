import { GRAND_PALACE_SLOT } from './grand-palace-slot.js';

// Existing model anchors, not newly inferred monument coordinates.
// Wat Arun matches wireframe-geometry.js's cited central-prang reference.
export const LANDMARK_VIEWS = {
  'grand-palace': { center: GRAND_PALACE_SLOT.anchor, zoom: 16.4, pitch: 60, bearing: -25 },
  'wat-arun': { center: [100.48888889, 13.74361111], zoom: 16.6, pitch: 60, bearing: 25 },
};
