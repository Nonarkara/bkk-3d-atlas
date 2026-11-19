# The Atlas on three 0.187, and a pin that lives in six places

Scope: operational Atlas, main. The dependency batch, the pin that decides
what the browser actually loads, and the PR dispositions that followed.

## Reconciliation

Started at 91d4b8b. The working tree was clean; no branch, public layer,
source or earned content was deleted or rewritten. Every PR that was closed
here carries its disposition on the PR, and every branch was left in place.

## The batch, taken in pieces

PR #26 carried four dev-dependency bumps and its CI failed. The failure was
not the dependency: **TypeScript 7's package is not the package that was
there before.** The `"."` export is `lib/version.cjs` — a module carrying a
version string — the compiler is a native binary under `bin/`, and the
JavaScript compiler API lives behind `./unstable/*`.

Two suites here call that API directly:

```
scripts/test-flood-integrity.mjs   ts.transpileModule(source, {target: ts.ScriptTarget.ES2022})
scripts/test-source-health.mjs     ts.transpileModule(…)
```

Under TypeScript 7 the default import is `undefined` and both die on
*"Cannot read properties of undefined (reading 'ES2022')"* — 205 tests, 203
pass, 2 fail, exit 1. TypeScript 6.0.3 keeps the classic API
(`main: ./lib/typescript.js`, `ts.ScriptTarget.ES2022 === 9`), so 6.0.3 is
the newest TypeScript this repo's suites can run against.

Landed across two rounds, each with its own evidence:

| Package | From | To | Round |
| --- | --- | --- | --- |
| three | 0.186.1 | 0.187.0 | #27 |
| @cloudflare/workers-types | 5.20261012.1 | 5.20261113.1 | #27, then #29 |
| wrangler | 4.149.0 | 4.161.0 | #27, then #29 |
| typescript | 5.9.3 | **6.0.3** (7.0.2 held) | #27, #29 |

`npm run verify` passes, `npm run typecheck` exits 0, 234/234 tests pass,
and the tree reports 0 vulnerabilities.

## The pin lives in six places, and one of them is a hash

The Atlas does not serve three.js from node_modules. The browser resolves
`"three"` through an inline import map that points at unpkg, so bumping the
npm dependency does NOT move the runtime — and the version is written in six
places:

```
public/index.html                        the import map, twice, and its comment
public/building-massing.js               THREE_VERSION, and its comment
scripts/test-building-massing.mjs        the assertion that pins it
public/_headers                          the CSP hash OF THE IMPORT MAP ITSELF
```

The first round bumped only package.json, leaving the tree saying 0.187.0 in
the dependency and 0.186.1 everywhere that decides what the browser loads —
the runtime and the types disagreeing, which is the disagreement this repo's
own comment warns about. All six now say 0.187.0, and the CSP hash is
recomputed the way `verify-local` computes it: sha256 of the import map's
text, base64. Edit the map without updating `public/_headers` and the massing
layer dies silently in production — it did, on 2026-10-14.

## Does it still draw?

A pin that is consistent, hashed correctly, and broken is still broken, and
the Atlas's history says exactly that: the massing layer once shipped 1,080
buildings, installed without error, passed every unit test, and drew
nothing. The gates here check agreement and hashing. None of them asks
whether a triangle is drawn.

So the live Atlas was opened at street zoom in a real browser, with every
`drawElements` and `drawArrays` call counted, the console watched, and the
network watched for which three.js was actually fetched:

```
import map in the served page   three@0.187.0
three.js the browser fetched    unpkg three@0.187.0 — module, core, GLTFLoader,
                                DRACOLoader, meshopt
WebGL draw calls                8479
biggest single draw             67830 vertices
console errors                  0
```

It draws. The instrument lives in the BKKx repository
(`tools/atlas-3d-check.mjs`), because that is where the browser is.

## PR dispositions

| PR | Disposition |
| --- | --- |
| #16 | **merged** — the github-actions group, CI green |
| #26 | **closed as landed** in #27, TypeScript held at 6 |
| #28 | **closed as landed** in #29, TypeScript held at 6 |
| #27 | **merged** — three 0.187, workers-types, wrangler, TypeScript held |
| #29 | **merged** — workers-types 5.20261113.1, wrangler 4.161.0 |
| #2 | **closed as superseded** — the phone header landed via #17 |
| #4 | **closed as superseded** — the civic POI zoom, the legend toggles and the static fallback are all in main |
| #25 | **merged** — the location-evidence module, brought up to today's main first |

PR #25 was three weeks stale and its base was months old: on its own it
failed the gates for reasons that had nothing to do with its work (it still
named three 0.170.0 in a tree that had moved to 0.186.1). Merging today's
main into it — without rewriting its history — put it on the current tree,
where `npm run verify` passes, `npm run typecheck` exits 0 and 234/234 tests
pass, and CI agrees. It adds `src/location-evidence.ts`,
`src/location-worker.ts`, `wrangler.location.toml`, its test and its audit
note. The release script deploys named configs only (`wrangler.cron.toml`),
so the new isolated worker is additive and cannot disturb the live atlas.

## Released

`bkk-atlas-20261119-1795079778-e06df0d` — the release script's own live
suite: 34 checks, ALL PASS.

## Remaining

- The Cloudflare rate-limiting rules for the BKKx site still need confirming
  in the zone. That is an owner action and it is recorded in the BKKx ledger.
- The location-evidence Worker is merged but not deployed: it ships with its
  own config, and deploying it is a separate decision.
