# Security audit — bkk-3d-atlas

Date: 2026-10-12. Scope: this repository (Cloudflare Worker `src/index.ts`, static atlas in `public/`, D1 schema, GitHub Actions, npm dependencies). Checklist: secrets in code and history, auth, CORS, security headers and CSP, data rules (no Firestore; D1 is the store), open endpoints, Worker loop and cost guards, `npm audit`.

No keys were rotated. Nothing was deployed.

## Result

| Check | Highest finding | Outcome |
| --- | --- | --- |
| Secrets in code and history | None | Pass. No API keys, private keys, or cloud tokens in the tree or in `git log -p --all`. |
| Auth | Medium | Fixed in code. Public reads stay open on purpose. Unauthenticated side effects are closed or rate-limited. |
| CORS | Low | Accepted. `access-control-allow-origin: *` is the documented cross-origin civic API. No cookies and no credentialed responses. |
| Security headers / CSP | Medium | Fixed. Every Worker response gets nosniff, a referrer policy, frame protection, a permissions policy, and a CSP. HTTPS responses also get HSTS. |
| Data / Firestore rules | None | Pass. There is no Firestore or Firebase client. D1 is reached only by the Worker, with bound SQL parameters. |
| Open endpoints | Medium | Fixed. `workers.dev` and preview URLs are off. Methods other than GET/HEAD (plus the presence POST) are rejected. Snapshot proxy is rate-limited. Scoreboard no longer reports whether Google secrets exist. |
| Worker loop / cost guards | Medium | Fixed. Request handlers no longer ingest. Cron takes an overlap lock. Expensive upstreams share a D1 cache and a single in-flight refresh. PM2.5 is cached on a 0.01° grid. Event reads and retention are bounded. `cpu_ms` stays 200 on the request Worker and 30000 on the cron Worker. |
| Dependencies (`npm audit`) | High | Fixed. `wrangler` 4.92.0 pulled vulnerable `undici`, `ws`, `sharp`, and `esbuild` through miniflare. `wrangler` 4.149.0 and `@cloudflare/workers-types` 5.20261012.1 audit clean (0 vulnerabilities). |
| GitHub Actions | Medium | Fixed. Third-party actions are pinned to commit SHAs. Both workflows set `permissions: contents: read`. |

## Findings fixed here

### High — vulnerable dev toolchain (`npm audit`)

`wrangler` 4.92.0 depended on `undici` 7.x, `ws` 8.x, `sharp`, and `esbuild` with high advisories (proxy TLS bypass, response splitting, memory disclosure, dev-server file read). Those packages run in local `wrangler dev` and the deploy CLI, not inside the production isolate, but the checklist treats high audit results as in scope. Production dependency `pmtiles` was already clean.

### Medium — unpinned Actions and a broad `GITHUB_TOKEN`

`.github/workflows/verify.yml` and `deploy-cloudflare.yml` used floating tags (`actions/checkout@v4`, `actions/setup-node@v4`, `cloudflare/wrangler-action@v3`) and did not set `permissions`. A moved tag can run new code with the workflow token. Both workflows now pin:

- `actions/checkout` `11d5960a326750d5838078e36cf38b85af677262` (v4.4.0)
- `actions/setup-node` `49933ea5288caeca8642d1e84afbd3f7d6820020` (v4.4.0)
- `cloudflare/wrangler-action` `9acf94ace14e7dc412b076f2c5c20b8ce93c79cd` (v3.15.0)

and grant `contents: read` only. Deploy still uses `CLOUDFLARE_API_TOKEN` from GitHub secrets.

### Medium — security headers did not cover Worker responses

`public/_headers` already set a CSP, `nosniff`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy` on static assets. Worker-built responses (API JSON, 405s, the PMTiles proxy, the SVG snapshot placeholder) did not. `src/edge-guard.ts` now sets the same CSP when the response does not already have one, and adds HSTS on `https:` responses. `upgrade-insecure-requests` is https-only so `wrangler dev` on `http://127.0.0.1` is unchanged. `public/_headers` also gained HSTS, the paper page's Google Fonts hosts (`fonts.googleapis.com`, `fonts.gstatic.com`), which the previous policy blocked, and the inline Maholan `onerror` handler moved to an event listener so `script-src` can stay free of `'unsafe-inline'`. `style-src` still allows inline styles because MapLibre and the atlas chrome inject them. `verify-local` fails if `_headers` and `edge-guard.ts` drift.

### Medium — public requests could start heavy ingest

`GET /api/news-events` called `ctx.waitUntil(ingestNewsEvents(...))` on every request: four RSS feeds, GDELT, and venue matching measured at about 657 ms of CPU, above the request Worker's 200 ms cap. `GET /api/city-events` did the same for the Longdo feed, throttled only inside one isolate. `GET /api/water/bkk/incidents` called both. A client could fan out subrequests and D1 writes without authenticating.

Ingest now runs only in `scheduled` on `bkk-3d-atlas-cron`. City and news reads are bounded (`first_seen_at` window, news `LIMIT 4000`). The cron deletes city events older than 2 days and news events older than 14 days. A D1 row `cron-lock` skips a second pass while one is running, and expires after 10 minutes if a pass dies.

### Medium — uncached upstream amplifiers

These handlers called a third party on every request, and `cache-control` on the response does not stop the Worker from running again:

- `/api/cctv` (Longdo camera feed)
- `/api/water/bkk/rain-stations` (ThaiWater)
- `/api/water/bkk/kpi` (four ThaiWater calls)
- `/api/risk` (Open-Meteo PM2.5 at full coordinate precision)

