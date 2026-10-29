// Thai architectural forms for the atlas.
//
// Ported from BKKx site/app/atlas/[district]/heritage-forms.ts. The geometry
// engine is pure (no three.js, no DOM) and unchanged; the classifier reads the
// atlas's own property names (building_type / height / base_height) instead of
// BKKx's building / render_height / render_min_height.
//
// The flat-topped extrusions read as massing, not as Rattanakosin. This turns a
// real OpenStreetMap footprint, the height the atlas already uses, and a
// building type into the shapes a Thai eye recognises:
//
//   hall    ubosot / wihan / หอพระ — walls, skirt roof, stacked tiers stepping
//           down to the gable ends, gold pediments, rake trims, chofa
//   sala    a one-tier open pavilion roof
//   chedi   stepped square base, bell, harmika, ringed spire (lathe)
//   prang   stepped base, cell, corn-cob tiers, trident spire
//   mondop  square base and body, stepped square spire
//   prasat  cruciform halls with a prang at the crossing
//   throne  a tiered hall with one or three mondop spires
//   fort    the footprint as a wall with merlons and a pavilion on top
//
// Honesty: placement and plan come from the real OSM footprint. Overall height
// is the value the atlas already uses. Everything between — tier counts,
// profiles, proportions — is a typological reading, drawn to be recognisable,
// not measured. Every spec carries `confidence`: "named" when a Thai name says
// what it is, "inferred" when only the type and the shape do. Callers must be
// able to show that difference.
//
// The colour of a form comes from its `material`, and the material is decided
// by the same evidence: a name that says ไม้ is timber, a name that says gold
// is gilded, a type that is a pavilion is teak. The colours themselves live in
// public/temple-materials.js — one declared set, shared with the map's
// extrusion, the massing layer and the sibling project. Nothing here writes a
// colour down.
import { TEMPLE_MATERIALS as M, bodyOf, shadeOf, lightOf, partOf } from './temple-materials.js';

const ORIGIN = { lng: 100.5028, lat: 13.7511 };
const KX = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
const KY = 110540;
// The colours are not written here. They live in public/temple-materials.js,
// one table, so a temple is the same colour in the forms mesh, in the map's
// extrusion underneath it, and in the sibling project that draws the same
// Old Town. This block only names the local handles the geometry uses; every
// colour a form actually wears comes from the material it carries.
const C = {
  plinth: M.plinth.base,
  roof: M.roof.base,
  skirt: M.skirt.base,
  gold: M.gold.base,
  glass: M.glass.base,
  // Loha Prasat is blackened iron and steel — the "metal castle". No gold.
  iron: M.iron.base,
  ironShade: M.iron.shade
};

class Builder {
  positions = [];
  colors = [];
  tri(a, b, c, col) {
    this.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.colors.push(col[0], col[1], col[2]);
  }
  quad(a, b, c, d, col) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }
  /** Walls between two rings with the same vertex count; optional top cap. */
  band(lo, hi, z0, z1, col, cap) {
    const n = lo.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad([lo[i][0], lo[i][1], z0], [lo[j][0], lo[j][1], z0], [hi[j][0], hi[j][1], z1], [hi[i][0], hi[i][1], z1], col);
    }
    if (cap) this.cap(hi, z1, cap);
  }
  prism(ring, z0, z1, col, cap = col) {
    this.band(ring, ring, z0, z1, col, cap);
  }
  /** Flat cap over a simple polygon (ear clipping). */
  cap(ring, z, col) {
    for (const [a, b, c] of earClip(ring)) this.tri([...ring[a], z], [...ring[b], z], [...ring[c], z], col);
  }
  /** Surface of revolution about (cx, cy). profile: [z, r] bottom → top. */
  lathe(cx, cy, profile, segs, phase, colorAt) {
    const ring = (r) => Array.from({ length: segs }, (_, i) => {
      const a = phase + i / segs * Math.PI * 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
    for (let k = 0; k < profile.length - 1; k++) {
      const [z0, r0] = profile[k];
      const [z1, r1] = profile[k + 1];
      if (z1 <= z0 && r1 === r0) continue;
      this.band(ring(r0), ring(r1), z0, z1, colorAt((z0 + z1) / 2));
    }
    const [zt, rt] = profile[profile.length - 1];
    if (rt > 0.01) this.cap(ring(rt), zt, colorAt(zt));
  }
}
function earClip(ring) {
  const pts = ring.slice();
  let idx = pts.map((_, i) => i);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  if (area < 0) idx = idx.reverse();
  const out = [];
  const cross = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 1e4) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
const toLocal = ([lng, lat]) => [(lng - ORIGIN.lng) * KX, (lat - ORIGIN.lat) * KY];
function openRing(ring) {
  const r = ring.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}
function polygonArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function fitRect(local) {
  return minAreaRect(hull(local));
}
/** The minimum-area rectangle of a point set, as the classifier measures it. */
function minAreaRect(h) {
  let best = null;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const [x0, y0] = h[i];
    const [x1, y1] = h[(i + 1) % h.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of h) {
      const u = x * ux + y * uy, v = -x * uy + y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      let hl = (maxU - minU) / 2, hw = (maxV - minV) / 2, ax = ux, ay = uy;
      if (hw > hl) {
        [hl, hw] = [hw, hl];
        [ax, ay] = [-uy, ux];
      }
      best = { cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, ux: ax, uy: ay, hl, hw };
    }
  }
  return best ?? { cx: 0, cy: 0, ux: 1, uy: 0, hl: 1, hw: 1 };
}
/**
 * The rectangle a form is actually drawn on: the minimum-area rectangle of
 * the footprint, scaled about its own centre until its four corners sit
 * inside the footprint's convex hull. A convex hull contains a rectangle
 * exactly when it contains all four of its corners.
 *
 * The classifier measures the real footprint on its own (`fitRect`); this is
 * the plan the drawing is held to.
 */
