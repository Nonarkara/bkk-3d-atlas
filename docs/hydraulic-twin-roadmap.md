# Bangkok hydraulic twin — what is built, what the rest needs

Advice received 2026-10-14: an operational core of **EPA SWMM (+ PySWMM)** for
drains, pumps and gates, **Delft3D FM** for river, tide, canal and floodplain
(1D–2D), an **ML surrogate** for fast nowcasts, fed continuously by ThaiWater /
BMA / tide / radar — the shape of the BMA × Mott MacDonald Wang Thonglang pilot.
Upstream inflow (LISFLOOD / SWAT+ / HEC-HMS) and scenario extents
(LISFLOOD-FP / Flo-2D) around it.

## Built (live)

| Layer of the advice | In the atlas |
|---|---|
| Live data spine | FloodDash relay (HII/RID judged gauges, city verdict, DDS bulletin); **BKK FloodWatch** (bejranonda/flood2026, MIT) — 199 BMA canal gauges + HII, 24/48 h forecasts used only where they beat "no change" (`/api/flood/canals`); Traffy + iTIC + DDS street reports on the road network (`/api/flood/roads`); radar (RainViewer), ThaiWater rain. |
| Network | 4,063 OSM waterway segments, flow direction from drawing order; 267,856 OSM roads. |
| Status on the network | Waterway segments coloured from ~270 gauges (most severe within 1.5 km on the same named waterway). Display rule, not hydraulics. |

## Not built — and what each needs

| Component | Blocked on |
|---|---|
| SWMM drainage model | BMA's pipe network (diameters, inverts), pump-station curves and gate rules. Not public. The Wang Thonglang pilot had them under contract. |
| Delft3D FM river/canal/tide | Canal cross-sections and bed levels, gate operations, a tidal boundary series (Pak Nam), a DEM finer than 30 m (Bangkok is flat within a metre; 30 m DEMs cannot resolve it). |
| ML surrogate | A hydraulic model to imitate, or a long matched archive of gauge levels and flood extents. flood2026's per-gauge statistical forecasts are the honest version available today. |
| Upstream inflow (SWAT+/HEC-HMS) | Feasible from public RID/HII data; adds days of lead for Chao Phraya flow, little for Bangkok's rain-driven street floods. Candidate next step. |
| Scenario extents (Flo-2D, LISFLOOD-FP) | Same DEM problem; a scenario map would look precise and be wrong by street. Not until a LiDAR-grade DEM is available. |

## Order if pursued

1. Ask BMA Drainage (สำนักการระบายน้ำ) for the pump/gate inventory and pipe network for one district — Wang Thonglang, where the pilot exists.
2. SWMM for that district only, calibrated against its BMA canal gauges (already ingested).
3. Only then a surrogate, trained on that SWMM, scored against the same gauges, labelled until it beats persistence — the rule flood2026 already follows.

Pointers: github.com/bejranonda/flood2026 (in use) · github.com/flukelaster/SIAHRA (MIT; Chao Phraya FEWS discharge, Nonthaburi levels — not yet used).
