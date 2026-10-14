// Bake the Grand Palace / Wat Phra Kaew schematic GLB from OSM footprints
// already in bkk-heritage-detail.geojson. Each building stays on its own
// ring and centroid. Roof pitch, tier count, chofa, bell, mondop and prang
// proportions follow the CC photographs listed in CREDITS.md. The mesh is
// not a trace of those photographs. No textures. Gold is the roof, finial,
// and spire accent only.
//
//   node scripts/palace-standin.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GRAND_PALACE_SLOT } from '../public/grand-palace-slot.js';
import {
  MeshDraft,
  MASSING_PALETTE,
  addGableRoof,
  linearColor,
  longAxis,
  orientCCW,
  outerRingLngLat,
  scaleAbout,
  toLocal,
} from '../public/building-massing.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Keyed to heritage-detail ids already in the court set. Unlisted sheds stay blocks.
export const PALACE_FORM_BY_ID = {
  'bkk-building-23482983': 'hall', // พระอุโบสถ
  'bkk-building-229771451': 'hall', // หอพระคันธารราษฎร์
  'bkk-building-82541135': 'gallery', // phra rabiang, two roof tiers
  'bkk-building-782453374': 'hall',
  'bkk-building-782453375': 'hall',
  'bkk-building-782453376': 'hall',
  'bkk-building-782453377': 'hall',
  'bkk-building-782453378': 'hall',
  'bkk-building-782453379': 'hall',
  'bkk-building-782453380': 'hall',
  'bkk-building-782453381': 'hall',
  'bkk-building-782453382': 'hall',
  'bkk-building-782453383': 'hall',
  'bkk-building-782453384': 'hall',
  'bkk-building-782453385': 'hall',
  'bkk-building-782453386': 'hall',
  'bkk-building-782453410': 'hall',
  'bkk-building-23482988': 'chedi', // พระศรีรัตนเจดีย์
  'bkk-building-229771456': 'chedi', // พระสุวรรณเจดีย์
  'bkk-building-23482994': 'chedi',
  'bkk-building-23482995': 'chedi',
  'bkk-building-23482996': 'chedi',
  'bkk-building-23482997': 'chedi',
  'bkk-building-23482998': 'chedi',
  'bkk-building-782453387': 'chedi',
  'bkk-building-782453388': 'chedi',
  'bkk-building-782453389': 'chedi',
  'bkk-building-782453390': 'chedi',
  'bkk-building-782214614': 'chedi', // พระโพธิธาตุพิมาน
  'bkk-building-23482989': 'mondop', // พระมณฑป
  'bkk-building-229771450': 'mondop', // หอระฆัง, square plan
  'bkk-building-23482990': 'prang', // ปราสาทพระเทพบิดร
};

// Scales shrink each tier. Pitches steepen, in degrees, across the short side.
// The ubosot reference shows three overlapping tiers; the gallery shows two.
export const HALL_TIER_PLAN = {
  2: { scales: [1, 0.64], pitches: [48, 56] },
  3: { scales: [1, 0.72, 0.48], pitches: [46, 52, 58] },
};

export const GALLERY_TIER_PLAN = { scales: [1, 0.66], pitches: [40, 48] };

// How far up the lower slope the next eave begins, so the tiers overlap.
export const ROOF_OVERLAP = 0.42;

// Bell radius fractions from the foot of the bell to the neck. The middle is widest.
export const CHEDI_BELL = [0.52, 0.74, 0.92, 1, 0.9, 0.66, 0.4];

export function palaceFormFor(id) {
  return PALACE_FORM_BY_ID[id] ?? 'block';
}

export function hallTierPlan(count) {
  return HALL_TIER_PLAN[count === 3 ? 3 : 2];
}

export function standInKind(props) {
  return palaceFormFor(props?.id);
}

function localRing(feature) {
  const ring = outerRingLngLat(feature);
  if (!ring) return null;
  return orientCCW(ring.map(([lng, lat]) => toLocal(lng, lat, GRAND_PALACE_SLOT.anchor)));
}

function centerOf(ring) {
  let x = 0;
  let z = 0;
  for (const point of ring) { x += point[0]; z += point[1]; }
  return [x / ring.length, z / ring.length];
}

