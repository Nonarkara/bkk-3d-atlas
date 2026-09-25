// FloodDash relay — the atlas reads FloodDash's judgement instead of
// re-ingesting ThaiWater itself.
//
// FloodDash (flood.nonarkara.org) already ingests the same upstreams once,
// judges every gauge (band + action + freshness) and publishes a verdict per
// province. The atlas used to proxy ThaiWater directly; on 2026-09-25, with
// FloodDash holding Bangkok at "danger", ThaiWater was answering this
// Worker's shared egress with 429 and the gauge layer was blank. FloodDash's
// docs/TWIN-API.md asks consumers to relay rather than re-ingest.
//
// CONSERVATION LAW. The atlas shows a fresh FloodDash reading or the last
// good one with its age. Never blank while a copy exists, never an unlabelled
// age, never a verdict or a band FloodDash did not give. Each of the three
// upstream reads can fail alone; a failed part keeps its last good copy.
//
// POLITENESS. FloodDash runs on one Mac behind a tunnel. The cron refreshes
// at most every ~10 minutes (TWIN-API.md: "polling every 10 minutes is
// enough"). Visitors read D1, never FloodDash.
//
// WORDS. FloodDash's band and action text is life-safety copy, tested in its
// own system. It is passed through verbatim, never rephrased here.

import type { Env } from "./index";

export const FLOODDASH_ORIGIN = "https://flood.nonarkara.org";
const STATE_KEY = "bkk";
const REFRESH_EVERY_MS = 9.5 * 60_000;
export const STALE_AFTER_MIN = 30;
const UPSTREAM_TIMEOUT_MS = 20_000;
const SNAP_SAME_NAME_M = 1000;
const SNAP_ANY_M = 300;
const REACH_M = 1500;
export const DDPM_HOTLINE = "1784";

/** Metro box — the Chao Phraya reaches Bangkok through Nonthaburi and
 *  Pathum Thani, so their gauges belong on a Bangkok flood map. */
const BBOX = { minLat: 13.4, maxLat: 14.2, minLon: 100.2, maxLon: 101.1 };

// Severity order of FloodDash's gauge bands (server/indicator.js).
// no-signal and untrusted make no claim about the water, so they rank 0
// and never colour a waterway.
export const BAND_RANK: Record<string, number> = {
  "no-signal": 0,
  untrusted: 0,
  safe: 1,
  watch: 2,
  prepare: 3,
  evacuate: 4, // FloodDash labels this "NEAR BANK" — not an evacuation order
  "overflow-imminent": 5, // "MAY OVERTOP" — arithmetic, not observation
  "observed-overflow": 6,
};

// One palette for gauges, waterways and legend. Calm water blue at rest;
// the tone heats only where a judged gauge says so — read like traffic.
export const BAND_COLOR: Record<string, string> = {
  "no-signal": "#6b6d63",
  untrusted: "#8a8c80",
  safe: "#3FA7E0",
  watch: "#E8C547",
  prepare: "#E8A317",
  evacuate: "#E86A10",
  "overflow-imminent": "#DB3A1F",
  "observed-overflow": "#C8102E",
};

// FloodDash's own no-signal wording, used when it marks a gauge absent.
const SILENT_EN = "Gauge is silent — follow official channels";
const SILENT_TH = "เกจไม่ส่งข้อมูล — ติดตามช่องทางราชการ";

type Json = Record<string, unknown>;
type Fc = { features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: Json }[] };

export type Gauge = {
  id: string;
  lng: number;
  lat: number;
  name: string;
  nameTh: string;
  river: string | null;
  agency: string | null;
  basin: string | null;
  province: string | null;
  band: string;
  bandEn: string;
  bandTh: string;
  action: string;
  actionTh: string;
  basis: string | null;
  lastBandEn: string | null; // what an absent gauge said when it last spoke
  confidence: string;
  ageMin: number | null;
  observedAt: string | null;
  waterlevelMsl: number | null;
  minBank: number | null;
  freeboardM: number | null;
  riseMH: number | null;
  storagePercent: number | null;
  waterwayId: string | null;
  waterwayName: string | null;
};

