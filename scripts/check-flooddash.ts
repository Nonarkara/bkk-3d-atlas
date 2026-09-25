// Runnable check for the FloodDash relay (src/flooddash.ts), against live
// FloodDash and the repo's own waterway/district files.
//   node scripts/check-flooddash.ts
// Asserts the relay's conservation law: it repeats FloodDash's verdict and
// bands, silent gauges never colour water, and a failed refresh keeps the
// last good copy with its original age.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAND_RANK, floodBkkResponse, loadFloodState, refreshFloodDash } from "../src/flooddash.ts";

// ponytail: one-row in-memory stand-in for the D1 table.
const rows = new Map<string, { payload: string; fetched_at: string }>();
const CIVIC_DB = {
  prepare: (sql: string) => ({
    bind: (...args: string[]) => ({
      first: async () => rows.get(args[0]) ?? null,
      run: async () => {
        assert.match(sql, /INSERT INTO flood_state/);
        rows.set(args[0], { payload: args[1], fetched_at: args[2] });
      },
    }),
  }),
};
const env = { CIVIC_DB } as never;
const read = (p: string) => JSON.parse(readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8"));
const deps = { districts: read("bkk-districts.geojson"), khlongs: read("bkk-khlongs.geojson") };

const t0 = performance.now();
const state = await refreshFloodDash(env, deps, { force: true });
console.log(`refresh ${Math.round(performance.now() - t0)} ms`);
assert.ok(state, "relay produced no state");

const twin = await (await fetch("https://flood.nonarkara.org/api/twin")).json();
const bkk = twin.provinces.find((p: { code: string }) => p.code === "10");
assert.equal(state.verdict?.level, bkk.level, "verdict must be FloodDash's own");
assert.equal(state.verdict?.etaHours ?? null, bkk.eta_hours ?? null, "never invent an ETA");

for (const g of state.gauges) {
  assert.ok(g.band in BAND_RANK, `unknown band ${g.band}`);
  if (g.confidence === "absent") assert.equal(g.band, "no-signal", `${g.id}: absent gauge must read NO DATA`);
}
const silent = new Set(state.gauges.filter((g) => !BAND_RANK[g.band]).map((g) => g.id));
for (const [id, w] of Object.entries(state.waterways)) {
  assert.ok(!silent.has(w.gauge), `${id} coloured by a silent gauge`);
}
for (const d of state.roads.byDistrict) assert.ok(d.districtId != null, `unplaced DDS district ${d.nameTh}`);

// A total upstream failure keeps the last good copy, age intact.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;
const kept = await refreshFloodDash(env, deps, { force: true });
globalThis.fetch = realFetch;
assert.equal(kept?.fetchedAt, state.fetchedAt, "failed refresh must not re-date the copy");
assert.equal((await floodBkkResponse(await loadFloodState(env, async () => deps)).json()).verdict.level, bkk.level);

console.log(
  `ok — verdict ${state.verdict?.level}, ${state.gauges.length} gauges (${silent.size} silent), ` +
    `${Object.keys(state.waterways).length} waterway segments judged, ${state.roads.records.length} DDS road reports in ${state.roads.byDistrict.length} districts, ${state.canals.stations.length} gates`,
);
