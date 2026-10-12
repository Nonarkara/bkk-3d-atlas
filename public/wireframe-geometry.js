// Procedural wireframes for the Landmarks layer.
//
// Method: img2threejs (Apache-2.0) — one reference photograph, then a
// code-only model built from parts, not a downloaded mesh. This file is
// the sculpt. public/wireframe-landmarks.js wraps the segments in
// THREE.LineSegments. No photograph is projected onto the lines.
//
// A single view hides the back. Heights are schematic. Each entry says
// which measurement it follows and what it does not claim.
//
// Ink is Palette plate 052 only: Sulpher Yellow on Black. Flat lines.
// No second hue, no gradient, no glow.

export const PALETTE = {
  plate: "052",
  ink: "#f5ecc2",
  inkName: "Sulpher Yellow",
  field: "#111314",
  fieldName: "Black",
  url: "https://colors.nonarkara.org/#plate-052",
};

export const WIRE_LANDMARKS = [
  {
    id: "chakri",
    name: "Phra Thinang Chakri Maha Prasat",
    nameTh: "พระที่นั่งจักรีมหาปราสาท",
    lng: 100.4913,
    lat: 13.7501,
    yaw: 0,
    pickRadius: 42,
    heightM: 50,
    coordSource: "English Wikipedia, Chakri Maha Prasat Throne Hall, 13.7501°N 100.4913°E",
    note: "Schematic. Three Thai prasat roofs on one western hall — the “farang in a chada”. The back is the box only; the colonnade is the north front from the reference photo.",
    reference: {
      author: "Mastertongapollo",
      license: "CC BY-SA 4.0",
      title: "พระที่นั่งจักรีมหาปราสาท2.jpg",
      url: "https://commons.wikimedia.org/wiki/File:%E0%B8%9E%E0%B8%A3%E0%B8%B0%E0%B8%97%E0%B8%B5%E0%B9%88%E0%B8%99%E0%B8%B1%E0%B9%88%E0%B8%87%E0%B8%88%E0%B8%B1%E0%B8%81%E0%B8%A3%E0%B8%B5%E0%B8%A1%E0%B8%AB%E0%B8%B2%E0%B8%9B%E0%B8%A3%E0%B8%B2%E0%B8%AA%E0%B8%B2%E0%B8%972.jpg",
    },
    shot: { zoom: 17.15, pitch: 58, bearing: 170 },
  },
  {
    id: "chedi",
    name: "Phra Si Rattana Chedi",
    nameTh: "พระศรีรัตนเจดีย์",
    lng: 100.492289,
    lat: 13.751612,
    yaw: 0,
    pickRadius: 14,
    heightM: 42,
    coordSource: "OSM footprint centroid, bkk-building-23482988 in bkk-heritage-detail.geojson. Tagged height 42 m.",
    note: "Schematic bell chedi. Square base, bulb, ringed spire. Not a surveyed elevation.",
    reference: {
      author: "2008guangzhou",
      license: "CC BY-SA 3.0",
      title: "Phra Si Rattana Chedi, Wat Phra Kaew, Bangkok.JPG",
      url: "https://commons.wikimedia.org/wiki/File:Phra_Si_Rattana_Chedi,_Wat_Phra_Kaew,_Bangkok.JPG",
    },
    shot: { zoom: 17.85, pitch: 64, bearing: 150 },
  },
  {
    id: "mondop",
    name: "Phra Mondop",
    nameTh: "พระมณฑป",
    lng: 100.492473,
    lat: 13.751616,
    yaw: 0,
    pickRadius: 12,
    heightM: 28,
    coordSource: "OSM footprint centroid, bkk-building-23482989. Tagged height 28 m.",
    note: "Schematic square library between the chedi and the pantheon. No separate elevation photo — the plan is the OSM footprint.",
    reference: null,
    shot: { zoom: 18.05, pitch: 64, bearing: 140 },
  },
  {
    id: "pantheon",
    name: "Prasat Phra Thep Bidon",
    nameTh: "ปราสาทพระเทพบิดร",
    lng: 100.492708,
    lat: 13.75164,
    yaw: 0,
    pickRadius: 16,
    heightM: 34,
    coordSource: "OSM footprint centroid, bkk-building-23482990. The file tags the mass at 32 m; the drawn spire reaches 34 m.",
    note: "Schematic cruciform prasat. Wat Phra Kaew has no free-standing Khmer prang. This is the terrace’s spired hall, not Wat Arun’s prang.",
    reference: null,
    shot: { zoom: 17.9, pitch: 62, bearing: 130 },
  },
  {
    id: "arun",
    name: "Wat Arun",
    nameTh: "วัดอรุณราชวราราม",
    lng: 100.48888889,
    lat: 13.74361111,
    yaw: 0,
    pickRadius: 36,
    heightM: 70,
    coordSource: "English Wikipedia, Wat Arun, 13.743611°N 100.488889°E. Central prang drawn at 70 m, inside the published 67–82 m range. Sources disagree.",
    note: "Schematic corn-cob prang and four satellites. Porcelain flowers are rows of rings, not a texture.",
    reference: {
      author: "Juanitoooww",
      license: "CC BY-SA 4.0",
      title: "The Prang of Wat Arun.jpg",
      url: "https://commons.wikimedia.org/wiki/File:The_Prang_of_Wat_Arun.jpg",
    },
    shot: { zoom: 16.85, pitch: 56, bearing: 28 },
  },
  {
    id: "democracy",
    name: "Democracy Monument",
    nameTh: "อนุสาวรีย์ประชาธิปไตย",
    lng: 100.501847,
    lat: 13.756676,
    yaw: 0,
    pickRadius: 32,
    heightM: 28,
    coordSource: "OSM way 178329973 centroid in bkk-landmarks.geojson (landmark-democracy-monument). Wings tagged 24 m, core 28 m.",
    note: "Schematic. Four wings, a turret, the tray, and the constitution. Relief figures are a panel, not people.",
    reference: {
      author: "Rangan Datta Wiki",
      license: "CC BY-SA 4.0",
      title: "Democracy Monument Bangkok.jpg",
      url: "https://commons.wikimedia.org/wiki/File:Democracy_Monument_Bangkok.jpg",
    },
    shot: { zoom: 17.55, pitch: 63, bearing: 36 },
  },
  {
    id: "swing",
    name: "Giant Swing",
    nameTh: "เสาชิงช้า",
    lng: 100.50138889,
    lat: 13.75194444,
    yaw: 0,
    pickRadius: 16,
    heightM: 21.15,
    coordSource: "English Wikipedia, Giant Swing, 13.751944°N 100.501389°E. Height 21.15 m from that article.",
    note: "Schematic pair of posts, crossbeam, and central finial. The ceremonial swing seat is gone and is not drawn.",
    reference: {
      author: "KOSIN SUKHUM",
      license: "CC BY-SA 4.0",
      title: "Giant Swing Bangkok Thailand.jpg",
      url: "https://commons.wikimedia.org/wiki/File:Giant_Swing_Bangkok_Thailand.jpg",
    },
    shot: { zoom: 18.15, pitch: 62, bearing: 188 },
  },
  {
    id: "golden-mount",
    name: "Golden Mount",
    nameTh: "ภูเขาทอง",
    lng: 100.506693,
    lat: 13.75385,
    yaw: 0,
    pickRadius: 40,
    heightM: 60,
    coordSource: "OSM chedi centroid, landmark-golden-mount-chedi in bkk-landmarks.geojson. Mound tagged 45 m, chedi top 60 m.",
    note: "Schematic cone, spiral walk, and a small chedi. The hill is brick and earth, not a natural peak.",
    reference: {
      author: "Vyacheslav Argenberg",
      license: "CC BY 4.0",
      title: "Wat Saket, Golden Mount, Bangkok, Thailand.jpg",
      url: "https://commons.wikimedia.org/wiki/File:Wat_Saket,_Golden_Mount,_Bangkok,_Thailand.jpg",
    },
    shot: { zoom: 16.7, pitch: 55, bearing: -24 },
  },
];