function axisSpan(ring) {
  const axis = longAxis(ring);
  let minA = Infinity;
  let maxA = -Infinity;
  let minP = Infinity;
  let maxP = -Infinity;
  for (const point of ring) {
    const along = (point[0] - axis.cx) * axis.ax + (point[1] - axis.cz) * axis.az;
    const across = (point[0] - axis.cx) * axis.px + (point[1] - axis.cz) * axis.pz;
    minA = Math.min(minA, along);
    maxA = Math.max(maxA, along);
    minP = Math.min(minP, across);
    maxP = Math.max(maxP, across);
  }
  return { axis, long: maxA - minA, wide: maxP - minP };
}

function planWidth(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minZ = Math.min(minZ, point[1]);
    maxZ = Math.max(maxZ, point[1]);
  }
  return Math.min(maxX - minX, maxZ - minZ);
}

function circleRing(cx, cz, radius, segments) {
  const ring = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    ring.push([cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius]);
  }
  return ring;
}

function squareRing(cx, cz, half) {
  return [
    [cx - half, cz - half],
    [cx + half, cz - half],
    [cx + half, cz + half],
    [cx - half, cz + half],
  ];
}

function connectRings(draft, material, lower, y0, upper, y1) {
  const count = Math.min(lower.length, upper.length);
  for (let i = 0; i < count; i++) {
    const a = lower[i];
    const b = lower[(i + 1) % count];
    const c = upper[(i + 1) % count];
    const d = upper[i];
    draft.quad(
      material,
      { x: a[0], y: y0, z: a[1] },
      { x: b[0], y: y0, z: b[1] },
      { x: c[0], y: y1, z: c[1] },
      { x: d[0], y: y1, z: d[1] },
    );
  }
}

function addChofa(draft, origin, outward, size) {
  // Hook: out and up, then the head curls back toward the roof.
  const spine = [
    [0, 0],
    [0.22, 0.48],
    [0.7, 1.15],
    [1.05, 1.75],
    [0.42, 2.28],
  ];
  const side = { x: -outward.z, z: outward.x };
  const half = Math.max(0.22, size * 0.34);
  const points = spine.map(([along, up]) => ({
    x: origin.x + outward.x * along * size,
    y: origin.y + up * size,
    z: origin.z + outward.z * along * size,
  }));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    draft.quad(
      'gold',
      { x: a.x + side.x * half, y: a.y, z: a.z + side.z * half },
      { x: b.x + side.x * half, y: b.y, z: b.z + side.z * half },
      { x: b.x - side.x * half, y: b.y, z: b.z - side.z * half },
      { x: a.x - side.x * half, y: a.y, z: a.z - side.z * half },
    );
    draft.quad(
      'gold',
      { x: a.x, y: a.y + half, z: a.z },
      { x: b.x, y: b.y + half, z: b.z },
      { x: b.x, y: b.y - half * 0.2, z: b.z },
      { x: a.x, y: a.y - half * 0.2, z: a.z },
    );
  }
}

function addBaiRaka(draft, ring, ridgeY, size) {
  const axis = longAxis(ring);
  let minT = Infinity;
  let maxT = -Infinity;
  for (const point of ring) {
    const along = (point[0] - axis.cx) * axis.ax + (point[1] - axis.cz) * axis.az;
    minT = Math.min(minT, along);
    maxT = Math.max(maxT, along);
  }
  const span = maxT - minT;
  if (span < 6) return;
  const count = Math.max(5, Math.min(9, Math.round(span / 5)));
  const inset = span * 0.14;
  const along = { x: axis.ax, z: axis.az };
  const side = { x: -axis.az, z: axis.ax };
  for (let i = 0; i < count; i++) {
    const t = minT + inset + ((span - inset * 2) * (i + 0.5)) / count;
    const x = axis.cx + axis.ax * t;
    const z = axis.cz + axis.az * t;
    const height = size * (0.75 + 0.25 * Math.sin((i / (count - 1)) * Math.PI));
    const half = Math.max(0.12, size * 0.28);
    draft.tri(
      'gold',
      { x: x - along.x * half, y: ridgeY, z: z - along.z * half },
      { x: x + along.x * half, y: ridgeY, z: z + along.z * half },
      { x, y: ridgeY + height, z },
    );
    draft.tri(
      'gold',
      { x: x + side.x * half * 0.45, y: ridgeY, z: z + side.z * half * 0.45 },
      { x: x - side.x * half * 0.45, y: ridgeY, z: z - side.z * half * 0.45 },
      { x, y: ridgeY + height, z },
    );
  }
}

