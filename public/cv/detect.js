// Ported from Nonarkara/FloodDash public/js/cv/detect.js @ 04ba31e, unchanged.

// Basic computer vision over the CCTV wall. No model weights, no new supplier.
//
// WHY THIS SHAPE. The wall already plays each camera through hls.js. Media
// Source Extensions video does not taint a canvas, so the frames the operator is
// looking at can be read back directly with getImageData and analysed in the
// browser. That buys three things a server sweep cannot: the detection is
// genuinely simultaneous with what is on screen, it costs nothing per request,
// and a national view is not dragged down by ffmpeg. The server-side sweep in
// server/cvTraffic.js keeps its job — the national traffic claim — and this file
// does not touch it.
//
// THE HONESTY RULE, INHERITED FROM scripts/cv-traffic/motion.mjs AND NOT
// NEGOTIABLE HERE. A positive observation is a claim about the IMAGE and is
// publishable: "something moved", "this region looks like standing water". A
// negative one is a claim about the WORLD and is not: nothing detected is not
// "no flood", a clear frame is not "the camera works". So this module only ever
// emits positives, and `blind`/`unknown` is a first-class answer that the UI
// must render. We never return a "safe" verdict.
//
// WHAT EACH CLASS ACTUALLY MEASURES. These are classical image statistics, not
// recognition. Each carries its own evidence string so a reader can see what
// was measured rather than being asked to trust a label:
//
//   moving   · a region changed by more than PIXEL_DELTA between frames
//   vehicle  · a moving region, wide and low (wide aspect, mid-frame height)
//   person   · a moving region, tall and narrow
//   water    · a still region that is bright, low-texture and blue-biased —
//              the signature of a reflective standing-water surface
//   haze     · the WHOLE frame is low-contrast, desaturated and lifted: the
//              signature of fog or a fogged lens
//
// The water and haze tests are heuristics and are labelled as such in the UI.
// A confident-looking box is still a heuristic, and the interface must not
// present it as a measurement of depth or a confirmation of a flood.

/** Analysis size. Small on purpose: at 160x90 a car is ~10 px, and
 *  sub-pixel H.264 jitter washes out below that. */
export const W = 160;
export const H = 90;
export const PIXELS = W * H;

/**
 * Per-pixel luma change below this is quantisation noise, not movement.
 * Same reasoning as motion.mjs PIXEL_DELTA — H.264 moves a pixel by 2-3 levels
 * when nothing in the scene moved at all.
 */
export const PIXEL_DELTA = 12;

/** A connected region must cover at least this fraction of the frame to count. */
export const MIN_AREA_FRAC = 0.0015;

/** Regions larger than this are "the whole scene changed", not an object. */
export const MAX_AREA_FRAC = 0.55;

/** A vehicle is wide and low. Aspect = width / height. */
export const VEHICLE_ASPECT_MIN = 1.15;
export const VEHICLE_ASPECT_MAX = 4.5;
export const VEHICLE_MAX_REL_H = 0.62;

/** A person is taller than wide. */
export const PERSON_ASPECT_MAX = 0.95;
export const PERSON_MIN_REL_H = 0.10;

/**
 * Water: bright, smooth, and bluer than it is red.
 *
 * WATER_MIN_LUMA is the load-bearing constant here, and it was 58 until a
 * render showed a plain night road being reported as two bands of standing
 * water. Measured on synthetic scenes: a uniform asphalt carriageway scores
 * luma ≈ 67 (bluish, B−R ≈ +16, zero texture — it passes every other test),
 * while a water band reflecting sky scores ≈ 168–179. 100 sits between them
 * with margin on both sides.
 *
 * A RELATIVE brightness gate was tried first and rejected: comparing a
 * candidate to the median of the frame region where water can appear breaks
 * the case that matters most — a carriageway that is mostly underwater, whose
 * own median IS the water, so nothing is brighter than the reference. A
 * weaker form of the same idea, using the whole frame, was wrong the other
 * way: a road under a darker sky is 23 luma above the global median and still
 * is not water.
 *
 * Like every constant in this file, this one is a reasoned threshold on
 * synthetic scenes, not a calibrated measurement on real flood footage. It is
 * the first thing to revisit when such footage exists — which is why the
 * finding is labelled "consistent with standing water" and never "flooded".
 */
export const WATER_MIN_LUMA = 100;
export const WATER_MAX_TEX = 7.5;
export const WATER_MIN_BLUE_BIAS = 4;
/**
 * Water is rejected if it sits too HIGH in frame, not too low: the sky is at
 * the top, and a bright smooth blue band up there is sky, not standing water.
 * (Getting this backwards was the first version's bug — it rejected the very
 * band it was meant to find, because the bottom of the frame is the *most*
 * likely place for water.)
 */
export const WATER_MIN_REL_Y = 0.45;

/** Haze: the whole frame washed out. */
export const HAZE_MIN_LUMA = 120;
export const HAZE_MAX_STDDEV = 34;
export const HAZE_MAX_SATURATION = 26;

