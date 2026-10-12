/** Headers and request guards for the public atlas Worker.
 * Document CSP for static files lives in public/_headers. This copy is
 * applied only when a response does not already carry one (API JSON,
 * errors, R2 tiles). Keep the two strings identical; verify-local checks. */

/** Same policy as public/_headers. Do not add upgrade-insecure-requests
 * here — that suffix is https-only, below, so local wrangler stays on http. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
  "img-src 'self' https: data: blob:",
  "font-src 'self' https://tiles.openfreemap.org https://fonts.gstatic.com data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "media-src 'self' blob: https://camerai1.iticfoundation.org",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/([?&]key=)[^&\s]+/gi, "$1redacted").slice(0, 240);
}

export function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const set = (name: string, value: string) => {
    if (!headers.has(name)) headers.set(name, value);
  };
  const https = new URL(request.url).protocol === "https:";
  set("x-content-type-options", "nosniff");
  set("referrer-policy", "strict-origin-when-cross-origin");
  set("x-frame-options", "SAMEORIGIN");
  set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  set(
    "content-security-policy",
    https ? `${CONTENT_SECURITY_POLICY}; upgrade-insecure-requests` : CONTENT_SECURITY_POLICY,
  );
  if (https) set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

type HitWindow = { count: number; resetAt: number };

/** In-isolate counter. Cold starts reset it; it is a cost brake, not a WAF. */
export function hitLimit(
  bucket: Map<string, HitWindow>,
  key: string,
  limit: number,
  windowMs: number,
  maxKeys = 10_000,
): boolean {
  const now = Date.now();
  const entry = bucket.get(key);
  if (!entry || now > entry.resetAt) {
    if (bucket.size > maxKeys) bucket.clear();
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

/** Public reads are GET/HEAD. The presence heartbeat is the only POST.
 * Anything else is refused before a handler can fan out to upstreams. */
export function guardMethod(request: Request): Response | null {
  const pathname = new URL(request.url).pathname;
  const allowed = pathname === "/api/presence/ping"
    ? ["POST", "OPTIONS"]
    : ["GET", "HEAD", "OPTIONS"];
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        allow: allowed.join(", "),
        "access-control-allow-origin": "*",
        "access-control-allow-methods": allowed.join(", "),
        "access-control-allow-headers": "accept, content-type, range, if-match, if-none-match, x-atlas-session",
        "access-control-max-age": "86400",
        "cache-control": "no-store",
      },
    });
  }
  if (allowed.includes(method)) return null;
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: allowed.join(", "), "cache-control": "no-store" },
  });
}