export type FloodState = {
  schema: 1;
  fetchedAt: string;
  flooddashVersion: string | null;
  verdict: {
    level: string;
    band: string;
    score: number;
    headEn: string;
    headTh: string;
    reasonEn: string | null;
    reasonTh: string | null;
    stationsL5: number | null;
    stationsL4: number | null;
    rain24hMm: number | null;
    wetness: string | null;
    etaHours: number | null;
    updated: string | null;
  } | null;
  method: string | null;
  gauges: Gauge[];
  waterways: Record<string, { rank: number; band: string; gauge: string; confidence: string }>;
  canals: {
    date: string | null;
    stale: boolean;
    stations: {
      name: string;
      side: string;
      levelMsl: number | null;
      criticalMsl: number | null;
      marginM: number | null;
      status: string;
      statusTh: string;
      observedAt: string | null;
    }[];
  };
  roads: {
    days: string[];
    stale: boolean;
    fetchedAt: string | null;
    source: string;
    byDistrict: {
      districtId: number | null;
      nameEn: string;
      nameTh: string;
      reports: number;
      clearanceUnrecorded: number;
      maxDepthCm: number | null;
      latestFloodedAt: string | null;
    }[];
    records: {
      district: string;
      road: string;
      location: string;
      depthCm: string | null;
      lengthM: string | null;
      floodedAt: string | null;
      clearedAt: string | null;
      status: string;
    }[];
  };
  parts: Record<"twin" | "snapshot" | "dds", { ok: boolean; at: string | null; error: string | null }>;
};

/* ----------------------------------------------------------------- store */

async function readRow(env: Env): Promise<{ payload: FloodState; fetchedAt: string } | null> {
  const row = await env.CIVIC_DB.prepare(
    "SELECT payload, fetched_at FROM flood_state WHERE key = ?",
  )
    .bind(STATE_KEY)
    .first<{ payload: string; fetched_at: string }>();
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload) as FloodState, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

async function writeRow(env: Env, state: FloodState, error: string | null) {
  await env.CIVIC_DB.prepare(
    `INSERT INTO flood_state (key, payload, fetched_at, attempted_at, error)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(key) DO UPDATE SET payload = ?2, fetched_at = ?3, attempted_at = ?4, error = ?5`,
  )
    .bind(STATE_KEY, JSON.stringify(state), state.fetchedAt, new Date().toISOString(), error)
    .run();
}

/* ------------------------------------------------------------- geometry */

const R = 6_371_000;
function toXY(lng: number, lat: number, lat0: number): [number, number] {
  return [((lng * Math.PI) / 180) * R * Math.cos((lat0 * Math.PI) / 180), ((lat * Math.PI) / 180) * R];
}

export function distanceM(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const [ax, ay] = toXY(aLng, aLat, aLat);
  const [bx, by] = toXY(bLng, bLat, aLat);
  return Math.hypot(ax - bx, ay - by);
}