const BUILDERS = {
  chakri: buildChakri,
  chedi: buildChedi,
  mondop: buildMondop,
  pantheon: buildPantheon,
  arun: buildArun,
  democracy: buildDemocracy,
  swing: buildSwing,
  "golden-mount": buildGoldenMount,
};

export function detailForViewport(width) {
  const phone = !Number.isFinite(width) || width < 500;
  return {
    phone,
    radial: phone ? 8 : 12,
    tiers: phone ? 5 : 8,
    rows: phone ? 6 : 9,
    helix: phone ? 32 : 56,
    bays: phone ? 5 : 9,
  };
}

export function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function segmentCount(positions) {
  return positions.length / 6;
}

export function buildLandmark(id, detail = detailForViewport(1440)) {
  const spec = WIRE_LANDMARKS.find((item) => item.id === id);
  if (!spec) throw new Error(`unknown landmark ${id}`);
  const draw = createDraw();
  BUILDERS[id](draw, detail);
  const positions = draw.toArray();
  return { id, positions, segments: positions.length / 6 };
}

export function buildAll(detail = detailForViewport(1440)) {
  return WIRE_LANDMARKS.map((spec) => ({ spec, ...buildLandmark(spec.id, detail) }));
}

function createDraw() {
  const data = [];
  return {
    line(a, b) {
      data.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    },
    poly(pts, closed = false) {
      for (let i = 0; i < pts.length - 1; i++) this.line(pts[i], pts[i + 1]);
      if (closed && pts.length > 2) this.line(pts[pts.length - 1], pts[0]);
    },
    box(x0, y0, z0, x1, y1, z1) {
      const v = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
      ];
      this.poly(v.slice(0, 4), true);
      this.poly(v.slice(4), true);
      for (let i = 0; i < 4; i++) this.line(v[i], v[i + 4]);
    },
    ring(y, radius, n, phase = 0) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2;
        pts.push([Math.cos(a) * radius, y, Math.sin(a) * radius]);
      }
      this.poly(pts, true);
      return pts;
    },
    loft(a, b) {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) this.line(a[i], b[i]);
    },
    toArray() {
      return Float32Array.from(data);
    },
  };
}

