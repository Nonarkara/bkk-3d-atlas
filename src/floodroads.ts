// Flooded roads — every public flood signal for Bangkok, put on the street
// it describes.
//
// Stolen from FloodDash (flood.nonarkara.org) and pushed one step further.
// FloodDash's streetReports.js turns a Traffy Fondue ticket into
// {time, ~100 m place, depth word, duration} and nothing else; its
// streetFlood.js ranks the evidence: residents' reports, BMA DDS's own
// flooded-road list, the nearest canal gauge, known risk spots. FloodDash
// answers "is my street flooding?" for one point and publishes citywide
// counts per khet. This module places the same evidence on the road network
// itself, so the map can show which streets carry reports:
//
//   residents  Traffy Fondue public API (NECTEC × BMA), read direct.
//              Depth is the resident's own estimate — a word, not a gauge.
//   drivers    iTIC / Longdo flood and closure reports, via FloodDash.
//   officials  BMA DDS flood_report.php, via the FloodDash relay. DDS gives
//              a road name and a district, no coordinates; the road is
//              matched by name inside that district's boundary.
//   sensors    FloodDash-judged gauges at prepare or worse (heat only —
//              gauges sit on canals, not roads).
//   news       geolocated flood news already in this Worker (heat only).
//
// What it will not claim. A lit stretch means "a report within ~100 m on
// this road, in this window", not a surveyed flood extent, not a depth
// model, not a safe or unsafe route. No text, address, name or photo from
// any ticket is kept; heat is summed onto a ~220 m grid.

import type { Env } from "./index";
import type { FloodState } from "./flooddash";
import { BAND_RANK, FLOODDASH_ORIGIN } from "./flooddash";

const STATE_KEY = "bkk-roads";
const TRAFFY_KEY = "bkk-traffy";
const REFRESH_EVERY_MS = 4.5 * 60_000;
const TRAFFY_URL = "https://publicapi.traffy.in.th/share/teamchadchart/search";
const TRAFFY_PAGE = 1000;
const TRAFFY_MAX_PAGES = 2;
const KEEP_H = 24;
const UA = "BKKx 3D Atlas flood roads (+https://atlas.nonarkara.org)";
const BBOX = { minLng: 100.3, maxLng: 100.95, minLat: 13.45, maxLat: 14.1 };

// Snap radius and the stretch of road a report lights, each side, in metres.
// Traffy coordinates are rounded to 0.001° (±55 m), so the radius is wider.
const SNAP_M = { traffy: 90, itic: 60 } as const;
const HALF_M = { traffy: 100, itic: 150 } as const;
const DDS_MAX_KM = 6; // a DDS road name that matches more than this is too vague to draw
const HEAT_GRID = 0.002; // ~220 m

// ── FloodDash streetReports.js, ported ────────────────────────────────
// Body-reference depth, shallow → deep. Ranks order the words; they are
// not centimetres.
export const DEPTHS = [
  { k: "surface", rank: 1, re: /ผิวถนน|ท่วมผิว|ฟุตบาท|ฟุตบาต|ขอบทาง/, th: "ผิวถนน", en: "road surface" },
  { k: "ankle", rank: 2, re: /ตาตุ่ม|ตาตุ|ข้อเท้า|ข้อเท่า|ท่วมเท้า/, th: "ข้อเท้า", en: "ankle" },
  { k: "shin", rank: 3, re: /หน้าแข้ง|ครึ่งแข้ง|แข้ง|น่อง|น่าแขง/, th: "หน้าแข้ง", en: "shin" },
  { k: "knee", rank: 4, re: /เข่า|ครึ่งล้อ|ครึ่งรอ/, th: "หัวเข่า", en: "knee" },
  { k: "thigh", rank: 5, re: /ต้นขา|โคนขา/, th: "ต้นขา", en: "thigh" },
  { k: "waist", rank: 6, re: /เอว|สะโพก/, th: "เอว", en: "waist" },
  { k: "chest", rank: 7, re: /หน้าอก|ระดับอก|ถึงอก|ระดับคอ/, th: "หน้าอก", en: "chest" },
] as const;
const RANK: Record<string, number> = Object.fromEntries(DEPTHS.map((d) => [d.k, d.rank]));
const CM_EDGES: [number, string][] = [[5, "surface"], [15, "ankle"], [30, "shin"], [50, "knee"], [70, "thigh"], [100, "waist"]];
const FLOOD_RE = /น้ำท่วม|นํ้าท่วม|นำ้ท่วม|ท่วมขัง|น้ำรอระบาย|น้ำขัง|ระบายน้ำไม่|น้ำไม่ระบาย|น้ำไม่ลง|ระบายไม่ทัน/;