/** Shortest distance, in metres, from a point to a polyline. */
function pointToLineM(lng: number, lat: number, coords: number[][]): number {
  const [px, py] = toXY(lng, lat, lat);
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = toXY(coords[i][0], coords[i][1], lat);
    const [bx, by] = toXY(coords[i + 1][0], coords[i + 1][1], lat);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

type Waterway = {
  id: string;
  nameTh: string;
  coords: number[][];
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

function isUnnamed(name: string) {
  return !name || name.startsWith("unnamed");
}

/** Fast bounding-box check before geodesic distance calculation.
 *  Uses 100,000m/degree as a conservative lower-bound divisor for Bangkok latitude. */
function nearBbox(w: Waterway, lng: number, lat: number, maxM: number): boolean {
  const deg = maxM / 100_000;
  return (
    lng >= w.minLng - deg &&
    lng <= w.maxLng + deg &&
    lat >= w.minLat - deg &&
    lat <= w.maxLat + deg
  );
}

/** Snap each reporting gauge to the waterway it sits on, then heat every
 *  segment of that same named waterway within REACH_M of it. A gauge on an
 *  unnamed ditch heats only the ditch. Straight-line reach, stated as such. */
function joinWaterways(gauges: Gauge[], waterways: Waterway[]): FloodState["waterways"] {
  const status: FloodState["waterways"] = {};
  const byName = new Map<string, Waterway[]>();
  for (const w of waterways) {
    if (isUnnamed(w.nameTh)) continue;
    const list = byName.get(w.nameTh) ?? [];
    list.push(w);
    byName.set(w.nameTh, list);
  }

  for (const g of gauges) {
    let pick: { w: Waterway; d: number } | null = null;
    if (g.river) {
      for (const w of byName.get(g.river) ?? []) {
        if (!nearBbox(w, g.lng, g.lat, SNAP_SAME_NAME_M)) continue;
        const d = pointToLineM(g.lng, g.lat, w.coords);
        if (d <= SNAP_SAME_NAME_M && (!pick || d < pick.d)) pick = { w, d };
      }
    }
    if (!pick) {
      for (const w of waterways) {
        if (!nearBbox(w, g.lng, g.lat, SNAP_ANY_M)) continue;
        const d = pointToLineM(g.lng, g.lat, w.coords);
        if (d <= SNAP_ANY_M && (!pick || d < pick.d)) pick = { w, d };
      }
    }
    if (!pick) continue;
    g.waterwayId = pick.w.id;
    g.waterwayName = pick.w.nameTh;

    // A silent or untrusted gauge makes no claim about the water around it.
    if (!BAND_RANK[g.band]) continue;
    const rank = BAND_RANK[g.band] ?? 0;
    const reach = isUnnamed(pick.w.nameTh)
      ? [pick.w]
      : (byName.get(pick.w.nameTh) ?? []).filter(
          (w) => nearBbox(w, g.lng, g.lat, REACH_M) && pointToLineM(g.lng, g.lat, w.coords) <= REACH_M,
        );
    for (const w of reach) {
      const prev = status[w.id];
      if (!prev || rank > prev.rank) {
        status[w.id] = { rank, band: g.band, gauge: g.id, confidence: g.confidence };
      }
    }
  }
  return status;
}

/* -------------------------------------------------------------- mapping */

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number.parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

/** "10-20" → 20. DDS publishes ranges; the deepest end is the honest max. */
function maxOf(v: unknown): number | null {
  if (v == null) return null;
  const nums = String(v).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : null;
}

function toGauge(s: Json): Gauge | null {
  const lat = num(s.lat);
  const lng = num(s.lng);
  if (lat == null || lng == null) return null;
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLon || lng > BBOX.maxLon) return null;
  const meta = (s.meta ?? {}) as Json;
  const ind = (s.indicator ?? {}) as Json;
  const confidence = String(s.data_confidence ?? "absent");
  const absent = confidence === "absent";
  const band = absent ? "no-signal" : String(ind.band ?? "no-signal");
  const nameTh = String(s.name_th ?? "");
  const nameEn = String(s.name_en ?? "");
  const wl = num(s.wl_msl);
  const bank = num(meta.min_bank);
  return {
    id: `fd-${s.key}`,
    lng,
    lat,
    // FloodDash sometimes repeats the Thai name in name_en.
    name: nameEn && nameEn !== nameTh ? nameEn : nameTh,
    nameTh,
    river: (meta.river as string) ?? null,
    agency: (meta.agency as string) ?? null,
    basin: (s.basin_en as string) ?? null,
    province: (s.province_en as string) ?? null,
    band,
    bandEn: band === "no-signal" ? "NO DATA" : String(ind.band_en ?? band),
    bandTh: band === "no-signal" ? "ไม่มีข้อมูล" : String(ind.band_th ?? ""),
    action: absent ? SILENT_EN : String(ind.action_en ?? SILENT_EN),
    actionTh: absent ? SILENT_TH : String(ind.action_th ?? SILENT_TH),
    basis: absent ? null : ((ind.basis_en as string) ?? null),
    lastBandEn: absent && ind.band_en ? String(ind.band_en) : null,
    confidence,
    ageMin: num(s.age_min),
    observedAt: (s.obs_time as string) ?? null,
    waterlevelMsl: wl,
    minBank: bank,
    // Observed now. FloodDash's margin_to_bank_m is the 3-hour projection.
    freeboardM: wl != null && bank != null ? Math.round((bank - wl) * 100) / 100 : null,
    riseMH: num(ind.rise_m_h),
    storagePercent: num(s.storage_pct),
    waterwayId: null,
    waterwayName: null,
  };
}

const CANAL_STATUS: Record<string, string> = {
  ระดับน้ำปกติ: "normal",
  ระดับน้ำเตือนภัย: "warning",
  ระดับน้ำวิกฤติ: "critical",
};

function normaliseDistrict(name: string) {
  return name.replace(/^เขต/, "").trim();
}

/* -------------------------------------------------------------- refresh */

async function getJson(path: string): Promise<Json> {
  const res = await fetch(`${FLOODDASH_ORIGIN}${path}`, {
    headers: { accept: "application/json", "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return (await res.json()) as Json;
}

export type RefreshDeps = {
  districts: Fc | null;
  khlongs: Fc | null;
};

/** Pull FloodDash, cut it to Bangkok, keep the last good copy of each part.
 *  Returns the stored state (fresh or previous). */
export async function refreshFloodDash(
  env: Env,
  deps: RefreshDeps,
  opts: { force?: boolean } = {},
): Promise<FloodState | null> {
  const prev = await readRow(env);
  if (!opts.force && prev && Date.now() - Date.parse(prev.fetchedAt) < REFRESH_EVERY_MS) {
    return prev.payload;
  }

  const now = new Date().toISOString();
  const [twin, snapshot, dds] = await Promise.allSettled([
    getJson("/api/twin"),
    getJson("/api/snapshot"),
    getJson("/api/dds/briefing"),
  ]);
  const old = prev?.payload;
  const fail = (r: PromiseSettledResult<Json>) => (r.status === "rejected" ? String(r.reason) : null);

  if (twin.status === "rejected" && snapshot.status === "rejected" && dds.status === "rejected") {
    if (old) {
      // Keep serving the last good copy; its fetchedAt stays honest.
      await writeRow(env, old, `all FloodDash reads failed: ${fail(twin)}`);
      return old;
    }
    return null;
  }

  const state: FloodState = {
    schema: 1,
    fetchedAt: now,
    flooddashVersion: old?.flooddashVersion ?? null,
    verdict: old?.verdict ?? null,
    method: old?.method ?? null,
    gauges: old?.gauges ?? [],
    waterways: old?.waterways ?? {},
    canals: old?.canals ?? { date: null, stale: true, stations: [] },
    roads: old?.roads ?? {
      days: [],
      stale: true,
      fetchedAt: null,
      source: "https://dds.bangkok.go.th/flood_report.php",
      byDistrict: [],
      records: [],
    },
    parts: {
      twin: { ok: twin.status === "fulfilled", at: twin.status === "fulfilled" ? now : (old?.parts.twin.at ?? null), error: fail(twin) },
      snapshot: { ok: snapshot.status === "fulfilled", at: snapshot.status === "fulfilled" ? now : (old?.parts.snapshot.at ?? null), error: fail(snapshot) },
      dds: { ok: dds.status === "fulfilled", at: dds.status === "fulfilled" ? now : (old?.parts.dds.at ?? null), error: fail(dds) },
    },
  };

  if (twin.status === "fulfilled") {
    const t = twin.value;
    const bkk = ((t.provinces as Json[]) ?? []).find((p) => String(p.code) === "10");
    state.flooddashVersion = (t.version as string) ?? state.flooddashVersion;
    if (bkk) {
      state.verdict = {
        level: String(bkk.level),
        band: String(bkk.band),
        score: Number(bkk.score),
        headEn: String(bkk.head_en ?? ""),
        headTh: String(bkk.head_th ?? ""),
        reasonEn: (bkk.reason_en as string) ?? null,
        reasonTh: (bkk.reason_th as string) ?? null,
        stationsL5: num(bkk.stations_l5),
        stationsL4: num(bkk.stations_l4),
        rain24hMm: num(bkk.rain_24h_mm),
        wetness: (bkk.wetness_band as string) ?? null,
        // FloodDash gives an ETA only when its engine trusts it. null stays null.
        etaHours: num(bkk.eta_hours),
        updated: (t.updated as string) ?? null,
      };
    }
  }

  if (snapshot.status === "fulfilled") {
    const s = snapshot.value;
    state.method = ((s.risk as Json)?.method_en as string) ?? state.method;
    state.gauges = ((s.water as Json[]) ?? [])
      .map(toGauge)
      .filter((g): g is Gauge => g !== null)
      .sort((a, b) => (BAND_RANK[b.band] ?? 0) - (BAND_RANK[a.band] ?? 0));
    const waterways: Waterway[] = [];
    for (const f of deps.khlongs?.features ?? []) {
      if (f.geometry?.type !== "LineString") continue;
      const p = f.properties ?? {};
      const coords = f.geometry.coordinates as number[][];
      let minLng = Infinity;
      let maxLng = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      for (const pt of coords) {
        if (pt[0] < minLng) minLng = pt[0];
        if (pt[0] > maxLng) maxLng = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      }
      waterways.push({
        id: String(p.id),
        nameTh: String(p.nameTh ?? p.name ?? ""),
        coords,
        minLng,
        maxLng,
        minLat,
        maxLat,
      });
    }
    state.waterways = waterways.length ? joinWaterways(state.gauges, waterways) : {};
  }

  if (dds.status === "fulfilled") {
    const d = dds.value;
    const bulletin = (d.bulletin ?? {}) as Json;
    state.canals = {
      date: (bulletin.date as string) ?? null,
      stale: Boolean(bulletin.stale),
      stations: ((bulletin.stations as Json[]) ?? []).map((st) => {
        const level = num(st.levelMsl);
        const critical = num(st.criticalMsl);
        const statusTh = String(st.statusTh ?? "");
        return {
          name: String(st.name ?? ""),
          side: String(st.side ?? ""),
          levelMsl: level,
          criticalMsl: critical,
          marginM: level != null && critical != null ? Math.round((critical - level) * 100) / 100 : null,
          status: CANAL_STATUS[statusTh] ?? "unknown",
          statusTh,
          observedAt: (st.observedAt as string) ?? null,
        };
      }),
    };

    const roads = (d.roads ?? {}) as Json;
    const records = ((roads.records as Json[]) ?? []).map((r) => ({
      district: String(r.district ?? ""),
      road: String(r.road ?? ""),
      location: String(r.location ?? ""),
      depthCm: r.depthCm == null ? null : String(r.depthCm),
      lengthM: r.lengthM == null ? null : String(r.lengthM),
      floodedAt: (r.floodedAt as string) ?? null,
      clearedAt: (r.clearedAt as string) ?? null,
      status: String(r.status ?? ""),
    }));

    const index = new Map<string, { id: number | null; nameEn: string; nameTh: string }>();
    for (const f of deps.districts?.features ?? []) {
      const p = f.properties ?? {};
      const th = String(p.name_th ?? "");
      index.set(normaliseDistrict(th), {
        id: (p.id as number) ?? null,
        nameEn: String(p.name_en ?? "").replace(/ District$/, ""),
        nameTh: th,
      });
    }
    const groups = new Map<string, FloodState["roads"]["byDistrict"][number]>();
    for (const r of records) {
      const key = normaliseDistrict(r.district);
      const hit = index.get(key);
      const g = groups.get(key) ?? {
        districtId: hit?.id ?? null,
        nameEn: hit?.nameEn ?? key,
        nameTh: hit?.nameTh ?? r.district,
        reports: 0,
        clearanceUnrecorded: 0,
        maxDepthCm: null as number | null,
        latestFloodedAt: null as string | null,
      };
      g.reports += 1;
      if (r.status !== "reported-cleared") g.clearanceUnrecorded += 1;
      const depth = maxOf(r.depthCm);
      if (depth != null) g.maxDepthCm = Math.max(g.maxDepthCm ?? 0, depth);
      if (r.floodedAt && (!g.latestFloodedAt || r.floodedAt > g.latestFloodedAt)) g.latestFloodedAt = r.floodedAt;
      groups.set(key, g);
    }
    state.roads = {
      days: (roads.days as string[]) ?? [],
      stale: Boolean(roads.stale),
      fetchedAt: (roads.fetchedAt as string) ?? null,
      source: (roads.source as string) ?? "https://dds.bangkok.go.th/flood_report.php",
      byDistrict: [...groups.values()].sort((a, b) => b.reports - a.reports),
      records: records.sort((a, b) => String(b.floodedAt).localeCompare(String(a.floodedAt))),
    };
  }

  const errors = Object.entries(state.parts)
    .filter(([, p]) => p.error)
    .map(([k, p]) => `${k}: ${p.error}`)
    .join("; ");
  await writeRow(env, state, errors || null);
  return state;
}

/** Read the stored state; on a cold start (no row yet) refresh once inline. */
export async function loadFloodState(env: Env, deps: () => Promise<RefreshDeps>): Promise<FloodState | null> {
  const row = await readRow(env);
  if (row) return row.payload;
  return refreshFloodDash(env, await deps(), { force: true });
}

export function ageMin(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60_000)) : null;
}

/* ------------------------------------------------------------ responses */

const HEADERS = {
  "cache-control": "public, max-age=60",
  "access-control-allow-origin": "*",
  "x-bkkx-source": "FloodDash relay (flood.nonarkara.org)",
};

const DUTY =
  "FloodDash is a prioritisation layer on open data, not an official warning. DDPM, BMA and TMD issue warnings. DDPM hotline 1784.";

function unavailable(): Response {
  return new Response(
    JSON.stringify({
      error: "flooddash_unavailable",
      message: "No FloodDash reading has reached the atlas yet. Absence of data is not an all-clear.",
      duty: DUTY,
    }),
    { status: 503, headers: { "content-type": "application/json; charset=utf-8", ...HEADERS } },
  );
}

export function floodBkkResponse(state: FloodState | null): Response {
  if (!state) return unavailable();
  const age = ageMin(state.fetchedAt);
  return new Response(
    JSON.stringify({
      tool: "flood-bkk",
      version: 1,
      source: FLOODDASH_ORIGIN,
      ageMin: age,
      stale: age == null || age > STALE_AFTER_MIN,
      duty: DUTY,
      hotline: DDPM_HOTLINE,
      bandColors: BAND_COLOR,
      reachM: REACH_M,
      ...state,
    }),
    { headers: { "content-type": "application/json; charset=utf-8", ...HEADERS } },
  );
}

/** Same property contract the gauge layer has always read, plus the
 *  judgement FloodDash attaches to every gauge. */
export function floodSensorsResponse(state: FloodState | null): Response {
  if (!state) return unavailable();
  const age = ageMin(state.fetchedAt);
  const features = state.gauges.map((g) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [g.lng, g.lat] },
    properties: {
      ...g,
      levelLabel: g.bandEn,
      levelColor: BAND_COLOR[g.band] ?? BAND_COLOR["no-signal"],
      rank: BAND_RANK[g.band] ?? 0,
      silent: g.band === "no-signal",
      dim: g.confidence === "stale",
    },
  }));
  return new Response(
    JSON.stringify({
      type: "FeatureCollection",
      name: "bkk-flood-sensors",
      source: `${FLOODDASH_ORIGIN}/api/snapshot`,
      attribution: "FloodDash (flood.nonarkara.org) · judged from HII/ThaiWater, RID and MRC telemetry",
      disclaimer: DUTY,
      fetchedAt: state.fetchedAt,
      ageMin: age,
      count: features.length,
      reporting: state.gauges.filter((g) => g.band !== "no-signal").length,
      features,
    }),
    { headers: { "content-type": "application/geo+json; charset=utf-8", ...HEADERS } },
  );
}