function prasat(draw, cx, cz, baseHalf, y0, yTip, tiers) {
  const rise = (yTip - y0) * 0.84;
  let prev = null;
  for (let i = 0; i <= tiers; i++) {
    const t = i / tiers;
    const y = y0 + rise * Math.pow(t, 0.9);
    const half = baseHalf * (1 - t) + 0.15;
    const lift = i === 0 ? 0 : Math.min(1.15, half * 0.25);
    const corners = [
      [cx - half, y + lift, cz - half],
      [cx + half, y + lift, cz - half],
      [cx + half, y + lift, cz + half],
      [cx - half, y + lift, cz + half],
    ];
    const mids = [
      [cx, y, cz - half],
      [cx + half, y, cz],
      [cx, y, cz + half],
      [cx - half, y, cz],
    ];
    const pts = [];
    for (let k = 0; k < 4; k++) pts.push(corners[k], mids[k]);
    draw.poly(pts, true);
    if (prev) {
      for (let k = 0; k < 4; k++) draw.line(prev[k], corners[k]);
    }
    prev = corners;
  }
  const tip = [cx, yTip, cz];
  draw.line([cx, y0 + rise, cz], tip);
  draw.line([cx - 0.35, yTip - 0.7, cz], tip);
  draw.line([cx + 0.35, yTip - 0.7, cz], tip);
  draw.line([cx, yTip - 0.7, cz - 0.35], tip);
  draw.line([cx, yTip - 0.7, cz + 0.35], tip);
}