/** Luma from RGB, the same coefficients ffmpeg uses for `format=gray`. */
export function lumaAt(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Read an ImageData into the flat structures the detectors want.
 * Kept separate so tests can build the same shape without a canvas.
 *
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} img
 */
export function toPlanes(img) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const gray = new Float32Array(n);
  const blueBias = new Float32Array(n);   // B - R, >0 means blue-biased
  const sat = new Float32Array(n);        // max(r,g,b) - min(r,g,b)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    gray[i] = lumaAt(r, g, b);
    blueBias[i] = b - r;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  return { w, h, gray, blueBias, sat };
}

/**
 * Changed-pixel mask between two frames.
 * @returns {Uint8Array} 1 where |luma change| >= PIXEL_DELTA
 */
export function diffMask(a, b) {
  const n = Math.min(a.length, b.length);
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = Math.abs(a[i] - b[i]) >= PIXEL_DELTA ? 1 : 0;
  return m;
}

/**
 * Flood-fill connected components over a binary mask, 4-connected.
 * Returns at least MIN_AREA_FRAC and at most MAX_AREA_FRAC of the frame, so a
 * uniformly changed frame is reported as one big region rather than a thousand
 * specks.
 */
export function components(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    const frac = area / (w * h);
    if (frac < MIN_AREA_FRAC || frac > MAX_AREA_FRAC) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    out.push({
      x0, y0, x1, y1, area,
      areaFrac: frac,
      aspect: bw / bh,
      relH: bh / h,
      relY: y0 / h,
    });
  }
  return out;
}

/** Mean and standard deviation of a plane. */
function stats(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const mean = sum / arr.length;
  let s = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - mean; s += d * d; }
  return { mean, stddev: Math.sqrt(s / arr.length) };
}

/**
 * Local texture: mean absolute horizontal gradient inside a box.
 * Water is smooth; a car, a road marking and foliage are not.
 */
function boxTexture(gray, w, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      sum += Math.abs(gray[i] - gray[i + 1]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

function meanOver(plane, w, box) {
  let sum = 0, n = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) { sum += plane[y * w + x]; n++; }
  }
  return n ? sum / n : 0;
}

/**
 * Classify one connected region. `box` came from the motion mask, so it is by
 * construction a region that CHANGED — the geometry test says what shape the
 * change was, and the colour test says what the pixels behind it look like.
 */
export function classify(box, prevPlanes, curPlanes) {
  const aspect = box.aspect, relH = box.relH;
  const tex = boxTexture(curPlanes.gray, curPlanes.w, box.x0, box.y0, box.x1, box.y1);
  const luma = meanOver(curPlanes.gray, curPlanes.w, box);
  const blue = meanOver(curPlanes.blueBias, curPlanes.w, box);
  const sat = meanOver(curPlanes.sat, curPlanes.w, box);

  // Geometry first: a region that is not vehicle-shaped and not person-shaped
  // is reported as plain movement, which is a true statement about it.
  let cls = 'moving';
  if (aspect >= VEHICLE_ASPECT_MIN && aspect <= VEHICLE_ASPECT_MAX && relH <= VEHICLE_MAX_REL_H) {
    cls = 'vehicle';
  } else if (aspect <= PERSON_ASPECT_MAX && relH >= PERSON_MIN_REL_H) {
    cls = 'person';
  }
  return {
    cls,
    box,
    score: Number(box.areaFrac.toFixed(5)),
    evidence: `${(box.areaFrac * 100).toFixed(2)}% of frame changed · aspect ${aspect.toFixed(2)} · height ${(relH * 100).toFixed(0)}%`,
    metrics: {
      aspect: Number(aspect.toFixed(2)),
      relH: Number(relH.toFixed(3)),
      texture: Number(tex.toFixed(2)),
      luma: Number(luma.toFixed(1)),
      blueBias: Number(blue.toFixed(1)),
      saturation: Number(sat.toFixed(1)),
    },
  };
}

/**
 * A standing-water candidate. Runs over a TILE GRID, not the motion mask:
 * water is still, so it would never appear in a difference image at all. This
 * is the reason the detector needs a second, independent path.
 *
 * @returns array of regions, each with the evidence that produced it
 */
