import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
const compile = (p) =>
  ts.transpileModule(readFileSync(new URL(p, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const uri = (s) =>
  "data:text/javascript;base64," + Buffer.from(s).toString("base64");
const helper = uri(compile("../src/location-evidence.ts"));
const { parseLocation, complaintSummary, sourceState, nearbyCivic } =
  await import(helper);
const worker = (
  await import(
    uri(
      compile("../src/location-worker.ts")
        .replace('"./location-evidence"', JSON.stringify(helper))
        .replace("'./location-evidence'", JSON.stringify(helper))
        .replace(
          '"./edge-guard"',
          JSON.stringify(uri(compile("../src/edge-guard.ts"))),
        )
        .replace(
          "'./edge-guard'",
          JSON.stringify(uri(compile("../src/edge-guard.ts"))),
        ),
    )
  )
).default;
test("empty, non-finite and outside-region coordinates cannot fan out", () => {
  for (const q of [
    "",
    "lat=&lng=",
    "lat=Infinity&lng=100.5",
    "lat=0&lng=0",
    "lat=13.7&lng=100.5evil",
  ])
    assert.equal(parseLocation(new URL("https://test/?" + q)), null);
});
test("generated, malformed, missing and negative complaint counts are rejected", () => {
  for (const d of [
    {},
    { summary: { total_all_time: 1 } },
    { summary: { total_all_time: 1, recent: -1, open_now: 0, resolved: 0 } },
  ])
    assert.throws(() => complaintSummary(d));
});
test("missing and future time cannot become fresh; old cache is stale", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(sourceState(null, now), "unavailable");
  assert.equal(sourceState("2026-10-24T12:00:00Z", now), "unavailable");
  assert.equal(sourceState("2026-10-22T12:00:00Z", now), "stale");
});
test("nearby civic selection excludes outside-radius and invalid coordinates", () => {
  const rows = [
    { lat: 13.75, lng: 100.5, id: "yes" },
    { lat: 14, lng: 100.5, id: "no" },
    { lat: NaN, lng: 100.5, id: "bad" },
  ];
  assert.deepEqual(
    nearbyCivic(rows, { lat: 13.75, lng: 100.5 }).map((x) => x.id),
    ["yes"],
  );
});
test("failed upstream keeps aged evidence, never substitutes zeros; civic failure is independent", async () => {
  const oldFetch = globalThis.fetch,
    oldCaches = globalThis.caches;
  globalThis.caches = {
    open: async () => ({
      match: async () =>
        new Response(
          JSON.stringify({
            fetchedAt: "2026-01-01T00:00:00Z",
            value: { recent: 12 },
          }),
        ),
      put: async () => {},
    }),
  };
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    const res = await worker.fetch(
      new Request(
        "https://atlas.nonarkara.org/api/location/evidence?lat=13.75&lng=100.5",
      ),
      {
        CIVIC_DB: {
          prepare() {
            throw Error("offline");
          },
        },
      },
      { waitUntil() {} },
    );
    const d = await res.json();
    assert.equal(d.complaints.status, "stale");
    assert.equal(d.complaints.value.recent, 12);
    assert.equal(d.complaints.fetchedAt, "2026-01-01T00:00:00Z");
    assert.equal(d.civic.status, "unavailable");
    assert.equal(d.civic.count, null);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.caches = oldCaches;
  }
});
test("valid source response retains attribution and strips personal tickets", () => {
  const d = complaintSummary({
    summary: { total_all_time: 2, recent: 1, open_now: 1, resolved: 1 },
    events: [{ address: "private" }],
    attribution: { url: "https://evil.test" },
  });
  assert.equal(d.attribution.url, "https://bangkok.traffy.in.th");
  assert.equal(d.events, undefined);
});
