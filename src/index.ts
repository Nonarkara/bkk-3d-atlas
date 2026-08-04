// Cloudflare Worker entry. The atlas itself is a static SPA in public/;
// this worker exists so we can run on a custom domain (atlas.nonarkara.org)
// and so server-side logic (analytics ingest, geocoding, R2 reads for
// 3D Tiles, the iTIC/Longdo traffic proxy) has a place to land. Today
// it (1) proxies /api/traffic to the iTIC/Longdo feed using a secret
// API key, and (2) falls back to the static asset binding for
// everything else.

export interface Env {
  ASSETS: Fetcher;
  LONGDO_KEY?: string;
}

const SPA_FALLBACK_PATHS = new Set<string>(["/atlas", "/atlas/"]);

const LONGDO_TRAFFIC_FEED = "https://traffic.longdo.com/api/feed/itsth";
// BKKx-atlas is on a Thai CDN edge; the Longdo feed needs a path-style
// query, so the proxy just adds the API key as a query parameter.
const TRAFFIC_CACHE_TTL_SECONDS = 90;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", `public, max-age=${TRAFFIC_CACHE_TTL_SECONDS}`);
  return new Response(JSON.stringify(body), { ...init, headers });
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
    if (SPA_FALLBACK_PATHS.has(url.pathname)) {
      const fallback = new URL("/", url);
      return env.ASSETS.fetch(new Request(fallback, request));
    }
    return env.ASSETS.fetch(request);
  },
};
