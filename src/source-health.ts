// Ingest health is not observation freshness. Re-evaluate cached timestamps on
// every response; a successful cache read must never renew an upstream ingest.
export function sourceHealth(payload: any, now = Date.now()) {
  const counts = { total: 0, ok: 0, degraded: 0, stale: 0, skipped: 0 };
  const items = (payload.items || []).map((item: any) => {
    const lastOk = Date.parse(item.last_ok || "");
    const interval = Number(item.interval_ms);
    // Two missed scheduled runs, or 15 minutes for very fast feeds. Unknown
    // cadence retains the legacy 3-hour threshold, explicitly exposed below.
    const threshold = Number.isFinite(interval) && interval > 0
      ? Math.max(interval * 2, 15 * 60000) : 180 * 60000;
    const age = now - lastOk;
    const valid = Number.isFinite(age) && age >= 0;
    const status = !item.last_run || String(item.last_error || "").startsWith("skipped")
      ? "skipped" : Number(item.failures) > 0 ? "degraded"
      : !valid || age > threshold ? "stale" : "ok";
    counts[status]++;
    counts.total++;
    return { ...item, age_min: valid ? Math.floor(age / 60000) : null,
      status, stale_after_min: threshold / 60000 };
  });
  const order: Record<string, number> = { degraded: 0, stale: 1, skipped: 2, ok: 3 };
  items.sort((a: any, b: any) => order[a.status] - order[b.status]
    || (a.age_min ?? Infinity) - (b.age_min ?? Infinity));
  return { ...payload, version: 2, evaluatedAt: new Date(now).toISOString(),
    age_basis: "last successful upstream ingest, not sensor observation time",
    stale_policy: "two scheduled intervals, minimum 15 minutes; unknown cadence 180 minutes",
    counts, items };
}
