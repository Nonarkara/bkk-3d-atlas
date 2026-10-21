// Wireframe monuments: Democracy Monument, the Giant Swing, Wat Arun's prangs,
// Victory Monument, Baiyoke II's neighbour Golden Mount and the Rattanakosin
// set — drawn as LineSegments from procedural geometry, no external assets.
//
// Ported from PR #19 (cursor/wireframe-landmarks-c6d1), which was closed rather
// than merged. Two things changed, both because that branch predated this repo's
// current state:
//
//   - three.js resolves through the pinned import map (`import('three')`,
//     three@0.170.0) instead of a second vendored copy at
//     /vendor/three.module.js. This repo does not vendor three; the massing and
//     heritage-forms layers both resolve through the map, and two unpinned
//     copies of a rendering library is one version bump away from silent drift.
//   - render() takes MapLibre 5+'s `args.defaultProjectionData.mainMatrix`.
//     The branch used the pre-5 signature `render(gl, matrix)`, which on 6.4.1
//     receives the args object instead of a matrix — it installs cleanly and
//     draws nothing.
//
// The models are static, so render() never asks the map to repaint.

import {
  PALETTE,
  WIRE_LANDMARKS,
  buildAll,
  detailForViewport,
} from "./wireframe-geometry.js";
import { composeProjection } from './custom-layer-matrix.js';

export const WIRE_LAYER_ID = "bkkx-wireframe-landmarks";

let modulePromise = null;

function loadThree() {
  // Lazy, and through the same specifier every other 3D layer uses. Resolving
  // 'three' is what the import map is for; a hardcoded path silently opts out
  // of the pin, the integrity hash, and Dependabot at once.
  modulePromise = modulePromise || import("three");
  return modulePromise;
}

export async function installWireframeLandmarks(map) {
  if (map.getLayer(WIRE_LAYER_ID)) {
    try { map.setLayoutProperty(WIRE_LAYER_ID, "visibility", "visible"); } catch { /* custom layer */ }
    return;
  }
  const THREE = await loadThree();
  const width = map.getCanvas()?.clientWidth || window.innerWidth;
  const detail = detailForViewport(width);
  const models = buildAll(detail);
  const layer = createLayer(THREE, map, models, detail);
  map.addLayer(layer);
  map.triggerRepaint();
}

export function uninstallWireframeLandmarks(map) {
  if (map.__bkkxWireClick) {
    map.off("click", map.__bkkxWireClick);
    delete map.__bkkxWireClick;
  }
  delete map.__bkkxWireHit;
  if (map.__bkkxWirePopup) {
    map.__bkkxWirePopup.remove();
    delete map.__bkkxWirePopup;
  }
  if (map.getLayer(WIRE_LAYER_ID)) {
    try { map.removeLayer(WIRE_LAYER_ID); } catch { /* already gone */ }
  }
}