function addTierChofa(draft, ring, ridgeY, size) {
  const axis = longAxis(ring);
  let minT = Infinity;
  let maxT = -Infinity;
  for (const point of ring) {
    const along = (point[0] - axis.cx) * axis.ax + (point[1] - axis.cz) * axis.az;
    minT = Math.min(minT, along);
    maxT = Math.max(maxT, along);
  }
  addChofa(draft, { x: axis.cx + axis.ax * maxT, y: ridgeY, z: axis.cz + axis.az * maxT }, { x: axis.ax, z: axis.az }, size);
  addChofa(draft, { x: axis.cx + axis.ax * minT, y: ridgeY, z: axis.cz + axis.az * minT }, { x: -axis.ax, z: -axis.az }, size);
}

export function addTieredHall(draft, ring, height, planOverride) {
  const span = axisSpan(ring);
  const plan = planOverride ?? hallTierPlan(span.wide >= 24 && span.long >= 40 ? 3 : 2);
  const wallTop = Math.max(2.4, Math.min(span.wide * 0.28, 8, Math.max(height, 2.4) * 0.45));
  draft.walls('steel', scaleAbout(ring, 0.86), 0, wallTop);
  let eaveY = wallTop;
  for (let i = 0; i < plan.scales.length; i++) {
    const scaled = scaleAbout(ring, plan.scales[i]);
    const half = (span.wide / 2) * plan.scales[i];
    const rise = Math.max(half * Math.tan(plan.pitches[i] * Math.PI / 180), 1.2);
    const ridge = eaveY + rise;
    addGableRoof(draft, 'gold', 'steel', scaled, eaveY, ridge);
    const finial = Math.min(Math.max(half * 0.15, 0.38), 1.55);
    addTierChofa(draft, scaled, ridge, finial);
    addBaiRaka(draft, scaled, ridge, Math.min(finial * 0.85, 1.15));
    eaveY += rise * ROOF_OVERLAP;
  }
}

export function addBellChedi(draft, ring, height) {
  const [cx, cz] = centerOf(ring);
  const width = planWidth(ring);
  const base = height * 0.22;
  const steps = width < 8 ? 2 : 3;
  for (let i = 0; i < steps; i++) {
    const scaled = scaleAbout(ring, 1 - i * 0.07);
    const y0 = (base / steps) * i;
    const y1 = (base / steps) * (i + 1);
    draft.walls('gold', scaled, y0, y1);
    draft.cap('gold', scaled, y1);
  }
  const segments = width < 10 ? 6 : 8;
  const bellRadius = width * 0.34;
  const bellTop = height * 0.58;
  let previous = null;
  let previousY = base;
  CHEDI_BELL.forEach((fraction, index) => {
    const y = base + (bellTop - base) * (index / (CHEDI_BELL.length - 1));
    const loop = circleRing(cx, cz, bellRadius * fraction, segments);
    if (previous) connectRings(draft, 'gold', previous, previousY, loop, y);
    previous = loop;
    previousY = y;
  });
  const harm = Math.max(bellRadius * 0.34, 0.4);
  const harmTop = height * 0.66;
  const harmRing = squareRing(cx, cz, harm);
  draft.walls('gold', harmRing, bellTop, harmTop);
  draft.cap('gold', harmRing, harmTop);
  const spireRings = width < 10 ? 5 : 8;
  let radius = bellRadius * 0.42;
  const spireSpan = height - harmTop;
  for (let i = 0; i < spireRings; i++) {
    const y0 = harmTop + spireSpan * (i / (spireRings + 0.35));
    const y1 = harmTop + spireSpan * ((i + 0.82) / (spireRings + 0.35));
    const mid = y0 + (y1 - y0) * 0.45;
    const disc = Math.max(radius, 0.08);
    connectRings(draft, 'gold', circleRing(cx, cz, disc * 0.86, segments), y0, circleRing(cx, cz, disc, segments), mid);
    connectRings(draft, 'gold', circleRing(cx, cz, disc, segments), mid, circleRing(cx, cz, disc * 0.78, segments), y1);
    radius *= 0.72;
  }
  const tipY = harmTop + spireSpan * (spireRings / (spireRings + 0.35));
  const tip = circleRing(cx, cz, Math.max(radius, 0.06), segments);
  const apex = { x: cx, y: height, z: cz };
  for (let i = 0; i < segments; i++) {
    const a = tip[i];
    const b = tip[(i + 1) % segments];
    draft.tri('gold', { x: a[0], y: Math.min(tipY, height), z: a[1] }, { x: b[0], y: Math.min(tipY, height), z: b[1] }, apex);
  }
}

