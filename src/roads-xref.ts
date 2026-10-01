// Honest cross-referenced flooded-roads view.
//
// The atlas already has two layers that each tell one half of the story:
//
//   1. /api/flood/roads         — Traffy resident reports + iTIC/Longdo
//                                 official events + BMA DDS road reports,
//                                 snapped to OSM road polylines. A row is a
//                                 road *stretch* with a depth, district,
//                                 and a `placed` flag (report vs road-name).
//
//   2. /api/flood-sensors       — FloodDash's judged canal/river gauges.
//                                 Each gauge has lat/lng, band, confidence.
//
// Pair the two as nearby evidence. Canal and river gauges do not measure
// road flooding or passability. The legacy confirmed API bucket means a
// recent report near a fresh, high-confidence gauge alert; the UI names
// that relationship explicitly. All other reports remain visible.
//
// What "nearby" means here: within ~250 m of the road stretch, measured
// with the same equirectangular projection as the rest of the atlas
// (flooddash.ts distanceM). 250 m is generous enough to catch a sensor
// at the end of the same soi. Distance alone cannot establish hydraulic
// connectivity or whether water has reached the road surface.
//
// Output shape — three groups, never overlapped:
//
//   - confirmed         recent road report + nearby fresh gauge alert
//   - unconfirmed       road claim + no nearby sensor OR sensor stale
//                       OR sensor dry (the closed section in the UI)
//   - sensor_only       nearby sensor wet + no road claim within 6 h
//                       (sensors ahead of the news — worth showing too)
//
// Source: world.tehx.dyndns.info/flood/api, Owner rule 2026-10-01.

import { distanceM, type FloodState } from "./flooddash";
import type { FloodRoads } from "./floodroads";
import { reportWithin } from "./report-freshness";

const XREF_MAX_M = 250;        // context radius; canal/river readings do not measure road depth
const SENSOR_ONLY_HOURS = 6;   // how recent a sensor reading needs to be to count as "ahead of the news"
const SENSOR_ONLY_MAX_M = 250; // same radius for the reverse lookup
const STALE_MIN = 45;          // FloodDash stamps confidence="stale" past this age; we re-check defensively

const WET_BANDS = new Set(["prepare", "evacuate", "overflow-imminent", "observed-overflow"]);
const DRY_BANDS = new Set(["safe", "watch"]);

type FeatureCollection = { features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[] };
type SensorFeature = { id?: string; lng?: number; lat?: number; name?: string; band?: string; bandEn?: string; confidence?: string; ageMin?: number; observedAt?: string | null };

function pointToLineM(lng: number, lat: number, lineCoords: number[][]): number {
  if (!lineCoords.length) return Infinity;
  if (lineCoords.length === 1) {
    const [x, y] = lineCoords[0];
    return distanceM(lng, lat, x, y);
  }
  let best = Infinity;
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [ax, ay] = lineCoords[i];
    const [bx, by] = lineCoords[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((lng - ax) * dx + (lat - ay) * dy) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = ax + t * dx, py = ay + t * dy;
    const d = distanceM(lng, lat, px, py);
    if (d < best) best = d;
  }
  return best;
}

function isFresh(observedAt: string | null | undefined, ageMin: number | null | undefined, nowMs: number): boolean {
  // A saved ageMin alone freezes time across a relay outage. Require the
  // observation timestamp, and honour either signal when it says stale.
  if (ageMin != null && (!Number.isFinite(ageMin) || ageMin < -5 || ageMin > STALE_MIN)) return false;
  return reportWithin(observedAt, nowMs, STALE_MIN / 60);
}

function tagQuality(sensor: SensorFeature | null, distM: number, nowMs: number): {
  q: "sensor-confirmed" | "sensor-dry" | "sensor-stale" | "no-sensor";
  confirmation: "wet" | "dry" | "stale" | "none";
} {
  if (!sensor || distM > XREF_MAX_M) return { q: "no-sensor", confirmation: "none" };
  const fresh = sensor.confidence === "high" && isFresh(sensor.observedAt, sensor.ageMin, nowMs);
  if (!fresh) return { q: "sensor-stale", confirmation: "stale" };
  const band = String(sensor.band ?? "");
  if (WET_BANDS.has(band)) return { q: "sensor-confirmed", confirmation: "wet" };
  if (DRY_BANDS.has(band)) return { q: "sensor-dry", confirmation: "dry" };
  return { q: "sensor-stale", confirmation: "stale" };
}

