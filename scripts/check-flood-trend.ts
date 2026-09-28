// Offline check for the relay's history and trend (src/flooddash.ts).
//   node scripts/check-flood-trend.ts
// The atlas may only say "receding" when its own stored history shows a
// prepare/danger peak that has since dropped, and "over" only once the
// city verdict is back at safe or watch.
import assert from "node:assert/strict";
import { appendHistory, floodTrend, type FloodState, type Gauge } from "../src/flooddash.ts";

const H = 3_600_000;
const now = Date.parse("2026-09-28T12:00:00Z");
const iso = (hAgo: number) => new Date(now - hAgo * H).toISOString();
const V = (level: string, score: number) => ({ level, band: level, score, headEn: "", headTh: "", reasonEn: null, reasonTh: null,
  stationsL5: null, stationsL4: null, rain24hMm: null, wetness: null, etaHours: null, updated: null, rainAccelRatio: null, satFloodRai: null });
const g = (riseMH: number | null, band = "watch", confidence = "fresh") => ({ band, confidence, riseMH }) as unknown as Gauge;
const build = (steps: [number, string, number][]) => steps.reduce((h, [ago, lvl, sc]) => appendHistory(h, V(lvl, sc), iso(ago)), [] as NonNullable<FloodState["history"]>);

// History: one entry per 20 min at the same level, but a level change always lands.
let h = build([[1, "watch", 30], [0.9, "watch", 31], [0.8, "danger", 80]]);
assert.equal(h.length, 2);
assert.equal(h[1].level, "danger");
h = build([[80, "danger", 90], [1, "watch", 30]]);
assert.equal(h.length, 1, "entries older than 72 h fall off");

// A danger peak 10 h ago, watch now: receding and over.
let t = floodTrend({ verdict: V("watch", 30), history: build([[10, "danger", 85], [6, "prepare", 60], [0, "watch", 30]]), gauges: [] }, now);
assert.equal(t.peak?.level, "danger");
assert.equal(t.direction, "falling");
assert.ok(t.receding && t.over);

// Still danger but the score has dropped 6 h on: receding, not over.
t = floodTrend({ verdict: V("danger", 70), history: build([[6, "danger", 92], [0, "danger", 70]]), gauges: [] }, now);
assert.ok(t.receding && !t.over);

// Rising danger: neither.
t = floodTrend({ verdict: V("danger", 95), history: build([[6, "prepare", 60], [0, "danger", 95]]), gauges: [] }, now);
assert.equal(t.direction, "rising");
assert.ok(!t.receding && !t.over);

// Never above watch: calm is not "receding".
t = floodTrend({ verdict: V("safe", 5), history: build([[8, "watch", 25], [0, "safe", 5]]), gauges: [] }, now);
assert.ok(!t.receding && !t.over);

// No history yet: direction from the gauges, silent and stale gauges ignored.
t = floodTrend({ verdict: V("danger", 80), history: [], gauges: [g(-0.1), g(-0.05), g(-0.2), g(0.03), g(0.5, "no-signal"), g(0.5, "watch", "stale"), g(null)] }, now);
assert.deepEqual([t.gaugesFalling, t.gaugesRising, t.gaugesSteady], [3, 1, 0]);
assert.equal(t.direction, "falling");
assert.ok(!t.receding, "no stored peak, so no claim of recession");

console.log("flood trend: ok");
