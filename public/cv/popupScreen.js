// FloodDash's camera-wall computer vision, for the one stream an atlas
// camera popup plays.
//
// detect.js and floodEvidence.js are FloodDash's own modules, copied
// unchanged; this file is the single-video form of FloodDash's
// public/js/cv/overlay.js loop and keeps its rules:
//
//   - ~2 Hz, at analysis size 160x90, in this browser. Nothing is uploaded.
//   - Only an advancing frame is a sample: paused, ended, not yet decoded,
//     or a media clock that has not moved for 2 s resets the evidence.
//   - hls.js plays through Media Source Extensions, which does not taint a
//     canvas, so the pixels on screen can be read. A stream the browser
//     will not hand over (Safari's native HLS from another origin) is
//     "CV unreadable", never "clear".
//   - Flood evidence needs a water-like patch (>= 5% of the image, same
//     place, IoU >= 0.5) across 3 samples spanning 5 s, none more than
//     3 s apart. The strongest wording is "Possible flooding · inspect
//     footage". Finding nothing draws nothing: absence is not an all-clear.

import { analyse, CLASS_LABEL, W, H } from './detect.js'
import { createFloodEvidence, floodEvidenceText } from './floodEvidence.js'

const MIN_TICK_MS = 450
const STALL_RESET_MS = 2000
const DRAW_SCALE = 2

// FloodDash's colour grammar, so a box means the same thing on both sites.
export const COLOR = {
  vehicle: '#F0B400',
  person: '#00933C',
  moving: '#8FA8C8',
  water: '#00A3E0',
  haze: '#B9A7D0',
}

/** Draw the regions and their labels, scaled up to the overlay canvas. */
export function drawFindings(ctx, findings) {
  const w = W * DRAW_SCALE
  const h = H * DRAW_SCALE
  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 2
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'
  const placed = []
  for (const f of findings) {
    if (!f.box) continue
    const color = COLOR[f.cls] || COLOR.moving
    const x = f.box.x0 * DRAW_SCALE
    const y = f.box.y0 * DRAW_SCALE
    const bw = (f.box.x1 - f.box.x0 + 1) * DRAW_SCALE
    const bh = (f.box.y1 - f.box.y0 + 1) * DRAW_SCALE
    ctx.strokeStyle = color
    if (f.cls === 'haze') {
      ctx.setLineDash([6, 4])
      ctx.strokeRect(1, 1, w - 2, h - 2)
      ctx.setLineDash([])
    } else {
      ctx.strokeRect(x, y, bw, bh)
    }
    const label = (CLASS_LABEL[f.cls]?.en || f.cls).toUpperCase()
    const tw = ctx.measureText(label).width + 8
    let lx = Math.max(0, Math.min(x, w - tw))
    let ly = Math.max(0, y - 14)
    for (let attempt = 0; attempt < 3; attempt++) {
      const clash = placed.some((r) => lx < r.x + r.w && lx + tw > r.x && ly < r.y + 14 && ly + 14 > r.y)
      if (!clash) break
      ly += 15
      if (ly + 14 > h) { ly = Math.max(0, h - 14); break }
    }
    placed.push({ x: lx, y: ly, w: tw })
    ctx.fillStyle = 'rgba(6,10,16,0.72)'
    ctx.fillRect(lx, ly, tw, 14)
    ctx.fillStyle = color
    ctx.fillText(label, lx + 4, ly + 1)
  }
}

/** The one line under the video. Exported for tests. */
export function screeningLine(result, unreadable = false) {
  if (unreadable) return '◌ CV unreadable · this stream cannot be read by the browser, so no claim is made about it'
  if (!result) return 'Screening starts once the stream is playing'
  const flood = result.flood
  if (flood?.state === 'possible_flooding' || flood?.state === 'checking') return floodEvidenceText(flood)
  if (!result.findings.length) return floodEvidenceText(flood)
  const counts = {}
  for (const f of result.findings) counts[f.cls] = (counts[f.cls] ?? 0) + 1
  const parts = Object.entries(counts).map(([k, n]) => `${n}× ${CLASS_LABEL[k]?.en || k}`)
  return `◉ ${parts.join(' · ')} · ${(result.motionRatio * 100).toFixed(2)}% moved · ${floodEvidenceText(flood)}`
}

/**
 * Screen one <video>. `overlay` is a canvas laid over it, `line` the status
 * element. Returns a stop function; call it when the popup closes.
 */
export function startVideoScreening(video, overlay, line) {
  const scratch = document.createElement('canvas')
  scratch.width = W
  scratch.height = H
  const sctx = scratch.getContext('2d', { willReadFrequently: true })
  overlay.width = W * DRAW_SCALE
  overlay.height = H * DRAW_SCALE
  const octx = overlay.getContext('2d')
  const tracker = createFloodEvidence()
  let prev = null
  let media = null
  let unreadable = false
  let lastTick = 0
  let raf = 0
  let stopped = false

  const say = (text, state) => {
    if (!line || (line.textContent === text && line.dataset.state === (state || ''))) return
    line.textContent = text
    line.dataset.state = state || ''
  }
  const reset = () => {
    prev = null
    tracker.reset()
    octx?.clearRect(0, 0, overlay.width, overlay.height)
  }

  // Match the box to the stream's own shape, so the overlay sits on the
  // pixels that were measured instead of a crop of them.
  const fitAspect = () => {
    if (video.videoWidth && video.videoHeight) {
      const ratio = `${video.videoWidth} / ${video.videoHeight}`
      video.style.aspectRatio = ratio
      overlay.style.aspectRatio = ratio
    }
  }
  video.addEventListener('loadedmetadata', fitAspect)

  const tick = (now) => {
    if (stopped) return
    raf = requestAnimationFrame(tick)
    if (now - lastTick < MIN_TICK_MS) return
    lastTick = now
    if (unreadable || !sctx || !octx) return
    // Stopped playback is not evidence of anything: back to unknown, as
    // FloodDash's wall does.
    if (video.readyState < 2 || video.paused || video.ended) {
      reset()
      say(floodEvidenceText(null), 'unknown')
      return
    }
    if (media && media.time === video.currentTime) {
      if (now - media.when > STALL_RESET_MS) { reset(); say(floodEvidenceText(null), 'unknown') }
      return
    }
    media = { time: video.currentTime, when: now }
    let frame
    try {
      sctx.drawImage(video, 0, 0, W, H)
      frame = sctx.getImageData(0, 0, W, H)
    } catch {
      unreadable = true
      reset()
      say(screeningLine(null, true), 'unreadable')
      return
    }
    const before = prev
    prev = frame
    if (!before) return
    let result
    try {
      result = analyse(before, frame)
      result.flood = tracker.update(result, Date.now())
    } catch {
      return
    }
    drawFindings(octx, result.findings)
    say(screeningLine(result), result.flood?.state)
    overlay.title = result.flood?.region?.evidence || result.findings[0]?.evidence || ''
  }
  raf = requestAnimationFrame(tick)
  say(screeningLine(null), 'unknown')

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    video.removeEventListener('loadedmetadata', fitAspect)
    reset()
  }
}
