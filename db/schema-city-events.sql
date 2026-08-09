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

CREATE TABLE IF NOT EXISTS city_events (
  id TEXT PRIMARY KEY,              -- Longdo eid
  title_th TEXT,
  title_en TEXT,
  description_th TEXT,
  description_en TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  icon TEXT,                        -- accident | flood | trafficjam | roadclosed | diversion | …
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