/** The live answer for one point, for /api/risk and the inspect card. */
export function liveAt(
  state: FloodState | null,
  lng: number,
  lat: number,
  district: { id: number | null; name: string | null },
) {
  if (!state) return null;
  let nearest: { g: Gauge; d: number } | null = null;
  for (const g of state.gauges) {
    if (!BAND_RANK[g.band]) continue;
    const d = distanceM(lng, lat, g.lng, g.lat);
    if (d <= 15_000 && (!nearest || d < nearest.d)) nearest = { g, d };
  }
  const roads = district.id != null ? state.roads.byDistrict.find((r) => r.districtId === district.id) ?? null : null;
  return {
    source: FLOODDASH_ORIGIN,
    ageMin: ageMin(state.fetchedAt),
    city: state.verdict,
    nearestGauge: nearest
      ? {
          name: nearest.g.name,
          waterway: nearest.g.waterwayName ?? nearest.g.river,
          distanceKm: Math.round(nearest.d / 100) / 10,
          band: nearest.g.band,
          bandEn: nearest.g.bandEn,
          action: nearest.g.action,
          confidence: nearest.g.confidence,
          ageMin: nearest.g.ageMin,
        }
      : null,
    district: district.name,
    roadReports: roads,
    roadReportDays: state.roads.days,
    duty: DUTY,
  };
}
