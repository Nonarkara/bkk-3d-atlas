import test from 'node:test'
import assert from 'node:assert/strict'
import { createFloodEvidence, currentFloodEvidence, floodEvidenceText } from '../../public/cv/floodEvidence.js'
import { toPlanes, detectWater, analyse } from '../../public/cv/detect.js'
import { W, H } from '../../public/cv/detect.js'

const region = { cls: 'water', areaFrac: 0.2, x0: 10, x1: 90, y0: 50, y1: 89 }
const sample = (findings = [region]) => ({ findings, motionRatio: 0 })

test('flood screening requires advancing samples, time and same spatial region, not traffic', () => {
  const tracker = createFloodEvidence()
  assert.equal(tracker.update(sample(), 0).state, 'checking')
  assert.equal(tracker.update(sample(), 2500).state, 'checking')
  const evidence = tracker.update(sample(), 5000)
  assert.equal(evidence.state, 'possible_flooding')
  assert.equal(evidence.samples, 3)
  assert.equal(evidence.spanMs, 5000)
  assert.equal(evidence.imageFraction, 0.2)
  assert.equal(tracker.update(sample([{ cls: 'vehicle' }, { cls: 'person' }]), 6000).state, 'unknown')
})

test('gaps, repeated timestamps, moving reflections and reset cannot accumulate persistence', () => {
  const tracker = createFloodEvidence()
  tracker.update(sample(), 0)
  tracker.update(sample(), 2500)
  assert.equal(tracker.update(sample(), 2500).samples, 1)
  assert.equal(tracker.update(sample(), 6000).samples, 1)
  const distant = { ...region, x0: 100, x1: 159 }
  assert.equal(tracker.update(sample([distant]), 7000).samples, 1)
  tracker.reset()
  assert.equal(tracker.update(sample([distant]), 8000).samples, 1)
})

test('haze, tiny patches, blind and missing findings cannot become flood evidence', () => {
  for (const result of [sample([]), sample([{ ...region, areaFrac: 0.01 }]), sample([region, { cls: 'haze' }]), { ...sample(), blind: true }, null]) {
    const tracker = createFloodEvidence()
    for (const t of [0, 2500, 5000, 7500]) assert.equal(tracker.update(result, t).state, 'unknown')
  }
})

test('stale evidence expires and never becomes a dry/safe/confirmed verdict', () => {
  const evidence = { state: 'possible_flooding', at: 5000 }
  assert.equal(currentFloodEvidence(evidence, 8000).state, 'possible_flooding')
  assert.equal(currentFloodEvidence(evidence, 8001).state, 'unknown')
  assert.equal(currentFloodEvidence(evidence, 4000).state, 'unknown')
  assert.equal(currentFloodEvidence({ state: 'possible_flooding', at: NaN }, 5000).state, 'unknown')
  assert.match(floodEvidenceText(evidence), /Possible flooding/)
  assert.match(floodEvidenceText(null), /unknown/)
  assert.match(floodEvidenceText(null, 'th'), /ประเมิน/)
})

test('water image coverage uses actual resolution, not a hardcoded 160x90 denominator', () => {
  const width = 320, height = 180
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4
    data.set(y >= 120 ? [150, 165, 190, 255] : [70, 72, 70, 255], p)
  }
  const findings = detectWater(toPlanes({ data, width, height }))
  assert.ok(findings.length > 0)
  for (const f of findings) {
    const expected = (f.x1 - f.x0 + 1) * (f.y1 - f.y0 + 1) / (width * height)
    assert.ok(Math.abs(f.areaFrac - expected) < 0.00001)
    assert.ok(f.areaFrac <= 1)
  }
  const frame = { data, width, height }
  const analysed = analyse(frame, frame).findings.filter(f => f.cls === 'water')
  assert.ok(analysed.length > 0)
  for (const f of analysed) assert.deepEqual(f.box, { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 })
})

