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
