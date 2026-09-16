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
  follower_count INTEGER,
  moni_score INTEGER,
  wl_spots INTEGER,
  link_risk_level TEXT,
  link_risk_score INTEGER,
  link_risk_reasons TEXT,
  
  is_free INTEGER DEFAULT 0,
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