function buildChakri(draw, detail) {
  // East-west hall. Colonnade and pediment face north (negative Z).
  draw.box(-36, 0, -12, 36, 1.5, 12);
  draw.box(-34, 1.5, -11, 34, 16.5, 11);
  draw.line([-32, 6.2, -11], [32, 6.2, -11]);
  draw.line([-32, 11.2, -11], [32, 11.2, -11]);
  const bays = detail.bays;
  for (let i = 0; i <= bays; i++) {
    const x = -32 + (64 * i) / bays;
    draw.line([x, 1.5, -11], [x, 16.2, -11]);
  }
  // Projecting portico and triangular pediment.
  draw.box(-9, 1.5, -19.5, 9, 13.5, -11);
  for (let i = 0; i < 6; i++) {
    const x = -7.5 + (15 * i) / 5;
    draw.line([x, 1.5, -19.5], [x, 13.2, -19.5]);
  }
  draw.line([-7.5, 13.2, -19.5], [7.5, 13.2, -19.5]);
  draw.poly([[-10, 13.4, -19.6], [0, 19.4, -19.6], [10, 13.4, -19.6]], false);
  draw.line([-36, 16.5, -11], [36, 16.5, -11]);
  draw.line([-36, 16.5, 11], [36, 16.5, 11]);
  // Three crowns. The middle one is the throne-hall spire.
  prasat(draw, -18, 0, 4.4, 16.5, 33, detail.tiers);
  prasat(draw, 0, 0.4, 6.6, 16.5, 50, detail.tiers);
  prasat(draw, 18, 0, 4.4, 16.5, 33, detail.tiers);
}

function buildChedi(draw, detail) {
  draw.box(-8, 0, -8, 8, 2.2, 8);
  draw.box(-6.6, 2.2, -6.6, 6.6, 4.4, 6.6);
  draw.box(-5.4, 4.4, -5.4, 5.4, 6.2, 5.4);
  const n = detail.radial;
  let prev = null;
  const bell = [
    [6.2, 5.2],
    [9.5, 6.4],
    [14, 7.1],
    [18, 6.6],
    [22, 4.4],
    [24.5, 2.6],
  ];
  for (const [y, radius] of bell) {
    const ring = draw.ring(y, radius, n);
    if (prev) draw.loft(prev, ring);
    prev = ring;
  }
  draw.box(-2.3, 24.5, -2.3, 2.3, 27.2, 2.3);
  let neck = null;
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const y = 27.2 + t * 12.2;
    const radius = 2.4 * (1 - t) + 0.18;
    const ring = draw.ring(y, radius, n);
    if (neck) draw.loft(neck, ring);
    neck = ring;
  }
  const tip = [0, 42, 0];
  draw.line([0, 39.4, 0], tip);
  for (const p of neck) draw.line(p, tip);
}

function buildMondop(draw, detail) {
  draw.box(-7.2, 0, -7.2, 7.2, 1.2, 7.2);
  draw.box(-6.2, 1.2, -6.2, 6.2, 9.5, 6.2);
  for (const [x, z] of [[-5.4, -5.4], [5.4, -5.4], [5.4, 5.4], [-5.4, 5.4]]) {
    draw.line([x, 1.2, z], [x, 9.5, z]);
  }
  prasat(draw, 0, 0, 5.6, 9.5, 28, detail.tiers);
}

function buildPantheon(draw, detail) {
  draw.box(-8, 0, -8, 8, 11.5, 8);
  // Four porches. Gable on each face.
  const porches = [
    [-8, 0, -16, 8, 8, -8, [0, 12.4, -16]],
    [-8, 0, 8, 8, 8, 16, [0, 12.4, 16]],
    [-16, 0, -8, -8, 8, 8, [-16, 12.4, 0]],
    [8, 0, -8, 16, 8, 8, [16, 12.4, 0]],
  ];
  for (const [x0, y0, z0, x1, y1, z1, peak] of porches) {
    draw.box(x0, y0, z0, x1, y1, z1);
    const midY = 8;
    if (peak[2] !== 0 && peak[0] === 0) {
      draw.poly([[x0, midY, peak[2]], peak, [x1, midY, peak[2]]], false);
    } else {
      draw.poly([[peak[0], midY, z0], peak, [peak[0], midY, z1]], false);
    }
  }
  prasat(draw, 0, 0, 6.2, 11.5, 34, detail.tiers);
}

