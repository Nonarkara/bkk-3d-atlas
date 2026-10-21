// Signature skyline forms — famous Bangkok buildings drawn as themselves.
//
// A tiered box says "a tall building". Mahanakhon's carved glass ribbon,
// Baiyoke's crowned shaft and spire, and the State Tower's golden dome say
// WHICH building. These forms are keyed to the curated modern-icons registry
// (scripts/apply-modern-icons.py) and consume the same real OSM footprint the
// massing layer uses. Everything between footprint and silhouette — tier
// counts, ribbon pitch, dome radius — is a typological reading, and the
// source line the registry recorded travels on the feature so the popup can
// say where the height came from. No texture, no survey claim.
//
// Builders write into the same MeshDraft groups the generic tower path uses
// ('body' steel, 'crown' paper, 'roof' gold/paper) plus an edge list, so the
// massing layer's materials and picking need no changes.

import { MeshDraft, scaleAbout, MASSING_PALETTE } from './building-massing.js';

export const CITY_ICON_KINDS = ['mahanakhon', 'baiyoke-ii', 'state-tower'];

// Match by registry id first, then OSM way id, so a re-curation that renames
// ids still matches on the way and vice versa.
const BY_KEY = {
  'icon-mahanakhon': 'mahanakhon',
  444651219: 'mahanakhon',
  'icon-baiyoke-tower-ii': 'baiyoke-ii',
  443491487: 'baiyoke-ii',
  'icon-state-tower': 'state-tower',
  25805374: 'state-tower',
};

export function cityIconKindFor(props) {
  if (!props) return null;
  for (const key of [props.id, props.osm_id]) {
    if (key == null || key === '') continue;
    const asNumber = typeof key === 'string' && /^\d+$/.test(key) ? Number(key) : key;
    const kind = BY_KEY[key] ?? BY_KEY[asNumber];
    if (kind) return kind;
  }
  return null;
}

function centroid(ring) {
  let cx = 0;
  let cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  return [cx / ring.length, cz / ring.length];
}

function maxRadius(ring, cx, cz) {
  let r = 0;
  for (const p of ring) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cz));
  return r;
}

// Radius of the first ring-boundary crossing along a ray from (cx, cz) at
// angle t (0 = +x/east, radians, z grows southward). Cramer's rule on
// ray × edge; null when the ray misses every edge.
function rayRadius(ring, cx, cz, t) {
  const dx = Math.cos(t);
  const dz = Math.sin(t);
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    const ex = x1 - x0;
    const ez = z1 - z0;
    const det = ex * dz - dx * ez;
    if (Math.abs(det) < 1e-9) continue;
    const wx = x0 - cx;
    const wz = z0 - cz;
    const s = (ex * wz - wx * ez) / det;
    const u = (dx * wz - dz * wx) / det;
    if (s > 0 && u >= 0 && u <= 1 && (best === null || s < best)) best = s;
  }
  return best;
}

// Walls between two rings at two heights — the prism the MeshDraft walls()
// cannot express, needed for dome and taper bands.
function band(draft, name, lower, upper, y0, y1) {
  const n = Math.min(lower.length, upper.length);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = lower[i];
    const b = lower[j];
    const c = upper[j];
    const d = upper[i];
    draft.quad(
      name,
      { x: a[0], y: y0, z: a[1] },
      { x: b[0], y: y0, z: b[1] },
      { x: c[0], y: y1, z: c[1] },
      { x: d[0], y: y1, z: d[1] },
    );
  }
}

function boxRing(cx, cz, half, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [cx - half * c + half * s, cz - half * s - half * c],
    [cx + half * c + half * s, cz + half * s - half * c],
    [cx + half * c - half * s, cz + half * s + half * c],
    [cx - half * c - half * s, cz - half * s + half * c],
  ];
}

// King Power MahaNakhon — the carved tower. A subtly tapering shaft wrapped
// in a helical ribbon of glass blocks that protrude past the facade, under a
// flat full-width observation deck (the SkyWalk).
function buildMahanakhon(draft, local, height, base, lod) {
  const span = height - base;
  const [cx, cz] = centroid(local);
  const shaftTop = base + span * 0.87;
  const tiers = [
    { from: base, to: base + span * 0.32, scale: 1 },
    { from: base + span * 0.32, to: base + span * 0.60, scale: 0.955 },
    { from: base + span * 0.60, to: shaftTop, scale: 0.91 },
  ];
  for (const tier of tiers) {
    const ring = scaleAbout(local, tier.scale);
    draft.walls('body', ring, tier.from, tier.to);
    draft.cap('crown', ring, tier.to);
  }
  // The SkyWalk: full-width flat deck, the widest slice of the tower.
  const deck = scaleAbout(local, 1);
  draft.walls('body', deck, shaftTop, height);
  draft.cap('roof', deck, height);

  // The pixel ribbon: one helical band, about two-and-a-half turns, of glass
  // blocks standing proud of the facade. The real carving is irregular; a
  // helix is the honest typological simplification and reads at street zoom.
  const count = lod >= 1 ? 52 : 20;
  const blockSize = Math.max(4, span * 0.032);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const y = base + span * (0.05 + 0.78 * t);
    const angle = t * Math.PI * 4.4;
    const tierScale = y <= tiers[0].to ? tiers[0].scale : y <= tiers[1].to ? tiers[1].scale : tiers[2].scale;
    const r = rayRadius(local, cx, cz, angle) ?? maxRadius(local, cx, cz);
    const px = cx + Math.cos(angle) * r * tierScale;
    const pz = cz + Math.sin(angle) * r * tierScale;
    const half = blockSize / 2;
    const ring = boxRing(
      px + Math.cos(angle) * half * 0.55,
      pz + Math.sin(angle) * half * 0.55,
      half,
      angle,
    );
    draft.walls('crown', ring, y - half, y + half);
    draft.cap('crown', ring, y + half);
  }
}

