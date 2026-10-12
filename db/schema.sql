-- Civic open-data store. Populated by scripts/ingest-bma-open-data.py from
-- Thailand's national/BMA open data portals (data.go.th, data.bangkok.go.th).
-- One flat table for every POI category rather than one table per category:
-- the categories share the same shape (a named point with an address) and
-- differ only in a handful of category-specific fields, which live in the
-- `properties` JSON blob instead of forcing a schema migration per dataset.

CREATE TABLE IF NOT EXISTS civic_pois (
  id TEXT PRIMARY KEY,              -- "<category>:<source id or row index>"
  category TEXT NOT NULL,           -- 'school' | 'sportsground' | 'carpark' | 'museum' | 'waterway'
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  district_id INTEGER,              -- OSM relation id, matches bkk-districts.geojson
  district_name_en TEXT,
  address TEXT,
  properties TEXT NOT NULL DEFAULT '{}',  -- category-specific fields, JSON
  source_dataset TEXT NOT NULL,     -- data.go.th / data.bangkok.go.th dataset slug
  source_url TEXT,
  ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_civic_pois_category ON civic_pois(category);
CREATE INDEX IF NOT EXISTS idx_civic_pois_district ON civic_pois(district_id);

-- One row per ingestion run, so re-running the pipeline is auditable rather
-- than a silent overwrite — this is the "consistently analyzed" part: any
-- analysis query can join against the run that produced its data.
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset TEXT NOT NULL,
  source_url TEXT,
  row_count INTEGER NOT NULL,
  ingested_at TEXT NOT NULL,
  notes TEXT
);

-- Live city events ("God Mode" breaking-incident layer).
--
-- Source: Longdo/iTIC public event feed (https://event.longdo.com/feed/json)
-- — real-time Thai road/city incidents reported by iTIC contributors, the
-- Royal Vehicle Protection company, and DOH. Every record ships with real
-- latitude/longitude from the reporter, so nothing here is geocoded by us:
-- a pin is where the source says the incident is, or it isn't stored.
--
-- Why persist at all when the feed is live and CORS-open? The feed is a
-- rolling window of only ~20 records nationwide. During a busy hour a
-- Bangkok accident can fall out of that window within minutes, while the
-- incident itself is still active and still worth a pin. Storing here lets
-- an event stay on the map for its full life instead of blinking out when
-- the upstream window rolls past it.
--
-- Populated only by the 5-minute cron on bkk-3d-atlas-cron (handler:
-- `scheduled` in src/index.ts). Public GETs read this table; they do
-- not ingest. Rows older than two days are deleted by that same cron.
CREATE TABLE IF NOT EXISTS city_events (
  id TEXT PRIMARY KEY,              -- Longdo eid
  title_th TEXT,
  title_en TEXT,
  description_th TEXT,
  description_en TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  icon TEXT,                        -- accident | flood | trafficjam | roadclosed | warning | …
  event_type TEXT,                  -- Longdo numeric type code
  severity TEXT,
  contributor TEXT,
  starts_at TEXT,                   -- source-declared start (Asia/Bangkok, as given)
  stops_at TEXT,                    -- source-declared expiry — accidents ≈ start + 1h
  district_id INTEGER,              -- OSM relation id, matches bkk-districts.geojson
  district_name_en TEXT,
  first_seen_at TEXT NOT NULL,      -- when THIS system first ingested it (UTC ISO)
  last_seen_at TEXT NOT NULL        -- last poll that still saw it upstream (UTC ISO)
);

CREATE INDEX IF NOT EXISTS idx_city_events_seen ON city_events(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_city_events_icon ON city_events(icon);

-- Geolocated news events ("what the city is talking about, and where").
--
-- Companion to city_events (live iTIC incidents) but a different kind of
-- signal: city_events is what is happening RIGHT NOW for an hour; this is
-- what is being DISCUSSED — a motor show, a concert, a rally — the things
-- that draw crowds and wreck traffic, and which are worth keeping forever
-- so patterns show up across months rather than vanishing in an hour.
--
-- Honesty contract, and the reason `match_phrase` exists:
-- news articles carry NO coordinates. A pin here is only created when a
-- real place name from public/bkk-venues.geojson (built from OpenStreetMap)
-- is found in the headline/summary text. The exact phrase that matched is
-- stored on every row, so any pin on the map can be audited back to the
-- words that put it there. Articles matching nothing get NO pin — they are
-- simply not stored. Nothing is geocoded by guesswork or dumped at the
-- city centre.
--
-- `precision` is either:
--   venue  — a specific named place (IMPACT Arena, BITEC) → exact pin
--   area   — a neighbourhood (Silom, Chatuchak) → area anchor, not a building
-- The client labels both, so nobody reads an area pin as a street address.
--
-- Built by scripts/ingest-news-events.py; gazetteer is the OSM-built
-- public/bkk-venues.geojson (599 venues + 13 curated areas).
CREATE TABLE IF NOT EXISTS news_events (
  id TEXT PRIMARY KEY,              -- stable hash of the article URL
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT,                      -- publisher domain
  published_at TEXT,                -- source-declared publish time
  summary TEXT,

  venue_name TEXT NOT NULL,         -- gazetteer entry that matched
  venue_kind TEXT,                  -- mall | stadium | exhibition_centre | area | …
  precision TEXT NOT NULL,          -- 'venue' | 'area'
  match_phrase TEXT NOT NULL,       -- the literal text that produced this pin
  lat REAL NOT NULL,
  lng REAL NOT NULL,

  district_id INTEGER,
  district_name_en TEXT,
  first_seen_at TEXT NOT NULL       -- when this system ingested it (UTC ISO)
);

CREATE INDEX IF NOT EXISTS idx_news_events_seen ON news_events(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_news_events_venue ON news_events(venue_name);

-- Last good FloodDash relay (src/flooddash.ts). One row per area; the cron
-- replaces it every ~10 min. fetched_at is when the payload was last good;
-- attempted_at/error record the most recent try, even a failed one.
CREATE TABLE IF NOT EXISTS flood_state (
  key          TEXT PRIMARY KEY,
  payload      TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  error        TEXT
);
