# Tableau Public "Bangkok" survey — deep pass, 2026-10-14

Supersedes the first pass. This one exhausts the search and follows each lead to its
original source.

## Method

Queried Tableau's real workbook search API directly, not the HTML page:

```
GET https://public.tableau.com/public/apis/bff/v2/search/query-workbooks
    ?count=100&start=N&language=en-us&type=vizzes
```

Search terms: `bangkok`, `thailand`, `chao phraya`, `bangkok flood`, `bangkok traffic`.
Union of results: **3,263 workbooks**. The `bangkok` term alone returned 1,541.

A Tableau viz is someone's chart, not a dataset. Where a viz is built on open data,
the atlas reads the **original source**, credited and refreshable — never a copy
scraped out of a workbook.

## The finding: Tableau Public has no Bangkok data for us

This is the honest result, and it is a negative one.

**Of 3,263 workbooks, exactly two carry Bangkok-district resolution:**

| Viz | Author | Views | Description |
|---|---|---|---|
| [Bangkok District](https://public.tableau.com/views/BangkokDistrict/sheets/Sheet2) | Theerachod Sepdham | 30 | "Bangkok District" |
| [Bangkok Infrastructure by District](https://public.tableau.com/views/BangkokInfrastructurebyDistrict/sheets/DistrictScore) | Nisha Prommool | 27 | "Bangkok Infrastructure by District" |

Both are ~30-view student projects with no description, no stated source, and no
identifiable refresh path. They cannot be integrated honestly.

Everything else sub-national is **province-level** (77 provinces). Bangkok is one
province, so province data cannot be placed on a Bangkok map.

The top of the view counts is not about the city's ground at all:

| Workbook | Views | Why it fails |
|---|---|---|
| SAT COVID Dashboard | 8,004,795 | COVID era; dead dataset |
| Thailand's SDG Progress (Open Development Mekong) | 520,507 | national aggregates, no coordinates |
| Total Internal Renewable Water per capita | 437,234 | see below — cannot be mapped |
| Covid19 Thailand v1.02 | 373,904 | COVID era |
| SDG: Thailand (ADB) | 281,169 | national aggregates |
| Greenhouse Gas by Sector (1990–2014) | 164,121 | national, historical, 12y stale |
| Thailand migration trends 2015, 2017 | 154,524 | national, 9y stale |
| Residual Waste Situation 2016 | 137,341 | national, 10y stale |

Keyword frequency over the whole union confirms the shape: 577 governance, 327
flood, 314 traffic, 206 short-term rental — and the flood/traffic/governance hits
are overwhelmingly national aggregates or COVID.

## Verdicts on every candidate worth naming

| Theme | Underlying data | Verdict |
|---|---|---|
| Airbnb / short-term rental | Inside Airbnb Bangkok `listings.csv`, CC BY 4.0 | **Adopted** — `bkk-airbnb.geojson`, 2026-09-22 snapshot, 30,922 listings |
| Complaints / Traffy | Traffy Fondue public API | **Already live** — feeds `/api/flood/roads` |
| Traffic, TTI, intersections | Longdo / iTIC | **Already live** |
| PM2.5 / AQI | PCD, Open-Meteo CAMS | **Already live** |
| Rail / metro stations | operator station lists | **Already live** — `bkk-rail.geojson` |
| Land value, condo prices | Treasury appraisal; scraped portals | **Have** Treasury prices; scraped asking prices rejected |
| Water quality (PCD stations) | PCD automatic stations | **Rejected for now** — 6 stations near Bangkok, samples stale |
| COVID isolation centres | 2021 BMA list | **Rejected** — a 2021 emergency list read today misleads |
| **EV charging stations** | EPPO | **Rejected — see below** |
| **Renewable water per capita** | World Bank `ER.H2O.INTR.PC` / FAO AQUASTAT | **Rejected for the map — see below** |
| Drought monitoring (DIGI Data Camp S3) | Office of Agricultural Economics | **Rejected** — student course project, no refresh path |
| GHGs, migration, poverty, SEZs, elderly | ODM / ADB / NSO national series | **Rejected** — national, and stale |
| Airline surveys, bank KPIs, OTT market research, coursework | private / synthetic | **Rejected** — not about the city |

### Why the EV dashboard fails

[EPPO Dashboard EV Thailand](https://public.tableau.com/views/EPPODashboardEVThailand/sheets/Main)
(27,510 views) looks like the obvious win. It is not.

EPPO has no open station API. Its own 2025 study report
(`eppo.go.th/images/Infromation_service/studyreport/2025/11.BatteryEV.pdf`) states the
charging-station coordinates were **collected from evme.io and plugshare.com**. The
"national EV database" and "unified hub" are announced plans, not live systems. Even
EPPO's own decks disagree with each other — one shows 849 chargers nationally, another
1,297 for Bangkok metro alone. There is no honest, citable station count to draw.

### Why renewable water per capita cannot be mapped

`ER.H2O.INTR.PC` is a **country** indicator: 181 economies, annual, no sub-national
resolution. The Atlas needs a value per khet. The underlying physical quantity
(Thailand's total internal renewable water) is a single national constant; dividing it
by population produces a per-capita figure that is mathematically identical for every
district inside the country.

Mapping it would be decoration. Rejected.

## Where the research actually paid: data.go.th

Two throwaway vizzes — [Thailand Road Accident 2008-2015](https://public.tableau.com/views/ThailandNewYearAccident_2008-2015/sheets/Dashboard1)
("using data from data.go.th") and [Rainfall Stun Province](https://public.tableau.com/views/RainfallStunProvince/sheets/RainfallAnnual)
("#OpendataThailand") — are worthless as charts but point at the actual source.

`data.go.th` is the Royal Government's CKAN portal, and unlike Tableau it is
refreshable and citable. Following it produced the one strong lead in this whole pass.

### HII national flood-risk classification — recommended

**Source:** สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน) — National Water Resources
Information Center, a public organisation under the Ministry of Natural Resources and
Environment.

- Portal: `data.hii.or.th`, dataset `flood-area`, modified 2025-11-25
- File: `monthly-flood-risk-area.csv`, 27,023 rows, 6.1 MB
- Method: shapefiles analysed from **GISTDA (สทอภ.) satellite imagery, BE 2548–2564
  (2005–2021)**, per tambon, classified into three bands
- Columns: `Month`, `GEOCODE`, `TAMBON_T/E`, `AMPHOE_CODE/T/E`, `PROV_CODE/T/E`,
  `COUNT 17 YEAR`, `CRITERIA`, `RISK`
- Bands: `1-3 ครั้งในรอบ 17 ปี` → low, `4-8` → medium, `9-17` → high
- Coverage: 75 provinces; **158 Bangkok khet**, present in months 6, 9, 10, 11, 12

Verified Bangkok split: **329 low, 23 medium, 0 high.** The 23 medium-risk khet are
exactly Bangkok's known flood ground — Nong Chok, Lam Toiting, Khok Faet, Lam Phak Chi,
Tha Raeng, Min Buri, Khlong Sam Prawet, Sam Wa Tok/Tawan Ok, Sai Mai, Khan Na Yao,
O Ngoen, Bang Chan, Saen Saep. That correspondence is strong evidence the classification
is real rather than noise.

**Honest framing required.** Despite the "monthly" in the filename, this is **not a live
observation**. It is a *seasonal risk climatology* — how often each tambon flooded over
a 17-year satellite record, keyed to calendar month. It must never be presented as
"this month the water is here." There is no observation date, no gauge, no depth.

**It replaces fabricated geometry.** `public/bkk-flood-envelope.geojson` is five
hand-drawn polygons that state their own status:

> "Schematic sandbox inspired by 2011 Chao Phraya floods + chronic monsoon drainage
> failures. Replace with DDPM/BMA official extents when available."
> "NOT for evacuation, insurance underwriting, or official planning."

Swapping hand-drawn envelopes for an official national classification is a genuine
upgrade in honesty, even though the official verdict (mostly low) differs from the
schematic's alarming corridors. That tension is itself worth surfacing: the national
satellite classification misses Bangkok's urban drainage and riverine flooding, which
is a real limitation of basin-scale remote sensing.

## The blocker: Atlas has no official khet layer

`public/bkk-districts.geojson` is **50 features**, sourced from OpenStreetMap
(`admin_level=6`, relation 92277), keyed by **OSM relation IDs** (92053, 92056, …).

Bangkok has **154 khet** (158 in this dataset). And the two naming schemes disagree —
only 34 of the 50 names match HII's official khet names, because OSM's layer mixes
tambon-level and district-level units the way tourism references do.

So the HII data cannot be joined today. The enabling work is:

1. Fetch a **154-khet official boundary layer** carrying DOPA `GEOCODE` (100101…105001).
2. Join `GEOCODE` → HII `RISK` per calendar month.
3. Render as a district-level choropleth with the climatology caveat in the UI.

Step 1 also fixes a structural gap Atlas has been carrying: a "districts" layer that is
neither 154 khet nor consistently sub-district.

## Recommendation

Take the HII flood-risk data and the official 154-khet boundary layer. Do not take
anything else from Tableau Public. Airbnb remains the single genuine win from this
platform, and it came from Inside Airbnb, not from the workbook.