function nearestSensor(lineCoords: number[][], sensors: SensorFeature[]): { s: SensorFeature; d: number } | null {
  if (!lineCoords.length) return null;
  let best: { s: SensorFeature; d: number } | null = null;
  for (const s of sensors) {
    if (typeof s.lng !== "number" || typeof s.lat !== "number") continue;
    const d = pointToLineM(s.lng, s.lat, lineCoords);
    if (d <= XREF_MAX_M && (!best || d < best.d)) best = { s, d };
  }
  return best;
}

export type XrefRoad = {
  /** A short id derived from road + first coordinate so the atlas can deep-link to it. */
  id: string;
  road: string | null;
  road_class: number | null;
  district_hint: string | null;
  center: [number, number];
  /** Source breakdown: how many resident / official / DDS hits fed this stretch. */
  n_traffy: number;
  n_itic: number;
  n_dds: number;
  /** Highest depth rank reported in the window (FloodDash depth order). */
  depth_rank: number;
  depth_label: string | null;
  /** ISO timestamp of the most recent hit on this stretch. */
  latest: string | null;
  /** Whether any hit closed the road. */
  closed: boolean;
  /** "report" if placed by Traffy/iTIC, "road-name" if placed by DDS anchor. */
  placed: string;
  q: "sensor-confirmed" | "sensor-dry" | "sensor-stale" | "no-sensor";
  confirmation: "wet" | "dry" | "stale" | "none";
  nearest_gauge: {
    id: string | null;
    name: string | null;
    distance_m: number;
    band: string | null;
    band_en: string | null;
    confidence: string | null;
  } | null;
};

export type XrefSensorOnly = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  band: string;
  band_en: string | null;
  band_th: string | null;
  age_min: number | null;
  /** Closest road stretch we could find (may be null if none). */
  nearest_road: { id: string; road: string | null; distance_m: number } | null;
};

export type RoadsXref = {
  tool: "bkk-roads-xref";
  version: 1;
  fetchedAt: string;
  fetchedAtMs: number;
  /** Max distance used to pair a road stretch with a sensor (m). */
  confirmRadiusM: number;
  counts: {
    confirmed: number;
    unconfirmed_no_sensor: number;
    unconfirmed_sensor_stale: number;
    unconfirmed_sensor_dry: number;
    sensor_only: number;
    total_roads: number;
  };
  attribution: string;
  credit: string;
  /** The roads split into confirmed + unconfirmed buckets. */
  confirmed: XrefRoad[];
  unconfirmed: XrefRoad[];
  /** Sensors reporting wet, with no recent road report nearby. */
  sensorOnly: XrefSensorOnly[];
};

