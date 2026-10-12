// MapLibre custom layer. Loaded only after the Landmarks toggle is on.
// Three.js stays at /vendor/three.module.js (same origin, no new script host).
// The models are static, so render() does not ask the map to repaint.

import {
  PALETTE,
  WIRE_LANDMARKS,
  buildAll,
  detailForViewport,
} from "/wireframe-geometry.js";

export const WIRE_LAYER_ID = "bkkx-wireframe-landmarks";

let modulePromise = null;

function loadThree() {
  modulePromise = modulePromise || import("/vendor/three.module.js");
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
        depthTest: false,
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
    render(gl, matrix) {
      if (!this.renderer || !matrix) return;
      const m = new THREE.Matrix4().fromArray(matrix);
      const translate = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
      const sized = new THREE.Matrix4().makeScale(scale, -scale, scale);
      const tilt = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      this.camera.projectionMatrix = m.multiply(translate).multiply(sized).multiply(tilt);
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