function cornRadius(t, rows) {
  const envelope = 1 - 0.4 * t;
  const bead = 1 + 0.055 * Math.sin(t * rows * Math.PI);
  return envelope * bead;
}

function cornPrang(draw, y0, yTip, radius, rows, radial) {
  const cobTop = y0 + (yTip - y0) * 0.72;
  let prev = null;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const y = y0 + (cobTop - y0) * t;
    const ring = draw.ring(y, radius * cornRadius(t, rows), radial);
    if (prev) draw.loft(prev, ring);
    prev = ring;
  }
  const tip = [0, yTip, 0];
  let shoulder = prev;
  const shoulderR = Math.hypot(shoulder[0][0], shoulder[0][2]);
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    const y = cobTop + (yTip - cobTop) * t * 0.92;
    const ring = draw.ring(y, Math.max(0.12, shoulderR * (1 - t)), radial);
    draw.loft(shoulder, ring);
    shoulder = ring;
  }
  for (const p of shoulder) draw.line(p, tip);
  draw.line([0, cobTop, 0], tip);
}

function buildArun(draw, detail) {
  draw.poly([[-18, 0.4, -18], [18, 0.4, -18], [18, 0.4, 18], [-18, 0.4, 18]], true);
  draw.poly([[-14, 3.2, -14], [14, 3.2, -14], [14, 3.2, 14], [-14, 3.2, 14]], true);
  draw.poly([[-10, 6.4, -10], [10, 6.4, -10], [10, 6.4, 10], [-10, 6.4, 10]], true);
  for (const [x, z] of [[-18, -18], [18, -18], [18, 18], [-18, 18]]) {
    draw.line([x, 0.4, z], [Math.sign(x) * 10, 6.4, Math.sign(z) * 10]);
  }
  // Stairs on the four faces.
  for (const [x0, z0, x1, z1] of [[0, -20, 0, -10], [0, 20, 0, 10], [-20, 0, -10, 0], [20, 0, 10, 0]]) {
    draw.line([x0 - 1.2, 0.2, z0], [x1 - 0.6, 6.4, z1]);
    draw.line([x0 + 1.2, 0.2, z0], [x1 + 0.6, 6.4, z1]);
  }
  cornPrang(draw, 6.4, 70, 7.2, detail.rows, detail.radial);
  const satellites = [[-13, -13], [13, -13], [13, 13], [-13, 13]];
  for (const [x, z] of satellites) {
    const local = createDraw();
    cornPrang(local, 1.2, 26, 3.1, Math.max(4, detail.rows - 3), Math.max(6, detail.radial - 2));
    const pts = local.toArray();
    for (let i = 0; i < pts.length; i += 6) {
      draw.line(
        [pts[i] + x, pts[i + 1], pts[i + 2] + z],
        [pts[i + 3] + x, pts[i + 4], pts[i + 5] + z],
      );
    }
  }
}

function rotQuarter(p, k) {
  let x = p[0];
  let z = p[2];
  for (let i = 0; i < k; i++) {
    const nx = -z;
    z = x;
    x = nx;
  }
  return [x, p[1], z];
}

function buildDemocracy(draw, detail) {
  const n = detail.radial;
  let prev = null;
  for (const y of [0.2, 20]) {
    const ring = draw.ring(y, 3.3, n);
    if (prev) draw.loft(prev, ring);
    prev = ring;
  }
  // Tray and the constitution.
  const trayA = draw.ring(21.2, 5.1, n);
  const trayB = draw.ring(22.3, 5.1, n);
  draw.loft(trayA, trayB);
  draw.box(-0.7, 22.3, -0.4, 0.7, 28, 0.4);
  draw.line([-0.7, 28, -0.4], [0.7, 28, 0.4]);

  const local = createDraw();
  local.box(3.5, 0, -1.2, 22, 15.2, 1.2);
  local.poly([[6, 3.2, 1.25], [16, 3.2, 1.25], [16, 12, 1.25], [6, 12, 1.25]], true);
  local.poly([[22, 15.2, -1.2], [26.4, 20.2, 0], [22, 15.2, 1.2]], false);
  local.line([22, 0, -1.2], [25.2, 0, 0]);
  local.line([22, 0, 1.2], [25.2, 0, 0]);
  local.line([25.2, 0, 0], [26.4, 20.2, 0]);
  const raw = local.toArray();
  for (let turn = 0; turn < 4; turn++) {
    for (let i = 0; i < raw.length; i += 6) {
      const a = rotQuarter([raw[i], raw[i + 1], raw[i + 2]], turn);
      const b = rotQuarter([raw[i + 3], raw[i + 4], raw[i + 5]], turn);
      draw.line(a, b);
    }
  }
}