export function buildRoadsXref(
  roads: FloodRoads | null,
  floodState: FloodState | null,
  nowMs: number = Date.now(),
): RoadsXref {
  const fetchedAt = roads?.fetchedAt ?? new Date(nowMs).toISOString();
  const sensors: SensorFeature[] = ((floodState?.gauges ?? []) as SensorFeature[]).filter(
    (g) => typeof g.lng === "number" && typeof g.lat === "number",
  );

  const confirmed: XrefRoad[] = [];
  const unconfirmed: XrefRoad[] = [];

  const features = ((roads?.roads as FeatureCollection | undefined)?.features ?? []) as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[];
  for (const f of features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const coords = (f.geometry?.coordinates as number[][] | undefined) ?? [];
    if (!coords.length || !reportWithin(props.latest, nowMs, 24)) continue;

    const near = nearestSensor(coords, sensors);
    const tagged = tagQuality(near?.s ?? null, near?.d ?? Infinity, nowMs);
    const { q, confirmation } = tagged.q === "sensor-confirmed" && !reportWithin(props.latest, nowMs, SENSOR_ONLY_HOURS)
      ? { q: "sensor-stale" as const, confirmation: "stale" as const } : tagged;

    const [cx, cy] = coords[0] ?? [];
    const xrefRoad: XrefRoad = {
      id: String(props.id ?? `${props.road ?? "road"}-${cx?.toFixed(4) ?? ""}-${cy?.toFixed(4) ?? ""}`),
      road: (props.road as string | null) ?? null,
      road_class: (props.cls as number | null) ?? null,
      district_hint: null,
      center: [cx ?? 0, cy ?? 0],
      n_traffy: Number(props.traffy ?? 0),
      n_itic: Number(props.itic ?? 0),
      n_dds: Number(props.dds ?? 0),
      depth_rank: Number(props.depth ?? 0),
      depth_label: (props.depthEn as string | null) ?? null,
      latest: (props.latest as string | null) ?? null,
      closed: Boolean(props.closed),
      placed: (props.placed as string) ?? "report",
      q,
      confirmation,
      nearest_gauge: near
        ? {
            id: near.s.id ?? null,
            name: near.s.name ?? null,
            distance_m: Math.round(near.d),
            band: (near.s.band as string | null) ?? null,
            band_en: (near.s.bandEn as string | null) ?? null,
            confidence: (near.s.confidence as string | null) ?? null,
          }
        : null,
    };
    if (q === "sensor-confirmed") confirmed.push(xrefRoad);
    else unconfirmed.push(xrefRoad);
  }

  // Sort: confirmed by depth desc, unconfirmed by depth desc
  confirmed.sort((a, b) => b.depth_rank - a.depth_rank || (b.latest ?? "").localeCompare(a.latest ?? ""));
  unconfirmed.sort((a, b) => b.depth_rank - a.depth_rank || (b.latest ?? "").localeCompare(a.latest ?? ""));

  // Sensor-only: a wet sensor with no road report nearby in the last SENSOR_ONLY_HOURS.
  const confirmedSet = new Set(confirmed.map((r) => r.id));
  const recentFeatures = features.filter((f) => reportWithin(f.properties?.latest, nowMs, SENSOR_ONLY_HOURS));

  const sensorOnly: XrefSensorOnly[] = [];
  for (const s of sensors) {
    if (typeof s.lng !== "number" || typeof s.lat !== "number") continue;
    const band = String(s.band ?? "");
    if (!WET_BANDS.has(band)) continue;
    if (s.confidence !== "high" || !isFresh(s.observedAt ?? null, s.ageMin ?? null, nowMs)) continue;
    // Skip if there's a confirmed road report very close.
    let claimedByRoad = false;
    let best: { id: string; road: string | null; distance_m: number } | null = null;
    for (const f of recentFeatures) {
      const coords = (f.geometry?.coordinates as number[][] | undefined) ?? [];
      const d = pointToLineM(s.lng, s.lat, coords);
      if (d <= SENSOR_ONLY_MAX_M) {
        const props = (f?.properties ?? {}) as Record<string, unknown>;
        const [cx, cy] = coords[0] ?? [];
        const id = String(props.id ?? `${props.road ?? "road"}-${cx?.toFixed(4) ?? ""}-${cy?.toFixed(4) ?? ""}`);
        if (confirmedSet.has(id)) {
          claimedByRoad = true;
          break;
        }
        if (!best || d < best.distance_m) best = { id, road: (props.road as string | null) ?? null, distance_m: Math.round(d) };
      }
    }
    if (claimedByRoad) continue;
    sensorOnly.push({
      id: String(s.id ?? ""),
      name: String(s.name ?? ""),
      lng: s.lng,
      lat: s.lat,
      band,
      band_en: (s.bandEn as string | null) ?? null,
      band_th: null,
      age_min: typeof s.ageMin === "number" ? s.ageMin : null,
      nearest_road: best,
    });
  }

  return {
    tool: "bkk-roads-xref",
    version: 1,
    fetchedAt,
    fetchedAtMs: nowMs,
    confirmRadiusM: XREF_MAX_M,
    counts: {
      confirmed: confirmed.length,
      unconfirmed_no_sensor: unconfirmed.filter((r) => r.q === "no-sensor").length,
      unconfirmed_sensor_stale: unconfirmed.filter((r) => r.q === "sensor-stale").length,
      unconfirmed_sensor_dry: unconfirmed.filter((r) => r.q === "sensor-dry").length,
      sensor_only: sensorOnly.length,
      total_roads: confirmed.length + unconfirmed.length,
    },
    attribution: "BMA DDS road reports + Traffy Fondue + iTIC/Longdo events, cross-checked against FloodDash gauges. Pattern from JK World (world.tehx.dyndns.info/flood) · Owner rule 2026-10-01. Not an official warning.",
    credit: "Road reports paired with nearby canal/river gauge alerts. Proximity does not verify road flooding, depth, clearance or passability. Legacy confirmed fields mean nearby gauge context only. Pattern from JK World.",
    confirmed,
    unconfirmed,
    sensorOnly,
  };
}

export function roadsXrefResponse(roads: FloodRoads | null, floodState: FloodState | null): Response {
  const xref = buildRoadsXref(roads, floodState);
  return new Response(JSON.stringify(xref), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
      "x-bkkx-source": "flood-roads × flood-sensors (JK World cross-reference pattern)",
    },
  });
}
