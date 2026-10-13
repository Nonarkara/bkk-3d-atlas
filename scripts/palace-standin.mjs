// Bake the Grand Palace / Wat Phra Kaew schematic GLB from OSM footprints
// already in bkk-heritage-detail.geojson. Each building stays on its own
// ring and centroid. The silhouettes are parametric Thai types chosen from
// the footprint's OSM id — roof tiers, a bell stupa, a mondop spire, a prang.
// They are not traced from photographs. Heights are the atlas tags.
// No textures. Gold is the roof, finial, and spire accent only.
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
  'bkk-building-82541135': 'hall', // gallery along the court
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

export const HALL_TIER_PLAN = {
  2: { scales: [1, 0.58], rises: [1, 1.6] },
  3: { scales: [1, 0.7, 0.44], rises: [1, 1.45, 1.95] },
};

// Bell radius fractions from the foot of the bell to the neck. The middle is widest.
export const CHEDI_BELL = [0.58, 0.9, 1, 0.84, 0.52, 0.3];

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

function minRadius(ring) {
  const [cx, cz] = centerOf(ring);
  let radius = Infinity;
  for (const point of ring) radius = Math.min(radius, Math.hypot(point[0] - cx, point[1] - cz));
  return radius;
}

function ringSpan(ring) {
  const axis = longAxis(ring);
  let minA = Infinity;
  let maxA = -Infinity;
  for (const point of ring) {
    const along = (point[0] - axis.cx) * axis.ax + (point[1] - axis.cz) * axis.az;
    minA = Math.min(minA, along);
    maxA = Math.max(maxA, along);
  }
  return { axis, long: maxA - minA };
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
  const spine = [
    [0, 0],
    [0.28, 0.42],
    [0.7, 1.05],
    [1.05, 1.55],
    [0.62, 1.92],
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

export function addTieredHall(draft, ring, height) {
  const tiers = height >= 16 && ringSpan(ring).long >= 14 ? 3 : 2;
  const plan = hallTierPlan(tiers);
  const tip = Math.min(Math.max(height * 0.16, 0.9), height * 0.22);
  const wallTop = height * 0.34;
  const budget = Math.max(height - tip - wallTop, height * 0.2);
  const riseSum = plan.rises.reduce((sum, value) => sum + value, 0);
  draft.walls('steel', ring, 0, wallTop);
  let y = wallTop;
  for (let i = 0; i < tiers; i++) {
    const rise = budget * (plan.rises[i] / riseSum);
    const ridge = i === tiers - 1 ? height - tip : y + rise;
    const scaled = scaleAbout(ring, plan.scales[i]);
    if (i > 0) draft.walls('steel', scaled, Math.max(wallTop, y - 0.2), y);
    addGableRoof(draft, 'gold', 'steel', scaled, y, ridge);
    const finial = (tip / 1.92) * (i === tiers - 1 ? 1 : 0.62);
    addTierChofa(draft, scaled, ridge, finial);
    y = ridge;
  }
}

export function addBellChedi(draft, ring, height) {
  const [cx, cz] = centerOf(ring);
  const foot = minRadius(ring);
  const base = height * 0.16;
  const steps = foot < 4 ? 2 : 3;
  for (let i = 0; i < steps; i++) {
    const scaled = scaleAbout(ring, 1 - i * 0.08);
    const y0 = (base / steps) * i;
    const y1 = (base / steps) * (i + 1);
    draft.walls('gold', scaled, y0, y1);
    draft.cap('gold', scaled, y1);
  }
  const segments = foot < 5 ? 6 : 8;
  const bellRadius = foot * 0.7;
  const bellTop = height * 0.56;
  let previous = null;
  let previousY = base;
  CHEDI_BELL.forEach((fraction, index) => {
    const y = base + (bellTop - base) * (index / (CHEDI_BELL.length - 1));
    const loop = circleRing(cx, cz, bellRadius * fraction, segments);
    if (previous) connectRings(draft, 'gold', previous, previousY, loop, y);
    previous = loop;
    previousY = y;
  });
  const harm = Math.max(bellRadius * 0.28, 0.35);
  const harmTop = height * 0.64;
  const harmRing = squareRing(cx, cz, harm);
  draft.walls('gold', harmRing, bellTop, harmTop);
  draft.cap('gold', harmRing, harmTop);
  const spireRings = foot < 5 ? 4 : 6;
  let radius = bellRadius * 0.34;
  const spireSpan = height - harmTop;
  for (let i = 0; i < spireRings; i++) {
    const y0 = harmTop + spireSpan * (i / (spireRings + 1));
    const y1 = harmTop + spireSpan * ((i + 1) / (spireRings + 1));
    const mid = y0 + (y1 - y0) * 0.45;
    connectRings(draft, 'gold', circleRing(cx, cz, radius * 0.72, segments), y0, circleRing(cx, cz, radius, segments), mid);
    connectRings(draft, 'gold', circleRing(cx, cz, radius, segments), mid, circleRing(cx, cz, radius * 0.7, segments), y1);
    radius *= 0.74;
  }
  const tipY = harmTop + spireSpan * (spireRings / (spireRings + 1));
  const tip = circleRing(cx, cz, Math.max(radius, 0.12), segments);
  const apex = { x: cx, y: height, z: cz };
  for (let i = 0; i < segments; i++) {
    const a = tip[i];
    const b = tip[(i + 1) % segments];
    draft.tri('gold', { x: a[0], y: tipY, z: a[1] }, { x: b[0], y: tipY, z: b[1] }, apex);
  }
}

export function addMondop(draft, ring, height) {
  const base = height * 0.3;
  draft.walls('steel', ring, 0, base * 0.55);
  draft.cap('paper', ring, base * 0.55);
  const plinth = scaleAbout(ring, 0.84);
  draft.walls('steel', plinth, base * 0.55, base);
  draft.cap('paper', plinth, base);
  const scales = [0.68, 0.5, 0.34, 0.2, 0.09];
  const rises = [0.75, 0.9, 1.1, 1.3, 1.55];
  const riseSum = rises.reduce((sum, value) => sum + value, 0);
  let y = base;
  const budget = height - base;
  for (let i = 0; i < scales.length; i++) {
    const scaled = scaleAbout(ring, scales[i]);
    const top = y + budget * (rises[i] / riseSum);
    if (i === scales.length - 1) {
      const [cx, cz] = centerOf(scaled);
      const apex = { x: cx, y: height, z: cz };
      for (let k = 0; k < scaled.length; k++) {
        const a = scaled[k];
        const b = scaled[(k + 1) % scaled.length];
        draft.tri('gold', { x: a[0], y, z: a[1] }, { x: b[0], y, z: b[1] }, apex);
      }
      break;
    }
    draft.walls('gold', scaled, y, top);
    draft.cap('paper', scaled, top);
    y = top;
  }
}

export function addPrang(draft, ring, height) {
  const body = height * 0.32;
  draft.walls('steel', ring, 0, body);
  draft.cap('paper', ring, body);
  const [cx, cz] = centerOf(ring);
  let reach = 0;
  for (const point of ring) reach = Math.max(reach, Math.hypot(point[0] - cx, point[1] - cz));
  const segments = 8;
  const cobs = 6;
  let radius = Math.max(reach * 0.22, 1.2);
  const span = height - body;
  for (let i = 0; i < cobs; i++) {
    const y0 = body + span * (i / (cobs + 0.6));
    const y1 = body + span * ((i + 1) / (cobs + 0.6));
    const mid = y0 + (y1 - y0) * 0.5;
    connectRings(draft, 'gold', circleRing(cx, cz, radius, segments), y0, circleRing(cx, cz, radius * 1.16, segments), mid);
    connectRings(draft, 'gold', circleRing(cx, cz, radius * 1.16, segments), mid, circleRing(cx, cz, radius * 0.82, segments), y1);
    radius *= 0.82;
  }
  const tipY = body + span * (cobs / (cobs + 0.6));
  const tip = circleRing(cx, cz, Math.max(radius, 0.15), segments);
  const apex = { x: cx, y: height, z: cz };
  for (let i = 0; i < segments; i++) {
    const a = tip[i];
    const b = tip[(i + 1) % segments];
    draft.tri('gold', { x: a[0], y: tipY, z: a[1] }, { x: b[0], y: tipY, z: b[1] }, apex);
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
    if (kind === 'hall') addTieredHall(draft, ring, height);
    else if (kind === 'chedi') addBellChedi(draft, ring, height);
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