export function depthOf(text: string): string | null {
  const form = text.match(/ความสูงระดับ([\s\S]{0,40}?)(?:น้ำท่วมมาแล้ว|$)/);
  const seg = form ? form[1] : text;
  const cm = seg.match(/(\d{1,3})\s*(?:[-–]\s*(\d{1,3}))?\s*(?:ซม|ซ\.ม|cm|เซน|เซ็น)/i);
  if (cm) {
    // A range reads as its lower bound — never deeper than the reporter committed to.
    const hit = CM_EDGES.find(([edge]) => Number(cm[1]) < edge);
    return hit ? hit[1] : "chest";
  }
  let best: (typeof DEPTHS)[number] | null = null;
  for (const d of DEPTHS) if (d.re.test(seg) && (!best || d.rank > best.rank)) best = d;
  return best?.k ?? null;
}

export function traffyTime(ts: unknown): string | null {
  const m = String(ts ?? "").match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.\d+)?\s*([+-]\d\d:?\d\d|[+-]\d\d|Z)?/);
  if (!m) return null;
  let zone = m[3] ?? "Z";
  if (/^[+-]\d\d$/.test(zone)) zone += ":00";
  const t = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export type StreetReport = { id: string; t: string; lat: number; lng: number; depth: string | null; done: boolean };

/** One Traffy ticket → a minimal street-flood report, or null. No text survives. */
export function toStreetReport(ticket: Record<string, unknown>): StreetReport | null {
  if (!ticket?.ticket_id) return null;
  const text = String(ticket.description ?? "");
  if (!FLOOD_RE.test(text)) return null;
  const t = traffyTime(ticket.timestamp);
  const c = ticket.coords as unknown[] | undefined;
  const lng = Number(c?.[0]);
  const lat = Number(c?.[1]);
  if (!t || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: String(ticket.ticket_id),
    t,
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
    depth: depthOf(text),
    done: ticket.state === "เสร็จสิ้น",
  };
}

// ── Road cells ───────────────────────────────────────────────────────
type Way = { id: number; name: string; cls: number; xy: Float64Array; cum: Float64Array };
type Manifest = { origin: { lng: number; lat: number }; cell: number; cells: string[] };
const R = 6_371_000;
const LAT0 = 13.75;
const KX = (Math.PI / 180) * R * Math.cos((LAT0 * Math.PI) / 180);
const KY = (Math.PI / 180) * R;
const toX = (lng: number) => lng * KX;
const toY = (lat: number) => lat * KY;

let manifestCache: Manifest | null = null;
const cellCache = new Map<string, Way[]>();

async function loadAsset<T>(env: Env, path: string): Promise<T | null> {
  const res = await env.ASSETS.fetch(new Request(`https://atlas.nonarkara.org${path}`));
  return res.ok ? ((await res.json()) as T) : null;
}

async function manifest(env: Env): Promise<Manifest | null> {
  manifestCache ??= await loadAsset<Manifest>(env, "/flood-roads/manifest.json");
  return manifestCache;
}

async function cell(env: Env, key: string): Promise<Way[]> {
  const hit = cellCache.get(key);
  if (hit) return hit;
  const raw = await loadAsset<{ ways: [number, string, number, number[]][] }>(env, `/flood-roads/${key}.json`);
  const ways: Way[] = (raw?.ways ?? []).map(([id, name, cls, flat]) => {
    const n = flat.length / 2;
    const xy = new Float64Array(flat.length);
    const cum = new Float64Array(n);
    let ix = 0, iy = 0; // delta-encoded ×1e5 (scripts/build-flood-road-cells.mjs)
    for (let i = 0; i < n; i++) {
      ix += flat[2 * i];
      iy += flat[2 * i + 1];
      xy[2 * i] = toX(ix / 1e5);
      xy[2 * i + 1] = toY(iy / 1e5);
      if (i) cum[i] = cum[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]);
    }
    return { id, name, cls, xy, cum };
  });
  cellCache.set(key, ways);
  return ways;
}