function fitRectInside(local) {
  const h = hull(local);
  const rect = minAreaRect(h);
  const s = inscribeScale(rect, h);
  if (s < 1) {
    rect.hl *= s;
    rect.hw *= s;
  }
  return rect;
}
const at = (r, u, v) => [r.cx + u * r.ux - v * r.uy, r.cy + u * r.uy + v * r.ux];
/** Is a point inside a convex polygon? */
function pointInHull(p, h) {
  let area = 0;
  for (let i = 0; i < h.length; i++) {
    const [x0, y0] = h[i];
    const [x1, y1] = h[(i + 1) % h.length];
    area += x0 * y1 - x1 * y0;
  }
  const poly = area < 0 ? h.slice().reverse() : h;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) < -1e-9) return false;
  }
  return true;
}
/**
 * The largest scale, at or below 1, that keeps a rectangle's four corners
 * inside the footprint's convex hull. A convex hull contains a rectangle
 * exactly when it contains all four of its corners.
 */
function inscribeScale(rect, h) {
  const corners = [[-rect.hl, -rect.hw], [rect.hl, -rect.hw], [rect.hl, rect.hw], [-rect.hl, rect.hw]];
  const fits = (s) => corners.every(([u, v]) => pointInHull(at(rect, u * s, v * s), h));
  if (fits(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
const rectRing = (r, hl, hw) => [at(r, -hl, -hw), at(r, hl, -hw), at(r, hl, hw), at(r, -hl, hw)];
const square = (r, half) => rectRing(r, half, half);
/**
 * How far a roof hangs past the walls below it, as a fraction of the plan's
 * half-width. A temple's roof does overhang — that is what a temple's roof
 * does — but the plan itself never leaves the footprint. This is the number
 * the plan is held to, so it is written down once and read by the test.
 */
export const ROOF_OVERHANG = 1.04;

function gableTier(b, r, hl, hw, zEave, zRidge, chofa, roofCol, zCap, trimCol = C.gold) {
  const room = Math.max(0, zCap - zRidge);
  const e = (u, v, z) => [...at(r, u, v), z];
  b.quad(e(-hl, -hw, zEave), e(hl, -hw, zEave), e(hl, 0, zRidge), e(-hl, 0, zRidge), roofCol);
  b.quad(e(hl, hw, zEave), e(-hl, hw, zEave), e(-hl, 0, zRidge), e(hl, 0, zRidge), roofCol);
  for (const s of [-1, 1]) {
    const u = s * hl;
    const inset = s * Math.min(0.6, hl * 0.04);
    b.tri(e(u - inset, -hw * 0.94, zEave), e(u - inset, hw * 0.94, zEave), e(u - inset, 0, zRidge - 0.05), trimCol);
    const t = Math.min(Math.max(0.18, hw * 0.05), room);
    for (const side of [-1, 1]) {
      b.quad(e(u, side * hw, zEave), e(u, 0, zRidge), e(u, 0, zRidge + t), e(u, side * hw, zEave + t), trimCol);
    }
    if (chofa) {
      const s0 = Math.min(Math.max(0.6, hw * 0.16), room / 1.95);
      const path = [[0, 0], [0.45, 0.55], [0.75, 1.25], [0.55, 1.8], [0.3, 1.95]];
      const w = s0 * 0.09;
      for (let k = 0; k < path.length - 1; k++) {
        const [du0, dz0] = path[k], [du1, dz1] = path[k + 1];
        const a0 = e(u + s * du0 * s0, -w, zRidge + dz0 * s0), b0 = e(u + s * du0 * s0, w, zRidge + dz0 * s0);
        const a1 = e(u + s * du1 * s0, -w, zRidge + dz1 * s0), b1 = e(u + s * du1 * s0, w, zRidge + dz1 * s0);
        b.quad(a0, b0, b1, a1, trimCol);
      }
    }
  }
}
/**
 * A shophouse row unit: narrow frontage, plastered wall banded at each floor,
 * and a plain tiled gable with the ridge along the long axis.
 *
 * Deliberately not temple vocabulary — no chofa, no gold pediment, no skirt
 * tile. Those would make an ordinary commercial building read as a wat.
 */
function shophouse(b, r, z0, H, floors) {
  const zPl = z0 + Math.min(0.4, 0.05 * H);
  b.prism(rectRing(r, r.hl, r.hw), z0, zPl, C.plinth);
  const wallTop = z0 + 0.78 * H;
  b.prism(rectRing(r, r.hl * 0.98, r.hw * 0.92), zPl, wallTop, bodyOf("shophouse"));
  // The string course at each floor line is what makes a row read as a row.
  const n = Math.max(1, Math.min(4, floors || 2));
  for (let i = 1; i < n; i++) {
    const z = z0 + (wallTop - z0) * (i / n);
    b.band(
      rectRing(r, r.hl * 1.005, r.hw * 0.95), rectRing(r, r.hl * 0.98, r.hw * 0.92),
      z - 0.16, z + 0.16, partOf("shophouse", "band"),
    );
  }
  const hl = r.hl * 0.99, hw = r.hw * 0.93;
  const e = (u, v, z) => [...at(r, u, v), z];
  const zRidge = z0 + H;
  b.quad(e(-hl, -hw, wallTop), e(hl, -hw, wallTop), e(hl, 0, zRidge), e(-hl, 0, zRidge), partOf("shophouse", "roof"));
  b.quad(e(hl, hw, wallTop), e(-hl, hw, wallTop), e(-hl, 0, zRidge), e(hl, 0, zRidge), partOf("shophouse", "roof"));
  // Close the gable ends in plaster, not gold.
  for (const s of [-1, 1]) {
    const u = s * hl;
    b.tri(e(u, -hw, wallTop), e(u, hw, wallTop), e(u, 0, zRidge), lightOf("shophouse"));
  }
}
/**
 * A hall: an enclosed building with walls, a skirt roof and stacked tiers.
 *
 * An open pavilion (`open`) is a different building, not a hall with the door
 * open. A ศาลา is a timber shed: no skirt tile, no glazed panel band, no gold
 * pediment and no chofa. Giving it the wat's vocabulary made every ordinary
 * pavilion in the Old Town read as a shrine.
 */
function hall(b, r, z0, H, tiers, open = false, mat = "plaster") {
  const zPl = z0 + Math.min(1.2, 0.06 * H);
  b.prism(rectRing(r, r.hl, r.hw), z0, zPl, C.plinth);
  const wallTop = z0 + (open ? 0.34 : 0.4) * H;
  const body = bodyOf(mat);
  b.prism(rectRing(r, r.hl * 0.9, r.hw * 0.84), zPl, wallTop, open ? shadeOf(mat) : body);
  const skirtLo = wallTop - 0.07 * H;
  if (!open) {
    b.band(rectRing(r, r.hl * 1, r.hw * ROOF_OVERHANG), rectRing(r, r.hl * 0.9, r.hw * 0.84), skirtLo, wallTop + 0.02 * H, C.skirt);
    // The glazed panel band under the skirt: กระจกคราม. Thai halls carry a row
    // of blue ceramic panels in the pediment wall, and it is the one place the
    // Old Town's temples use a cold colour — which is what makes a hundred
    // identical white walls read as a hundred separate buildings.
    const glassLo = wallTop - 0.155 * H;
    b.band(
      rectRing(r, r.hl * 0.905, r.hw * 0.845), rectRing(r, r.hl * 0.9, r.hw * 0.84),
      glassLo, glassLo + 0.07 * H, C.glass,
    );
  }
  const zEave = wallTop + 0.02 * H;
  const zTop = z0 + 0.9 * H;
  const n = Math.max(1, Math.min(3, tiers));
  for (let i = n - 1; i >= 0; i--) {
    const hl = r.hl * 0.92 * (1 - 0.15 * (n - 1 - i));
    const zr = zTop - i * 0.09 * H;
    // Gold pediment, rake trim and chofa belong to the wat. An open pavilion
    // is trimmed in its own timber.
    const trim = open ? body : C.gold;
    gableTier(b, r, hl, r.hw * 0.88, zEave, zr, !open && i === 0, C.roof, z0 + H, trim);
  }
}
function chedi(b, r, z0, H, mat, redented) {
  const R = Math.min(r.hl, r.hw);
  const body = bodyOf(mat);
  [[1, 0, 0.08], [0.86, 0.08, 0.16], [0.74, 0.16, 0.24]].forEach(([s, a, c]) => b.prism(square(r, R * s), z0 + a * H, z0 + c * H, body));
  const P = (pts) => pts.map(([z, k]) => [z0 + z * H, R * k]);
  const phase = Math.atan2(r.uy, r.ux) + (redented ? Math.PI / 12 : 0);
  const segs = redented ? 12 : 32;
  b.lathe(r.cx, r.cy, P([[0.24, 0.66], [0.27, 0.66], [0.27, 0.62], [0.3, 0.6], [0.34, 0.65], [0.41, 0.66], [0.47, 0.62], [0.52, 0.5], [0.555, 0.32], [0.56, 0.24]]), segs, phase, () => body);
  // The harmika is the square chamber under the spire, and it is gilded even
  // on a stucco chedi — that band of gold under the bell is the thing that
  // makes a white chedi read as a chedi and not as a grain silo.
  b.prism(square(r, R * 0.26), z0 + 0.56 * H, z0 + 0.62 * H, mat === "plaster" ? C.gold : body);
  const rings = [];
  for (let k = 0; k < 9; k++) {
    const z = 0.62 + k * 0.024, rad = 0.17 - k * 0.012;
    rings.push([z, rad], [z + 0.012, rad + 0.012]);
  }
  rings.push([0.84, 0.06], [0.88, 0.05], [0.9, 0.065], [0.93, 0.03], [1, 4e-3]);
  b.lathe(r.cx, r.cy, P(rings), 16, phase, (z) => z > z0 + 0.83 * H || mat === "gold" ? C.gold : body);
}
function prang(b, r, z0, H, mat) {
  const R = Math.min(r.hl, r.hw);
  const body = bodyOf(mat);
  [[1, 0, 0.1], [0.84, 0.1, 0.2], [0.7, 0.2, 0.28]].forEach(([s, a, c]) => b.prism(square(r, R * s), z0 + a * H, z0 + c * H, body));
  b.prism(square(r, R * 0.52), z0 + 0.28 * H, z0 + 0.48 * H, body);
  const prof = [];
  for (let k = 0; k < 7; k++) {
    const z = 0.48 + k * 0.06, rk = 0.48 * (1 - 0.12 * k), rn = 0.48 * (1 - 0.12 * (k + 1));
    prof.push([z, rk * 0.86], [z + 0.012, rk], [z + 0.045, rk * 0.94], [z + 0.06, rn * 0.86]);
  }
  prof.push([0.9, 0.06], [0.97, 0.025], [1, 4e-3]);
  const phase = Math.atan2(r.uy, r.ux) + Math.PI / 8;
  b.lathe(
    r.cx,
    r.cy,
    prof.map(([z, k]) => [z0 + z * H, R * k]),
    8,
    phase,
    (z) => z > z0 + 0.9 * H ? lightOf("gold") : body
  );
}
function mondop(b, r, z0, H, mat) {
  const R = Math.min(r.hl, r.hw);
  const body = bodyOf(mat);
  b.prism(square(r, R), z0, z0 + 0.1 * H, C.plinth);
  b.prism(square(r, R * 0.88), z0 + 0.1 * H, z0 + 0.2 * H, C.plinth);
  b.prism(square(r, R * 0.72), z0 + 0.2 * H, z0 + 0.46 * H, body);
  let z = z0 + 0.46 * H;
  const steps = 8, dz = 0.44 * H / steps;
  for (let k = 0; k < steps; k++) {
    const s = R * (0.78 - k * 0.085);
    // A mondop is a stack of the same roof, not a stack of gold. The tiers are
    // the material; only the finial at the very top is gilded.
    b.prism(square(r, s * 1.1), z, z + dz * 0.25, shadeOf(mat));
    b.prism(square(r, s), z + dz * 0.25, z + dz, body);
    z += dz;
  }
  b.lathe(r.cx, r.cy, [[z, R * 0.06], [z0 + H, R * 4e-3]], 8, 0, () => lightOf("gold"));
}
function cruciform(b, r, z0, H, tiers, mat = "plaster") {
  const across = { ...r, ux: -r.uy, uy: r.ux, hl: r.hw, hw: r.hl * 0.42 };
  hall(b, { ...r, hw: r.hw * 0.42 }, z0, H, tiers, false, mat);
  hall(b, across, z0, H, tiers, false, mat);
}
// Loha Prasat — วัดราชนัดดาราม's Metal Palace. Three square iron terraces
// carrying 37 spires: 24 on the ground tier (two rings of twelve), 8 on the
// middle, 4 above, and the crown spire at the very top. The count is the
// building's own (one per the Buddha's 37 virtues towards enlightenment);
// every proportion between footprint and spire is a typological reading.
function lohaPrasat(b, r, z0, H) {
  const R = Math.max(r.hl, r.hw);
  const tiers = [
    { half: R * 0.92, from: z0, to: z0 + 0.34 * H },
    { half: R * 0.64, from: z0 + 0.34 * H, to: z0 + 0.62 * H },
    { half: R * 0.40, from: z0 + 0.62 * H, to: z0 + 0.84 * H },
  ];
  for (const tier of tiers) b.prism(square(r, tier.half), tier.from, tier.to, bodyOf("iron"));
  // Spire lathe: a thin tapering metal cone with a collar, iron-shaded.
  const spire = (cx, cy, zBase, h, crown) => {
    const col = crown ? C.ironShade : C.iron;
    b.lathe(cx, cy, [
      [zBase, h * 0.16],
      [zBase + h * 0.35, h * 0.12],
      [zBase + h * 0.55, h * 0.14],
      [zBase + h * 0.8, h * 0.05],
      [zBase + h, 0],
    ], 6, 0, () => col);
  };
  // Twelve positions around a square: three per side, t in [0,1) walking
  // the perimeter. positions(half, 12).
  const positions = (half, n) => {
    const pts = [];
    const per = half * 8;
    for (let k = 0; k < n; k++) {
      let d = (k / n) * per;
      const seg = half * 2;
      let x;
      let y;
      if (d < seg) { x = -half + d; y = -half; }
      else if (d < seg * 2) { x = half; y = -half + (d - seg); }
      else if (d < seg * 3) { x = half - (d - seg * 2); y = half; }
      else { x = -half; y = half - (d - seg * 3); }
      pts.push([x, y]);
    }
    return pts;
  };
  const place = ([x, y], rRef) => {
    // Square-local coordinates back through the fitted rect axes.
    return at(rRef, x, y);
  };
  for (const [x, y] of positions(tiers[0].half, 12)) spire(...place([x, y], r), tiers[0].to, H * 0.16, false);
  for (const [x, y] of positions(tiers[0].half * 0.58, 12)) spire(...place([x, y], r), tiers[0].to, H * 0.14, false);
  for (const [x, y] of positions(tiers[1].half * 0.82, 8)) spire(...place([x, y], r), tiers[1].to, H * 0.16, false);
  for (const [x, y] of positions(tiers[2].half * 0.7, 4)) spire(...place([x, y], r), tiers[2].to, H * 0.15, false);
  spire(r.cx, r.cy, tiers[2].to, H * 0.16, true);
}
function fort(b, local, r, z0, H) {
  const wallTop = z0 + 0.62 * H;
  b.prism(local, z0, wallTop, bodyOf("plaster"));
  // Which way is out? The footprint's winding decides which side of a wall
  // is the street, and a merlon must sit on the wall — not half in it and
  // half in the road.
  let area = 0;
  for (let i = 0; i < local.length; i++) {
    const [x0, y0] = local[i];
    const [x1, y1] = local[(i + 1) % local.length];
    area += x0 * y1 - x1 * y0;
  }
  const sgn = area >= 0 ? 1 : -1;
  for (let i = 0; i < local.length; i++) {
    const [x0, y0] = local[i], [x1, y1] = local[(i + 1) % local.length];
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / 1.8);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len, w = 0.35;
    const ox = uy * sgn, oy = -ux * sgn;
    for (let k = 0; k < n; k++) {
      const cx = x0 + ux * (k + 0.5) * 1.8 - ox * w;
      const cy = y0 + uy * (k + 0.5) * 1.8 - oy * w;
      b.prism([
        [cx - ux * w - uy * w, cy - uy * w + ux * w],
        [cx + ux * w - uy * w, cy + uy * w + ux * w],
        [cx + ux * w + uy * w, cy + uy * w - ux * w],
        [cx - ux * w + uy * w, cy - uy * w - ux * w]
      ], wallTop, wallTop + 0.9, bodyOf("plaster"));
    }
  }
  const pav = { ...r, hl: Math.max(1.5, r.hl * 0.3), hw: Math.max(1.2, r.hw * 0.3) };
  hall(b, pav, wallTop, H * 0.38, 1, true, "plaster");
}
function buildForm(spec) {
  const b = new Builder();
  const local = openRing(spec.ring).map(toLocal);
  const r = fitRectInside(local);
  const { base: z0, height: H } = spec;
  switch (spec.kind) {
    case "hall":
      hall(b, r, z0, H, spec.tiers, false, spec.material);
      break;
    case "sala":
      hall(b, r, z0, H, 1, true, spec.material);
      break;
    case "chedi":
      chedi(b, r, z0, H, spec.material, spec.material === "ceramic");
      break;
    case "prang":
      prang(b, r, z0, H, spec.material);
      break;
    case "mondop":
      mondop(b, r, z0, H, spec.material);
      break;
    case "prasat":
      cruciform(b, r, z0, H * 0.55, 2, spec.material);
      prang(b, { ...r, hl: Math.min(r.hl, r.hw) * 0.42, hw: Math.min(r.hl, r.hw) * 0.42 }, z0 + 0.45 * H, 0.55 * H, "gold");
      break;
    case "loha":
      lohaPrasat(b, r, z0, H);
      break;
    case "throne": {
      const roofH = spec.spires ? H * 0.6 : H;
      if (spec.spires === 1 && r.hl / r.hw < 1.5) cruciform(b, r, z0, roofH, spec.tiers, spec.material);
      else hall(b, r, z0, roofH, spec.tiers, false, spec.material);
      const sp = Math.min(r.hw, r.hl) * 0.34;
      const spots = spec.spires === 3 ? [-0.6, 0, 0.6] : spec.spires === 1 ? [0] : [];
      for (const f of spots) {
        const [cx, cy] = at(r, f * r.hl, 0);
        mondop(b, { ...r, cx, cy, hl: sp, hw: sp }, z0 + 0.5 * H, 0.5 * H, "gold");
      }
      break;
    }
    case "fort":
      fort(b, local, r, z0, H);
      break;
    case "shophouse":
      shophouse(b, r, z0, H, spec.tiers);
      break;
  }
  return { positions: b.positions, colors: b.colors };
}
const ATTHAMAHA_PRANGS = [
  "พระสัมมาสัมพุทธมหาเจดีย์",
  "พระสัทธรรมปริยัติวรมหาเจดีย์",
  "พระอริยสงฆ์สาวกมหาเจดีย์",
  "พระอริยสาวิกาภิกษุสังฆมหาเจดีย์",
  "พระปัจเจกโพธิสัมพุทธมหาเจดีย์",
  "พระบรมจักรวรรดิราชามหาเจดีย์",
  "พระโพธิสัตวมหาเจดีย์",
  "พระศรีอริยเมตไตรยมหาเจดีย์"
];
const GOLD_CHEDI = ["พระศรีรัตนเจดีย์", "พระสุวรรณเจดีย์", "พระมหาเจดีย์ดิลกธรรมกรกนิทาน"];
// The two great chedis of the Old Town that are clad in coloured glass
// mosaic rather than stucco. A famous monument's material is a fact about
// that monument, so it is named rather than inferred from a rule.
const GLASS_CHEDI = ["พระโพธิสัตว์กฤษฎามหาเจดีย์", "พระมหาเจดีย์มุนีบัตบริขาร"];
const THAI_THRONE_HALLS = [
  "พระที่นั่งอมรินทรวินิจฉัย",
  "พระที่นั่งไพศาลทักษิณ",
  "พระที่นั่งจักรพรรดิพิมาน",
  "พระที่นั่งราชกรัณยสภา"
];
const THAI_THRONE_PAVILIONS = ["พระที่นั่งดุสิตาภิรมย์", "พระที่นั่งราชฤดี", "พระที่นั่งไชยชุมพล", "พระที่นั่งสีตลาภิรมย์"];
function outerRing(f) {
  const g = f.geometry;
  if (g?.type === "Polygon") return g.coordinates[0] ?? null;
  if (g?.type === "MultiPolygon") {
    let best = null, bestA = -1;
    for (const p of g.coordinates) {
      const a = polygonArea(openRing(p[0]).map(toLocal));
      if (a > bestA) {
        bestA = a;
        best = p[0];
      }
    }
    return best;
  }
  return null;
}
function shapeOf(ring) {
  const local = openRing(ring).map(toLocal);
  const r = fitRect(local);
  const area = polygonArea(local);
  return { area, aspect: r.hl / Math.max(r.hw, 0.01), fill: area / Math.max(4 * r.hl * r.hw, 0.01), vertices: local.length };
}
/**
 * The material of a hall, read off its name.
 *
 * A wat's scripture hall says what it is made of: วิหารไม้, อุโบสถไม้สัก.
 * A hall whose name says nothing is a whitewashed brick one. The name is the
 * evidence, and where there is none the default stands.
 */
function hallMaterial(n) {
  return n.includes("ไม้") ? "teak" : "plaster";
}
/**
 * The material of a mondop.
 *
 * หอไตร, หอระฆัง and มณเฑียร are the timber scripture halls and towers of
 * the Rattanakosin wats. A มณฑป is a masonry scripture pavilion. The two
 * spellings of มณเฑียร are both accepted: the OpenStreetMap names spell it
 * with a ท in places, and a typo must not cost a building its material.
 */
function mondopMaterial(n) {
  const timber = n.includes("หอไตร") || n.includes("หอระฆัง") || n.includes("มณเฑียร") || n.includes("มณเทียร");
  if (timber) return "teak";
  return "plaster";
}
function classify(f) {
  const p = f.properties;
  const ring = outerRing(f);
  if (!ring || ring.length < 4) return null;
  const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
  const building = String(p.building_type ?? p.building ?? "");
  const height = Number(p.height ?? 0);
  const base = Number(p.base_height ?? 0) || 0;
  if (!(height > base + 2)) return null;
  const s = shapeOf(ring);
  const spec = (kind, extra = {}) => ({
    id: String(p.id),
    kind,
    name,
    nameEn: null,
    ring,
    base,
    height: height - base,
    tiers: 1,
    spires: 0,
    material: "plaster",
    confidence: name ? "named" : "inferred",
    heightSource: typeof p.height_source === "string" ? p.height_source : null,
    heightConfidence: null,
    osmId: String(p.id ?? "").replace(/^bkk-building-/, "") || null,
    ...extra
  });
  const n = name ?? "";
  // The Metal Palace before the generic prasat: โลหะปราสาท contains
  // "ปราสาท" and would otherwise classify as a cruciform hall, which reads
  // nothing like the building. Its own form is the 37 iron spires.
  if (n.includes("โลหะปราสาท")) return spec("loha", { material: "iron" });
  if (ATTHAMAHA_PRANGS.some((x) => n.includes(x)) || n.includes("ปรางค์")) return spec("prang", { material: "ceramic" });
  if (GOLD_CHEDI.some((x) => n.includes(x))) return spec("chedi", { material: "gold" });
  if (GLASS_CHEDI.some((x) => n.includes(x))) return spec("chedi", { material: "glass" });
  if (n.includes("พระที่นั่ง")) {
    if (THAI_THRONE_HALLS.some((x) => n.includes(x))) return spec("hall", { tiers: 3, material: "plaster" });
    if (THAI_THRONE_PAVILIONS.some((x) => n.includes(x))) return spec("hall", { tiers: 2, material: "plaster" });
    if (!n.includes("ปราสาท")) return null;
    return spec("throne", { tiers: 3, spires: n.includes("จักรี") ? 3 : 1, material: "plaster" });
  }
  if (n.includes("ปราสาท")) return spec("prasat", { material: "plaster" });
  if (n.includes("เจดีย์")) return spec("chedi", { material: "plaster" });
  // มณเฑียร (a scripture repository / library, as at Wat Suthat) is a mondop
  // in plan and spire even though it is a different kind of building.
  if (n.includes("มณฑป") || n.includes("มณเฑียร") || n.includes("หอไตร") || n.includes("หอระฆัง")) {
    return spec("mondop", { material: mondopMaterial(n) });
  }
  if (n.includes("ป้อม")) return spec("fort", { material: "plaster" });
  if (/อุโบสถ|โบสถ์|วิหาร/.test(n)) return spec("hall", { tiers: s.area < 150 ? 2 : 3, material: hallMaterial(n) });
  if (n.includes("หอพระ")) return spec("hall", { tiers: 2, material: hallMaterial(n) });
  if (n.includes("เปรียญ")) return spec("hall", { tiers: 2, material: hallMaterial(n) });
  if (n.includes("ศาลา") || n.includes("พลับพลา")) {
    const civic = ["commercial", "retail", "office", "theatre", "government", "civic", "hotel", "public"].includes(building);
    if (!(s.area >= 12 && s.area <= 400 && !civic)) return null;
    // A ศาลา is a timber pavilion; a พลับพลา is a masonry one.
    return spec("sala", { material: n.includes("พลับพลา") ? "plaster" : "teak" });
  }
  if (name) return null;
  if (!["temple", "chapel"].includes(building)) return null;
  if (s.aspect >= 1.3 && s.area >= 100) return spec("hall", { tiers: s.area > 500 ? 3 : s.area > 200 ? 2 : 1, material: "plaster" });
  if (s.vertices >= 8 && s.aspect < 1.2 && s.fill > 0.68 && s.fill < 0.86 && s.area <= 900) return spec("chedi", { material: "plaster" });
  return null;
}
/**
 * Shophouse row candidates → shophouse forms.
 *
 * These are morphology-detected row units from BKKx's Overture screen, NOT a
 * heritage survey. Every one is `review_status: "unverified candidate"` and
 * `not_heritage_designation: true`, so they are always "inferred" and never
 * "named" here.
 *
 * Only candidates that carry a real Overture storey count are rendered. The
 * rest were screened on a modal storey height that was never written down, so
 * their height is unknown; inventing one would put a fabricated number on a
 * building. Unknown stays unknown — they are skipped, not zeroed.
 *
 * Height = storeys × STOREY_M, where STOREY_M is the same 3.15 m the atlas
 * already uses for building massing. That is an assumption, and the spec says
 * so in `heightSource` so a click can admit it.
 */
const STOREY_M = 3.15;
function classifyShophouse(f) {
  const p = f.properties ?? {};
  const ring = outerRing(f);
  if (!ring || ring.length < 4) return null;
  const floors = Number(p.num_floors);
  if (!Number.isFinite(floors) || floors < 1 || floors > 6) return null;
  if (p.height_basis !== "overture-storeys") return null;
  const s = shapeOf(ring);
  if (s.area < 8 || s.area > 900) return null;
  return {
    id: String(p.overture_id ?? p.id ?? ""),
    kind: "shophouse",
    name: p.name ?? p.cluster_name ?? null,
    nameEn: null,
    ring,
    base: 0,
    height: floors * STOREY_M,
    tiers: Math.round(floors),
    spires: 0,
    material: "shophouse",
    confidence: "inferred",
    heightSource: `overture-storeys x ${STOREY_M} m (assumed storey)`,
    heightConfidence: null,
    osmId: String(p.detail_box_id ?? "").replace(/^bkk-building-/, "") || null,
    replaces: { detail: [], hero: [] },
    shophouse: {
      cluster: p.cluster_name ?? null,
      strength: p.candidate_strength ?? null,
      review: p.review_status ?? "unverified candidate",
      notHeritage: p.not_heritage_designation === true,
      floors,
    },
  };
}

function heroForms(heroFeatures, detailByOsm) {
  const groups = /* @__PURE__ */ new Map();
  for (const f of heroFeatures) {
    const id = String(f.properties.id);
    const key = id.match(/^wat-arun-(central|satellite-\d)/)?.[0] ?? String(f.properties.hero_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const KIND = {
    "wat-arun-central": ["prang", "ceramic"],
    "wat-arun-satellite-1": ["prang", "ceramic"],
    "wat-arun-satellite-2": ["prang", "ceramic"],
    "wat-arun-satellite-3": ["prang", "ceramic"],
    "wat-arun-satellite-4": ["prang", "ceramic"],
    "grand-palace-siratana-chedi": ["chedi", "gold"],
    "grand-palace-phra-mondop": ["mondop", "gold"],
    "grand-palace-thepbidorn": ["prasat", "gold"],
    "wat-pho-srisanphetdayan": ["chedi", "ceramic"],
    "wat-pho-dilok": ["chedi", "ceramic"],
    "wat-pho-munibat": ["chedi", "ceramic"],
    "wat-pho-srisuriyothai": ["chedi", "ceramic"],
    "dusit-maha-prasat": ["throne", "plaster", { tiers: 3, spires: 1 }],
    "aphonphimok-prasat": ["throne", "plaster", { tiers: 2, spires: 1 }],
    "siwalai-maha-prasat": ["throne", "plaster", { tiers: 3, spires: 1 }]
    // Loha Prasat (37 spires) and the Golden Mount (a chedi on a hill) keep
    // their survey boxes: a generic form would say less than the boxes do.
  };
  const out = [];
  for (const [key, parts] of groups) {
    const kind = KIND[key];
    if (!kind) continue;
    const p0 = parts[0].properties;
    const detail = detailByOsm.get(String(p0.osm_id));
    let ring = detail ? outerRing(detail) : null;
    if (!ring) {
      let bestA = -1;
      for (const f of parts) {
        const rr = outerRing(f);
        const a = rr ? polygonArea(openRing(rr).map(toLocal)) : 0;
        if (rr && a > bestA) {
          bestA = a;
          ring = rr;
        }
      }
    }
    if (!ring) continue;
    const base = Math.min(...parts.map((f) => Number(f.properties.base_height ?? 0)));
    const top = Math.max(...parts.map((f) => Number(f.properties.height ?? 0)));
    out.push({
      id: `form-${key}`,
      kind: kind[0],
      name: String(p0.name ?? "") || null,
      nameEn: String(p0.name_en ?? "") || null,
      ring,
      base,
      height: top - base,
      tiers: 1,
      spires: 0,
      material: kind[1],
      confidence: "envelope",
      heightSource: typeof p0.height_source === "string" ? p0.height_source : null,
      heightConfidence: typeof p0.height_confidence === "string" ? p0.height_confidence : null,
      osmId: p0.osm_id != null ? String(p0.osm_id) : null,
      replaces: { detail: detail ? [String(detail.properties.id)] : [], hero: parts.map((f) => String(f.properties.id)) },
      ...kind[2] ?? {}
    });
  }
  return out;
}
export {
  ORIGIN,
  buildForm,
  classify,
  classifyShophouse,
  earClip,
  fitRect,
  fitRectInside,
  heroForms,
  openRing,
  outerRing,
  polygonArea,
  shapeOf,
  toLocal
};
