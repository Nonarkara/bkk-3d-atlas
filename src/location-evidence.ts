/** IOC donor pattern: typed source states + independent cached reads.
 * No seed hydration, invented observation times or synthetic project scores. */
export type Point = { lat: number; lng: number };
export function parseLocation(url: URL): Point | null {
  const a = url.searchParams.get("lat"),
    b = url.searchParams.get("lng");
  if (!a?.trim() || !b?.trim()) return null;
  const lat = Number(a),
    lng = Number(b);
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 13.45 &&
    lat <= 14.1 &&
    lng >= 100.3 &&
    lng <= 100.95
    ? {
        lat: Math.round(lat * 10000) / 10000,
        lng: Math.round(lng * 10000) / 10000,
      }
    : null;
}
export function distanceM(a: Point, b: Point) {
  const r = Math.PI / 180,
    dlat = (b.lat - a.lat) * r,
    dlng = (b.lng - a.lng) * r;
  return Math.round(
    6371000 *
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin(dlat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2,
        ),
      ),
  );
}
export function complaintSummary(body: unknown) {
  const d = body as {
    summary?: Record<string, unknown>;
    attribution?: { text?: unknown; url?: unknown };
  };
  const s = d?.summary;
  if (
    !s ||
    !["total_all_time", "recent", "open_now", "resolved"].every(
      (k) =>
        typeof s[k] === "number" && Number.isInteger(s[k]) && Number(s[k]) >= 0,
    )
  )
    throw new Error("Invalid complaint summary");
  // Do not forward individual tickets, personal details or a source-provided arbitrary URL.
  return {
    allTime: s.total_all_time as number,
    recent: s.recent as number,
    openAllTime: s.open_now as number,
    resolvedAllTime: s.resolved as number,
    categories: Array.isArray(s.by_type)
      ? s.by_type
          .filter(
            (x): x is { name: string; count: number } =>
              !!x &&
              typeof x.name === "string" &&
              typeof x.count === "number" &&
              Number.isInteger(x.count) &&
              x.count >= 0,
          )
          .slice(0, 10)
      : [],
    attribution: {
      text:
        typeof d.attribution?.text === "string"
          ? d.attribution.text
          : "Traffy Fondue (NECTEC / NSTDA)",
      url: "https://bangkok.traffy.in.th",
    },
  };
}
export function sourceState(fetchedAt: string | null, now = Date.now()) {
  const age = fetchedAt ? now - Date.parse(fetchedAt) : NaN;
  return !Number.isFinite(age) || age < 0
    ? "unavailable"
    : age <= 3600000
      ? "available"
      : "stale";
}
export type CivicRow = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  source_url: string | null;
  source_dataset: string;
  ingested_at: string;
};
export function nearbyCivic(rows: CivicRow[], point: Point) {
  return rows
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .map((r) => ({ ...r, distanceM: distanceM(point, r) }))
    .filter((r) => r.distanceM <= 800)
    .sort((a, b) => a.distanceM - b.distanceM);
}
