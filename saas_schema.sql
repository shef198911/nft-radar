CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS coin_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER,
  name TEXT,
  target_chat_id TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS coin_trackers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER,
  contract_address TEXT,
  network TEXT,
  ticker TEXT,
  baseline_price REAL,
  trigger_percent REAL,
  created_at TEXT
);
