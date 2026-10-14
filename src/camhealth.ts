// Camera picture check. The Maholan aggregator lists ~1,700 cameras around
// Bangkok, but a sample on 2026-10-14 found most BMA traffic (สจส.) and
// drainage (สนน.) cameras answer with no image at all — dots that open onto
// nothing. The cron asks each camera for a small snapshot, a batch per run,
// oldest-checked first, and keeps the result so the map can say which
// cameras actually show a picture. One D1 row (flood_state, key cam-health).

import type { Env } from "./index";

const KEY = "cam-health";
const BATCH = 150;
const CONCURRENCY = 10;
const SNAP = "https://cctv.maholan.net/api/snap";

export type CamHealth = Record<string, { ok: boolean | null; at: string }>;

export async function readCamHealth(env: Env): Promise<CamHealth> {
  const row = await env.CIVIC_DB.prepare("SELECT payload FROM flood_state WHERE key = ?").bind(KEY).first<{ payload: string }>();
  try {
    return row ? (JSON.parse(row.payload) as CamHealth) : {};
  } catch {
    return {};
  }
}

/** Drop verdicts recorded before the indeterminate-verdict fix (2026-10-14).
 *  Those runs painted every camera "none" because the check itself was being
 *  refused; the verdicts are not evidence about the cameras, so they go.
 *  Safe to call repeatedly — once the row is empty it is a no-op. */
export async function resetCamHealth(env: Env): Promise<void> {
  await env.CIVIC_DB.prepare("DELETE FROM flood_state WHERE key = ?").bind(KEY).run();
}

/** A real picture: an image type that is not the SVG placeholder, and not a sliver of bytes.
 *  null = could not tell (refused, rate-limited, timed out): leave the camera
 *  unchecked rather than paint a working camera as silent. */
async function hasPicture(id: string): Promise<boolean | null> {
  try {
    const r = await fetch(`${SNAP}/${encodeURIComponent(id)}?w=96`, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org) camera-check" },
      signal: AbortSignal.timeout(12_000),
    });
    const type = r.headers.get("content-type") ?? "";
    if (r.status === 429 || r.status === 403 || r.status >= 500) return null;
    if (!r.ok || !/^image\/(jpeg|png|webp|gif)/.test(type)) return false;
    return (await r.arrayBuffer()).byteLength > 800;
  } catch {
    return null;
  }
}

export async function refreshCamHealth(env: Env, ids: string[]): Promise<{ checked: number; ok: number; indeterminate: number }> {
  const health = await readCamHealth(env);
  const known = new Set(ids);
  for (const id of Object.keys(health)) if (!known.has(id)) delete health[id];
  // Oldest check first. A camera with no entry yet sorts first, which is
  // what makes the sweep advance — so every attempt must record a
  // timestamp, including an indeterminate one. Before 2026-10-14 a null
  // result wrote nothing, so the same 150 unchecked cameras sat at the
  // head of the queue for every run and the sweep never moved past them.
  const queue = [...ids].sort((a, b) => (health[a]?.at ?? "").localeCompare(health[b]?.at ?? "")).slice(0, BATCH);
  let ok = 0;
  let indeterminate = 0;
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const part = queue.slice(i, i + CONCURRENCY);
    const res = await Promise.all(part.map(hasPicture));
    const at = new Date().toISOString();
    part.forEach((id, k) => {
      if (res[k] === null) {
        // Record the attempt so the queue advances, but keep the verdict
        // null: the map must not draw this camera as silent.
        health[id] = { ok: null, at };
        indeterminate++;
        return;
      }
      health[id] = { ok: res[k] as boolean, at };
      if (res[k]) ok++;
    });
  }
  const now = new Date().toISOString();
  await env.CIVIC_DB.prepare(
    `INSERT INTO flood_state (key, payload, fetched_at, attempted_at, error) VALUES (?1, ?2, ?3, ?3, NULL)
     ON CONFLICT(key) DO UPDATE SET payload = ?2, fetched_at = ?3, attempted_at = ?3, error = NULL`,
  ).bind(KEY, JSON.stringify(health), now).run();
  return { checked: queue.length, ok, indeterminate };
}

/** Who runs a camera, from Maholan's free-text source: iTIC, a government body, or other. */
export function cameraCategory(source: string): "itic" | "government" | "other" {
  const s = source.toLowerCase();
  if (/itic|longdo/.test(s)) return "itic";
  if (/กทม|กรม|เทศบาล|สำนัก|สจส|ปภ|egat|thaiwater|dwr|doh|กฟผ|องค์การบริหาร|อบจ|อบต/.test(s)) return "government";
  return "other";
}
