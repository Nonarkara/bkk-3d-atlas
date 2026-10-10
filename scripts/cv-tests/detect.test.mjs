import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  W, H, PIXEL_DELTA, toPlanes, diffMask, components, classify,
  detectWater, detectHaze, analyse, CLASS_LABEL,
} from '../../public/cv/detect.js'

/** Build an ImageData-like object. `fn(x,y)` returns [r,g,b]. */
function frame(fn, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const [r, g, b] = fn(x, y)
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

const flat = (v) => frame(() => [v, v, v])

// A vehicle-shaped patch: wide, low, in the lower half of the frame.
function vehicleFrame(bg = 60, patch = 200) {
  return frame((x, y) => {
    const inPatch = x >= 40 && x < 80 && y >= 60 && y < 72
    return inPatch ? [patch, patch, patch] : [bg, bg, bg]
  })
}

test('diffMask marks only pixels that changed past PIXEL_DELTA', () => {
  const a = flat(100)
  const b = frame((x) => {
    const v = x >= 10 && x < 20 ? 200 : 100
    return [v, v, v]
  })
  const m = diffMask(toPlanes(a).gray, toPlanes(b).gray)
  const on = [...m].filter(Boolean).length
  assert.equal(on, 10 * H, 'only the changed column should fire')
  // Below the threshold is noise, not movement — the whole point of the floor.
  const tiny = frame((x, y) => {
    const v = x >= 10 && x < 20 ? 100 + PIXEL_DELTA - 1 : 100
    return [v, v, v]
  })
  assert.equal([...diffMask(toPlanes(a).gray, toPlanes(tiny).gray)].filter(Boolean).length, 0)
})

test('components finds one blob and reports honest geometry', () => {
  const prev = flat(60)
  const cur = vehicleFrame(60, 200)
  const p = toPlanes(prev), c = toPlanes(cur)
  const boxes = components(diffMask(p.gray, c.gray), c.w, c.h)
  assert.equal(boxes.length, 1, 'one contiguous patch is one region')
  const b = boxes[0]
  assert.equal(b.x0, 40); assert.equal(b.x1, 79)
  assert.equal(b.y0, 60); assert.equal(b.y1, 71)
  assert.ok(b.aspect > 1.15, `wide patch should read wide, got ${b.aspect}`)
  assert.ok(b.relH <= 0.62, 'short patch should read low')
  assert.ok(b.areaFrac > 0.0015, 'well above the minimum area')
})

test('a wide low moving region is vehicle-shaped, a tall narrow one is person-shaped', () => {
  const p = toPlanes(flat(60))
  const c = toPlanes(vehicleFrame(60, 200))
  const box = components(diffMask(p.gray, c.gray), c.w, c.h)[0]
  const v = classify(box, p, c)
  assert.equal(v.cls, 'vehicle')
  assert.match(v.evidence, /% of frame changed/)

  // Tall and narrow: a person crossing the frame.
  const tallCur = frame((x, y) => {
    const inPatch = x >= 78 && x < 88 && y >= 30 && y < 75
    return inPatch ? [210, 210, 210] : [60, 60, 60]
  })
  const tallPlanes = toPlanes(tallCur)
  const tbox = components(diffMask(p.gray, tallPlanes.gray), c.w, c.h)[0]
  const per = classify(tbox, p, tallPlanes)
  assert.equal(per.cls, 'person')
  assert.ok(per.metrics.aspect <= 0.95, `tall patch should not read wide, got ${per.metrics.aspect}`)
})

test('a region that is neither shape is reported as plain movement, not guessed at', () => {
  const p = toPlanes(flat(60))
  const square = frame((x, y) => {
    const inPatch = x >= 50 && x < 70 && y >= 40 && y < 60
    return inPatch ? [200, 200, 200] : [60, 60, 60]
  })
  const sp = toPlanes(square)
  const box = components(diffMask(p.gray, sp.gray), sp.w, sp.h)[0]
  const r = classify(box, p, sp)
  assert.equal(r.cls, 'moving', 'unknown shapes must not be promoted to a specific class')
})

test('water detector finds a bright smooth blue low band and ignores it high in frame', () => {
  // Smooth, bright, blue-biased, sitting low: the standing-water signature.
  const w1 = frame((x, y) => (y >= 66 ? [150, 165, 190] : [70, 72, 70]))
  const found = detectWater(toPlanes(w1))
  assert.ok(found.length >= 1, 'a low bright smooth blue band should be reported')
  assert.equal(found[0].cls ?? 'water', 'water')
  assert.match(found[0].evidence, /consistent with standing water/)
  assert.match(found[0].evidence, /may be glare/, 'must stay in may-language')

  // The same texture, high in the frame — sky, not water. Must not fire.
  const w2 = frame((x, y) => (y < 24 ? [150, 165, 190] : [70, 72, 70]))
  assert.equal(detectWater(toPlanes(w2)).length, 0, 'a high bright band is not standing water')
})

test('textured ground is not water, however bright and blue it is', () => {
  // The background is dark and NEUTRAL, so the only candidate cells are in
  // the band — which alternates hard edge to edge and must be rejected on
  // texture alone. (An earlier version of this fixture had a bright blue
  // background, which the detector correctly flagged as a water candidate:
  // the fixture was wrong, not the test's expectation.)
  const noisy = frame((x, y) => {
    if (y < 66) return [40, 40, 40]
    const v = (x % 2 === 0) ? 200 : 45
    return [v, v + 8, v + 30]
  })
  const found = detectWater(toPlanes(noisy))
  assert.equal(found.length, 0, `high texture is not water; got ${JSON.stringify(found.map(f => f.texture))}`)
})

test('a flat grey road is not standing water, even though it is bluish and smooth', () => {
  // Found by RENDERING the detector, not by reading it. A night road is
  // uniform (texture 0), bluish under a blue sky (B−R ≈ +16) and bright enough
  // to clear an absolute luma floor — so it produced two spurious "water-like"
  // bands. Water has to be brighter than its own scene; a road is the scene.
  const road = frame((x, y) => (y >= 60 ? [61, 68, 77] : [40, 44, 50]))
  const found = detectWater(toPlanes(road))
  assert.equal(found.length, 0, `a uniform road must not read as water; got ${JSON.stringify(found.map(f => f.luma))}`)
})

test('water is reported once, not once per grid row', () => {
  // A band two tiles deep used to split into two horizontally-merged strips
  // that never touched, so one flooded patch was reported twice.
  const deep = frame((x, y) => (y >= 60 ? [170, 180, 200] : [35, 38, 42]))
  const found = detectWater(toPlanes(deep))
  assert.ok(found.length >= 1, 'the deep band is still found')
  // Every reported region must be its own thing, not a stack of rows.
  for (const f of found) assert.match(f.evidence, /across \d+ tiles/)
  const ys = found.map(f => `${f.y0}-${f.y1}`).sort()
  assert.equal(new Set(ys).size, ys.length, `overlapping bands: ${ys.join(', ')}`)
})

test('haze fires on a washed-out frame and not on a contrasty one', () => {
  const fog = frame((x, y) => {
    const v = 190 + ((x + y) % 3)      // near-flat, bright, desaturated
    return [v, v, v]
  })
  const h = detectHaze(toPlanes(fog))
  assert.ok(h, 'a flat bright grey frame should read as haze-like')
  assert.equal(h.kind, 'haze')
  assert.match(h.evidence, /may be fog/)

  // Daylight scene: bright but with real contrast and colour.
  const clear = frame((x, y) => {
    const v = y < 45 ? 200 : 60
    return [v, v - 12, v - 40]
  })
  assert.equal(detectHaze(toPlanes(clear)), null, 'a contrasty day scene is not haze')

  // The colour test alone was rejecting that one, which left the CONTRAST gate
  // untested — deleting it entirely kept the suite green. This frame is bright,
  // perfectly desaturated, and violently high-contrast, so the contrast gate is
  // the only thing that can reject it.
  const striped = frame((x, y) => {
    const v = (y % 2 === 0) ? 245 : 15
    return [v, v, v]
  })
  assert.equal(detectHaze(toPlanes(striped)), null,
    'high-contrast greyscale is not haze, and only the contrast gate can say so')
})

test('analyse reports positives only and never turns absence into a clearance', () => {
  // Two identical frames: nothing moved, nothing detected.
  const still = flat(70)
  const r = analyse(still, flat(70))
  assert.equal(r.findings.length, 0)
  assert.equal(r.motionRatio, 0)
  // The refusal must be stated, not merely implied by an empty array.
  assert.match(r.note, /NOT a statement that the scene is clear/)
  // And no affirmative clearance may appear anywhere in the payload.
  const serialised = JSON.stringify(r)
  for (const banned of [/all clear/i, /\bsafe\b/i, /no flood/i, /\bno hazard\b/i, /confirmed clear/i]) {
    assert.doesNotMatch(serialised, banned, `absence must not be phrased as ${banned}`)
  }

  // And when something does move, it is reported.
  const r2 = analyse(flat(60), vehicleFrame(60, 200))
  assert.ok(r2.findings.length >= 1)
  assert.ok(r2.motionRatio > 0)
})

test('every emitted class has a bilingual label', () => {
  for (const k of Object.keys(CLASS_LABEL)) {
    assert.ok(CLASS_LABEL[k].th && CLASS_LABEL[k].en, `${k} needs both languages`)
  }
  // And no label may contain a predictive verb.
  for (const [k, v] of Object.entries(CLASS_LABEL)) {
    assert.doesNotMatch(v.th, /จะเกิด|จะน้ำท่วม/, `${k} Thai label must not predict`)
    assert.doesNotMatch(v.en, /\bwill\b/, `${k} English label must not predict`)
  }
})

test('the module does not silently grow a confidence score', () => {
  // There is no model, so there is nothing to be confident about. A future
  // contributor adding `confidence: 0.97` would be inventing a number.
  const src = readFileSync(new URL('../../public/cv/detect.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /confidence/i, 'no confidence score without a model to produce it')
  assert.doesNotMatch(src, /\baccuracy\b/i)
})