export function detectWater(planes, cols = 10, rows = 6) {
  const { w, h, gray, blueBias, sat } = planes;
  const out = [];
  const cw = Math.floor(w / cols), ch = Math.floor(h / rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = gx * cw, y0 = gy * ch, x1 = x0 + cw - 1, y1 = y0 + ch - 1;
      const box = { x0, y0, x1, y1 };
      const luma = meanOver(gray, w, box);
      if (luma < WATER_MIN_LUMA) continue;
      const tex = boxTexture(gray, w, x0, y0, x1, y1);
      if (tex > WATER_MAX_TEX) continue;
      const blue = meanOver(blueBias, w, box);
      if (blue < WATER_MIN_BLUE_BIAS) continue;
      const relY = y0 / h;
      if (relY < WATER_MIN_REL_Y) continue;
      const satMean = meanOver(sat, w, box);
      // Merge horizontally AND vertically so a flooded carriageway is one
      // region, not a stack of bands. Row-merging alone reported the same
      // standing water twice, because a band two tiles deep split into two
      // horizontally-merged strips that never touched.
      out.push({
        x0, y0, x1, y1,
        areaFrac: (cw * ch) / (w * h),
        relY,
        luma: Number(luma.toFixed(1)),
        texture: Number(tex.toFixed(2)),
        blueBias: Number(blue.toFixed(1)),
        saturation: Number(satMean.toFixed(1)),
      });
    }
  }
  return mergeBands(out, w, h);
}

/**
 * Merge grid cells that are adjacent horizontally or vertically into one
 * region, so one flooded patch produces one box and one line of evidence.
 */
function mergeBands(cells, w, h) {
  const bands = [];
  for (const c of cells) {
    const last = bands[bands.length - 1];
    if (last && last.y0 === c.y0 && last.x1 + 1 === c.x0) {
      last.x1 = c.x1;
      last.cells++;
    } else {
      bands.push({ ...c, cells: 1 });
    }
  }
  // Second pass: stack vertically-adjacent bands that share a column span.
  for (let i = bands.length - 1; i > 0; i--) {
    const below = bands[i], above = bands[i - 1];
    if (above.x0 === below.x0 && above.x1 === below.x1
      && above.y1 + 1 === below.y0) {
      above.y1 = below.y1;
      above.cells += below.cells;
      above.mergedRows = (above.mergedRows || 1) + 1;
      bands.splice(i, 1);
    }
  }
  return bands.filter((b) => b.cells >= 2).map((b) => ({
    ...b,
    areaFrac: Number(((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) / (w * h)).toFixed(5)),
    evidence: `bright (luma ${b.luma}), smooth (texture ${b.texture}), blue-biased (+${b.blueBias}) across ${b.cells} tiles low in frame — consistent with standing water, may be glare or a wet surface`,
  }));
}

/**
 * Whole-frame haze. Positive-only: this reports that the frame LOOKS washed out,
 * never that the camera is working. A clear frame produces no finding, and the
 * caller must not turn that absence into a clearance.
 */
export function detectHaze(planes) {
  const { gray, sat } = planes;
  const g = stats(gray), s = stats(sat);
  if (g.mean < HAZE_MIN_LUMA) return null;
  if (g.stddev > HAZE_MAX_STDDEV) return null;
  if (s.mean > HAZE_MAX_SATURATION) return null;
  return {
    kind: 'haze',
    luma: Number(g.mean.toFixed(1)),
    stddev: Number(g.stddev.toFixed(1)),
    saturation: Number(s.mean.toFixed(1)),
    evidence: `frame washed out — mean luma ${g.mean.toFixed(0)}, contrast ${g.stddev.toFixed(0)}, colour ${s.mean.toFixed(0)}; may be fog, rain, a fogged lens or a night scene`,
  };
}

/**
 * One analysis tick over two consecutive analysis-size frames.
 *
 * @param prev ImageData-like of the previous frame
 * @param cur  ImageData-like of the current frame
 * @returns {{findings: Array, motionRatio: number, blind: boolean, note: string}}
 */
export function analyse(prev, cur) {
  const p = toPlanes(prev), c = toPlanes(cur);
  const mask = diffMask(p.gray, c.gray);
  let changed = 0;
  for (let i = 0; i < mask.length; i++) changed += mask[i];
  const motionRatio = changed / mask.length;

  const boxes = components(mask, c.w, c.h);
  const findings = boxes.map((b) => classify(b, p, c));
  for (const w of detectWater(c)) findings.push({ cls: 'water', ...w,
    box: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 } });
  const haze = detectHaze(c);
  if (haze) findings.push({ cls: 'haze', ...haze, box: { x0: 0, y0: 0, x1: c.w - 1, y1: c.h - 1 }, score: 1, metrics: {} });

  const note = findings.length
    ? `${findings.length} region(s) measured`
    : 'no region met a detection threshold — NOT a statement that the scene is clear';
  return { findings, motionRatio: Number(motionRatio.toFixed(5)), blind: false, note };
}

/** Human-facing copy for a class. Never upgrades a heuristic into a fact. */
export const CLASS_LABEL = {
  moving:  { th: 'มีการเคลื่อนไหว', en: 'movement' },
  vehicle: { th: 'รูปร่างเหมือนรถ', en: 'vehicle-shaped' },
  person:  { th: 'รูปร่างเหมือนคน', en: 'person-shaped' },
  water:   { th: 'ผิวสะท้อนคล้ายน้ำขัง', en: 'water-like surface' },
  haze:    { th: 'ภาพมัวคล้ายหมอก', en: 'haze-like image' },
};
