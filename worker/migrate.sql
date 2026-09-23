-- Migration for databases created before Moni/WL giveaway fields existed.
-- Run only once against old databases. New databases should use schema.sql.
ALTER TABLE tweets ADD COLUMN moni_score INTEGER;
ALTER TABLE tweets ADD COLUMN wl_spots INTEGER;
ALTER TABLE tweets ADD COLUMN follower_count INTEGER;
ALTER TABLE tweets ADD COLUMN paid_price TEXT;
ALTER TABLE tweets ADD COLUMN public_price TEXT;
ALTER TABLE tweets ADD COLUMN whitelist_price TEXT;
ALTER TABLE tweets ADD COLUMN free_scope TEXT;
ALTER TABLE tweets ADD COLUMN is_free_whitelist INTEGER DEFAULT 0;
ALTER TABLE tweets ADD COLUMN link_risk_level TEXT;
ALTER TABLE tweets ADD COLUMN link_risk_score INTEGER;
ALTER TABLE tweets ADD COLUMN link_risk_reasons TEXT;
ALTER TABLE tweets ADD COLUMN is_giveaway INTEGER DEFAULT 0;
ALTER TABLE tweets ADD COLUMN is_raffle INTEGER DEFAULT 0;
ALTER TABLE tweets ADD COLUMN is_wl_giveaway INTEGER DEFAULT 0;
ALTER TABLE tweets ADD COLUMN is_wl_raffle INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS daily_summaries (
  summary_date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  telegram_message_id TEXT
);

CREATE TABLE IF NOT EXISTS opensea_drops (
  slug TEXT PRIMARY KEY,
  name TEXT,
  opensea_url TEXT,
  chain TEXT,
  source_type TEXT,
  status TEXT,
  category TEXT,
  score INTEGER DEFAULT 0,
  price TEXT,
  phase_summary TEXT,
  whitelist_url TEXT,
  public_url TEXT,
  starts_at TEXT,
  ends_at TEXT,
  total_supply INTEGER,
  max_supply INTEGER,
  minted_count INTEGER,
  image_url TEXT,
  raw_json TEXT,
  sent_to_telegram INTEGER DEFAULT 0,
  telegram_message_id TEXT,
  detected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_opensea_drops_score ON opensea_drops(score);
CREATE INDEX IF NOT EXISTS idx_opensea_drops_detected ON opensea_drops(detected_at);
CREATE INDEX IF NOT EXISTS idx_opensea_drops_sent ON opensea_drops(sent_to_telegram);

CREATE TABLE IF NOT EXISTS opensea_api_keys (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opensea_scan_status (
  id TEXT PRIMARY KEY,
  ok INTEGER DEFAULT 0,
  status TEXT,
  reason TEXT,
  error TEXT,
  drops_count INTEGER DEFAULT 0,
  sendable_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  last_scan_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_users (
  chat_id TEXT PRIMARY KEY,
  state TEXT,
  state_data TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  collection_slug TEXT NOT NULL,
  collection_name TEXT,
  baseline_price REAL,
  threshold_percent REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chat_id, collection_slug)
);
