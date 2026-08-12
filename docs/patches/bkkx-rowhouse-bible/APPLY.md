# Apply the shophouse bible to BKKx

This cloud agent can write to `Nonarkara/bkk-3d-atlas` only.
`cursor[bot]` has no push permission on `Nonarkara/BKKx`, so the
culture-site landing is packaged here.

Branch: `cursor/rowhouse-bible-78e6`
Tip: `e2fcf56` — *Make npm test import TypeScript data modules on Node 22.*
Parent of first commit: `6e88c4d` (Codex, already on BKKx `main`)

## What this does

- Adds `/rowhouses/bible` (working paper 02 + recovered thesis catalog)
- Stops the directory hero from summing six papers into “870+ units”
- Keeps Onsawangchai 1,656, CPB 1,960, corridor counts, and the Overture queue separate
- Maps Yaowarat ONEP `2E6-081` to Plaeng Nam **and** Wanit–Sampheng
- Publishes Luenrit’s ICCROM ~220 without adding it to the 2001–02 survey
- `npm test` uses `--experimental-strip-types` so Node 22 can import `.ts` data modules

Verified here: vinext build, eslint on touched files, **28/28 tests pass**.

## Apply on a machine that can push BKKx

```bash
cd BKKx
git checkout main
git pull origin main
git checkout -b cursor/rowhouse-bible-78e6
git am /path/to/0001-add-shophouse-bible.patch
cd site && npm test && npm run lint
git push -u origin cursor/rowhouse-bible-78e6
# or merge to main if you want it live immediately
```

Live after deploy:

- https://bkk.nonarkara.org/rowhouses
- https://bkk.nonarkara.org/rowhouses/bible
- https://bkk.nonarkara.org/rowhouses/bible/paper.html
- https://bkk.nonarkara.org/rowhouses/bible/theses.html