function buildSwing(draw) {
  const top = 21.15;
  for (const x of [-4.35, 4.35]) {
    draw.box(x - 1.05, 0, -1.05, x + 1.05, 1.1, 1.05);
    const foot = [
      [x - 0.62, 1.1, -0.62],
      [x + 0.62, 1.1, -0.62],
      [x + 0.62, 1.1, 0.62],
      [x - 0.62, 1.1, 0.62],
    ];
    const head = [
      [x - 0.4, 18.4, -0.4],
      [x + 0.4, 18.4, -0.4],
      [x + 0.4, 18.4, 0.4],
      [x - 0.4, 18.4, 0.4],
    ];
    draw.poly(foot, true);
    draw.poly(head, true);
    for (let i = 0; i < 4; i++) draw.line(foot[i], head[i]);
    draw.line([x, 18.4, 0], [x, 19.35, 0]);
  }
  draw.poly([[-5.5, 18.55, 0], [0, 19.15, 0], [5.5, 18.55, 0]], false);
  draw.poly([[-5.5, 19.25, 0], [0, 19.85, 0], [5.5, 19.25, 0]], false);
  draw.line([-5.5, 18.55, 0], [-5.5, 19.25, 0]);
  draw.line([5.5, 18.55, 0], [5.5, 19.25, 0]);
  draw.line([-5.5, 19.25, 0], [-6.3, 20.15, 0]);
  draw.line([5.5, 19.25, 0], [6.3, 20.15, 0]);
  // Pointed finial. The beam’s center is the ornament, not a hanging seat.
  draw.poly([[0, 19.7, 0], [0.7, 20.35, 0], [0, 20.55, 0], [-0.7, 20.35, 0]], true);
  draw.line([0, 20.55, 0], [0, top, 0]);
  draw.line([-0.28, top - 0.45, 0], [0, top, 0]);
  draw.line([0.28, top - 0.45, 0], [0, top, 0]);
}

function buildGoldenMount(draw, detail) {
  const baseR = 32;
  const lipR = 6.2;
  const mound = 45;
  const rings = [];
  const steps = detail.phone ? 6 : 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = mound * Math.pow(t, 1.05);
    const radius = baseR * (1 - t) + lipR * t;
    rings.push(draw.ring(y, radius, detail.radial));
  }
  for (let i = 0; i < rings.length - 1; i++) draw.loft(rings[i], rings[i + 1]);
  const turns = 2.15;
  let prev = null;
  for (let i = 0; i <= detail.helix; i++) {
    const t = i / detail.helix;
    const y = mound * t;
    const radius = (baseR * (1 - t) + lipR * t) * 0.92;
    const a = t * turns * Math.PI * 2;
    const p = [Math.cos(a) * radius, y + 0.35, Math.sin(a) * radius];
    if (prev) draw.line(prev, p);
    prev = p;
  }
  // Chedi on the lip. Same bell language as Phra Si Rattana, much smaller.
  const n = detail.radial;
  let bell = null;
  for (const [y, radius] of [[45, 4.6], [48, 5.1], [51.5, 3.6], [53.2, 1.8]]) {
    const ring = draw.ring(y, radius, n);
    if (bell) draw.loft(bell, ring);
    bell = ring;
  }
  const tip = [0, 60, 0];
  for (const p of bell) draw.line(p, tip);
  draw.line([0, 53.2, 0], tip);
}
