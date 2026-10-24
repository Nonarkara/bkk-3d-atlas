// Facade articulation for the mid-rise band.
//
// The band is 13 m to 70 m: the four- to twenty-storey buildings that make
// up most of a Bangkok street. Below 13 m the atlas gives the low-rise a
// pitched roof (public/city-forms.js); above 70 m it gives the towers a
// podium, setbacks and a crown (public/building-massing.js). Between those
// two the buildings were plain extrusions — a box with a lid — and at street
// zoom that is what a city looks like from the air.
//
// This module is the vocabulary, and nothing else: it says how tall the
// ground storey is, how deep the arcade is set back, where the storey lines
// fall and how far the cornice stands proud. It draws no geometry. The
// drawing lives in public/building-massing.js, which owns the mesh builder.
//
// HONESTY, and it matters here. A storey line is a TYPOLOGICAL READING of a
// footprint and a height: "a building of this height in this city has a
// ground storey and a storey line every 3.15 m". It is not a survey of this
// particular building's windows. Nothing here asserts that a building has a
// particular number of floors — the number of storeys comes from the same
// height rule the walls are drawn with (public/building-heights.js), so a
// building drawn 18.9 m tall gets six storeys, not a guessed number.
//
// RESOLUTION, and it decides what is built at all. A facade feature has to
// be big enough to survive the pixel grid or it is not drawn: a 0.5 m
// string course is 0.2 pixels wide at z16 and would be a shimmer, not a
// detail. So the detail level is a function of the zoom, and at street zoom
// the atlas draws the parts that read — the ground storey and the cornice —
// and only adds the storey lines when the screen can carry them.
//
// THE PROFILE. A facade is a profile line in the (offset, height) plane,
// swept around the footprint. Each point of the line says how far the wall
// stands from the footprint at that height: negative is set back, positive
// stands proud. The mesher sweeps it, and every step in the line becomes
// either a wall or a ledge. Nothing else is needed: an arcade is a step
// inward, a cornice is a step outward, a storey line is a groove, and the
// shading does the rest. The profile is the whole drawing.
//
// Geometry is pure: no DOM, no three.js, no MapLibre.

import { heightFor, HEIGHT_GET } from './building-heights.js';

export const FACADE_MIN_METERS = 13;
export const FACADE_MAX_METERS = 70;

// The band, as a MapLibre filter.
//
// The band is picked out by HEIGHT, never by id. Ids cannot carry it: the
// band's buildings come from vector tiles, their feature ids are tile-local,
// and a filter that names one hides whichever building happens to carry that
// number in whatever tile it lands in. A height range says what it means.
//
// The filter is built on the same height expression the map extrudes with, so
// the band it names is the band the map drew.
export const FACADE_BAND_FILTER = [
  'all',
  ['>=', HEIGHT_GET, FACADE_MIN_METERS],
  ['<=', HEIGHT_GET, FACADE_MAX_METERS],
];

// The minimum zoom at which the band is articulated at all. Below this the
// buildings are a few pixels tall and the atlas keeps its cheap extrusions.
export const FACADE_MIN_ZOOM = 16;

// The vocabulary, in metres.
export const FACADE = {
  // One tall storey at the street: shopfront, mezzanine, awning line.
  groundHeight: 4.2,
  // How far the ground storey is set back. This is the depth of the arcade
  // — the shadow it throws is what makes a ground floor read as a ground
  // floor and not as the bottom of a wall.
  groundDepth: 1.8,
  // The height of one storey.
  storeyHeight: 3.15,
  // A storey line is a recessed band: the wall steps back this far and comes
  // forward again.
  courseDepth: 0.9,
  courseHeight: 0.55,
  // The cornice stands this far proud of the wall.
  corniceDepth: 0.8,
  // The parapet stands this far above the roof deck, and the cornice is the
  // band it grows out of.
  parapet: 1.1,
  // The mesh is drawn this far outside the footprint so that it covers the
  // map's own extrusion instead of fighting it for the same pixels.
  outset: 0.12,
};

// How much facade detail the screen can carry at a given zoom.
//
// The scale is metres per pixel at the map's latitude. A feature has to be
// about a pixel wide to be worth drawing at all, so the thresholds below are
// expressed as the zoom at which each part crosses that line.
export function facadeDetail(zoom) {
  if (zoom >= 18.5) return 'full';
  if (zoom >= 17.5) return 'courses';
  return 'base';
}

