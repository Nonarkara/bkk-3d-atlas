// Cloudflare Worker entry. The atlas itself is a static SPA in public/;
// this worker exists so we can run on a custom domain (atlas.nonarkara.org)
// and so future server-side logic (analytics ingest, geocoding, R2 reads for
// 3D Tiles) has a place to land. Today the only job is to pass the
// request through to the static asset binding and fall back to index.html
// for SPA routes.

export interface Env {
  ASSETS: Fetcher;
}

const SPA_FALLBACK_PATHS = new Set<string>(["/atlas", "/atlas/"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (SPA_FALLBACK_PATHS.has(url.pathname)) {
      const fallback = new URL("/", url);
      return env.ASSETS.fetch(new Request(fallback, request));
    }
    return env.ASSETS.fetch(request);
  },
};
