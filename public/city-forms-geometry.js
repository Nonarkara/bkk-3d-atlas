// Real hipped roof geometry, as triangles.
//
// The fill-extrusion roof was a staircase: a pitched surface has to be drawn
// as a stack of flat-topped prisms, and every step between them catches the
// light differently. At street zoom the roof read as corrugated metal, not as
// a roof. The atlas already draws its Thai roofs with three.js and they look
// like roofs; this module is the geometry for doing the same to the city.
//
// Pure: no DOM, no three.js, no MapLibre. It emits positions, normals and
// colours in metres, relative to an origin, with z measured from the ground.
//
// A hipped roof over a rectangular fit of the footprint:
//
//   - the eave is a rectangle at the building's top, a little wider than the
//     walls, so the roof overhangs them
//   - the ridge is a line along the LONG axis, set in from both ends
//   - the four faces are two trapezoids (the long slopes) and two triangles
//     (the hips)
//
// That is eight triangles for a whole roof. A stepped fill-extrusion needed
// seventy-two prisms to fake the same shape, and looked worse.
import { toLocalMeters, metersPerDegree } from './city-forms.js';

// What every form says about itself. These are typological readings, not
// surveys, and the map says so out loud.
export const ACCURACY = {
  hip: 'Schematic hipped roof · typological reading of a low-rise footprint · unsurveyed · not for flood calculations',
  plant: 'Schematic rooftop plant · typical of a flat-roofed mid-rise · unsurveyed · not for flood calculations',
};

// The atlas's own roof palette, the one the heritage roofs use. One visual
// language: a city roof and a temple roof are the same tiles.
const ROOF_COLOUR = [0.77, 0.46, 0.28];   // #c57548
const HIP_COLOUR = [0.56, 0.22, 0.17];    // #8e382b
const EAVE_COLOUR = [0.84, 0.68, 0.35];   // #d7ac59
const TANK_COLOUR = [0.17, 0.17, 0.18];
const AC_COLOUR = [0.55, 0.57, 0.59];
const HUT_COLOUR = [0.73, 0.70, 0.65];

// Everything is appended straight into three shared buffers. The first
// version built each roof into its own arrays and then spread them into the
// city buffer, which was both slow — a spread of a hundred thousand
// arguments — and one argument list away from a stack overflow.
function pushTri(out, a, b, c, colour) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len > 1e-9) { nx /= len; ny /= len; nz /= len; }
  const p = out.positions;
  const n = out.normals;
  const col = out.colors;
  p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  col.push(
    colour[0], colour[1], colour[2],
    colour[0], colour[1], colour[2],
    colour[0], colour[1], colour[2],
  );
}

function pushQuad(out, a, b, c, d, colour) {
  pushTri(out, a, b, c, colour);
  pushTri(out, a, c, d, colour);
}

// The oriented box split into a long axis and a short axis.
function boxAxes(box) {
  const longIsU = box.halfU >= box.halfV;
  return {
    longAxis: longIsU ? [box.ux, box.uy] : [-box.uy, box.ux],
    shortAxis: longIsU ? [-box.uy, box.ux] : [box.ux, box.uy],
    longHalf: Math.max(box.halfU, box.halfV),
    shortHalf: Math.min(box.halfU, box.halfV),
  };
}

// A hipped roof over the plan's oriented box.
//
// `plan.box` is in local metres already. The roof is returned as triangles
// in the same local frame, with the eave at the building's top and the ridge
// `rise` above it.
export function hipRoofTriangles(plan, options = {}, out = newBuffers()) {
  const eave = options.eave ?? 0.5;
  const { box, height } = plan;
  const { longAxis, shortAxis, longHalf, shortHalf } = boxAxes(box);
  // The rise is capped by the width of the building: a shallow roof on a
  // narrow shop and a steep one on a wide hall, never a spike.
  const maxRise = shortHalf * 0.62;
  const rise = Math.max(0.8, Math.min(options.roofRise ?? 3.2, maxRise));
  const halfL = longHalf + eave;
  const halfS = shortHalf + eave;
  const z = height;
  const zr = height + rise;
  // The hip end is set in by the width of the roof, which is the classic
  // 45-degree hip. A building too short for a ridge gets a pyramid.
  const inset = Math.min(halfS, halfL * 0.9);
  const ridgeHalf = halfL - inset;
  const centre = box.centre;
  const at = (l, s, zz) => [
    centre[0] + longAxis[0] * l + shortAxis[0] * s,
    centre[1] + longAxis[1] * l + shortAxis[1] * s,
    zz,
  ];
  // The eave corners.
  const a = at(-halfL, -halfS, z);
  const b = at(-halfL, halfS, z);
  const c = at(halfL, halfS, z);
  const d = at(halfL, -halfS, z);
  if (ridgeHalf <= 0.05) {
    // No room for a ridge: a pyramid.
    const apex = at(0, 0, zr);
    pushTri(out, a, b, apex, HIP_COLOUR);
    pushTri(out, b, c, apex, ROOF_COLOUR);
    pushTri(out, c, d, apex, HIP_COLOUR);
    pushTri(out, d, a, apex, ROOF_COLOUR);
    return out;
  }
  const r1 = at(-ridgeHalf, 0, zr);
  const r2 = at(ridgeHalf, 0, zr);
  // The two long slopes.
  pushQuad(out, a, d, r2, r1, ROOF_COLOUR);
  pushQuad(out, b, c, r2, r1, ROOF_COLOUR);
  // The two hips.
  pushTri(out, a, b, r1, HIP_COLOUR);
  pushTri(out, d, c, r2, HIP_COLOUR);
  // A thin band at the eave, so the edge of the roof reads as an edge.
  const lipRise = z + Math.min(0.22, rise * 0.12);
  const a2 = at(-halfL, -halfS, lipRise);
  const b2 = at(-halfL, halfS, lipRise);
  const c2 = at(halfL, halfS, lipRise);
  const d2 = at(halfL, -halfS, lipRise);
  pushQuad(out, a, b, b2, a2, EAVE_COLOUR);
  pushQuad(out, c, d, d2, c2, EAVE_COLOUR);
  return out;
}

