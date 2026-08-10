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
