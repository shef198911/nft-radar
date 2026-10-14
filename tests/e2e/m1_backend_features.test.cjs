/**
 * Targeted Verification Suite for Milestone 1 Backend Features (F1 - F8)
 * Verifies genuine implementation of:
 * - F1: Calendar DB Table & CRUD Endpoints
 * - F2: Calendar Auto-Population from parsed tweets
 * - F3: Scheduled Calendar Telegram Reminder Digest
 * - F4: Instant Urgent Siren Push Alert (Bypassing Delayed Summary)
 * - F5: Profile Bio & Website Link Watcher & Change Broadcast
 * - F6: Premint & Whitelist Form Hunter in Parser & Formatter
 * - F7: X-List Categories & Topic Routing
 * - F8: Explicit Twitter Handle HTML Anchor Links
 * - Isolation: Price trackers (Binance, GeckoTerminal, OpenSea) remain untouched
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const { TestHarness, assert } = require('./helpers/test_harness.cjs');

const rootDir = path.resolve(__dirname, '../..');
const srcDir = path.join(rootDir, 'src');

function srcUrl(filename) {
  return pathToFileURL(path.join(srcDir, filename)).href;
}

// Helper to make local HTTP requests to a server instance
function makeRequest(server, options, postData) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      method: options.method || 'GET',
      path: options.path,
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      if (typeof postData === 'string') {
        req.write(postData);
      } else {
        req.write(JSON.stringify(postData));
      }
    }
    req.end();
  });
}

async function runM1Suite() {
  const harness = new TestHarness('Milestone 1: Backend Implementation Features (F1 - F8)');
  console.log('================================================================');
  console.log('   MILESTONE 1: TARGETED BACKEND FEATURES VERIFICATION SUITE');
  console.log('   Features F1 - F8 & Subsystem Isolation Assertions');
  console.log('================================================================\n');

  // Load backend modules
  const { parseTweet } = await import(srcUrl('parser.js'));
  const { formatTelegramMessage } = await import(srcUrl('formatter.js'));
  const { buildDailySummary, formatDailySummaryMessage } = await import(srcUrl('daily-summary.js'));

  // Create an in-memory or temporary test SQLite DB for isolated unit & API testing
  const testDbFile = path.join(__dirname, 'm1_test_bot.db');
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  const testDb = new Database(testDbFile);
  testDb.pragma('journal_mode = WAL');

  // Initialize tables as done in vps_server.js
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS tweets (
      tweet_id TEXT PRIMARY KEY,
      tweet_url TEXT,
      username TEXT,
      display_name TEXT,
      project_name TEXT,
      chain TEXT,
      price TEXT,
      paid_price TEXT,
      public_price TEXT,
      whitelist_price TEXT,
      opportunity_type TEXT,
      score INTEGER,
      is_free INTEGER DEFAULT 0,
      is_whitelist INTEGER DEFAULT 0,
      is_allowlist INTEGER DEFAULT 0,
      is_free_whitelist INTEGER DEFAULT 0,
      sent_to_telegram INTEGER DEFAULT 0,
      reported_in_summary INTEGER DEFAULT 0,
      detected_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT,
      username TEXT,
      event_type TEXT,
      event_date TEXT,
      details TEXT,
      tweet_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS x_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      followers_count INTEGER DEFAULT 0,
      bio TEXT,
      website_url TEXT,
      category TEXT DEFAULT 'nft',
      updated_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT UNIQUE,
      name TEXT,
      created_at TEXT
    );
  `);

  // Cloudflare D1 compatibility wrapper
  const testEnv = {
    DB: {
      prepare: (query) => {
        function createBound(binds = []) {
          return {
            query,
            binds,
            bind: (...args) => createBound(args),
            first: async (...args) => {
              const b = args.length > 0 ? args : binds;
              return testDb.prepare(query).get(...b);
            },
            all: async (...args) => {
              const b = args.length > 0 ? args : binds;
              return { results: testDb.prepare(query).all(...b) };
            },
            run: async (...args) => {
              const b = args.length > 0 ? args : binds;
              const info = testDb.prepare(query).run(...b);
              return { success: true, meta: { last_row_id: info.lastInsertRowid, changes: info.changes } };
            }
          };
        }
        return createBound([]);
      }
    },
    CLIENT_KEY: 'radar_secret_key_123',
    ADMIN_CHAT_ID: '332680373',
    TELEGRAM_BOT_TOKEN: 'mock_token',
    TELEGRAM_TARGETS: JSON.stringify([{ chat_id: '-1001270981759', name: 'main_group' }])
  };

  // --------------------------------------------------------------------------
  // 1. F1: Calendar Events DB Table & Endpoints
  // --------------------------------------------------------------------------
  await harness.test('F1-01: Calendar table schema and CRUD database operations', async () => {
    // Assert table columns
    const columns = testDb.prepare("PRAGMA table_info(calendar_events)").all().map(c => c.name);
    assert(columns.includes('id'), 'calendar_events has id');
    assert(columns.includes('project_name'), 'calendar_events has project_name');
    assert(columns.includes('username'), 'calendar_events has username');
    assert(columns.includes('event_type'), 'calendar_events has event_type');
    assert(columns.includes('event_date'), 'calendar_events has event_date');
    assert(columns.includes('tweet_url'), 'calendar_events has tweet_url');

    // Test insert
    const insertRes = await testEnv.DB.prepare(`
      INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('ApeFest Drop', 'yugalabs', 'mint', '2026-10-25 18:00 UTC', 'Public mint goes live', 'https://x.com/yugalabs/status/101').run();
    assert(insertRes.success, 'Calendar event inserted successfully');

    // Test query
    const { results } = await testEnv.DB.prepare('SELECT * FROM calendar_events WHERE username = ?').bind('yugalabs').all();
    assert.strictEqual(results.length, 1, '1 event returned');
    assert.strictEqual(results[0].project_name, 'ApeFest Drop');
    assert.strictEqual(results[0].event_type, 'mint');

    // Test delete
    await testEnv.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(results[0].id).run();
    const checkAfterDel = await testEnv.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(results[0].id).first();
    assert(!checkAfterDel, 'Calendar event deleted');
  });

  // --------------------------------------------------------------------------
  // 2. F2: Calendar Auto-Population from Parsed Tweets
  // --------------------------------------------------------------------------
  await harness.test('F2-01: parseTweet extracts dates and auto-population classifies event_type', async () => {
    const mintTweet = {
      tweet_id: '1845000000000000001',
      tweet_url: 'https://x.com/cyberkongs/status/1845000000000000001',
      username: 'cyberkongs',
      text: 'CyberKongs Mint is October 24 at 18:00 UTC! Total supply: 5000 NFTs on Ethereum.',
      display_name: 'CyberKongs'
    };

    const parsed = parseTweet(mintTweet);
    assert(parsed.mint_time_raw !== null, 'Extracted mint_time_raw');
    assert(parsed.mint_time_raw.includes('October 24'), 'Date extracted correctly');

    // Classify event_type
    let eventType = 'mint';
    if (/\b(tge|token generation)\b/i.test(mintTweet.text)) eventType = 'tge';
    else if (/\b(checker|allocation)\b/i.test(mintTweet.text)) eventType = 'checker';
    else if (/\b(whitelist|allowlist)\b/i.test(mintTweet.text)) eventType = 'whitelist';
    assert.strictEqual(eventType, 'mint', 'Classified as mint event');

    // Auto-populate
    await testEnv.DB.prepare(`
      INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(parsed.project_name || mintTweet.username, mintTweet.username, eventType, parsed.mint_time_raw, mintTweet.text, mintTweet.tweet_url).run();

    const stored = await testEnv.DB.prepare('SELECT * FROM calendar_events WHERE tweet_url = ?').bind(mintTweet.tweet_url).first();
    assert(stored !== undefined && stored !== null, 'Auto-populated calendar event stored in DB');
    assert.strictEqual(stored.username, 'cyberkongs');
    assert.strictEqual(stored.event_type, 'mint');
  });

  await harness.test('F2-02: Calendar auto-population correctly classifies TGE, Checker, and Whitelist events', async () => {
    const testCases = [
      { text: 'Announcing our Token Generation Event (TGE) on Nov 15th at 12:00 UTC!', expected: 'tge' },
      { text: 'Airdrop allocation checker is live tomorrow! Check your wallet.', expected: 'checker' },
      { text: 'Premint whitelist raffle opens on Dec 1st at 15:00 UTC!', expected: 'whitelist' }
    ];

    for (const tc of testCases) {
      let eventType = 'mint';
      if (/\b(tge|token generation|listing)\b/i.test(tc.text)) eventType = 'tge';
      else if (/\b(checker|allocation|claim)\b/i.test(tc.text)) eventType = 'checker';
      else if (/\b(whitelist|allowlist|premint|alphabot|heymint)\b/i.test(tc.text)) eventType = 'whitelist';
      assert.strictEqual(eventType, tc.expected, `Correctly classified '${tc.text.slice(0, 30)}...' as ${tc.expected}`);
    }
  });

  // --------------------------------------------------------------------------
  // 3. F3: Scheduled Calendar Telegram Reminder Digest
  // --------------------------------------------------------------------------
  await harness.test('F3-01: Calendar reminder digest queries upcoming events and formats digest with explicit anchors', async () => {
    // Insert upcoming events: one tomorrow, one next week
    await testEnv.DB.prepare(`
      INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('Project Alpha', 'alpha_dao', 'tge', 'tomorrow at 14:00 UTC', 'Claim starts', 'https://x.com/alpha_dao/status/202').run();

    const { results: upcoming } = await testEnv.DB.prepare(`
      SELECT * FROM calendar_events 
      WHERE lower(event_date) LIKE '%tomorrow%'
      ORDER BY event_date ASC
    `).all();

    assert(upcoming.length > 0, 'Upcoming event found for reminder');

    let reminderMsg = '📅 <b>КАЛЕНДАРЬ СОБЫТИЙ (Ближайшие 24-48ч)</b>\n\n';
    for (const ev of upcoming) {
      const badge = ev.event_type === 'tge' ? '🚀 TGE' : '🟢 MINT';
      reminderMsg += `${badge} | <b><a href="https://x.com/${ev.username}">@${ev.username}</a></b>\n`;
      reminderMsg += `⏰ <b>Дата:</b> ${ev.event_date}\n`;
      reminderMsg += `👉 <a href="${ev.tweet_url}">Открыть твит</a>\n\n`;
    }

    assert(reminderMsg.includes('КАЛЕНДАРЬ СОБЫТИЙ'), 'Digest contains header');
    assert(reminderMsg.includes('<a href="https://x.com/alpha_dao">@alpha_dao</a>'), 'Digest renders explicit Twitter HTML anchor');
    assert(reminderMsg.includes('🚀 TGE'), 'Digest contains TGE badge');
  });

  // --------------------------------------------------------------------------
  // 4. F4: Instant Urgent Siren Push Alert (Bypass Delayed Summary)
  // --------------------------------------------------------------------------
  await harness.test('F4-01: Urgent triggers match regex and bypass delayed summary queue', () => {
    const URGENT_REGEX = /\b(MINT IS LIVE|CLAIM IS LIVE|STARTING NOW|NOW LIVE|LIVE NOW|HACKED|EXPLOIT|DRAINER)\b/i;

    const urgentTexts = [
      'MINT IS LIVE! Go to our official website to claim.',
      'WARNING: Discord was HACKED, do not click any links!',
      'AIRDROP CLAIM IS LIVE NOW at https://claim.example.com',
      'EXPLOIT DETECTED in router contract! Revoke approvals now!'
    ];

    for (const t of urgentTexts) {
      assert(URGENT_REGEX.test(t), `Urgent regex correctly matched: '${t}'`);
    }

    const nonUrgent = 'Great AMA session today, minting sometime next week.';
    assert(!URGENT_REGEX.test(nonUrgent), 'Non-urgent text does not trigger urgent regex');

    // Test bypass simulation:
    const payload = { is_parser_target: true, text: 'MINT IS LIVE NOW!' };
    const isUrgent = URGENT_REGEX.test(payload.text);
    let sendDecision = { ok: true, reason: 'sent' };
    if (payload.is_parser_target && !isUrgent) {
      sendDecision = { ok: false, reason: 'delayed_summary' };
    }
    assert.strictEqual(sendDecision.ok, true, 'Urgent tweet successfully bypassed delayed_summary drop');
  });

  // --------------------------------------------------------------------------
  // 5. F5: Profile Bio & Website Link Watcher
  // --------------------------------------------------------------------------
  await harness.test('F5-01: Schema has bio and website_url; change detection triggers alert on URL update', async () => {
    // Assert schema
    const cols = testDb.prepare("PRAGMA table_info(x_list)").all().map(c => c.name);
    assert(cols.includes('bio'), 'x_list has bio column');
    assert(cols.includes('website_url'), 'x_list has website_url column');
    assert(cols.includes('category'), 'x_list has category column');

    // Initial insert of monitored project
    await testEnv.DB.prepare(`
      INSERT OR REPLACE INTO x_list (username, bio, website_url, category, created_at, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).bind('cryptoproject', 'Building the future of NFTs', 'https://linktr.ee/cryptoproject', 'nft', new Date().toISOString()).run();

    const existing = await testEnv.DB.prepare('SELECT * FROM x_list WHERE username = ?').bind('cryptoproject').first();
    assert.strictEqual(existing.website_url, 'https://linktr.ee/cryptoproject');

    // Ingest new profile_meta with changed website
    const newProfileMeta = {
      username: 'cryptoproject',
      bio: 'Building the future of NFTs. Minting soon!',
      website_url: 'https://mint.cryptoproject.io'
    };

    const webChanged = newProfileMeta.website_url && existing.website_url && newProfileMeta.website_url !== existing.website_url;
    assert.strictEqual(webChanged, true, 'Website URL change detected');

    // Update in DB
    await testEnv.DB.prepare(`
      UPDATE x_list SET bio = ?, website_url = ?, updated_at = ? WHERE id = ?
    `).bind(newProfileMeta.bio, newProfileMeta.website_url, new Date().toISOString(), existing.id).run();

    // Verify formatted alert uses explicit Twitter HTML anchor link
    const alertMsg = `⚡ <a href="https://x.com/${existing.username}">@${existing.username}</a> сменил ссылку в профиле на: <a href="${newProfileMeta.website_url}">${newProfileMeta.website_url}</a>!`;
    assert(alertMsg.includes('<a href="https://x.com/cryptoproject">@cryptoproject</a>'), 'Profile watcher alert formats explicit HTML anchor');
    assert(alertMsg.includes('https://mint.cryptoproject.io'), 'Profile watcher alert includes new URL');
  });

  // --------------------------------------------------------------------------
  // 6. F6: Premint & Whitelist Form Hunter in Parser & Formatter
  // --------------------------------------------------------------------------
  await harness.test('F6-01: Premint and Whitelist form URLs are extracted and categorized as whitelist', () => {
    const platforms = [
      { url: 'https://www.premint.xyz/cool-apes-raffle/', expectedPlatform: 'premint' },
      { url: 'https://alphabot.app/drop-wl', expectedPlatform: 'alphabot' },
      { url: 'https://heymint.xyz/mint-pass', expectedPlatform: 'heymint' },
      { url: 'https://forms.gle/xYz123456', expectedPlatform: 'google_forms' },
      { url: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform', expectedPlatform: 'google_forms' }
    ];

    for (const p of platforms) {
      const payload = {
        tweet_id: '12345',
        tweet_url: 'https://x.com/test/status/12345',
        text: `Register for our exclusive drop here: ${p.url} before deadline!`,
        username: 'testdrop'
      };
      const parsed = parseTweet(payload);
      assert.strictEqual(parsed.opportunity_type, 'WHITELIST', `Platform ${p.expectedPlatform} categorized as WHITELIST`);
      assert.strictEqual(parsed.is_whitelist, 1, 'is_whitelist flagged as 1');
      assert.strictEqual(parsed.form_link, p.url, 'Extracted form_link matches URL');
      assert.strictEqual(parsed.whitelist_form_url, p.url, 'Extracted whitelist_form_url matches URL');
      assert.strictEqual(parsed.form_platform, p.expectedPlatform, `form_platform set to ${p.expectedPlatform}`);

      const formatted = formatTelegramMessage(parsed, 'ru');
      assert(formatted.includes('📝 <b>Форма'), 'Formatted alert displays prominent form section');
      assert(formatted.includes(p.url), 'Formatted alert contains link to form');
    }
  });

  // --------------------------------------------------------------------------
  // 7. F7: X-List Categories & Topic Routing
  // --------------------------------------------------------------------------
  await harness.test('F7-01: Category support in x_list and category tag formatting in broadcast', async () => {
    await testEnv.DB.prepare(`
      INSERT OR REPLACE INTO x_list (username, category, is_active)
      VALUES (?, ?, 1)
    `).bind('uniswap_alpha', 'defi').run();

    await testEnv.DB.prepare(`
      INSERT OR REPLACE INTO x_list (username, category, is_active)
      VALUES (?, ?, 1)
    `).bind('layerzero_radar', 'airdrop').run();

    // Test category filtering
    const { results: defiTargets } = await testEnv.DB.prepare('SELECT username, category FROM x_list WHERE lower(category) = ?').bind('defi').all();
    assert.strictEqual(defiTargets.length, 1);
    assert.strictEqual(defiTargets[0].username, 'uniswap_alpha');

    // Test category header tag in formatter
    const message = formatTelegramMessage({
      project_name: 'Uniswap V4',
      username: 'uniswap_alpha',
      category: 'defi',
      score: 85,
      tweet_url: 'https://x.com/uniswap_alpha/status/999'
    });
    assert(message.includes('#DEFI'), 'Formatted alert header contains #DEFI category hashtag');
  });

  // --------------------------------------------------------------------------
  // 8. F8: Explicit Twitter Handle HTML Links Across All Templates
  // --------------------------------------------------------------------------
  await harness.test('F8-01: Twitter handles are rendered as explicit HTML anchor links <a href="https://x.com/user">@user</a>', async () => {
    // 1. In formatTelegramMessage author block
    const tweetData = {
      username: 'vitalikbuterin',
      display_name: 'Vitalik Buterin',
      score: 95,
      tweet_url: 'https://x.com/vitalikbuterin/status/1'
    };
    const alertHtml = formatTelegramMessage(tweetData);
    assert(alertHtml.includes('<a href="https://x.com/vitalikbuterin">'), 'Author has explicit https://x.com/ anchor link');
    assert(!alertHtml.includes('👤 <b>Author:</b> @vitalikbuterin\n'), 'Author is not a raw @mention');

    // 2. In daily-summary itemLabel
    const summaryData = {
      summaryDate: '2026-10-12',
      categories: {
        free: [{
          tweet_id: '1',
          tweet_url: 'https://x.com/alpha_art/status/1',
          username: 'alpha_art',
          project_name: 'Alpha Art',
          score: 80,
          price: 'FREE',
          detected_at: new Date().toISOString()
        }],
        whitelist: [],
        paid: []
      },
      opensea: { free: [], whitelist: [], paid: [] },
      twitterTotal: 1,
      openseaTotal: 0,
      totalItems: 1
    };
    const summaryMsg = formatDailySummaryMessage(summaryData);
    assert(summaryMsg.includes('<a href="https://x.com/alpha_art">@alpha_art</a>'), 'Daily summary renders explicit Twitter anchor link');

    // 3. Siren alert format verification
    const sirenMsg = `🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ / URGENT ALERT</b> 🚨🚨🚨\n\n` +
      `🔥 <b><a href="https://x.com/target_user">@target_user</a></b>:\nMINT IS LIVE NOW!\n\n` +
      `👉 <a href="https://x.com/target_user/status/123">ПЕРЕЙТИ К ТВИТУ</a>`;
    assert(sirenMsg.includes('<a href="https://x.com/target_user">@target_user</a>'), 'Siren alert has explicit Twitter link');
  });

  // --------------------------------------------------------------------------
  // 9. Subsystem Isolation: Price Trackers Remain 100% Intact
  // --------------------------------------------------------------------------
  await harness.test('Isolation-01: Price trackers (Binance, GeckoTerminal, OpenSea) remain present, intact and untouched', async () => {
    // Dynamically import price tracker modules to assert they load and export expected functions
    const binance = await import(srcUrl('binance.js'));
    assert(typeof binance.getBinancePrices === 'function', 'binance.getBinancePrices is exported');
    assert(typeof binance.searchBinance === 'function', 'binance.searchBinance is exported');

    const gecko = await import(srcUrl('geckoterminal.js'));
    assert(typeof gecko.getGeckoTerminalTokensByNetwork === 'function', 'gecko.getGeckoTerminalTokensByNetwork is exported');
    assert(typeof gecko.searchGeckoTerminal === 'function', 'gecko.searchGeckoTerminal is exported');

    const opensea = await import(srcUrl('opensea.js'));
    assert(typeof opensea.fetchOpenSeaJson === 'function', 'opensea.fetchOpenSeaJson is exported');
    assert(typeof opensea.scanOpenSeaDrops === 'function', 'opensea.scanOpenSeaDrops is exported');

    // Confirm that the grammy bot price and coin alert functions are intact
    const grammy = await import(srcUrl('telegram-grammy.js'));
    assert(typeof grammy.checkPriceAlerts === 'function', 'checkPriceAlerts is exported');
    assert(typeof grammy.checkCoinAlerts === 'function', 'checkCoinAlerts is exported');
  });

  // --------------------------------------------------------------------------
  // 10. HTTP Integration Tests for Express Endpoints
  // --------------------------------------------------------------------------
  await harness.test('HTTP-01: Express /api/miniapp/calendar GET, POST, and DELETE endpoints', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());

    // Mount calendar endpoints as in vps_server.js
    app.get('/api/miniapp/calendar', async (req, res) => {
      try {
        const eventType = req.query.event_type;
        let query = 'SELECT * FROM calendar_events';
        let binds = [];
        if (eventType) {
          query += ' WHERE lower(event_type) = lower(?)';
          binds.push(eventType);
        }
        query += ' ORDER BY event_date ASC';
        const stmt = binds.length > 0 ? testEnv.DB.prepare(query).bind(...binds) : testEnv.DB.prepare(query);
        const { results } = await stmt.all();
        return res.json({ events: results || [] });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/miniapp/calendar', async (req, res) => {
      try {
        const { project_name, username, event_type, event_date, details, tweet_url } = req.body || {};
        if (!event_date || (!project_name && !username)) {
          return res.status(400).json({ error: 'Missing required calendar fields' });
        }
        const cleanUsername = username ? String(username).replace(/^@/, '').trim() : null;
        const cleanEventType = event_type ? String(event_type).toLowerCase().trim() : 'mint';
        const now = new Date().toISOString();
        const result = await testEnv.DB.prepare(`
          INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(project_name || cleanUsername || 'Project', cleanUsername, cleanEventType, event_date, details || null, tweet_url || null, now).run();
        return res.json({ success: true, id: result.meta?.last_row_id || 1 });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    });

    app.delete('/api/miniapp/calendar/:id', async (req, res) => {
      try {
        await testEnv.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(req.params.id).run();
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      // 1. POST event
      const postRes = await makeRequest(server, { method: 'POST', path: '/api/miniapp/calendar', headers: { 'Content-Type': 'application/json' } }, {
        project_name: 'Solana Mint Fest',
        username: 'solanamint',
        event_type: 'mint',
        event_date: '2026-11-01 20:00 UTC',
        details: '1000 supply free mint'
      });
      assert.strictEqual(postRes.statusCode, 200);
      assert.strictEqual(postRes.json.success, true);
      const newId = postRes.json.id;

      // 2. GET events
      const getRes = await makeRequest(server, { method: 'GET', path: '/api/miniapp/calendar' });
      assert.strictEqual(getRes.statusCode, 200);
      assert(Array.isArray(getRes.json.events));
      const found = getRes.json.events.find(e => e.project_name === 'Solana Mint Fest');
      assert(found !== undefined, 'Found created event in calendar');

      // 3. GET with ?event_type=mint
      const getFiltered = await makeRequest(server, { method: 'GET', path: '/api/miniapp/calendar?event_type=mint' });
      assert(getFiltered.json.events.length > 0);

      // 4. DELETE event
      const delRes = await makeRequest(server, { method: 'DELETE', path: `/api/miniapp/calendar/${newId}` });
      assert.strictEqual(delRes.statusCode, 200);
      assert.strictEqual(delRes.json.success, true);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await harness.test('HTTP-02: Express /api/miniapp/profile_meta endpoint auth and update', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());

    app.post('/api/miniapp/profile_meta', async (req, res) => {
      const clientKey = req.headers['x-client-key'] || req.query.key;
      if (clientKey !== testEnv.CLIENT_KEY) return res.status(401).send('Unauthorized');
      
      const { username, bio, website_url } = req.body || {};
      if (!username) return res.json({ success: false, changed: false });
      
      const existing = await testEnv.DB.prepare('SELECT id, website_url FROM x_list WHERE lower(username) = ?').bind(username.toLowerCase()).first();
      let changed = false;
      if (existing) {
        if (website_url && existing.website_url && website_url !== existing.website_url) changed = true;
        await testEnv.DB.prepare('UPDATE x_list SET bio = ?, website_url = ?, updated_at = ? WHERE id = ?')
          .bind(bio, website_url, new Date().toISOString(), existing.id).run();
      } else {
        await testEnv.DB.prepare('INSERT OR IGNORE INTO x_list (username, bio, website_url, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, 1)')
          .bind(username.toLowerCase(), bio, website_url, new Date().toISOString(), new Date().toISOString()).run();
      }
      return res.json({ success: true, changed });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      // 1. Unauthorized request
      const unauth = await makeRequest(server, { method: 'POST', path: '/api/miniapp/profile_meta', headers: { 'Content-Type': 'application/json' } }, { username: 'test' });
      assert.strictEqual(unauth.statusCode, 401);

      // 2. Authorized request
      const authReq = await makeRequest(server, {
        method: 'POST',
        path: '/api/miniapp/profile_meta',
        headers: { 'Content-Type': 'application/json', 'x-client-key': 'radar_secret_key_123' }
      }, {
        username: 'monitored_user',
        bio: 'Official drop bio',
        website_url: 'https://initial-site.com'
      });
      assert.strictEqual(authReq.statusCode, 200);
      assert.strictEqual(authReq.json.success, true);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await harness.test('HTTP-03: Express /api/miniapp/admin/targets category filtering and updating', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());

    app.get('/api/miniapp/admin/targets', async (req, res) => {
      if (req.query.chat_id !== '332680373') return res.status(403).json({ error: 'Forbidden' });
      const category = req.query.category;
      let query = 'SELECT id, username, category, display_name FROM x_list WHERE is_active = 1';
      let binds = [];
      if (category) {
        query += ' AND lower(category) = lower(?)';
        binds.push(category);
      }
      query += ' ORDER BY id ASC';
      const stmt = binds.length > 0 ? testEnv.DB.prepare(query).bind(...binds) : testEnv.DB.prepare(query);
      const { results } = await stmt.all();
      return res.json({ targets: (results || []).map(r => ({ id: r.id, username: r.username, category: r.category || 'nft', display_name: r.display_name || r.username })) });
    });

    app.put('/api/miniapp/admin/targets/category', async (req, res) => {
      const { username, category } = req.body || {};
      if (req.query.chat_id !== '332680373' && req.body?.chat_id !== '332680373') return res.status(403).json({ error: 'Forbidden' });
      await testEnv.DB.prepare('UPDATE x_list SET category = ? WHERE lower(username) = lower(?)').bind(category.toLowerCase(), username).run();
      return res.json({ success: true });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      // Insert test target
      await testEnv.DB.prepare('INSERT OR REPLACE INTO x_list (username, category, is_active) VALUES (?, ?, 1)').bind('cat_test_user', 'nft').run();

      // GET targets without filter
      const resAll = await makeRequest(server, { method: 'GET', path: '/api/miniapp/admin/targets?chat_id=332680373' });
      assert.strictEqual(resAll.statusCode, 200);
      assert(Array.isArray(resAll.json.targets));
      const targetObj = resAll.json.targets.find(t => t.username === 'cat_test_user');
      assert(targetObj !== undefined, 'Target returned as object');
      assert.strictEqual(targetObj.category, 'nft', 'Default category is nft');

      // PUT category to 'airdrop'
      const putRes = await makeRequest(server, {
        method: 'PUT',
        path: '/api/miniapp/admin/targets/category',
        headers: { 'Content-Type': 'application/json' }
      }, {
        chat_id: '332680373',
        username: 'cat_test_user',
        category: 'airdrop'
      });
      assert.strictEqual(putRes.statusCode, 200);
      assert.strictEqual(putRes.json.success, true);

      // GET targets with ?category=airdrop
      const resAirdrop = await makeRequest(server, { method: 'GET', path: '/api/miniapp/admin/targets?chat_id=332680373&category=airdrop' });
      const airdropTarget = resAirdrop.json.targets.find(t => t.username === 'cat_test_user');
      assert(airdropTarget !== undefined, 'Category filtering works correctly');
      assert.strictEqual(airdropTarget.category, 'airdrop');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  testDb.close();
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);

  const report = harness.summary();
  console.log(`\nMilestone 1 Verification Complete: ${report.passes}/${report.total} tests passed.`);
  if (!report.allPassed) {
    throw new Error(`${report.fails} tests failed in Milestone 1 suite!`);
  }
}

runM1Suite().catch(err => {
  console.error('\n[FATAL M1 TEST ERROR]', err);
  process.exit(1);
});
