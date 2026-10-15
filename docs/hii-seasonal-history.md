# HII seasonal flood history — audited 2026-10-15

Sources: https://data.hii.or.th/api/3/action/package_show?id=flood-area and
https://data.hii.or.th/dataset/flood-area . BMA's own district catalogue:
https://data.bangkok.go.th/dataset/50 . No API key required. Licence:
Creative Commons Attribution Non-Commercial; version unspecified in metadata.

Tier: reference, 2005–2021 satellite history. Calendar month is not a current
observation or forecast. CSV URL, source and boundary SHA256, source metadata
modification and retrieval time are in `public/bkk-hii-history.json`.

27,023 national rows. Bangkok: 352 subdistrict-month rows, 329 low, 23 medium,
zero high. 158 distinct khwaeng across 50 district codes. Counts by month:
June 25, September 37, October 92, November 158, December 40. Other months
have no Bangkok records in this CSV; this is not an all-clear.

All 50 existing OSM district names match HII's Thai AMPHOE_T exactly. The
builder validates a one-to-one name-to-code bridge, then groups by four-digit
AMPHOE_CODE. Six-digit GEOCODE identifies a child khwaeng; its prefix must
match its parent. Unknown bands, duplicate subdistrict-months, ambiguous
names and unmatched districts fail. No fuzzy transliteration joins.

Every OSM ID and coordinate was compared against the previous Git version
and is unchanged. Previous month-free `hii_risk` labels were retired. This
does not create official DOPA geometry or a khwaeng polygon layer.

Layers → Fine-tune toggles → HII seasonal flood history. Choose a calendar
month. Colour is the highest band among reported khwaeng, not a classification
of every square metre or every resident in the district. Missing is unassessed
and grey. Click for counts and source. Live Pulse no longer enables schematic
envelopes; the labelled Labs layer remains available separately.

`npm run build:history` rebuilds the compact reference artifact from metadata
and CSV. `npm run test:history` verifies joins, counts, missing months, geometry,
hashes and CSV failure behaviour. Review source drift before accepting updates.

The earlier Tableau search totals and universal negative claims were not
independently reproduced. View count or alleged student authorship does not
establish data quality. EV totals require compatible dates and units before
treating them as contradictions; not finding an API does not prove none exists.