export function addMondop(draft, ring, height) {
  const tiers = height >= 18 ? 7 : 4;
  const base = height * 0.22;
  draft.walls('steel', ring, 0, base * 0.62);
  draft.cap('paper', ring, base * 0.62);
  const plinth = scaleAbout(ring, 0.82);
  draft.walls('steel', plinth, base * 0.62, base);
  draft.cap('paper', plinth, base);
  const scales = [];
  const rises = [];
  for (let i = 0; i < tiers; i++) {
    scales.push(0.78 * (0.72 ** i));
    rises.push(0.8 + i * 0.28);
  }
  const riseSum = rises.reduce((sum, value) => sum + value, 0);
  let y = base;
  const budget = height - base;
  for (let i = 0; i < tiers; i++) {
    const scaled = scaleAbout(ring, scales[i]);
    if (i === tiers - 1) {
      const [cx, cz] = centerOf(scaled);
      const apex = { x: cx, y: height, z: cz };
      for (let k = 0; k < scaled.length; k++) {
        const a = scaled[k];
        const b = scaled[(k + 1) % scaled.length];
        draft.tri('gold', { x: a[0], y, z: a[1] }, { x: b[0], y, z: b[1] }, apex);
      }
      break;
    }
    const top = y + budget * (rises[i] / riseSum);
    draft.walls('gold', scaled, y, top);
    draft.cap('paper', scaled, top);
    y = top;
  }
}

export function addPrang(draft, ring, height) {
  const body = height * 0.26;
  draft.walls('steel', ring, 0, body);
  draft.cap('paper', ring, body);
  const [cx, cz] = centerOf(ring);
  let reach = 0;
  for (const point of ring) reach = Math.max(reach, Math.hypot(point[0] - cx, point[1] - cz));
  const segments = 8;
  const cobs = 7;
  let radius = Math.max(reach * 0.16, 1.1);
  const span = height - body;
  for (let i = 0; i < cobs; i++) {
    const y0 = body + span * (i / (cobs + 0.45));
    const y1 = body + span * ((i + 0.86) / (cobs + 0.45));
    const mid = y0 + (y1 - y0) * 0.48;
    const bulge = 1.08 + (1 - i / cobs) * 0.2;
    connectRings(draft, 'gold', circleRing(cx, cz, radius, segments), y0, circleRing(cx, cz, radius * bulge, segments), mid);
    connectRings(draft, 'gold', circleRing(cx, cz, radius * bulge, segments), mid, circleRing(cx, cz, radius * 0.78, segments), y1);
    radius *= 0.78;
  }
  const tipY = body + span * (cobs / (cobs + 0.45));
  const tip = circleRing(cx, cz, Math.max(radius, 0.08), segments);
  const apex = { x: cx, y: height, z: cz };
  for (let i = 0; i < segments; i++) {
    const a = tip[i];
    const b = tip[(i + 1) % segments];
    draft.tri('gold', { x: a[0], y: Math.min(tipY, height), z: a[1] }, { x: b[0], y: Math.min(tipY, height), z: b[1] }, apex);
  }
}

function addBlock(draft, ring, height) {
  draft.walls('steel', ring, 0, height);
  draft.cap('paper', ring, height);
}

export function buildPalaceDraft(heritage) {
  const byId = new Map();
  for (const feature of heritage?.features ?? []) {
    const id = feature?.properties?.id;
    if (id) byId.set(id, feature);
  }
  const draft = new MeshDraft();
  const used = [];
  const missing = [];
  const forms = {};
  for (const id of GRAND_PALACE_SLOT.hideIds) {
    const feature = byId.get(id);
    if (!feature) {
      missing.push(id);
      continue;
    }
    const ring = localRing(feature);
    const height = Number(feature.properties?.render_height ?? feature.properties?.height);
    if (!ring || !Number.isFinite(height) || height < 1 || height > 80) {
      missing.push(id);
      continue;
    }
    const kind = palaceFormFor(id);
    forms[id] = kind;
    if (kind === 'gallery') addTieredHall(draft, ring, height, GALLERY_TIER_PLAN);
    else if (kind === 'hall') addTieredHall(draft, ring, height);
    else if (kind === 'chedi') {
      const width = planWidth(ring);
      const proportional = width * 2.65;
      const chediHeight = height > proportional * 1.35 ? proportional : height;
      addBellChedi(draft, ring, chediHeight);
    }
    else if (kind === 'mondop') addMondop(draft, ring, height);
    else if (kind === 'prang') addPrang(draft, ring, height);
    else addBlock(draft, ring, height);
    used.push(id);
  }
  return { draft, used, missing, forms };
}

