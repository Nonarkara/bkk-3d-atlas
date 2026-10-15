// Opt-in research tool. No frames, detections or identifiers leave this browser.
// COCO-SSD is a general detector, NOT a calibrated traffic or safety model.
export const TRAFFIC_CLASSES = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);
export function trafficSummary(predictions, width, height) {
  if (!(width > 0 && height > 0)) throw new Error('Image dimensions unavailable');
  const counts = Object.fromEntries([...TRAFFIC_CLASSES].map(key => [key, 0]));
  for (const p of predictions) {
    if (!p || !TRAFFIC_CLASSES.has(p.class) || !Number.isFinite(p.score) || p.score < 0.6 || p.score > 1) continue;
    if (!Array.isArray(p.bbox) || p.bbox.length !== 4 || !p.bbox.every(Number.isFinite)) continue;
    const [x, y, w, h] = p.bbox;
    if (w <= 0 || h <= 0 || x >= width || y >= height || x + w <= 0 || y + h <= 0) continue;
    counts[p.class]++;
  }
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), tier: 'experimental', captureTime: null };
}

let modelPromise;
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('Model download timed out')); }, 30000);
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => { clearTimeout(timer); ready() ? resolve() : reject(new Error('Model runtime unavailable')); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Model download unavailable')); };
    document.head.appendChild(script);
  });
}
async function model() {
  if (!modelPromise) modelPromise = (async () => {
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js', () => !!window.tf);
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js', () => !!window.cocoSsd);
    return window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
  })().catch(error => { modelPromise = null; throw error; });
  return modelPromise;
}

// Three on-demand samples only; no surveillance loop or persistent storage.
export function installTrafficPilot(root, { enabled = false } = {}) {
  if (!enabled) return () => {};
  let closed = false, busy = false;
  const tiles = [...root.querySelectorAll('.atlas-wall-tile[data-traffic-eligible="true"]')].filter(tile => tile.querySelector('img')).slice(0, 3);
  const handlers = [];
  for (const tile of tiles) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Experimental vehicle count';
    const output = document.createElement('p');
    output.setAttribute('aria-live', 'polite');
    output.textContent = 'Unvalidated pilot · model download on request · frames stay in this browser.';
    const run = async () => {
      if (closed || busy || document.hidden) return;
      const image = tile.querySelector('img');
      if (!image?.complete || !image.naturalWidth) { output.textContent = 'Picture unavailable · no traffic conclusion'; return; }
      busy = true; button.disabled = true;
      output.textContent = 'Loading / analysing locally…';
      let canvas;
      try {
        const detector = await model();
        if (closed || document.hidden) return;
        canvas = document.createElement('canvas');
        const scale = Math.min(1, 640 / image.naturalWidth);
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        // Explicitly fail on cross-origin/tainted media instead of returning zero.
        ctx.getImageData(0, 0, 1, 1);
        const result = trafficSummary(await detector.detect(canvas, 100, 0.6), canvas.width, canvas.height);
        if (closed || document.hidden) return;
        output.textContent = `Experimental: ${result.total} possible vehicles in this picture (${Object.entries(result.counts).map(([k,v]) => `${k}: ${v}`).join(', ')}). Analysed ${new Date().toLocaleTimeString()}; capture time unknown. May miss or misclassify vehicles. Not a congestion, speed or road-clearance assessment.`;
      } catch {
        if (!closed) output.textContent = 'Analysis unavailable · no traffic conclusion';
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        busy = false;
        if (!closed) button.disabled = false;
      }
    };
    button.addEventListener('click', run);
    tile.querySelector('figcaption').append(button, output);
    handlers.push(() => { button.removeEventListener('click', run); button.remove(); output.remove(); });
  }
  return () => { closed = true; handlers.forEach(dispose => dispose()); };
}
