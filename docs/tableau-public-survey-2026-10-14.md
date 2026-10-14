# Tableau Public "Bangkok" survey — 2026-10-14

Search: public.tableau.com/app/search/vizzes/Bangkok — 1,541 results. The
search is fuzzy: most hits are *Bangor Daily News* (Maine) charts. 276 vizzes
genuinely concern Bangkok or Thailand; 172 of those are Airbnb.

Rule applied: a Tableau viz is someone's chart, not a dataset. Where a viz is
built on open data, the atlas reads the **original source**, credited, and
refreshable — never a copy scraped out of a workbook.

| Theme (vizzes) | Underlying data | Verdict |
|---|---|---|
| Airbnb (172) | Inside Airbnb, Bangkok `listings.csv`, CC BY 4.0 | **Adopted** — one layer, `bkk-airbnb.geojson`, snapshot 2026-09-22, 30,922 listings (`scripts/build-airbnb.py`) |
| Complaints / Traffy (1 · 1.6K views) | Traffy Fondue public API | **Already live** — flood tickets feed `/api/flood/roads` |
| Traffic congestion, TTI, intersections (4) | Longdo/iTIC | **Already live** — traffic layer |
| PM2.5 / AQI (5) | PCD, Open-Meteo CAMS | **Already live** — AQI layer |
| Metro stations (3) | operator station lists | **Already live** — rail layer |
| Land value, condo prices, property listings (≈15) | Treasury appraisal; web-scraped portals | **Have** Treasury land price; scraped asking prices are not a public record — **rejected** |
| Water quality (3) | PCD automatic stations | **Rejected for now** — 6 stations near Bangkok, last samples Dec 2025 (via FloodDash `/api/water-quality`) |
| Population / density (5) | DOPA registered population by district | **Candidate** — source the DOPA table directly; not in this pass |
| COVID isolation centres (1 · 2.5K views) | 2021 BMA list | **Rejected** — a 2021 emergency list read today would mislead |
| Airline surveys, bank KPIs, superstore, online sales, coursework | private or synthetic | **Rejected** — not about the city's ground |

Next if wanted: district population (DOPA) as a denominator for the flood
board — reports per 10,000 residents rather than raw counts.
