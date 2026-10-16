// MapLibre GL 6.4.1, self-hosted and byte-identical to the npm release
// (pattern from the Jakarta atlas). v6 is ES-module only; the atlas modules
// read the classic global, so this sets it before any of them runs.
// 6.4.1 fixes GHSA-jrc7-96c5-q579 (attribution sanitizer XSS) in 4.7.1.
import * as maplibregl from '/vendor/maplibre-6.4.1/maplibre-gl.mjs';
window.maplibregl = maplibregl;
