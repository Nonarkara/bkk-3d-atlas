// Ported from Nonarkara/FloodDash public/js/cv/floodEvidence.js @ 04ba31e, unchanged.

// Flood screening, not a flood/depth model. Repeated reflective patches are
// grounds to inspect footage; glare, permanent water and wet roads can persist.
export const FLOOD_SAMPLE_MAX_AGE_MS = 3000
export const FLOOD_MIN_SPAN_MS = 5000
export const FLOOD_MIN_SAMPLES = 3
export const FLOOD_MIN_IMAGE_FRACTION = 0.05

function overlap(a, b) {
  const intersection = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1)
    * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1)
  const area = r => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)
  return intersection / (area(a) + area(b) - intersection)
}

export function createFloodEvidence() {
  let previous = null
  return {
    reset() { previous = null },
    update(result, at) {
      if (!Number.isFinite(at)) { previous = null; return { state: 'unknown', reason: 'invalid_time' } }
      const water = result?.findings?.filter(f => f.cls === 'water' && f.areaFrac >= FLOOD_MIN_IMAGE_FRACTION)
        .sort((a, b) => b.areaFrac - a.areaFrac)[0]
      const obscured = result?.blind || result?.findings?.some(f => f.cls === 'haze')
      if (!water || obscured) {
        previous = null
        return { state: 'unknown', reason: obscured ? 'obscured' : 'no_water_evidence', at }
      }
      const continuous = previous && at > previous.at && at - previous.at <= FLOOD_SAMPLE_MAX_AGE_MS
        && overlap(previous.region, water) >= 0.5
      previous = {
        region: water, at, firstAt: continuous ? previous.firstAt : at,
        samples: continuous ? previous.samples + 1 : 1,
      }
      const spanMs = at - previous.firstAt
      return {
        state: previous.samples >= FLOOD_MIN_SAMPLES && spanMs >= FLOOD_MIN_SPAN_MS ? 'possible_flooding' : 'checking',
        reason: 'persistent_reflective_surface', at, spanMs, samples: previous.samples,
        imageFraction: water.areaFrac, region: water,
        method: 'reflective_surface_temporal_v1',
      }
    },
  }
}

export function currentFloodEvidence(evidence, now) {
  if (!evidence || !Number.isFinite(now) || !Number.isFinite(evidence.at)
    || now < evidence.at || now - evidence.at > FLOOD_SAMPLE_MAX_AGE_MS) {
    return { state: 'unknown', reason: 'no_current_frames' }
  }
  return evidence
}

export function floodEvidenceText(evidence, lang = 'en') {
  const th = lang === 'th'
  if (evidence?.state === 'possible_flooding') return th ? 'อาจมีน้ำท่วม · ตรวจภาพ' : 'Possible flooding · inspect footage'
  if (evidence?.state === 'checking') return th ? 'พบผิวคล้ายน้ำ · กำลังตรวจความต่อเนื่อง' : 'Water-like patch · checking persistence'
  if (evidence?.reason === 'obscured') return th ? 'ภาพมัว · ประเมินน้ำท่วมไม่ได้' : 'Obscured · cannot assess flooding'
  return th ? 'ยังประเมินน้ำท่วมไม่ได้ · ไม่ใช่ปลอดภัย' : 'Flooding unknown · not an all-clear'
}