// Is this building in the band?
export function isFacadeCandidate(props) {
  if (!props) return false;
  const { height, degenerate } = heightFor(props, 'metro');
  if (degenerate) return false;
  return height >= FACADE_MIN_METERS && height <= FACADE_MAX_METERS;
}

// The storey lines of a building, in metres above its base.
//
// The count comes from the height, not from a guess: a building drawn 18.9 m
// tall above a 4.2 m ground storey has 14.7 m of upper wall, which is four
// storeys of 3.15 m and a remainder. The remainder is the last course, which
// is shorter — and it is drawn shorter.
export function storeyLines(base, height, groundHeight = FACADE.groundHeight) {
  const lines = [];
  const top = height - FACADE.parapet;
  let y = base + groundHeight;
  while (y < top - 0.4) {
    lines.push(y);
    y += FACADE.storeyHeight;
  }
  return lines;
}

// The profile of one building's facade.
//
// The returned line is a list of [offset, height] points, from the bottom of
// the building to the top of its parapet, wound so that the material is
// always on the inside of the line. Two points at the same height and
// different offsets are a ledge: one that steps outward stands proud and
// throws a shadow, one that steps inward is a recess. Two points at the same
// offset are a wall.
//
// The heights come from the shared height rule, so the profile cannot claim
// a storey the building does not have.
export function facadeProfile(base, height, detail = 'base') {
  const F = FACADE;
  const profile = [];
  const groundTop = Math.min(base + F.groundHeight, height - 0.8);
  const hasGround = (height - base) > F.groundHeight + 1.2;

  // The ground storey: set back, so the wall above overhangs it and the
  // street sees a shadowed base.
  if (hasGround) {
    profile.push([-F.groundDepth, base]);
    profile.push([-F.groundDepth, groundTop]);
    // The soffit of the overhang. This ledge is the shadow line that makes
    // the ground floor read as a ground floor.
    profile.push([0, groundTop]);
  } else {
    profile.push([0, base]);
  }

  // The wall, with the storey lines cut into it when the screen can carry
  // them. A groove is two ledges and a back wall.
  const corniceFrom = Math.max(profile[profile.length - 1][1], height - F.corniceDepth * 2);
  if (detail === 'courses' || detail === 'full') {
    for (const line of storeyLines(base, height)) {
      if (line <= profile[profile.length - 1][1] + 0.3) continue;
      if (line + F.courseHeight >= corniceFrom) break;
      profile.push([0, line]);
      profile.push([-F.courseDepth, line]);
      profile.push([-F.courseDepth, line + F.courseHeight]);
      profile.push([0, line + F.courseHeight]);
    }
  }

  // The cornice: the wall steps proud and stays proud for the last stretch,
  // so the building ends in an edge rather than a line.
  profile.push([0, corniceFrom]);
  profile.push([F.corniceDepth, corniceFrom]);
  profile.push([F.corniceDepth, height]);
  // The top of the cornice, back to the wall plane.
  profile.push([0, height]);
  // The parapet: the wall carries on past the roof deck.
  profile.push([0, height + F.parapet]);

  return { profile, roofDeck: height, groundTop, corniceFrom };
}

// Offset a ring outwards (positive) or inwards (negative) by a distance.
//
// The ring is in local metres and wound counter-clockwise. This is a mitred
// offset: each vertex moves along the bisector of its two edges, which is
// exact for a convex corner and close enough for the concave ones a building
// footprint throws at it.
export function offsetRing(ring, distance) {
  const n = ring.length;
  if (n < 3 || distance === 0) return ring.map((point) => [point[0], point[1]]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    // Outward normal of each edge for a counter-clockwise ring: the
    // interior is to the left of the direction of travel, so the outward
    // normal is the direction of travel turned the other way.
    const edgeNormal = (a, b) => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) return [0, 0];
      return [dz / len, -dx / len];
    };
    const n1 = edgeNormal(prev, cur);
    const n2 = edgeNormal(cur, next);
    const bx = n1[0] + n2[0];
    const bz = n1[1] + n2[1];
    const len = Math.hypot(bx, bz);
    if (len < 1e-9) {
      out.push([cur[0] + n2[0] * distance, cur[1] + n2[1] * distance]);
      continue;
    }
    const mx = bx / len;
    const mz = bz / len;
    // The mitre: the offset along the bisector has to be longer than the
    // offset itself, by the cosine of the half angle.
    const cos = Math.max(0.35, mx * n2[0] + mz * n2[1]);
    out.push([cur[0] + mx * (distance / cos), cur[1] + mz * (distance / cos)]);
  }
  return out;
}
