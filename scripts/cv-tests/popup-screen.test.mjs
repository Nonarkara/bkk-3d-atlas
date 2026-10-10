import test from 'node:test'
import assert from 'node:assert/strict'
import { screeningLine } from '../../public/cv/popupScreen.js'

// The atlas popup's one line under the stream. It may name what was
// measured; it may never turn absence into reassurance.
test('the popup line never reads as an all-clear', () => {
  const lines = [
    screeningLine(null),
    screeningLine(null, true),
    screeningLine({ findings: [], motionRatio: 0, flood: { state: 'unknown', reason: 'no_water_evidence' } }),
    screeningLine({ findings: [{ cls: 'vehicle' }], motionRatio: 0.012, flood: { state: 'unknown' } }),
    screeningLine({ findings: [{ cls: 'water' }], motionRatio: 0, flood: { state: 'checking' } }),
    screeningLine({ findings: [{ cls: 'water' }], motionRatio: 0, flood: { state: 'possible_flooding' } }),
  ]
  for (const l of lines) assert.doesNotMatch(l.replace("not an all-clear", ""), /\b(clear|safe|dry|no flood|confirmed)\b/i, l)
  assert.match(lines[1], /unreadable/)
  assert.match(lines[2], /not an all-clear/)
  assert.match(lines[3], /1× vehicle-shaped · 1\.20% moved/)
  assert.match(lines[5], /Possible flooding · inspect footage/)
})