function cellKeysNear(m: Manifest, lng: number, lat: number, radiusM: number): string[] {
  const dLng = radiusM / KX;
  const dLat = radiusM / KY;
  const keys = new Set<string>();
  for (const [a, b] of [[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng - dLng, lat + dLat], [lng + dLng, lat + dLat]]) {
    keys.add(`${Math.floor((a - m.origin.lng) / m.cell)}_${Math.floor((b - m.origin.lat) / m.cell)}`);
  }
  const have = new Set(m.cells);
  return [...keys].filter((k) => have.has(k));
}

/** Nearest road to a point: way, distance, and along-road position. */
async function snap(env: Env, m: Manifest, lng: number, lat: number, maxM: number) {
  const px = toX(lng);
  const py = toY(lat);
  let best: { way: Way; d: number; s: number } | null = null;
  const seen = new Set<number>();
  for (const key of cellKeysNear(m, lng, lat, maxM)) {
    for (const w of await cell(env, key)) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      const { xy, cum } = w;
      for (let i = 0; i < cum.length - 1; i++) {
        const ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * i + 2], by = xy[2 * i + 3];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        // Among near-ties, the bigger road wins: a report "on Lat Phrao" at a soi mouth.
        const score = d + w.cls * 2;
        if (d <= maxM && (!best || score < best.d + best.way.cls * 2)) best = { way: w, d, s: cum[i] + t * Math.sqrt(len2) };
      }
    }
  }
  return best;
}

