// Bake the Grand Palace / Wat Phra Kaew schematic GLB from OSM footprints
// already in bkk-heritage-detail.geojson. Heights are the atlas tags.
// No textures. Gold is the roof accent only.
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
  orientCCW,
  outerRingLngLat,
  scaleAbout,
  toLocal,
} from '../public/building-massing.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function standInKind(props) {
  const name = String(props?.name || '');
  const id = String(props?.id || '');
  const building = String(props?.building || '');
  const height = Number(props?.render_height ?? props?.height ?? 0);
  if (id === GRAND_PALACE_SLOT.anchorFeatureId || name.includes('อุโบสถ')) return 'gable';
  if (building === 'chapel' || name.includes('หอ')) return 'gable';
  if (
    name.includes('เจดีย์')
    || name.includes('มณฑป')
    || name.includes('ปราสาท')
    || (building === 'temple' && height >= 28)
  ) return 'stupa';
  return 'block';
}

function localRing(feature) {
  const ring = outerRingLngLat(feature);
  if (!ring) return null;
  return orientCCW(ring.map(([lng, lat]) => toLocal(lng, lat, GRAND_PALACE_SLOT.anchor)));
}

function addStupa(draft, ring, height) {
  const scales = [1, 0.78, 0.56, 0.36];
  const body = height * 0.8;
  const step = body / scales.length;
  for (let i = 0; i < scales.length; i++) {
    const scaled = scaleAbout(ring, scales[i]);
    const y0 = step * i;
    const y1 = step * (i + 1);
    draft.walls(i === scales.length - 1 ? 'gold' : 'shade', scaled, y0, y1);
    if (i < scales.length - 1) draft.cap('paper', scaled, y1);
  }
  const top = scaleAbout(ring, scales[scales.length - 1]);
  let cx = 0;
  let cz = 0;
  for (const p of top) { cx += p[0]; cz += p[1]; }
  cx /= top.length;
  cz /= top.length;
  const apex = { x: cx, y: height, z: cz };
  for (let i = 0; i < top.length; i++) {
    const a = top[i];
    const b = top[(i + 1) % top.length];
    draft.tri('gold', { x: a[0], y: body, z: a[1] }, { x: b[0], y: body, z: b[1] }, apex);
  }
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
    const kind = standInKind(feature.properties);
    if (kind === 'gable') {
      const eave = height * 0.66;
      draft.walls('shade', ring, 0, eave);
      addGableRoof(draft, 'gold', 'shade', ring, eave, height);
    } else if (kind === 'stupa') {
      addStupa(draft, ring, height);
    } else {
      draft.walls('shade', ring, 0, height);
      draft.cap('paper', ring, height);
    }
    used.push(id);
  }
  return { draft, used, missing };
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
    { name: 'shade', hex: MASSING_PALETTE.shade },
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
  const triangles = ['paper', 'shade', 'gold'].reduce((sum, name) => {
    const geometry = draft.finish(name);
    return sum + (geometry ? geometry.positions.length / 9 : 0);
  }, 0);
  console.log(`wrote ${out} (${glb.length} bytes, ${used.length} footprints, ${triangles} triangles)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