// Baiyoke Sky II — the crowned shaft. Round tiers step in, a glass crown
// drum caps them, a dome sits on the drum, and a spire carries the total to
// 304 m.
function buildBaiyokeII(draft, local, height, base, lod) {
  const span = height - base;
  const [cx, cz] = centroid(local);
  const tiers = [
    { from: base, to: base + span * 0.50, scale: 1 },
    { from: base + span * 0.50, to: base + span * 0.68, scale: 0.86 },
    { from: base + span * 0.68, to: base + span * 0.82, scale: 0.72 },
  ];
  for (const tier of tiers) {
    const ring = scaleAbout(local, tier.scale);
    draft.walls('body', ring, tier.from, tier.to);
    draft.cap('crown', ring, tier.to);
  }
  // Crown drum.
  const drumTop = base + span * 0.90;
  const drum = scaleAbout(local, 0.5);
  draft.walls('crown', drum, tiers[tiers.length - 1].to, drumTop);
  draft.cap('crown', drum, drumTop);
  // Dome over the drum.
  const domeBase = drumTop;
  const domeR = maxRadius(drum, cx, cz);
  const domeTop = domeBase + span * 0.045;
  const steps = lod >= 1 ? 5 : 3;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const r0 = domeR * Math.sqrt(Math.max(0, 1 - t0 * t0));
    const r1 = domeR * Math.sqrt(Math.max(0, 1 - t1 * t1));
    const ring0 = scaleAbout(drum, domeR > 0 ? r0 / domeR : 0);
    const ring1 = scaleAbout(drum, domeR > 0 ? r1 / domeR : 0);
    band(draft, 'roof', ring0, ring1, domeBase + t0 * (domeTop - domeBase), domeBase + t1 * (domeTop - domeBase));
    if (i === steps - 1) draft.cap('roof', ring1, domeTop);
  }
  // Spire to the full 304 m.
  const spire = scaleAbout(local, 0.09);
  draft.walls('crown', spire, domeTop, height);
  draft.cap('crown', spire, height);
}

// State Tower — the stepped shaft under the golden dome. Silom's most
// recognisable silhouette: wide podium, two setbacks, then the dome the
// skyline knows from every point on the river.
function buildStateTower(draft, local, height, base, lod) {
  const span = height - base;
  const [cx, cz] = centroid(local);
  const tiers = [
    { from: base, to: base + span * 0.40, scale: 1 },
    { from: base + span * 0.40, to: base + span * 0.66, scale: 0.88 },
    { from: base + span * 0.66, to: base + span * 0.82, scale: 0.74 },
  ];
  for (const tier of tiers) {
    const ring = scaleAbout(local, tier.scale);
    draft.walls('body', ring, tier.from, tier.to);
    draft.cap('crown', ring, tier.to);
  }
  // Dome drum + hemisphere in gold, finial to the top.
  const drumBase = base + span * 0.82;
  const drumTop = base + span * 0.88;
  const drum = scaleAbout(local, 0.24);
  draft.walls('roof', drum, drumBase, drumTop);
  const domeR = maxRadius(drum, cx, cz);
  const domeTop = drumTop + span * 0.075;
  const steps = lod >= 1 ? 4 : 3;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const r0 = domeR * Math.sqrt(Math.max(0, 1 - t0 * t0));
    const r1 = domeR * Math.sqrt(Math.max(0, 1 - t1 * t1));
    const ring0 = scaleAbout(drum, domeR > 0 ? r0 / domeR : 0);
    const ring1 = scaleAbout(drum, domeR > 0 ? r1 / domeR : 0);
    band(draft, 'roof', ring0, ring1, drumTop + t0 * (domeTop - drumTop), drumTop + t1 * (domeTop - drumTop));
    if (i === steps - 1) draft.cap('roof', ring1, domeTop);
  }
  const finial = scaleAbout(local, 0.045);
  draft.walls('roof', finial, domeTop, height);
  draft.cap('roof', finial, height);
}

const BUILDERS = {
  mahanakhon: buildMahanakhon,
  'baiyoke-ii': buildBaiyokeII,
  'state-tower': buildStateTower,
};

/**
 * Build a signature form into a fresh MeshDraft.
 * Returns the same shape buildTowerBuffers returns, minus keys/origin/ring
 * which the caller already owns, or null when the kind is unknown.
 */
export function buildCityIcon(kind, local, height, base, lod = 1) {
  const build = BUILDERS[kind];
  if (!build) return null;
  const draft = new MeshDraft();
  const edges = [];
  if (lod >= 1 && local.length <= 48) {
    for (let i = 0; i < local.length; i++) {
      const a = local[i];
      const b = local[(i + 1) % local.length];
      edges.push(a[0], base, a[1], b[0], base, b[1]);
    }
  }
  build(draft, local, height, base, lod);
  return {
    body: draft.finish('body'),
    crown: draft.finish('crown'),
    roof: draft.finish('roof'),
    edges,
    // Real palette values, not group names: rebuildScene passes these
    // straight to three.js as material colors.
    colors: {
      body: MASSING_PALETTE.steel,
      crown: MASSING_PALETTE.paper,
      roof: kind === 'mahanakhon' ? MASSING_PALETTE.paper : MASSING_PALETTE.gold,
      edge: MASSING_PALETTE.ink,
    },
    icon: kind,
  };
}
