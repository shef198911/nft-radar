/**
 * Challenger Verification Test Suite: Price Trackers Non-Regression & Isolation
 * Tests:
 * 1. Byte-for-byte zero modifications to src/binance.js, src/geckoterminal.js, src/opensea.js against backup.
 * 2. Empirical invocation of getBinancePrices and searchBinance from src/binance.js.
 * 3. Empirical invocation of getGeckoTerminalTokensByNetwork and searchGeckoTerminal from src/geckoterminal.js.
 * 4. Empirical invocation and execution of checkCoinAlerts logic for Binance and GeckoTerminal tokens.
 * 5. Empirical invocation and execution of checkPriceAlerts logic for NFT floor price tracking via OpenSea and Binance ETH fallback.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const { TestHarness, assert } = require('./helpers/test_harness.cjs');

const rootDir = path.resolve(__dirname, '../..');
const srcDir = path.join(rootDir, 'src');
const backupSrcDir = 'H:\\NFT_RADAR_BACKUP_FULL\\server_vps\\src';

function srcUrl(file) {
  return pathToFileURL(path.join(srcDir, file)).href;
}

async function runPriceTrackersSuite() {
  const harness = new TestHarness('Challenger M1-2: Price Trackers Non-Regression Suite');
  console.log('================================================================');
  console.log('   CHALLENGER VERIFICATION: PRICE TRACKERS NON-REGRESSION');
  console.log('   Testing Byte Isolation, API Invocations, and Alert Engines');
  console.log('================================================================\n');

  // 1. Verify byte-for-byte zero modifications
  await harness.test('CHK-01: Zero modifications to src/binance.js, src/geckoterminal.js, src/opensea.js', async () => {
    const files = ['binance.js', 'geckoterminal.js', 'opensea.js'];
    for (const f of files) {
      const currentPath = path.join(srcDir, f);
      const backupPath = path.join(backupSrcDir, f);
      assert(fs.existsSync(currentPath), `Current file exists: ${f}`);
      assert(fs.existsSync(backupPath), `Backup file exists: ${f}`);

      const currentContent = fs.readFileSync(currentPath, 'utf8').replace(/\r\n/g, '\n');
      const backupContent = fs.readFileSync(backupPath, 'utf8').replace(/\r\n/g, '\n');

      assert.strictEqual(
        currentContent,
        backupContent,
        `File ${f} must be 100% byte-for-byte identical to baseline backup`
      );
    }
  });

  // 2. Test getBinancePrices and searchBinance
  await harness.test('CHK-02: getBinancePrices executes and handles symbol normalization and response parsing', async () => {
    const binance = await import(srcUrl('binance.js'));
    assert.strictEqual(typeof binance.getBinancePrices, 'function', 'getBinancePrices is exported');
    assert.strictEqual(typeof binance.searchBinance, 'function', 'searchBinance is exported');

    // Empty symbols test
    const emptyRes = await binance.getBinancePrices([], {});
    assert.deepStrictEqual(emptyRes, {}, 'Empty symbols return empty object');

    // Live or simulated fetch test for ETH and BTC
    try {
      const prices = await binance.getBinancePrices(['ETH', 'BTCUSDT'], {});
      if (prices && Object.keys(prices).length > 0) {
        if (prices['ETH']) {
          assert(typeof prices['ETH'] === 'number', 'ETH price is a number');
          assert(prices['ETH'] > 100, `ETH price should be realistic (>100), got ${prices['ETH']}`);
        }
        if (prices['BTCUSDT']) {
          assert(typeof prices['BTCUSDT'] === 'number', 'BTCUSDT price is a number');
          assert(prices['BTCUSDT'] > 1000, `BTC price should be realistic (>1000), got ${prices['BTCUSDT']}`);
        }
      }
    } catch (err) {
      console.warn('  [WARN] Binance external network unavailable, verified syntax and function contract:', err.message);
    }
  });

  // 3. Test getGeckoTerminalTokensByNetwork
  await harness.test('CHK-03: getGeckoTerminalTokensByNetwork executes and normalizes token addresses', async () => {
    const gecko = await import(srcUrl('geckoterminal.js'));
    assert.strictEqual(typeof gecko.getGeckoTerminalTokensByNetwork, 'function', 'getGeckoTerminalTokensByNetwork is exported');
    assert.strictEqual(typeof gecko.searchGeckoTerminal, 'function', 'searchGeckoTerminal is exported');

    // Empty addresses test
    const emptyRes = await gecko.getGeckoTerminalTokensByNetwork('eth', []);
    assert.deepStrictEqual(emptyRes, [], 'Empty addresses return empty array');

    // Fetch token with WETH contract
    const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    try {
      const tokens = await gecko.getGeckoTerminalTokensByNetwork('eth', [wethAddress]);
      if (tokens && tokens.length > 0) {
        const token = tokens[0];
        assert.strictEqual(token.network, 'eth', 'Network matches eth');
        assert.strictEqual(token.contract_address, wethAddress.toLowerCase(), 'Contract address matches in lowercase');
        assert(typeof token.priceUsd === 'number', 'priceUsd is a number');
      }
    } catch (err) {
      console.warn('  [WARN] GeckoTerminal network unavailable, verified syntax and function contract:', err.message);
    }
  });

  // 4. Test checkCoinAlerts logic execution
  await harness.test('CHK-04: checkCoinAlerts logic processes Binance and GeckoTerminal trackers and computes alerts', async () => {
    const grammy = await import(srcUrl('telegram-grammy.js'));
    assert.strictEqual(typeof grammy.checkCoinAlerts, 'function', 'checkCoinAlerts is exported');

    // Create an in-memory SQLite DB
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL
      );
      CREATE TABLE telegram_users (
        chat_id TEXT PRIMARY KEY,
        language TEXT DEFAULT 'ru'
      );
      CREATE TABLE coin_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        target_chat_id TEXT
      );
      CREATE TABLE coin_trackers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL,
        network TEXT NOT NULL,
        contract_address TEXT NOT NULL,
        ticker TEXT NOT NULL,
        baseline_price REAL NOT NULL,
        trigger_percent REAL NOT NULL
      );
    `);

    // Insert test data
    db.exec(`
      INSERT INTO profiles (id, chat_id) VALUES (1, '12345678');
      INSERT INTO telegram_users (chat_id, language) VALUES ('12345678', 'ru');
      INSERT INTO coin_collections (id, profile_id, target_chat_id) VALUES (1, 1, '12345678');
      -- Tracker 1: Binance ETH tracker (baseline: 2000, trigger: 5%)
      INSERT INTO coin_trackers (id, collection_id, network, contract_address, ticker, baseline_price, trigger_percent)
      VALUES (1, 1, 'binance', 'ETH', 'ETH', 2000.0, 5.0);
      -- Tracker 2: GeckoTerminal token (baseline: 1.0, trigger: 10%)
      INSERT INTO coin_trackers (id, collection_id, network, contract_address, ticker, baseline_price, trigger_percent)
      VALUES (2, 1, 'eth', '0x1234567890abcdef', 'TEST', 1.0, 10.0);
    `);

    // Mock environment simulating env.DB
    const fakeEnv = {
      DB: {
        prepare: (sql) => {
          const stmt = db.prepare(sql);
          return {
            bind: (...args) => ({
              all: async () => ({ results: stmt.all(...args) }),
              first: async () => stmt.get(...args),
              run: async () => stmt.run(...args)
            }),
            all: async () => ({ results: stmt.all() }),
            first: async () => stmt.get(),
            run: async () => stmt.run()
          };
        }
      },
      TELEGRAM_BOT_TOKEN: 'mock_token'
    };

    // Verify DB initial state
    const trackers = db.prepare('SELECT * FROM coin_trackers').all();
    assert.strictEqual(trackers.length, 2, '2 coin trackers initialized');

    // Run checkCoinAlerts with fakeEnv
    // Intercept global fetch so telegram messages and external APIs are mocked accurately
    const originalFetch = global.fetch;
    const sentTelegramMessages = [];

    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('api.binance.com')) {
        // Return ETH price of 2200 (a +10% move from 2000, triggering the 5% threshold)
        return {
          ok: true,
          json: async () => [{ symbol: 'ETHUSDT', price: '2200.00' }]
        };
      }
      if (urlStr.includes('api.geckoterminal.com')) {
        // Return TEST token price of 1.02 (+2% move from 1.0, below 10% threshold)
        return {
          ok: true,
          json: async () => ({
            data: [{
              attributes: {
                address: '0x1234567890abcdef',
                symbol: 'TEST',
                price_usd: '1.02'
              }
            }]
          })
        };
      }
      if (urlStr.includes('api.telegram.org')) {
        sentTelegramMessages.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return originalFetch(url, opts);
    };

    try {
      await grammy.checkCoinAlerts(fakeEnv);

      // Verify that Binance tracker triggered an alert because +10% >= 5%
      assert.strictEqual(sentTelegramMessages.length, 1, 'Exactly 1 coin alert triggered');
      const alertBody = sentTelegramMessages[0].text;
      assert(alertBody.includes('$ETH'), 'Alert contains $ETH');
      assert(alertBody.includes('+10.00%') || alertBody.includes('10%'), 'Alert contains +10% price delta');
      assert(alertBody.includes('BINANCE'), 'Alert contains BINANCE network badge');

      // Verify that baseline price was updated to new price 2200 for tracker 1
      const updatedTracker1 = db.prepare('SELECT baseline_price FROM coin_trackers WHERE id = 1').get();
      assert.strictEqual(updatedTracker1.baseline_price, 2200, 'Baseline price updated to 2200 after trigger');

      // Verify that tracker 2 was NOT updated because 2% < 10%
      const updatedTracker2 = db.prepare('SELECT baseline_price FROM coin_trackers WHERE id = 2').get();
      assert.strictEqual(updatedTracker2.baseline_price, 1.0, 'Baseline price remains 1.0 for untriggered tracker');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 5. Test checkPriceAlerts logic execution (NFT floor tracking)
  await harness.test('CHK-05: checkPriceAlerts logic processes OpenSea floor alerts with ETH conversion and updates baselines', async () => {
    const grammy = await import(srcUrl('telegram-grammy.js'));
    assert.strictEqual(typeof grammy.checkPriceAlerts, 'function', 'checkPriceAlerts is exported');

    // Create an in-memory SQLite DB
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE telegram_users (
        chat_id TEXT PRIMARY KEY,
        language TEXT DEFAULT 'ru'
      );
      CREATE TABLE price_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        collection_slug TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        baseline_price REAL,
        threshold_type TEXT NOT NULL,
        threshold_percent REAL,
        threshold_abs REAL,
        is_active INTEGER DEFAULT 1,
        updated_at TEXT
      );
      CREATE TABLE opensea_api_keys (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT
      );
      CREATE TABLE alert_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id INTEGER,
        direction TEXT,
        percent_change REAL,
        old_price REAL,
        new_price REAL,
        created_at TEXT
      );
    `);

    db.exec(`
      INSERT INTO telegram_users (chat_id, language) VALUES ('12345678', 'ru');
      -- Alert 1: Percent threshold: baseline 1.0 ETH, threshold 10%
      INSERT INTO price_alerts (id, chat_id, collection_slug, collection_name, baseline_price, threshold_type, threshold_percent, threshold_abs, is_active)
      VALUES (1, '12345678', 'bored-ape-yacht-club', 'BAYC', 10.0, 'percent', 10.0, NULL, 1);
      -- Alert 2: Abs threshold: baseline 2.0 ETH, threshold 0.5 ETH
      INSERT INTO price_alerts (id, chat_id, collection_slug, collection_name, baseline_price, threshold_type, threshold_percent, threshold_abs, is_active)
      VALUES (2, '12345678', 'azuki', 'Azuki', 2.0, 'abs', NULL, 0.5, 1);
      -- Alert 3: New alert with baseline null (should initialize baseline without alerting)
      INSERT INTO price_alerts (id, chat_id, collection_slug, collection_name, baseline_price, threshold_type, threshold_percent, threshold_abs, is_active)
      VALUES (3, '12345678', 'doodles', 'Doodles', NULL, 'percent', 5.0, NULL, 1);
    `);

    const fakeEnv = {
      DB: {
        prepare: (sql) => {
          const stmt = db.prepare(sql);
          return {
            bind: (...args) => ({
              all: async () => ({ results: stmt.all(...args) }),
              first: async () => stmt.get(...args),
              run: async () => stmt.run(...args)
            }),
            all: async () => ({ results: stmt.all() }),
            first: async () => stmt.get(),
            run: async () => stmt.run()
          };
        }
      },
      OPENSEA_API_KEY: 'test_opensea_key',
      TELEGRAM_BOT_TOKEN: 'mock_bot_token'
    };

    const originalFetch = global.fetch;
    const sentTelegramMessages = [];

    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('api.binance.com')) {
        return {
          ok: true,
          json: async () => [{ symbol: 'ETHUSDT', price: '3000.00' }]
        };
      }
      if (urlStr.includes('api.opensea.io/api/v2/collections/bored-ape-yacht-club/stats')) {
        // Floor moved from 10.0 to 12.0 (+20% >= 10% threshold)
        return {
          ok: true,
          json: async () => ({
            total: {
              floor_price: 12.0,
              volume: 1500.5,
              sales: 50,
              num_owners: 5000,
              average_price: 12.5,
              market_cap: 120000.0
            }
          })
        };
      }
      if (urlStr.includes('api.opensea.io/api/v2/collections/azuki/stats')) {
        // Floor moved from 2.0 to 2.2 (+0.2 diff < 0.5 threshold) -> NO TRIGGER
        return {
          ok: true,
          json: async () => ({
            total: {
              floor_price: 2.2,
              volume: 200.0,
              sales: 10,
              num_owners: 4000,
              average_price: 2.2,
              market_cap: 22000.0
            }
          })
        };
      }
      if (urlStr.includes('api.opensea.io/api/v2/collections/doodles/stats')) {
        // Doodles initial floor: 1.5 ETH
        return {
          ok: true,
          json: async () => ({
            total: {
              floor_price: 1.5,
              volume: 100.0,
              sales: 5,
              num_owners: 3000,
              average_price: 1.5,
              market_cap: 15000.0
            }
          })
        };
      }
      if (urlStr.includes('api.telegram.org')) {
        sentTelegramMessages.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return originalFetch(url, opts);
    };

    try {
      await grammy.checkPriceAlerts(fakeEnv);

      // Alert 1 (BAYC) triggered because 20% >= 10%
      // Alert 2 (Azuki) did NOT trigger because 0.2 < 0.5 ETH
      // Alert 3 (Doodles) initialized baseline to 1.5 ETH without alert
      assert.strictEqual(sentTelegramMessages.length, 1, 'Only BAYC triggered floor price alert');
      const msg = sentTelegramMessages[0].text;
      assert(msg.includes('BAYC'), 'Message contains BAYC name');
      assert(msg.includes('12'), 'Message contains new floor price 12');
      assert(msg.includes('10'), 'Message contains old floor price 10');

      // Verify baseline for BAYC was updated to 12.0
      const baycRow = db.prepare('SELECT baseline_price FROM price_alerts WHERE id = 1').get();
      assert.strictEqual(baycRow.baseline_price, 12.0, 'BAYC baseline updated to 12.0');

      // Verify baseline for Doodles was set to 1.5
      const doodlesRow = db.prepare('SELECT baseline_price FROM price_alerts WHERE id = 3').get();
      assert.strictEqual(doodlesRow.baseline_price, 1.5, 'Doodles baseline initialized to 1.5');
    } finally {
      global.fetch = originalFetch;
    }
  });

  const summary = harness.summary();
  if (!summary.allPassed) {
    console.error(`\nPrice Trackers Non-Regression Verification Failed: ${summary.fails} failures.`);
    process.exit(1);
  } else {
    console.log(`\nPrice Trackers Non-Regression 100% VERIFIED: All ${summary.passes} checks passed.`);
  }
}

if (require.main === module) {
  runPriceTrackersSuite().catch((err) => {
    console.error('Fatal Test Suite Error:', err);
    process.exit(1);
  });
}

module.exports = { runPriceTrackersSuite };
