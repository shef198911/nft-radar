CREATE TABLE IF NOT EXISTS tweets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tweet_id TEXT NOT NULL UNIQUE,
  tweet_url TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  text TEXT NOT NULL,
  
  detected_at TEXT NOT NULL,
  
  score INTEGER DEFAULT 0,
  priority TEXT,
  
  project_key TEXT,
  
  chain TEXT,
  mint_type TEXT,
  opportunity_type TEXT,
  
  project_name TEXT,
  
  mint_date TEXT,
  mint_time TEXT,
  mint_time_raw TEXT,
  
  supply INTEGER,
  price TEXT,
  paid_price TEXT,
  public_price TEXT,
  whitelist_price TEXT,
  free_scope TEXT,
  follower_count INTEGER,
  moni_score INTEGER,
  wl_spots INTEGER,
  link_risk_level TEXT,
  link_risk_score INTEGER,
  link_risk_reasons TEXT,
  
  is_free INTEGER DEFAULT 0,
  is_free_whitelist INTEGER DEFAULT 0,
  is_whitelist INTEGER DEFAULT 0,
  is_allowlist INTEGER DEFAULT 0,
  is_fcfs INTEGER DEFAULT 0,
  is_gtd INTEGER DEFAULT 0,
  is_robinhood INTEGER DEFAULT 0,
  is_giveaway INTEGER DEFAULT 0,
  is_raffle INTEGER DEFAULT 0,
  is_wl_giveaway INTEGER DEFAULT 0,
  is_wl_raffle INTEGER DEFAULT 0,
  
  sent_to_telegram INTEGER DEFAULT 0,
  telegram_message_id TEXT,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tweets_score ON tweets(score);
CREATE INDEX IF NOT EXISTS idx_tweets_chain ON tweets(chain);
CREATE INDEX IF NOT EXISTS idx_tweets_detected ON tweets(detected_at);
CREATE INDEX IF NOT EXISTS idx_tweets_project ON tweets(project_key);

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
  updated_at TEXT,
  is_active INTEGER DEFAULT 1 NOT NULL
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
  language TEXT DEFAULT 'ru',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  collection_slug TEXT NOT NULL,
  collection_name TEXT,
  baseline_price REAL,
  threshold_percent REAL NOT NULL,
  threshold_type TEXT DEFAULT 'percent',
  threshold_abs REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chat_id, collection_slug)
);


CREATE TABLE IF NOT EXISTS alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER,
  direction TEXT,
  percent_change REAL,
  old_price REAL,
  new_price REAL,
  created_at TEXT
);


CREATE TABLE IF NOT EXISTS solana_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  address TEXT NOT NULL,
  name TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS solana_filters (
  wallet_id INTEGER PRIMARY KEY,
  notify_swap INTEGER DEFAULT 1,
  notify_transfer INTEGER DEFAULT 1,
  notify_nft INTEGER DEFAULT 1,
  notify_mint INTEGER DEFAULT 1,
  notify_stake INTEGER DEFAULT 1,
  notify_other INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS solana_tx_cache (
  signature TEXT PRIMARY KEY,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS evm_wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT, address TEXT, name TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS evm_filters (wallet_id INTEGER PRIMARY KEY, notify_swap INTEGER DEFAULT 1, notify_transfer INTEGER DEFAULT 1, notify_nft INTEGER DEFAULT 1, notify_mint INTEGER DEFAULT 1);