function nearestLandmark(lngLat, radiusOverride) {
  const lng = lngLat.lng ?? lngLat[0];
  const lat = lngLat.lat ?? lngLat[1];
  let best = null;
  let bestD = Infinity;
  for (const spec of WIRE_LANDMARKS) {
    const d = haversine(lat, lng, spec.lat, spec.lng);
    const limit = radiusOverride ?? spec.pickRadius;
    if (d <= limit && d < bestD) {
      best = spec;
      bestD = d;
    }
  }
  return best ? { spec: best, meters: bestD } : null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function popupFor(spec) {
  const card = document.createElement("div");
  card.className = "atlas-cctv-card";
  const title = document.createElement("strong");
  title.textContent = spec.name;
  const thai = document.createElement("p");
  thai.textContent = spec.nameTh;
  const note = document.createElement("p");
  note.textContent = spec.note;
  card.append(title, thai, note);
  if (spec.reference) {
    const link = document.createElement("a");
    link.href = spec.reference.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${spec.reference.title} · ${spec.reference.author} · ${spec.reference.license}`;
    card.append(link);
  }
  const coord = document.createElement("p");
  coord.textContent = spec.coordSource;
  card.append(coord);
  return card;
}

function createLayer(THREE, map, models, detail) {
  const origin = maplibregl.MercatorCoordinate.fromLngLat([100.497, 13.752], 0);
  const scale = origin.meterInMercatorCoordinateUnits();
  let segments = 0;

  const layer = {
    id: WIRE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.camera.matrixAutoUpdate = false;
      if ("projectionMatrixAutoUpdate" in this.camera) {
        this.camera.projectionMatrixAutoUpdate = false;
      }
      this.scene = new THREE.Scene();
      const material = new THREE.LineBasicMaterial({
        color: 0xf5ecc2,
        // depthTest true: heritage buildings render first (bottom of LAYER_STACK),
        // so wires are occluded by buildings behind them and draw over open space.
        // depthWrite false: labels/symbols drawn after still paint over wires.
        depthTest: true,
        depthWrite: false,
        transparent: false,
        toneMapped: false,
      });
      const root = new THREE.Group();
      root.name = "landmarks";
      root.frustumCulled = false;
      for (const model of models) {
        const mc = maplibregl.MercatorCoordinate.fromLngLat([model.spec.lng, model.spec.lat], 0);
        const east = (mc.x - origin.x) / scale;
        const south = (mc.y - origin.y) / scale;
        const placed = place(model.positions, east, south, model.spec.yaw);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(placed, 3));
        const lines = new THREE.LineSegments(geometry, material);
        lines.name = model.id;
        lines.frustumCulled = false;
        root.add(lines);
        segments += model.segments;
      }
      this.scene.add(root);
      this.segments = segments;
      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      this.renderer.autoClear = false;
      if (THREE.NoToneMapping !== undefined) this.renderer.toneMapping = THREE.NoToneMapping;
      if (THREE.SRGBColorSpace !== undefined) {
        try { this.renderer.outputColorSpace = THREE.SRGBColorSpace; } catch { /* shared context */ }
      }
      this.renderer.setPixelRatio(1);
      const canvas = map.getCanvas();
      this.renderer.setSize(canvas.width, canvas.height, false);

      const hit = (point) => {
        if (!map.getLayer(WIRE_LAYER_ID)) return null;
        const ll = map.unproject(point);
        return nearestLandmark(ll);
      };
      map.__bkkxWireHit = hit;
      map.__bkkxWireClick = (event) => {
        const found = nearestLandmark(event.lngLat);
        if (!found) return;
        if (map.__bkkxWirePopup) map.__bkkxWirePopup.remove();
        map.__bkkxWirePopup = new maplibregl.Popup({ className: "atlas-cctv-popup", maxWidth: "280px" })
          .setLngLat(event.lngLat)
          .setDOMContent(popupFor(found.spec))
          .addTo(map);
      };
      map.on("click", map.__bkkxWireClick);
      this.detail = detail;
      this.palette = PALETTE.ink;
    },
    render(gl, args) {
      // The scene is built in metres relative to `origin`, a fixed anchor north
      // of the monuments. composeProjection() bridges metres -> normalised
      // Mercator -> clip space. Do not substitute args.projectionMatrix here:
      // that is the camera's view-space frustum matrix, and a metre-scale scene
      // fed to it lands ten screen-widths off. See custom-layer-matrix.js.
      if (!this.renderer) return;
      const matrix = composeProjection(THREE, args, {
        x: origin.x,
        y: origin.y,
        z: origin.z,
        scale,
      });
      if (!matrix) return;
      this.camera.projectionMatrix = matrix;
      const canvas = this.map.getCanvas();
      if (canvas.width !== this.renderer.domElement.width || canvas.height !== this.renderer.domElement.height) {
        this.renderer.setSize(canvas.width, canvas.height, false);
      }
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      if (!this.announced) {
        this.announced = true;
        const payload = {
          segments: this.segments,
          phone: !!this.detail?.phone,
          ink: PALETTE.ink,
          models: models.map((model) => model.id),
        };
        window.__bkkxWireReady = true;
        window.__bkkxWireStats = payload;
        window.dispatchEvent(new CustomEvent("bkkx-wireframes-ready", { detail: payload }));
      }
    },
    onRemove() {
      if (this.scene) {
        this.scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
        });
      }
      if (this.renderer) {
        try { this.renderer.dispose(); } catch { /* map still owns the context */ }
      }
    },
  };
  return layer;
}

function place(positions, east, south, yaw) {
  const out = new Float32Array(positions.length);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const xr = x * c - z * s;
    const zr = x * s + z * c;
    out[i] = east + xr;
    out[i + 1] = y;
    out[i + 2] = south + zr;
  }
  return out;
}