CCTV, rain, and KPI now use the existing D1 cache (`withD1Cache`), and concurrent misses share one refresh. PM2.5 is cached for 5 minutes on a 0.01° grid (about 1 km), with a cap of 8,000 entries. `/api/snap/<id>` stays on the fixed Maholan host with the existing id allowlist, and is limited to 60 requests per minute per IP per isolate. Presence pings are limited to 12 per minute per IP, session ids must match a short token shape, and the in-memory map stops at 2,000 sessions.

### Medium — extra public hostnames and methods

`wrangler.toml` did not set `workers_dev` or `preview_urls`, so the platform default can also publish `*.workers.dev` and preview URLs beside `atlas.nonarkara.org`. Both are now `false` on the request Worker (the cron Worker already had this). `POST`/`PUT`/`DELETE` to read routes return 405 before any handler runs. `OPTIONS` returns a short public CORS preflight.

### Low — client error text could echo an exception

`/api/traffic` builds an upstream URL that includes `LONGDO_KEY`. `fetchUpstream` already swallows fetch failures, but the handler's `catch` returned `String(error)` to the client. That path, the CCTV handler, and the ThaiWater helper now log a redacted message and return fixed text.

### Low — scoreboard reported Google secret presence

`/api/atlas/scoreboard` set `feeds.googleWeather.live` from `Boolean(env.GOOGLE_MAPS_API_KEY || env.GOOGLE_WEATHER_API_KEY)`. The route serves Open-Meteo and does not call Google. `live` is now `true` for the model feed and does not read those secrets.

## Accepted (not changed)

- **CORS `*`** on public JSON, GeoJSON, and the snapshot image. Chula/UNL reuse in the README depends on it. Responses are not credentialed.
- **No user auth.** The atlas is a public civic map. The medium issue was unauthenticated *work*, which is what the cost guards close.
- **No Firestore rules file.** D1 has no browser SDK. SQL uses `?` bindings. That is the data-rule equivalent, and it already held.
- **Account id `74ad6bf8dfaaccf82de6f0847f7d2d54` and D1 id `2fed2bc0-b8bf-4497-aa22-c6ac5b39a330`** are in `wrangler.toml` and the README. They identify the account and database. They are not API tokens.
- **In-isolate rate limits reset on a cold start.** They reduce one isolate's blast radius. They are not a zone WAF.
- **`style-src 'unsafe-inline'`** stays, so a style-injection bug is still possible. Script injection is what the CSP is there to stop.
- **No self-fetch loop.** Incident aggregation calls handlers directly. Asset reads use the `ASSETS` binding, not `fetch` of `atlas.nonarkara.org`.

## Secrets scan

Working tree (excluding flood-road cells and the lockfile): no `AIza…`, `AKIA…`, `ghp_…`, Slack tokens, live Stripe keys, or private keys.

History: `git log -p --all` with the same patterns, plus `LONGDO_KEY=<value>`, returned no commits.

`LONGDO_KEY` is documented as a Wrangler secret (`npx wrangler secret put LONGDO_KEY`) and is not in `[vars]`.

## What the owner must do

This change does not rotate secrets and does not deploy.

1. **Deploy when you are ready.** The Worker, the cron Worker, and the header changes do nothing in production until the next deploy. Prefer the existing path: cron config first, then the request Worker. Confirm `https://atlas.nonarkara.org/` still loads the map, and that the `*.workers.dev` hostname for `bkk-3d-atlas` no longer serves.
2. **Keep `bkk-3d-atlas-cron` deployed.** City events and news no longer refresh from visitor traffic. If the cron Worker is missing, those layers go stale within one cron interval (5 minutes) and then age out.
3. **Do not rotate keys because of this audit.** Nothing in git history was a live credential. Rotate `LONGDO_KEY`, any Google keys, or `CLOUDFLARE_API_TOKEN` only if you know one was pasted into a log, a dashboard `[vars]` entry, or a chat.
4. **Confirm the GitHub secret `CLOUDFLARE_API_TOKEN` is a Workers edit token** for account `74ad6bf8dfaaccf82de6f0847f7d2d54` and the `nonarkara.org` zone, not an account-wide API key. This PR cannot see the secret's scope.
5. **Add a Cloudflare rate-limiting rule** on `atlas.nonarkara.org` for `/api/*` if you want a limit that survives cold starts. The in-isolate caps are the code-side brake only.
6. **No Firestore console change.** There is no Firebase project in this repo.
7. **Optional later:** move `actions/checkout` and `cloudflare/wrangler-action` to their current major versions. They are pinned to the commits the previous floating tags resolved to on 2026-10-12.

## How this was checked

- `npm audit` after the wrangler bump: 0 vulnerabilities.
- `npx tsc --noEmit`.
- `npm run verify` (static atlas checks, plus the new pins, permissions, CSP parity, cron lock, and workers.dev assertions).
- `npm run test:flood`: 22 tests, including KPI caching, D1 cache fallback, method guard, CSP on https vs local http, and the rate-limit counter.
- `git log` / `git grep` secret scan described above.
- Local `wrangler dev` on `http://127.0.0.1:8787`: `GET /` returns the `_headers` policy (including HSTS and the font hosts), `POST /api/news-events` returns 405, a valid presence ping returns 200, and a session id containing `<` returns 400.
- Headless Chrome loaded `/` and `/labs/paper/` from that server. Both documents rendered (atlas title and map node, paper title). The console log had no `Refused to` CSP messages. Chrome did not exit on its own because the atlas keeps timers running; the process was stopped after the DOM was captured. Tile and camera playback were not clicked through.

Not checked against production. `npm run smoke` hits the live site and was not run, because this work does not deploy.