/** Road geometry between two along-road distances, back in lng/lat. */
function substring(w: Way, a: number, b: number): [number, number][] {
  const { xy, cum } = w;
  const n = cum.length;
  const out: [number, number][] = [];
  const at = (s: number): [number, number] => {
    let i = 0;
    while (i < n - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
    return [(xy[2 * i] + t * (xy[2 * i + 2] - xy[2 * i])) / KX, (xy[2 * i + 1] + t * (xy[2 * i + 3] - xy[2 * i + 1])) / KY];
  };
  const lo = Math.max(0, a);
  const hi = Math.min(cum[n - 1], b);
  if (hi - lo < 5) return out;
  out.push(at(lo));
  for (let i = 0; i < n; i++) if (cum[i] > lo && cum[i] < hi) out.push([xy[2 * i] / KX, xy[2 * i + 1] / KY]);
  out.push(at(hi));
  return out.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
}

// ── Evidence ─────────────────────────────────────────────────────────
type Src = "traffy" | "itic" | "dds";
type Hit = { s: number; half: number; src: Src; t: number; depth: number; closed: boolean };

async function fetchTraffy(prev: StreetReport[], now: number): Promise<StreetReport[]> {
  const fresh: StreetReport[] = [];
  for (let p = 0; p < TRAFFY_MAX_PAGES; p++) {
    const r = await fetch(`${TRAFFY_URL}?limit=${TRAFFY_PAGE}&offset=${p * TRAFFY_PAGE}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(40_000),
    });
    if (!r.ok) throw new Error(`Traffy HTTP ${r.status}`);
    const rows = ((await r.json()) as { results?: Record<string, unknown>[] }).results;
    if (!Array.isArray(rows)) throw new Error("Traffy: no results array");
    for (const t of rows) {
      const s = toStreetReport(t);
      if (s && s.lng >= BBOX.minLng && s.lng <= BBOX.maxLng && s.lat >= BBOX.minLat && s.lat <= BBOX.maxLat) fresh.push(s);
    }
    const oldest = Date.parse(traffyTime(rows.at(-1)?.timestamp) ?? "");
    if (rows.length < TRAFFY_PAGE || !(oldest > now - 6 * 3_600_000)) break;
  }
  // Newest state wins; older than a day drops out.
  const byId = new Map(prev.map((r) => [r.id, r]));
  for (const r of fresh) byId.set(r.id, r);
  const since = now - KEEP_H * 3_600_000;
  return [...byId.values()].filter((r) => Date.parse(r.t) >= since && Date.parse(r.t) <= now + 300_000);
}

type IticEvent = { id: string; category: string; lat: number; lng: number; start: string; depth_cm?: number | null; passable?: boolean | null; title_th?: string };

async function fetchItic(): Promise<IticEvent[]> {
  const r = await fetch(`${FLOODDASH_ORIGIN}/api/traffic?flood=1`, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`FloodDash /api/traffic HTTP ${r.status}`);
  const events = ((await r.json()) as { events?: IticEvent[] }).events ?? [];
  return events.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng) &&
    e.lng >= BBOX.minLng && e.lng <= BBOX.maxLng && e.lat >= BBOX.minLat && e.lat <= BBOX.maxLat);
}

const normRoad = (s: string) => s.replace(/^(ถนน|ถ\.|ซอย|ซ\.)\s*/, "").replace(/\s+/g, "").trim();

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type DistrictFc = { features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[] };

function outerRings(g: { type?: string; coordinates?: unknown } | undefined): number[][][] {
  if (g?.type === "Polygon") return [(g.coordinates as number[][][])[0]];
  if (g?.type === "MultiPolygon") return (g.coordinates as number[][][][]).map((p) => p[0]);
  return [];
}

// ── The build ────────────────────────────────────────────────────────
export type FloodRoads = {
  tool: "flood-roads";
  version: 1;
  fetchedAt: string;
  windowH: number;
  sources: Record<string, { ok: boolean; at: string | null; error: string | null; count: number }>;
  counts: { stretches: number; closed: number; heatCells: number; unplacedDds: number };
  roads: { type: "FeatureCollection"; features: unknown[] };
  heat: { type: "FeatureCollection"; features: unknown[] };
  unplacedDds: { district: string | null; road: string | null; location: string | null; floodedAt: string | null }[];
  /** Districts ranked by reports in the last 3 h (residents + iTIC, placed by boundary). */
  areas: Area[];
  /** Reports per hour, citywide, oldest first — is it getting worse? */
  hourly: { hour: string; traffy: number; itic: number }[];
  /** FloodDash's Bangkok rain trend: daily mean mm across ~134 gauges. */
  rainTrend: RainTrend | null;
};

export type Area = {
  id: number | null; nameTh: string; nameEn: string;
  n1h: number; nPrev1h: number; n3h: number; n24h: number;
  deepest: number; deepestEn: string | null; deepestTh: string | null;
  latest: string | null; center: [number, number] | null;
};

export type RainTrend = {
  generatedAt: string | null;
  series: { day: string; mm: number }[];
  wkNowMm: number | null; wkPrevMm: number | null; ratio: number | null; band: string | null;
  stations: number | null;
};

async function fetchRainTrend(): Promise<RainTrend> {
  const r = await fetch(`${FLOODDASH_ORIGIN}/api/rain/trend`, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(40_000),
  });
  if (!r.ok) throw new Error(`FloodDash /api/rain/trend HTTP ${r.status}`);
  const j = (await r.json()) as { generated_at?: string; provinces?: Record<string, unknown>[] };
  const bkk = j.provinces?.find((p) => String(p.province_code) === "10");
  if (!bkk) throw new Error("rain trend: no Bangkok row");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    generatedAt: j.generated_at ?? null,
    series: ((bkk.series as { day: string; mm: number }[]) ?? [])
      .filter((d) => typeof d.day === "string" && Number.isFinite(d.mm))
      .map((d) => ({ day: d.day, mm: Math.round(d.mm * 10) / 10 })),
    wkNowMm: n(bkk.wk_now_mm), wkPrevMm: n(bkk.wk_prev_mm), ratio: n(bkk.ratio),
    band: typeof bkk.band === "string" ? bkk.band : null, stations: n(bkk.stations),
  };
}

async function readRow<T>(env: Env, key: string): Promise<{ payload: T; fetchedAt: string } | null> {
  const row = await env.CIVIC_DB.prepare("SELECT payload, fetched_at FROM flood_state WHERE key = ?")
    .bind(key).first<{ payload: string; fetched_at: string }>();
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload) as T, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

async function writeRow(env: Env, key: string, payload: unknown, fetchedAt: string, error: string | null) {
  await env.CIVIC_DB.prepare(
    `INSERT INTO flood_state (key, payload, fetched_at, attempted_at, error) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(key) DO UPDATE SET payload = ?2, fetched_at = ?3, attempted_at = ?4, error = ?5`,
  ).bind(key, JSON.stringify(payload), fetchedAt, new Date().toISOString(), error).run();
}

export type RoadDeps = {
  flood: FloodState | null;
  districts: DistrictFc | null;
  news: () => Promise<{ lng: number; lat: number; t: number; weight: number }[]>;
};

export async function refreshFloodRoads(env: Env, deps: RoadDeps, opts: { force?: boolean } = {}): Promise<FloodRoads | null> {
  const prev = await readRow<FloodRoads>(env, STATE_KEY);
  if (!opts.force && prev && Date.now() - Date.parse(prev.fetchedAt) < REFRESH_EVERY_MS) return prev.payload;
  const m = await manifest(env);
  if (!m) return prev?.payload ?? null;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const old = prev?.payload.sources ?? {};
  const sources: FloodRoads["sources"] = {};
  const mark = (k: string, ok: boolean, count: number, error: string | null = null) => {
    sources[k] = { ok, at: ok ? nowIso : (old[k]?.at ?? null), error, count };
  };

  // Residents — keep the last good set if Traffy is down.
  const kept = (await readRow<StreetReport[]>(env, TRAFFY_KEY))?.payload ?? [];
  let traffy = kept;
  try {
    traffy = await fetchTraffy(kept, now);
    await writeRow(env, TRAFFY_KEY, traffy, nowIso, null);
    mark("traffy", true, traffy.length);
  } catch (e) {
    mark("traffy", false, traffy.length, String(e).slice(0, 160));
  }

  let itic: IticEvent[] = [];
  try {
    itic = await fetchItic();
    mark("itic", true, itic.length);
  } catch (e) {
    mark("itic", false, 0, String(e).slice(0, 160));
  }

  const hits = new Map<number, { way: Way; list: Hit[] }>();
  const add = (way: Way, h: Hit) => {
    const e = hits.get(way.id) ?? { way, list: [] };
    e.list.push(h);
    hits.set(way.id, e);
  };
  const heat = new Map<string, { lng: number; lat: number; w: number; n: number; t: number }>();
  const addHeat = (lng: number, lat: number, w: number, t: number) => {
    const gx = Math.round(lng / HEAT_GRID);
    const gy = Math.round(lat / HEAT_GRID);
    const k = `${gx}_${gy}`;
    const c = heat.get(k) ?? { lng: gx * HEAT_GRID, lat: gy * HEAT_GRID, w: 0, n: 0, t: 0 };
    c.w += w;
    c.n += 1;
    c.t = Math.max(c.t, t);
    heat.set(k, c);
  };
  // Evidence fades with age: a 3-hour-old report counts about a third.
  const decay = (t: number) => Math.exp(-Math.max(0, now - t) / (3 * 3_600_000));

  for (const r of traffy) {
    if (r.done) continue; // closed ticket: the resident's issue was marked finished
    const t = Date.parse(r.t);
    const depth = r.depth ? RANK[r.depth] ?? 0 : 0;
    addHeat(r.lng, r.lat, 0.6 * (0.6 + depth / 7) * decay(t), t);
    const s = await snap(env, m, r.lng, r.lat, SNAP_M.traffy);
    if (s) add(s.way, { s: s.s, half: HALF_M.traffy, src: "traffy", t, depth, closed: false });
  }

  for (const e of itic) {
    const t = Date.parse(e.start);
    if (!Number.isFinite(t) || now - t > 12 * 3_600_000) continue;
    const closed = e.category === "closed" || e.passable === false;
    const cm = Number(e.depth_cm);
    const depth = Number.isFinite(cm) && cm > 0 ? RANK[CM_EDGES.find(([edge]) => cm < edge)?.[1] ?? "chest"] : 0;
    addHeat(e.lng, e.lat, (closed ? 1 : 0.8) * decay(t), t);
    const s = await snap(env, m, e.lng, e.lat, SNAP_M.itic);
    if (s) add(s.way, { s: s.s, half: HALF_M.itic, src: "itic", t, depth, closed });
  }

  // Officials — DDS names a road and a khet. Match the name inside the khet.
  const unplacedDds: FloodRoads["unplacedDds"] = [];
  // Rolling 24 h, not "today": at 00:30 the whole evening's list is yesterday's.
  const ddsOpen = (deps.flood?.roads.records ?? []).filter((r) => {
    const t = Date.parse(r.floodedAt ?? "");
    return Number.isFinite(t) && now - t <= 24 * 3_600_000 && !r.clearedAt;
  });
  const districtRings = new Map<string, number[][][]>();
  for (const f of deps.districts?.features ?? []) {
    districtRings.set(String(f.properties?.name_th ?? "").replace(/^เขต/, ""), outerRings(f.geometry));
  }
  let ddsPlaced = 0;
  for (const rec of ddsOpen) {
    const name = normRoad(rec.road ?? "");
    const rings = districtRings.get(String(rec.district ?? "").replace(/^เขต/, ""));
    let placed = false;
    if (name.length >= 3 && rings?.length) {
      // Candidate cells: every cell the district's bounding box touches.
      let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
      for (const ring of rings) for (const [x, y] of ring) {
        minLng = Math.min(minLng, x); maxLng = Math.max(maxLng, x); minLat = Math.min(minLat, y); maxLat = Math.max(maxLat, y);
      }
      const matched = new Map<number, Way>();
      for (let x = Math.floor((minLng - m.origin.lng) / m.cell); x <= Math.floor((maxLng - m.origin.lng) / m.cell); x++) {
        for (let y = Math.floor((minLat - m.origin.lat) / m.cell); y <= Math.floor((maxLat - m.origin.lat) / m.cell); y++) {
          const key = `${x}_${y}`;
          if (!m.cells.includes(key)) continue;
          for (const w of await cell(env, key)) {
            if (matched.has(w.id) || !normRoad(w.name).includes(name)) continue;
            const mid = Math.floor(w.cum.length / 2);
            const lng = w.xy[2 * mid] / KX, lat = w.xy[2 * mid + 1] / KY;
            if (rings.some((ring) => pointInRing(lng, lat, ring))) matched.set(w.id, w);
          }
        }
      }
      const totalKm = [...matched.values()].reduce((s, w) => s + w.cum[w.cum.length - 1], 0) / 1000;
      if (matched.size && totalKm <= DDS_MAX_KM) {
        const t = Date.parse(rec.floodedAt ?? "") || now;
        const cm = Number(String(rec.depthCm ?? "").match(/\d+/g)?.map(Number).sort((a, b) => b - a)[0]);
        const depth = Number.isFinite(cm) ? RANK[CM_EDGES.find(([edge]) => cm < edge)?.[1] ?? "chest"] : 0;
        for (const w of matched.values()) {
          add(w, { s: w.cum[w.cum.length - 1] / 2, half: 1e9, src: "dds", t, depth, closed: false });
          const mid = Math.floor(w.cum.length / 2);
          addHeat(w.xy[2 * mid] / KX, w.xy[2 * mid + 1] / KY, 1.0 * decay(t), t);
        }
        placed = true;
        ddsPlaced++;
      }
    }
    if (!placed) unplacedDds.push({ district: rec.district, road: rec.road, location: rec.location, floodedAt: rec.floodedAt });
  }
  const ddsRoads = deps.flood?.roads;
  mark("dds", Boolean(deps.flood), ddsOpen.length,
    ddsRoads?.stale && !ddsOpen.length ? `BMA DDS list last covers ${ddsRoads.days.join(", ") || "no day"} — nothing within 24 h` : null);

  // Sensors and news: heat only.
  let sensorN = 0;
  for (const g of deps.flood?.gauges ?? []) {
    const rank = BAND_RANK[g.band] ?? 0;
    if (rank < 3) continue;
    addHeat(g.lng, g.lat, 0.4 + rank * 0.1, now);
    sensorN++;
  }
  mark("sensors", Boolean(deps.flood), sensorN);
  try {
    const news = await deps.news();
    for (const n of news) addHeat(n.lng, n.lat, n.weight * decay(n.t), n.t);
    mark("news", true, news.length);
  } catch (e) {
    mark("news", false, 0, String(e).slice(0, 160));
  }

  // Merge each road's hits into stretches.
  const features: unknown[] = [];
  let closedN = 0;
  for (const { way, list } of hits.values()) {
    const iv = list
      .map((h) => ({ ...h, a: h.half >= 1e9 ? 0 : h.s - h.half, b: h.half >= 1e9 ? way.cum[way.cum.length - 1] : h.s + h.half }))
      .sort((x, y) => x.a - y.a);
    let cur: { a: number; b: number; hs: typeof iv } | null = null;
    const flush = () => {
      if (!cur) return;
      const coords = substring(way, cur.a, cur.b);
      if (coords.length >= 2) {
        const n = { traffy: 0, itic: 0, dds: 0 };
        let depth = 0, latest = 0, weight = 0, closed = false;
        for (const h of cur.hs) {
          n[h.src]++;
          depth = Math.max(depth, h.depth);
          latest = Math.max(latest, h.t);
          closed ||= h.closed;
          weight += (h.src === "dds" ? 1 : h.src === "itic" ? 0.8 : 0.6) * decay(h.t);
        }
        if (closed) closedN++;
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {
            road: way.name || null,
            cls: way.cls,
            n: n.traffy + n.itic + n.dds,
            traffy: n.traffy,
            itic: n.itic,
            dds: n.dds,
            depth,
            depthEn: DEPTHS.find((d) => d.rank === depth)?.en ?? null,
            depthTh: DEPTHS.find((d) => d.rank === depth)?.th ?? null,
            closed,
            latest: new Date(latest).toISOString(),
            score: Math.round((1 - Math.exp(-weight)) * 100) / 100,
            placed: n.traffy + n.itic ? "report" : "road-name",
          },
        });
      }
    };
    for (const h of iv) {
      if (cur && h.a <= cur.b + 30) {
        cur.b = Math.max(cur.b, h.b);
        cur.hs.push(h);
      } else {
        flush();
        cur = { a: h.a, b: h.b, hs: [h] };
      }
    }
    flush();
  }

  // Districts: every report placed by the boundary it falls in, so resident
  // and iTIC reports count the same way (addresses are not read).
  const districts = (deps.districts?.features ?? []).map((f) => {
    const rings = outerRings(f.geometry);
    let sx = 0, sy = 0, k = 0;
    for (const [x, y] of rings[0] ?? []) { sx += x; sy += y; k++; }
    return {
      id: (f.properties?.id as number) ?? null,
      nameTh: String(f.properties?.name_th ?? "").replace(/^เขต/, ""),
      nameEn: String(f.properties?.name_en ?? "").replace(/ District$/, ""),
      rings,
      center: k ? ([Math.round((sx / k) * 1e4) / 1e4, Math.round((sy / k) * 1e4) / 1e4] as [number, number]) : null,
    };
  });
  const districtOf = (lng: number, lat: number) => districts.find((d) => d.rings.some((r) => pointInRing(lng, lat, r))) ?? null;
  const HOUR = 3_600_000;
  const areaMap = new Map<string, Area>();
  const hourStart = Math.floor(now / HOUR) * HOUR;
  const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: new Date(hourStart - (23 - i) * HOUR).toISOString(), traffy: 0, itic: 0 }));
  const tally = (lng: number, lat: number, t: number, depth: number, src: "traffy" | "itic") => {
    const slot = 23 - Math.floor((hourStart - Math.floor(t / HOUR) * HOUR) / HOUR);
    if (slot >= 0 && slot < 24) hourly[slot][src]++;
    const d = districtOf(lng, lat);
    if (!d) return;
    const a = areaMap.get(d.nameTh) ?? {
      id: d.id, nameTh: d.nameTh, nameEn: d.nameEn, n1h: 0, nPrev1h: 0, n3h: 0, n24h: 0,
      deepest: 0, deepestEn: null, deepestTh: null, latest: null, center: d.center,
    };
    const age = now - t;
    if (age <= 24 * HOUR) a.n24h++;
    if (age <= 3 * HOUR) {
      a.n3h++;
      if (depth > a.deepest) {
        a.deepest = depth;
        a.deepestEn = DEPTHS.find((x) => x.rank === depth)?.en ?? null;
        a.deepestTh = DEPTHS.find((x) => x.rank === depth)?.th ?? null;
      }
    }
    if (age <= HOUR) a.n1h++;
    else if (age <= 2 * HOUR) a.nPrev1h++;
    if (!a.latest || t > Date.parse(a.latest)) a.latest = new Date(t).toISOString();
    areaMap.set(d.nameTh, a);
  };
  for (const r of traffy) {
    const t = Date.parse(r.t);
    if (Number.isFinite(t)) tally(r.lng, r.lat, t, r.depth ? RANK[r.depth] ?? 0 : 0, "traffy");
  }
  for (const e of itic) {
    const t = Date.parse(e.start);
    const cm = Number(e.depth_cm);
    const depth = Number.isFinite(cm) && cm > 0 ? RANK[CM_EDGES.find(([edge]) => cm < edge)?.[1] ?? "chest"] : 0;
    if (Number.isFinite(t) && now - t <= 24 * HOUR) tally(e.lng, e.lat, t, depth, "itic");
  }
  const areas = [...areaMap.values()]
    .filter((a) => a.n24h > 0)
    .sort((a, b) => b.n3h - a.n3h || b.deepest - a.deepest || b.n24h - a.n24h);

  let rainTrend: RainTrend | null = prev?.payload.rainTrend ?? null;
  try {
    rainTrend = await fetchRainTrend();
    mark("rainTrend", true, rainTrend.series.length);
  } catch (e) {
    mark("rainTrend", false, rainTrend?.series.length ?? 0, String(e).slice(0, 160));
  }

  const heatFeatures = [...heat.values()].map((c) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [Math.round(c.lng * 1e4) / 1e4, Math.round(c.lat * 1e4) / 1e4] },
    properties: { w: Math.round(c.w * 100) / 100, n: c.n, fresh: now - c.t < 30 * 60_000 },
  }));

  const out: FloodRoads = {
    tool: "flood-roads",
    version: 1,
    fetchedAt: nowIso,
    windowH: KEEP_H,
    sources,
    counts: { stretches: features.length, closed: closedN, heatCells: heatFeatures.length, unplacedDds: unplacedDds.length },
    roads: { type: "FeatureCollection", features },
    heat: { type: "FeatureCollection", features: heatFeatures },
    unplacedDds,
    areas,
    hourly,
    rainTrend,
  };
  const errors = Object.entries(sources).filter(([, s]) => s.error).map(([k, s]) => `${k}: ${s.error}`).join("; ");
  await writeRow(env, STATE_KEY, out, nowIso, errors || null);
  console.log("flood-roads", JSON.stringify({ ...out.counts, ddsPlaced, traffy: traffy.length, itic: itic.length }));
  return out;
}

export async function loadFloodRoads(env: Env, deps: () => Promise<RoadDeps>): Promise<FloodRoads | null> {
  const row = await readRow<FloodRoads>(env, STATE_KEY);
  if (row) return row.payload;
  return refreshFloodRoads(env, await deps(), { force: true });
}

export function floodRoadsResponse(state: FloodRoads | null): Response {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
    "access-control-allow-origin": "*",
    "x-bkkx-source": "Traffy Fondue + iTIC/Longdo + BMA DDS (via FloodDash) + FloodDash gauges",
  };
  if (!state) {
    return new Response(JSON.stringify({
      error: "flood_roads_unavailable",
      message: "No flood-road reading yet. Absence of data is not an all-clear.",
    }), { status: 503, headers });
  }
  const ageMin = Math.max(0, Math.round((Date.now() - Date.parse(state.fetchedAt)) / 60_000));
  return new Response(JSON.stringify({
    ...state,
    ageMin,
    stale: ageMin > 20,
    credit: "Method stolen from FloodDash (flood.nonarkara.org): streetReports.js depth parser, streetFlood.js evidence order.",
    duty: "Reports on a road, not a surveyed flood extent or a route. Unmarked roads are unknown, not safe. Not an official warning — DDPM 1784.",
  }), { headers });
}
