// Runs the vehicle-count pilot's model off the page. TensorFlow.js evaluates
// generated code, which the page's CSP rightly forbids; this worker gets its
// own narrow CSP (public/_headers) so the page keeps its own. Both libraries
// are self-hosted copies of tfjs 4.22.0 and coco-ssd 2.2.3, byte-checked
// against the jsdelivr releases (sha384 in docs/digital-twin-pilot.md).
importScripts('/vendor/tfjs-4.22.0.min.js', '/vendor/coco-ssd-2.2.3.min.js');

let detector;
self.onmessage = async ({ data }) => {
  try {
    detector ??= await self.cocoSsd.load({ base: 'lite_mobilenet_v2' });
    self.postMessage({ id: data.id, predictions: await detector.detect(data.image, 100, 0.6) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message || error) });
  }
};
