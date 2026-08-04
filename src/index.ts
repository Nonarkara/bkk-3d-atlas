// Cloudflare Worker entry. The atlas itself is a static SPA in public/;
// this worker exists so we can run on a custom domain (atlas.nonarkara.org)
// and so server-side logic (analytics ingest, geocoding, the
// iTIC/Longdo traffic proxy, and the 3D buildings PMTiles Range proxy)
// has a place to land. Today it:
//   (1) proxies /api/traffic to the iTIC/Longdo feed using a secret key
//   (2) serves /bkk-buildings.pmtiles from R2 with HTTP Range passthrough
//   (3) falls back to the static asset binding for everything else
//
// Why R2 for PMTiles: the Workers [assets] binding does NOT honor HTTP
// Range requests — every GET returns the full 17 MB. The pmtiles
// client lib streams by issuing Range requests for the directory and
// individual tiles, so we proxy through R2 which supports Range natively.

export interface Env {
  ASSETS: Fetcher;
  BKK_TILES: R2Bucket;
  LONGDO_KEY?: string;
}

const SPA_FALLBACK_PATHS = new Set<string>(["/atlas", "/atlas/"]);
const PMTILES_PATH = "/bkk-buildings.pmtiles";
const PMTILES_R2_KEY = "buildings/bangkok.pmtiles";
const RATTANAKOSIN_PMTILES_PATH = "/bkk-buildings-rattanakosin.pmtiles";
const RATTANAKOSIN_PMTILES_R2_KEY = "buildings/bangkok-rattanakosin.pmtiles";

const LONGDO_TRAFFIC_FEED = "https://traffic.longdo.com/api/feed/itsth";
const TRAFFIC_CACHE_TTL_SECONDS = 90;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", `public, max-age=${TRAFFIC_CACHE_TTL_SECONDS}`);
  return new Response(JSON.stringify(body), { ...init, headers });
}

// Parse a single-range HTTP Range header. Supports three shapes:
//   `bytes=<start>-`        → open-ended: from start to EOF
//   `bytes=<start>-<end>`   → closed range: from start to end inclusive
//   `bytes=-<suffix>`       → suffix range: last N bytes
// The pmtiles lib uses shape #2; the others are for correctness so
// other clients (curl, Range-aware browsers, etc.) work too.
function parseRange(header: string | null): { offset: number; length?: number } | null {
  if (!header) return null;
  const match = /^bytes=(-)?(\d+)(?:-(\d*))?$/.exec(header.trim());
  if (!match) return null;
  if (match[1] === "-") {
    // Suffix range: `bytes=-N` → last N bytes.
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { offset: 0, length: suffix, suffix: true } as { offset: number; length: number; suffix: true };
  }
  const offset = Number.parseInt(match[2], 10);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (match[3] === undefined || match[3] === "") {
    return { offset }; // open-ended
  }
  const end = Number.parseInt(match[3], 10);
  if (!Number.isFinite(end) || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

async function serveBuildingsPmtiles(request: Request, env: Env): Promise<Response> {
  return servePmtilesFromR2(request, env, PMTILES_R2_KEY, PMTILES_PATH);
}

async function serveRattanakosinPmtiles(request: Request, env: Env): Promise<Response> {
  return servePmtilesFromR2(request, env, RATTANAKOSIN_PMTILES_R2_KEY, RATTANAKOSIN_PMTILES_PATH);
}

async function servePmtilesFromR2(request: Request, env: Env, key: string, _logicalPath: string): Promise<Response> {
  const range = parseRange(request.headers.get("range"));
  // For a suffix range we first read the metadata to know the total
  // size, then issue a ranged get for the trailing N bytes.
  if (range && "suffix" in range && range.suffix) {
    const head = await env.BKK_TILES.head(key);
    if (head === null) return new Response("not found", { status: 404 });
    const suffixLen = range.length ?? 0;
    const length = Math.min(suffixLen, head.size);
    const offset = head.size - length;
    const obj = await env.BKK_TILES.get(key, { range: { offset, length } });
    if (obj === null || !("body" in obj) || obj.body === null) {
      return new Response(null, { status: 304 });
    }
    const headers = new Headers();
    headers.set("content-type", "application/octet-stream");
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "public, max-age=31536000, immutable");
    if (obj.httpEtag) headers.set("etag", obj.httpEtag);
    headers.set("x-bkkx-source", "R2 bkk-tiles/" + key);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${head.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  const obj = await env.BKK_TILES.get(key, {
    range: range ?? undefined,
    onlyIf: {
      etagMatches: request.headers.get("if-match") ?? undefined,
      etagDoesNotMatch: request.headers.get("if-none-match") ?? undefined,
    },
  });

  if (obj === null) {
    return new Response("not found", { status: 404 });
  }
  if (!("body" in obj) || obj.body === null) {
    // R2Object (metadata only) is only returned when range is requested
    // and the result is a 304/412 conditional. The conditional headers
    // above would have produced that, so surface it cleanly.
    return new Response(null, { status: 304 });
  }

  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);
  headers.set("x-bkkx-source", "R2 bkk-tiles/" + key);

  if (range) {
    const length = range.length ?? obj.size - range.offset;
    const end = range.offset + length - 1;
    headers.set("content-range", `bytes ${range.offset}-${end}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

async function proxyTraffic(request: Request, env: Env): Promise<Response> {
  if (!env.LONGDO_KEY) {
    return jsonResponse(
      {
        error: "longdo_key_not_configured",
        message:
          "LONGDO_KEY is not set on the worker. Run: npx wrangler secret put LONGDO_KEY. " +
          "For now, the static sample at /bkk-traffic-sample.geojson is used.",
        dataOrigin: "https://itic.longdo.com/opendata/",
      },
      { status: 503 },
    );
  }
  const url = new URL(LONGDO_TRAFFIC_FEED);
  url.searchParams.set("key", env.LONGDO_KEY);
  try {
    const upstream = await fetch(url.toString(), {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!upstream.ok) {
      return jsonResponse(
        {
          error: "longdo_upstream_error",
          status: upstream.status,
          message: `iTIC/Longdo feed returned ${upstream.status}. Falling back to static sample.`,
        },
        { status: 502 },
      );
    }
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": `public, max-age=${TRAFFIC_CACHE_TTL_SECONDS}`,
        "x-bkkx-source": "iTIC/Longdo live feed",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "longdo_fetch_failed",
        message: String(error),
      },
      { status: 502 },
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/traffic") {
      return proxyTraffic(request, env);
    }
    if (url.pathname === PMTILES_PATH) {
      return serveBuildingsPmtiles(request, env);
    }
    if (url.pathname === RATTANAKOSIN_PMTILES_PATH) {
      return serveRattanakosinPmtiles(request, env);
    }
    if (SPA_FALLBACK_PATHS.has(url.pathname)) {
      const fallback = new URL("/", url);
      return env.ASSETS.fetch(new Request(fallback, request));
    }
    return env.ASSETS.fetch(request);
  },
};