// A box, as six quads, from z0 to z1.
function pushBox(out, x0, y0, x1, y1, z0, z1, colour) {
  const p = (x, y, z) => [x, y, z];
  const a = p(x0, y0, z0); const b = p(x1, y0, z0); const c = p(x1, y1, z0); const d = p(x0, y1, z0);
  const e = p(x0, y0, z1); const f = p(x1, y0, z1); const g = p(x1, y1, z1); const h = p(x0, y1, z1);
  pushQuad(out, a, b, f, e, colour);
  pushQuad(out, b, c, g, f, colour);
  pushQuad(out, c, d, h, g, colour);
  pushQuad(out, d, a, e, h, colour);
  pushQuad(out, e, f, g, h, colour);
}

// A regular prism with `sides` faces: a water tank.
function pushPrism(out, cx, cy, radius, z0, z1, sides, colour) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius];
    const p1 = [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius];
    pushQuad(
      out,
      [p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1],
      colour,
    );
  }
  // The lid.
  const lid = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    lid.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z1]);
  }
  for (let i = 1; i < sides - 1; i++) pushTri(out, lid[0], lid[i], lid[i + 1], colour);
}

// Rooftop plant: black water tanks, a condenser bank and a stair hut.
//
// The counts are a typological reading, not a survey — the same claim the
// fill-extrusion version made, and it makes it here too.
export function plantTriangles(plan, options = {}, out = newBuffers()) {
  const { box, height } = plan;
  const { longAxis, shortAxis, longHalf, shortHalf } = boxAxes(box);
  const centre = box.centre;
  const at = (l, s) => [
    centre[0] + longAxis[0] * l + shortAxis[0] * s,
    centre[1] + longAxis[1] * l + shortAxis[1] * s,
  ];
  const margin = 1.6;
  const halfU = longHalf - margin;
  const halfV = shortHalf - margin;
  if (halfU <= 1.2 || halfV <= 1.2) return out;
  const tankR = Math.min(1.1, Math.max(0.45, Math.min(halfU, halfV) * 0.22));
  const cols = Math.max(1, Math.min(4, Math.floor((halfU * 2) / (tankR * 3.4))));
  const rows = Math.max(1, Math.min(3, Math.floor((halfV * 2) / (tankR * 3.4))));
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (cols * rows > 6 && (c + r) % 3 === 2) continue;
      const u = cols === 1 ? 0 : -halfU + (2 * halfU) * (c / (cols - 1));
      const v = rows === 1 ? 0 : -halfV + (2 * halfV) * (r / (rows - 1));
      const p = at(u, v);
      pushPrism(out, p[0], p[1], tankR, height, height + (options.tankHeight ?? 1.8), 8, TANK_COLOUR);
    }
  }
  // The condenser bank along one long edge.
  const acW = Math.min(halfU * 0.9, 2.4);
  const acD = Math.min(halfV * 0.35, 1.3);
  for (let i = 0; i < 2; i++) {
    const v = halfV - acD * (0.8 + i * 1.3);
    if (v + acD > halfV + 0.9) break;
    const u = -halfU * 0.35 + i * halfU * 0.7;
    const p0 = at(u - acW, v - acD);
    const p1 = at(u + acW, v - acD);
    const p2 = at(u + acW, v + acD);
    const p3 = at(u - acW, v + acD);
    pushBox(
      out,
      Math.min(p0[0], p1[0], p2[0], p3[0]), Math.min(p0[1], p1[1], p2[1], p3[1]),
      Math.max(p0[0], p1[0], p2[0], p3[0]), Math.max(p0[1], p1[1], p2[1], p3[1]),
      height, height + (options.acHeight ?? 0.9), AC_COLOUR,
    );
  }
  // The stair hut: the one opaque block every Bangkok roof carries.
  const hutW = Math.min(2.6, halfU * 0.6);
  const hutD = Math.min(2.4, halfV * 0.6);
  if (hutW > 0.8 && hutD > 0.8) {
    const p0 = at(-halfU + hutW * 0.5, -halfV + hutD * 0.5);
    const p1 = at(-halfU + hutW * 1.5, -halfV + hutD * 0.5);
    const p2 = at(-halfU + hutW * 1.5, -halfV + hutD * 1.5);
    const p3 = at(-halfU + hutW * 0.5, -halfV + hutD * 1.5);
    pushBox(
      out,
      Math.min(p0[0], p1[0], p2[0], p3[0]), Math.min(p0[1], p1[1], p2[1], p3[1]),
      Math.max(p0[0], p1[0], p2[0], p3[0]), Math.max(p0[1], p1[1], p2[1], p3[1]),
      height, height + (options.hutHeight ?? 2.6), HUT_COLOUR,
    );
  }
  return out;
}

// The whole city's roofs and plant, as one merged set of triangles.
//
// `entries` is a list of { feature, family } pairs, and `plans` says which
// of them get which form. The output is in metres relative to `origin`, with
// z measured from the ground.
export function newBuffers() {
  return { positions: [], normals: [], colors: [] };
}

export function buildCityGeometry(plans, options = {}) {
  const out = newBuffers();
  for (const plan of plans) {
    if (plan.kind === 'hip') hipRoofTriangles(plan, options, out);
    else plantTriangles(plan, options, out);
  }
  return out;
}

export { toLocalMeters, metersPerDegree };
