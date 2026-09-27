// Build the road-cell index the flood engine snaps reports onto.
//
//   node scripts/build-flood-road-cells.mjs <dir-of-overpass-json-tiles>
//
// Input: Overpass `out tags geom` JSON tiles of Bangkok highways (motorway
// … residential, living_street, *_link). Output: public/flood-roads/,
// one file per 0.02° cell (~2.2 km) holding every way whose bounding box
// touches the cell, plus manifest.json. The Worker loads only the cells a
// report falls in, so the whole metro network never sits in memory.
//
// Cell file: { v:2, ways: [[osmId, name, cls, [lng5,lat5, dLng,dLat, …]]] }
// coordinates ×1e5 (~1 m); the first pair absolute, the rest deltas from
// the previous point. cls: 1 motorway … 8 living_street.
// © OpenStreetMap contributors, ODbL 1.0.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: build-flood-road-cells.mjs <overpass-tile-dir>");
const OUT = new URL("../public/flood-roads/", import.meta.url).pathname;
export const ORIGIN = { lng: 100.3, lat: 13.45 };
export const CELL = 0.02;
const CLS = {
  motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5, unclassified: 6, residential: 7, living_street: 8,
};

const ways = new Map();
for (const f of readdirSync(SRC).filter((f) => f.endsWith(".json"))) {
  const j = JSON.parse(readFileSync(join(SRC, f), "utf8"));
  for (const e of j.elements ?? []) {
    if (e.type !== "way" || !e.geometry?.length || ways.has(e.id)) continue;
    const hw = String(e.tags?.highway ?? "").replace(/_link$/, "");
    const cls = CLS[hw];
    if (!cls) continue;
    const name = e.tags?.["name:th"] || e.tags?.name || e.tags?.ref || "";
    const flat = [];
    let px = 0, py = 0;
    for (const p of e.geometry) {
      const x = Math.round(p.lon * 1e5), y = Math.round(p.lat * 1e5);
      flat.push(x - px, y - py);
      px = x;
      py = y;
    }
    ways.set(e.id, { id: e.id, name, cls, flat, b: e.bounds });
  }
}

const cells = new Map();
const cellOf = (lng, lat) => [Math.floor((lng - ORIGIN.lng) / CELL), Math.floor((lat - ORIGIN.lat) / CELL)];
for (const w of ways.values()) {
  const [x0, y0] = cellOf(w.b.minlon, w.b.minlat);
  const [x1, y1] = cellOf(w.b.maxlon, w.b.maxlat);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const k = `${x}_${y}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push([w.id, w.name, w.cls, w.flat]);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [k, list] of cells) {
  const s = JSON.stringify({ v: 2, ways: list });
  bytes += s.length;
  writeFileSync(join(OUT, `${k}.json`), s);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  v: 2,
  origin: ORIGIN,
  cell: CELL,
  cells: [...cells.keys()].sort(),
  ways: ways.size,
  classes: CLS,
  source: "OpenStreetMap via Overpass API",
  license: "ODbL-1.0 · © OpenStreetMap contributors",
  built: new Date().toISOString().slice(0, 10),
}));
console.log(`${ways.size} ways → ${cells.size} cells, ${(bytes / 1e6).toFixed(1)} MB`);