function typedBytes(view) {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function pad4(bytes, fill) {
  const extra = (4 - (bytes.length % 4)) % 4;
  if (!extra) return bytes;
  const out = Buffer.alloc(bytes.length + extra, fill);
  bytes.copy(out);
  return out;
}

export function packGlb(draft) {
  const materials = [
    { name: 'paper', hex: MASSING_PALETTE.paper },
    { name: 'steel', hex: MASSING_PALETTE.steel },
    { name: 'gold', hex: MASSING_PALETTE.gold },
  ];
  const parts = materials.map((material) => ({ ...material, geometry: draft.finish(material.name) })).filter((part) => part.geometry);
  if (!parts.length) throw new Error('palace stand-in produced no triangles');

  const binParts = [];
  let byteOffset = 0;
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  const matIndex = new Map(materials.map((material, index) => [material.name, index]));

  for (const part of parts) {
    const position = typedBytes(part.geometry.positions);
    const normal = typedBytes(part.geometry.normals);
    const positionOffset = byteOffset;
    binParts.push(position);
    byteOffset += position.length;
    const normalOffset = byteOffset;
    binParts.push(normal);
    byteOffset += normal.length;
    const positionView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: positionOffset, byteLength: position.length, target: 34962 });
    const normalView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: normalOffset, byteLength: normal.length, target: 34962 });
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: part.geometry.positions.length / 3,
      type: 'VEC3',
      min: part.geometry.min,
      max: part.geometry.max,
    });
    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: normalView,
      componentType: 5126,
      count: part.geometry.normals.length / 3,
      type: 'VEC3',
    });
    primitives.push({
      attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
      material: matIndex.get(part.name),
      mode: 4,
    });
  }

  const bin = Buffer.concat(binParts);
  const json = {
    asset: {
      version: '2.0',
      generator: 'bkk-3d-atlas palace stand-in',
      copyright: 'Schematic stand-in derived from © OpenStreetMap contributors, ODbL 1.0. Approximate model, not an official survey. No third-party textures.',
      extras: {
        standIn: true,
        note: GRAND_PALACE_SLOT.note,
        anchorFeatureId: GRAND_PALACE_SLOT.anchorFeatureId,
        units: 'metres',
        axes: '+X east, +Y up, +Z south',
      },
    },
    scene: 0,
    scenes: [{ nodes: [0], name: GRAND_PALACE_SLOT.name }],
    nodes: [{ mesh: 0, name: 'grand-palace-stand-in' }],
    meshes: [{ name: GRAND_PALACE_SLOT.name, primitives }],
    materials: materials.map((material) => ({
      name: material.name,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: linearColor(material.hex),
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };

  const jsonChunk = pad4(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad4(bin, 0x00);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const glb = Buffer.alloc(total);
  glb.write('glTF', 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(jsonChunk.length, 12);
  glb.writeUInt32LE(0x4E4F534A, 16);
  jsonChunk.copy(glb, 20);
  const binHeader = 20 + jsonChunk.length;
  glb.writeUInt32LE(binChunk.length, binHeader);
  glb.writeUInt32LE(0x004E4942, binHeader + 4);
  binChunk.copy(glb, binHeader + 8);
  return glb;
}

export function readGlbJson(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a glb');
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

function main() {
  const heritage = JSON.parse(readFileSync(join(root, 'public/bkk-heritage-detail.geojson'), 'utf8'));
  const { draft, used, missing } = buildPalaceDraft(heritage);
  if (missing.length) {
    console.error('Missing palace footprints:', missing.join(', '));
    process.exit(1);
  }
  const glb = packGlb(draft);
  const out = join(root, 'public/models/grand-palace.glb');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, glb);
  const compressed = `${out}.meshopt.glb`;
  const meshopt = spawnSync('npx', ['--yes', '@gltf-transform/cli@4.1.3', 'meshopt', out, compressed], { stdio: 'inherit' });
  if (meshopt.status === 0) {
    writeFileSync(out, readFileSync(compressed));
    unlinkSync(compressed);
  } else {
    console.warn('meshopt skipped; uncompressed GLB kept');
  }
  const triangles = ['paper', 'steel', 'gold'].reduce((sum, name) => {
    const geometry = draft.finish(name);
    return sum + (geometry ? geometry.positions.length / 9 : 0);
  }, 0);
  const bytes = readFileSync(out).length;
  console.log(`wrote ${out} (${bytes} bytes, ${used.length} footprints, ${triangles} triangles)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
