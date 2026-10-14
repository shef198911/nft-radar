/**
 * Database Helper for In-Memory SQLite Testing
 * Provides Cloudflare D1-compatible API wrapping better-sqlite3.
 */

const Database = require('better-sqlite3');

function createTestDatabase(options = {}) {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Initialize Full Schema
  db.exec(`
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
      reported_in_summary INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coin_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER,
      name TEXT,
      target_chat_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coin_trackers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER,
      contract_address TEXT,
      network TEXT,
      ticker TEXT,
      baseline_price REAL,
      trigger_percent REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      threshold_type TEXT DEFAULT 'percent',
      threshold_abs REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      UNIQUE(chat_id, collection_slug)
    );

    CREATE TABLE IF NOT EXISTS evm_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      address TEXT,
      name TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS solana_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      address TEXT NOT NULL,
      name TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS evm_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT,
      payload TEXT,
      created_at INTEGER,
      status TEXT DEFAULT 'pending'
    );
  `);

  // Cloudflare D1 compatible adapter
  const d1 = {
    _rawDb: db,
    prepare: (query) => {
      function createBound(binds = []) {
        return {
          bind: (...args) => createBound(args),
          first: async () => db.prepare(query).get(...binds),
          all: async () => ({ results: db.prepare(query).all(...binds) }),
          run: async () => ({ success: true, meta: db.prepare(query).run(...binds) })
        };
      }
      return createBound([]);
    },
    batch: async (statements) => {
      const tx = db.transaction((stmts) => {
        for (const s of stmts) {
          s.run();
        }
      });
      return tx(statements);
    }
  };

  return {
    rawDb: db,
    d1,
    close: () => db.close()
  };
}

module.exports = {
  createTestDatabase
};
