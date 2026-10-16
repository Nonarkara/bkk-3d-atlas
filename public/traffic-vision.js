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
let activeAnalysis = null; // One actual inference at a time, including across wall reopenings.
export function withDeadline(task, milliseconds = 90000) { // first run downloads ~1.5 MB runtime + weights
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Analysis timed out')), milliseconds);
    Promise.resolve(task).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
// The model runs in /vision-worker.js: TensorFlow.js needs eval, which the
// page CSP forbids (it silently left window.tf empty, 2026-10-16). Only
// pixels cross to the worker; the model and weights stay in this browser.
function workerDetector() {
  const worker = new Worker('/vision-worker.js');
  const pending = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    data.error ? job.reject(new Error(data.error)) : job.resolve(data.predictions);
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(new Error('Model runtime unavailable'));
    pending.clear();
    worker.terminate();
    modelPromise = null; // a failed runtime may be retried on the next request
  };
  return {
    detect(canvas) {
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, image });
      });
    },
  };
}
async function model() {
  if (!modelPromise) modelPromise = Promise.resolve(workerDetector());
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
      if (activeAnalysis) { output.textContent = 'Another local analysis is still running · wait or reload this page'; return; }
      const image = tile.querySelector('img');
      if (!image?.complete || !image.naturalWidth) { output.textContent = 'Picture unavailable · no traffic conclusion'; return; }
      busy = true; button.disabled = true;
      output.textContent = 'Loading / analysing locally…';
      let interrupted = false, expired = false;
      const onHidden = () => {
        if (document.hidden) {
          interrupted = true;
          output.textContent = 'Analysis interrupted while page hidden · request again when ready';
        }
      };
      document.addEventListener('visibilitychange', onHidden);
      try {
        const task = (async () => {
          const detector = await model();
          if (closed || interrupted || expired || document.hidden) return null;
          const canvas = document.createElement('canvas');
          try {
            const scale = Math.min(1, 640 / image.naturalWidth);
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            // Fail on tainted media instead of returning zero.
            ctx.getImageData(0, 0, 1, 1);
            return trafficSummary(await detector.detect(canvas, 100, 0.6), canvas.width, canvas.height);
          } finally { canvas.width = 0; canvas.height = 0; }
        })();
        activeAnalysis = task;
        // Release only when the underlying task ends, NOT when its UI deadline
        // expires: a timed-out GPU task must not spawn concurrent retries.
        task.then(() => { if (activeAnalysis === task) activeAnalysis = null; }, () => { if (activeAnalysis === task) activeAnalysis = null; });
        const result = await withDeadline(task);
        if (closed || interrupted || document.hidden || !result) return;
        output.textContent = `Experimental: ${result.total} possible vehicles in this picture (${Object.entries(result.counts).map(([k,v]) => `${k}: ${v}`).join(', ')}). Analysed ${new Date().toLocaleTimeString()}; capture time unknown. May miss or misclassify vehicles. Not a congestion, speed or road-clearance assessment.`;
      } catch (error) {
        expired = true;
        console.warn('BKKx traffic pilot unavailable', error);
        if (!closed && !interrupted) output.textContent = 'Analysis unavailable or timed out · reload to retry · no traffic conclusion';
      } finally {
        document.removeEventListener('visibilitychange', onHidden);
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
