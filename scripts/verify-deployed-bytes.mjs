#!/usr/bin/env node
// After a release, require the live edge to serve exactly the committed bytes:
// three consecutive probes where every asset's SHA-256 matches the local file.
// A unique probe query bypasses any cached copy. Pattern from the Jakarta atlas.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (body) => createHash("sha256").update(body).digest("hex");
const read = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url));
const tag = read("app.js").toString().match(/const ATLAS_BUILD = "([^"]+)"/)[1];
if (process.env.EXPECTED_BUILD && process.env.EXPECTED_BUILD !== tag) throw new Error("local build differs from release stamp");
const assets = [["/", "index.html"], ...["app.js", "style.css", "traffic-vision.js", "vision-worker.js", "building-massing.js", "heritage-forms.js", "heritage-forms-layer.js", "maplibre-global.js"].map((p) => [`/${p}`, p])]
  .map(([url, path]) => ({ url, path, hash: sha(read(path)) }));
const base = process.env.ATLAS_URL || "https://atlas.nonarkara.org";

let streak = 0;
for (let attempt = 0; attempt < 30 && streak < 3; attempt++) {
  const results = await Promise.allSettled(assets.map(async (asset) => {
    const url = new URL(asset.url, base);
    url.searchParams.set("probe", `${tag}-${Date.now()}-${attempt}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`${asset.path} HTTP ${response.status}`);
    if (sha(Buffer.from(await response.arrayBuffer())) !== asset.hash) throw new Error(`${asset.path} old bytes`);
  }));
  const failures = results.filter((r) => r.status === "rejected");
  streak = failures.length ? 0 : streak + 1;
  if (failures.length) console.log(`waiting for ${new URL(base).host}: ${failures.map((r) => r.reason.message).join(", ")}`);
  if (streak < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
}
if (streak < 3) throw new Error(`byte convergence failed: ${base}`);
console.log(`PASS three consecutive matching byte probes: ${base} · ${tag}`);
