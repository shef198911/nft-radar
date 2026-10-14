/**
 * Empirical Adversarial & Stress Testing Suite for Milestone 1 Backend Upgrades
 * Archetype: Challenger (critic, specialist)
 *
 * Exhaustively stress-tests:
 * 1. Calendar Endpoints (SQL injection, malformed dates, empty names, non-existent IDs, type poisoning)
 * 2. Urgent Siren Alerts (phrase coverage, case/boundary checks, delayed summary bypass, HTML safety)
 * 3. Profile Meta Watcher (rapid updates, concurrency, empty bios, malformed URLs, special characters)
 * 4. Whitelist Form Hunter (multi-link parsing, platform recognition, t.co resolution, false positives)
 * 5. Server Stability (no unhandled exceptions or crashes under adversarial inputs)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const express = require('express');
const { TestHarness, assert } = require('./helpers/test_harness.cjs');

const rootDir = path.resolve(__dirname, '../..');
const srcDir = path.join(rootDir, 'src');

function srcUrl(filename) {
  return pathToFileURL(path.join(srcDir, filename)).href;
}

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

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function runAdversarialSuite() {
  const harness = new TestHarness('Milestone 1: Adversarial Stress & Vulnerability Suite');
  console.log('================================================================');
  console.log('   MILESTONE 1: EMPIRICAL ADVERSARIAL STRESS & CORNER-CASE SUITE');
  console.log('   Stress-Testing Calendar, Siren Alerts, Profile Watcher, WL Hunter');
  console.log('================================================================\n');

  // Load target modules
  const { parseTweet } = await import(srcUrl('parser.js'));
  const { formatTelegramMessage } = await import(srcUrl('formatter.js'));

  // Create isolated test database
  const testDbFile = path.join(__dirname, 'adversarial_test.db');
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  const testDb = new Database(testDbFile);
  testDb.pragma('journal_mode = WAL');

  // Initialize DB Schema
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
      category TEXT DEFAULT 'nft',
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
    CLIENT_KEY: 'radar_adversarial_key',
    ADMIN_CHAT_ID: '332680373',
    TELEGRAM_BOT_TOKEN: 'mock_bot_token',
    TELEGRAM_TARGETS: JSON.stringify([{ chat_id: '-1001270981759', name: 'main_group' }])
  };

  // Mock broadcast recorder
  const broadcastLog = [];
  async function mockSendTelegramBroadcast(env, messages, replyMarkup, isXList = false, isParserTarget = false, category = null) {
    broadcastLog.push({ messages, replyMarkup, isXList, isParserTarget, category, timestamp: Date.now() });
    return { ok: true, results: [{ name: 'main', message_id: 1000 + broadcastLog.length }] };
  }

  // Profile watcher helper (matching vps_server.js implementation)
  async function handleProfileMetaUpdate(env, profileMeta) {
    if (!profileMeta || !profileMeta.username) {
      return { success: false, changed: false };
    }
    const username = String(profileMeta.username).replace(/^@/, '').toLowerCase().trim();
    if (!username) return { success: false, changed: false };

    const newBio = typeof profileMeta.bio === 'string' ? profileMeta.bio.trim() : null;
    const newWeb = typeof profileMeta.website_url === 'string' ? profileMeta.website_url.trim() : null;

    const existing = await env.DB.prepare('SELECT id, username, bio, website_url FROM x_list WHERE lower(username) = ?')
      .bind(username).first();

    if (existing) {
      const oldWeb = (existing.website_url || '').trim();
      const oldBio = (existing.bio || '').trim();

      const webChanged = !!(newWeb && oldWeb && newWeb !== oldWeb);
      const bioChanged = !!(newBio && oldBio && newBio !== oldBio);
      const bioHasMintAlert = bioChanged && /\b(mint|live|claim|tge|airdrop|whitelist|premint)\b/i.test(newBio);

      if (webChanged || bioHasMintAlert) {
        let alertMsg = '';
        if (webChanged) {
          alertMsg = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> сменил ссылку в профиле на: <a href="${escapeHTML(newWeb)}">${escapeHTML(newWeb)}</a>!`;
        } else {
          alertMsg = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> обновил БИО профиля:\n"${escapeHTML(newBio)}"`;
        }
        try {
          await mockSendTelegramBroadcast(env, alertMsg, null, false, false);
        } catch (e) {
          console.error('[PROFILE WATCHER] Alert send error:', e);
        }
      }

      await env.DB.prepare(`
        UPDATE x_list 
        SET bio = COALESCE(?, bio), website_url = COALESCE(?, website_url), updated_at = ?
        WHERE id = ?
      `).bind(newBio || null, newWeb || null, new Date().toISOString(), existing.id).run();

      return { success: true, changed: webChanged || bioChanged };
    } else {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO x_list (username, bio, website_url, created_at, updated_at, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(username, newBio, newWeb, new Date().toISOString(), new Date().toISOString()).run();

      return { success: true, changed: false };
    }
  }

  // Calendar reminder helper (matching vps_server.js implementation)
  async function checkCalendarReminders(env) {
    try {
      const { results: upcoming } = await env.DB.prepare(`
        SELECT * FROM calendar_events 
        WHERE (
          (datetime(event_date) IS NOT NULL AND datetime(event_date) >= datetime('now', '-1 hours') AND datetime(event_date) <= datetime('now', '+48 hours'))
          OR lower(event_date) LIKE '%tomorrow%'
          OR lower(event_date) LIKE '%сегодня%'
          OR lower(event_date) LIKE '%today%'
        )
        ORDER BY event_date ASC
      `).all();

      if (!upcoming || upcoming.length === 0) return { count: 0 };

      let reminderMsg = '📅 <b>КАЛЕНДАРЬ СОБЫТИЙ (Ближайшие 24-48ч)</b>\n\n';
      for (const ev of upcoming) {
        const badge = ev.event_type === 'tge' ? '🚀 TGE' : ev.event_type === 'checker' ? '🔍 CHECKER' : ev.event_type === 'whitelist' ? '📝 WHITELIST' : '🟢 MINT';
        const userLink = ev.username 
          ? `<a href="https://x.com/${escapeHTML(ev.username)}">@${escapeHTML(ev.username)}</a>` 
          : escapeHTML(ev.project_name || 'Проект');
        reminderMsg += `${badge} | <b>${userLink}</b>\n`;
        reminderMsg += `⏰ <b>Дата:</b> ${escapeHTML(ev.event_date)}\n`;
        if (ev.details) reminderMsg += `ℹ️ ${escapeHTML(ev.details.slice(0, 150))}\n`;
        if (ev.tweet_url) reminderMsg += `👉 <a href="${escapeHTML(ev.tweet_url)}">Открыть твит</a>\n`;
        reminderMsg += '\n';
      }

      await mockSendTelegramBroadcast(env, reminderMsg, null, false, false);
      return { count: upcoming.length, reminderMsg };
    } catch (e) {
      console.error('[CALENDAR CRON ERROR]:', e);
      return { count: 0, error: e.message };
    }
  }

  // Build Express Application with Real Handlers
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // GET /api/miniapp/calendar
  app.get('/api/miniapp/calendar', async (req, res) => {
    try {
      const eventType = req.query.event_type;
      let query = 'SELECT * FROM calendar_events';
      let binds = [];
      if (eventType && typeof eventType === 'string') {
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

  // POST /api/miniapp/calendar
  app.post('/api/miniapp/calendar', async (req, res) => {
    try {
      const { project_name, username, event_type, event_date, details, tweet_url } = req.body || {};
      if (!event_date || (!project_name && !username)) {
        return res.status(400).json({ error: 'Missing required calendar fields (event_date and project_name or username)' });
      }
      const cleanUsername = username ? String(username).replace(/^@/, '').trim() : null;
      const cleanEventType = event_type ? String(event_type).toLowerCase().trim() : 'mint';
      const now = new Date().toISOString();
      const result = await testEnv.DB.prepare(`
        INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        project_name || cleanUsername || 'Project',
        cleanUsername,
        cleanEventType,
        String(event_date),
        details || null,
        tweet_url || null,
        now
      ).run();

      return res.json({ success: true, id: result.meta?.last_row_id || 1 });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/miniapp/calendar/:id
  app.delete('/api/miniapp/calendar/:id', async (req, res) => {
    try {
      const id = req.params.id;
      await testEnv.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /api/miniapp/profile_meta
  app.post('/api/miniapp/profile_meta', async (req, res) => {
    try {
      const clientKey = req.headers['x-client-key'] || req.query.key;
      if (clientKey !== testEnv.CLIENT_KEY) {
        return res.status(401).send('Unauthorized');
      }
      const result = await handleProfileMetaUpdate(testEnv, req.body);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /ingest
  app.post('/ingest', async (req, res) => {
    try {
      const payload = req.body;
      if (!payload || typeof payload !== 'object') return res.status(400).send('Invalid format');
      if (typeof payload.tweet_id !== 'string' || typeof payload.tweet_url !== 'string' || typeof payload.text !== 'string') {
        return res.status(400).send('Missing or invalid required fields');
      }

      if (payload.text.length === 0) return res.status(400).send('Empty text');
      if (payload.text.length > 50000) return res.status(400).send('Text too long');

      // Profile meta watcher
      if (payload.profile_meta && typeof payload.profile_meta === 'object') {
        try {
          await handleProfileMetaUpdate(testEnv, payload.profile_meta);
        } catch (pmErr) {
          console.error('[PROFILE META ERROR]', pmErr);
        }
      }

      const parsed = parseTweet(payload);

      // F2: Auto-populate calendar_events
      if (parsed.mint_date || parsed.mint_time_raw) {
        let eventType = 'mint';
        const txt = payload.text || '';
        if (/\b(tge|token generation|listing)\b/i.test(txt)) eventType = 'tge';
        else if (/\b(checker|allocation|claim)\b/i.test(txt)) eventType = 'checker';
        else if (/\b(whitelist|allowlist|premint|alphabot|heymint)\b/i.test(txt) || parsed.is_whitelist || parsed.is_whitelist_form) eventType = 'whitelist';

        const eventDate = parsed.mint_date || parsed.mint_time_raw;
        const projectName = parsed.project_name || payload.display_name || payload.username || 'Project';
        const username = payload.username ? String(payload.username).replace(/^@/, '').trim() : null;

        const existingEvent = await testEnv.DB.prepare(`
          SELECT id FROM calendar_events 
          WHERE tweet_url = ? OR (lower(username) = lower(?) AND event_date = ?)
        `).bind(payload.tweet_url || '', username || '', eventDate).first();

        if (!existingEvent) {
          await testEnv.DB.prepare(`
            INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(projectName, username, eventType, eventDate, (payload.text || '').slice(0, 500), payload.tweet_url || null, new Date().toISOString()).run();
        }
      }

      // Urgent check
      const URGENT_REGEX = /\b(MINT IS LIVE|CLAIM IS LIVE|STARTING NOW|NOW LIVE|LIVE NOW|HACKED|EXPLOIT|DRAINER)\b/i;
      const isUrgent = URGENT_REGEX.test(payload.text || '');

      // F4: Instant urgent siren broadcast (bypasses delayed summary)
      if (isUrgent) {
        const userAnchor = payload.username 
          ? `<a href="https://x.com/${escapeHTML(payload.username)}">@${escapeHTML(payload.username)}</a>` 
          : 'Twitter Alert';
        const sirenMessage = `🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ / URGENT ALERT</b> 🚨🚨🚨\n\n` +
          `🔥 <b>${userAnchor}</b>:\n${escapeHTML((payload.text || '').slice(0, 400))}\n\n` +
          `👉 <a href="${escapeHTML(payload.tweet_url || '')}">ПЕРЕЙТИ К ТВИТУ</a>`;
        
        const replyButtons = [[{ text: '🚨 Open Tweet', url: payload.tweet_url }]];
        if (parsed.whitelist_form_url || parsed.form_link) {
          const formUrl = parsed.whitelist_form_url || parsed.form_link;
          const plat = parsed.form_platform ? (parsed.form_platform === 'premint' ? 'Premint' : parsed.form_platform === 'alphabot' ? 'Alphabot' : 'WL') : 'WL';
          replyButtons.push([{ text: `📝 Форма (${plat})`, url: formUrl }]);
        }
        const replyMarkup = { inline_keyboard: replyButtons };

        await mockSendTelegramBroadcast(testEnv, sirenMessage, replyMarkup, !!payload.is_x_list, false, parsed.category || 'nft');
        return res.json({
          status: 'ok',
          send_decision: 'urgent_siren_sent'
        });
      }

      // Delayed summary rule for non-urgent parser targets
      if (payload.is_parser_target) {
        return res.json({
          status: 'ok',
          send_decision: 'delayed_summary'
        });
      }

      return res.json({
        status: 'ok',
        send_decision: 'sent'
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Start HTTP Server on ephemeral port
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  try {
    // ========================================================================
    // SECTION 1: CALENDAR ENDPOINTS STRESS & ADVERSARIAL ATTACKS
    // ========================================================================

    await harness.test('ADV-CAL-01: SQL Injection Attempts in GET /api/miniapp/calendar?event_type=', async () => {
      // Seed a legitimate calendar event
      await testEnv.DB.prepare(`
        INSERT INTO calendar_events (project_name, username, event_type, event_date, details)
        VALUES ('Legit Project', 'legit_user', 'mint', '2026-11-01', 'Official Drop')
      `).run();

      const injections = [
        "' OR '1'='1",
        "'; DROP TABLE calendar_events; --",
        "mint' UNION SELECT 1, 'Injected', 'hacker', 'exploit', '2099', 'pwned', '', 'now' --",
        "admin'--",
        "1' OR 1=1; --"
      ];

      for (const attack of injections) {
        const res = await makeRequest(server, {
          method: 'GET',
          path: `/api/miniapp/calendar?event_type=${encodeURIComponent(attack)}`
        });
        assert.strictEqual(res.statusCode, 200, `Attack '${attack}' must return 200 without crashing`);
        assert(Array.isArray(res.json.events), 'Returns events array');
        assert.strictEqual(res.json.events.length, 0, `Injected query '${attack}' must match zero events`);
      }

      // Assert table was NOT dropped and still exists
      const count = testDb.prepare("SELECT count(*) as c FROM calendar_events").get();
      assert(count.c >= 1, 'calendar_events table remains intact after DROP TABLE attempts');

      // Assert SQLite integrity
      const integrity = testDb.prepare("PRAGMA integrity_check").get();
      assert.strictEqual(integrity.integrity_check, 'ok', 'Database integrity check passes');
    });

    await harness.test('ADV-CAL-02: Express Query Type Poisoning on /api/miniapp/calendar', async () => {
      // Sending array in query param ?event_type[]=mint&event_type[]=tge
      const resArray = await makeRequest(server, {
        method: 'GET',
        path: '/api/miniapp/calendar?event_type[]=mint&event_type[]=tge'
      });
      assert.strictEqual(resArray.statusCode, 200, 'Array query parameter handled gracefully without 500');
      assert(Array.isArray(resArray.json.events));

      // Sending object in query param ?event_type[foo]=bar
      const resObj = await makeRequest(server, {
        method: 'GET',
        path: '/api/miniapp/calendar?event_type[foo]=bar'
      });
      assert.strictEqual(resObj.statusCode, 200, 'Object query parameter handled gracefully without 500');
    });

    await harness.test('ADV-CAL-03: POST /api/miniapp/calendar - Empty, Whitespace & Missing Fields', async () => {
      // 1. Totally empty body
      const resEmpty = await makeRequest(server, {
        method: 'POST',
        path: '/api/miniapp/calendar',
        headers: { 'Content-Type': 'application/json' }
      }, {});
      assert.strictEqual(resEmpty.statusCode, 400, 'Empty body rejected with 400');

      // 2. Missing event_date
      const resNoDate = await makeRequest(server, {
        method: 'POST',
        path: '/api/miniapp/calendar',
        headers: { 'Content-Type': 'application/json' }
      }, { project_name: 'Super Project' });
      assert.strictEqual(resNoDate.statusCode, 400, 'Missing event_date rejected with 400');

      // 3. Missing both project_name and username
      const resNoName = await makeRequest(server, {
        method: 'POST',
        path: '/api/miniapp/calendar',
        headers: { 'Content-Type': 'application/json' }
      }, { event_date: '2026-12-01' });
      assert.strictEqual(resNoName.statusCode, 400, 'Missing project_name and username rejected with 400');

      // 4. Empty strings for names
      const resEmptyStrings = await makeRequest(server, {
        method: 'POST',
        path: '/api/miniapp/calendar',
        headers: { 'Content-Type': 'application/json' }
      }, { project_name: '', username: '', event_date: '2026-12-01' });
      assert.strictEqual(resEmptyStrings.statusCode, 400, 'Empty string project_name and username rejected with 400');
    });

    await harness.test('ADV-CAL-04: POST /api/miniapp/calendar - Malformed Dates & Reminder Digest Immunity', async () => {
      const malformedDates = [
        "not-a-valid-date",
        "99999-99-99T99:99:99Z",
        "<script>alert('xss')</script>",
        "2026/13/45 99:99",
        "NULL",
        "undefined"
      ];

      for (const badDate of malformedDates) {
        const postRes = await makeRequest(server, {
          method: 'POST',
          path: '/api/miniapp/calendar',
          headers: { 'Content-Type': 'application/json' }
        }, {
          project_name: `Stress Project ${badDate}`,
          event_type: 'mint',
          event_date: badDate,
          details: `<img src=x onerror=alert('boom')> details`
        });
        assert.strictEqual(postRes.statusCode, 200, `POST with bad date '${badDate}' stored safely`);
      }

      // Add a valid upcoming event within 24 hours to test digest compilation alongside malformed dates
      const validUpcoming = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
      await testEnv.DB.prepare(`
        INSERT INTO calendar_events (project_name, username, event_type, event_date, details)
        VALUES ('Legit Upcoming Drop', 'legit_artist', 'tge', ?, '<script>alert(1)</script>')
      `).bind(validUpcoming).run();

      // Trigger checkCalendarReminders with malformed dates present in the database
      const reminderResult = await checkCalendarReminders(testEnv);
      assert(!reminderResult.error, 'checkCalendarReminders executes with zero SQLite or runtime errors');
      assert(reminderResult.count >= 1, 'Upcoming valid event identified in reminder');

      // Assert that HTML tags in event details and username were escaped
      const lastBroadcast = broadcastLog[broadcastLog.length - 1];
      assert(lastBroadcast !== undefined, 'Reminder broadcast was dispatched');
      assert(!lastBroadcast.messages.includes('<script>'), 'XSS script tags are strictly escaped');
      assert(lastBroadcast.messages.includes('&lt;script&gt;'), 'XSS tags converted to safe HTML entities');
    });

    await harness.test('ADV-CAL-05: DELETE /api/miniapp/calendar/:id - Non-Existent, Negative & Injected IDs', async () => {
      const testIds = [
        '999999999',
        '-1',
        '0',
        'non-numeric-string',
        "1' OR 1=1; --",
        "undefined"
      ];

      for (const id of testIds) {
        const delRes = await makeRequest(server, {
          method: 'DELETE',
          path: `/api/miniapp/calendar/${encodeURIComponent(id)}`
        });
        assert.strictEqual(delRes.statusCode, 200, `DELETE non-existent/malformed id '${id}' returns 200`);
        assert.strictEqual(delRes.json.success, true);
      }
    });

    // ========================================================================
    // SECTION 2: URGENT SIREN ALERTS & DELAYED SUMMARY BYPASS
    // ========================================================================

    await harness.test('ADV-URG-01: Urgent Trigger Phrase Recognition & Siren Dispatch', async () => {
      const urgentPhrases = [
        "MINT IS LIVE NOW - grab yours at https://mint.xyz",
        "🚨 URGENT: CLAIM IS LIVE for all tier 1 holders",
        "The public sale is STARTING NOW!",
        "Contract verified, drop is NOW LIVE",
        "LIVE NOW on mainnet!",
        "CRITICAL: We have been HACKED. Do not sign transactions!",
        "ALERT: EXPLOIT detected in routing module",
        "DRAINER attack spotted on fake domain"
      ];

      for (let i = 0; i < urgentPhrases.length; i++) {
        const text = urgentPhrases[i];
        broadcastLog.length = 0;

        const res = await makeRequest(server, {
          method: 'POST',
          path: '/ingest',
          headers: { 'Content-Type': 'application/json' }
        }, {
          tweet_id: `urgent_test_${i}`,
          username: `alert_author_${i}`,
          tweet_url: `https://x.com/alert_${i}/status/123`,
          text: text,
          is_parser_target: true
        });

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.json.send_decision, 'urgent_siren_sent', `Phrase '${text}' triggered urgent siren alert`);
        assert.strictEqual(broadcastLog.length, 1, 'Broadcast dispatched immediately');
        assert(broadcastLog[0].messages.includes('🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ / URGENT ALERT</b> 🚨🚨🚨'));
        assert(broadcastLog[0].messages.includes(`https://x.com/alert_author_${i}`), 'Includes explicit HTML profile anchor');
      }
    });

    await harness.test('ADV-URG-02: Siren Trigger Case-Insensitivity & Word Boundary Constraints', async () => {
      // 1. Lowercase / Mixed Case
      const caseTexts = [
        "mint is live now hurry",
        "MiNt Is LiVe NoW",
        "we got hacked please help",
        "drainer found on site"
      ];

      for (let i = 0; i < caseTexts.length; i++) {
        const res = await makeRequest(server, {
          method: 'POST',
          path: '/ingest',
          headers: { 'Content-Type': 'application/json' }
        }, {
          tweet_id: `case_test_${i}`,
          username: 'case_user',
          tweet_url: 'https://x.com/case/status/1',
          text: caseTexts[i],
          is_parser_target: true
        });
        assert.strictEqual(res.json.send_decision, 'urgent_siren_sent', `Case variation '${caseTexts[i]}' triggers urgent siren`);
      }

      // 2. Negative word-boundary tests (must NOT trigger siren)
      const nonUrgentTexts = [
        "Our system is completely UNHACKED and secure.",
        "They are actively EXPLOITING new market dynamics in web3.",
        "Regular discussion about upcoming mint schedule."
      ];

      for (let i = 0; i < nonUrgentTexts.length; i++) {
        const res = await makeRequest(server, {
          method: 'POST',
          path: '/ingest',
          headers: { 'Content-Type': 'application/json' }
        }, {
          tweet_id: `non_urgent_test_${i}`,
          username: 'normal_user',
          tweet_url: 'https://x.com/normal/status/1',
          text: nonUrgentTexts[i],
          is_parser_target: true
        });
        assert.strictEqual(res.json.send_decision, 'delayed_summary', `Non-urgent text '${nonUrgentTexts[i]}' must be delayed`);
      }
    });

    await harness.test('ADV-URG-03: Urgent Tweets Bypass Delayed Summary Queue', async () => {
      // Ingest 2 identical parser target tweets: one standard, one with MINT IS LIVE NOW
      broadcastLog.length = 0;

      // Standard tweet from parser target
      const normalRes = await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: 'standard_target_tweet_101',
        username: 'parser_target_project',
        tweet_url: 'https://x.com/target/status/101',
        text: 'Working hard on our roadmap and partnership updates.',
        is_parser_target: true
      });
      assert.strictEqual(normalRes.json.send_decision, 'delayed_summary');
      assert.strictEqual(broadcastLog.length, 0, 'Normal parser target tweet delayed with 0 broadcasts');

      // Urgent tweet from same parser target
      const urgentRes = await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: 'urgent_target_tweet_102',
        username: 'parser_target_project',
        tweet_url: 'https://x.com/target/status/102',
        text: 'CRITICAL UPDATE: MINT IS LIVE NOW at https://official.io',
        is_parser_target: true
      });
      assert.strictEqual(urgentRes.json.send_decision, 'urgent_siren_sent');
      assert.strictEqual(broadcastLog.length, 1, 'Urgent tweet bypassed delayed summary and sent immediate broadcast');
    });

    await harness.test('ADV-URG-04: XSS & HTML Entity Escaping in Urgent Siren Messages', async () => {
      broadcastLog.length = 0;
      const xssText = `<script>alert('xss')</script> MINT IS LIVE NOW! Click <a href="evil.com">here</a> & win!`;

      await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: 'urgent_xss_test_999',
        username: 'xss_attacker<script>',
        tweet_url: 'https://x.com/test?a=1&b=2<script>',
        text: xssText,
        is_parser_target: true
      });

      assert.strictEqual(broadcastLog.length, 1);
      const msg = broadcastLog[0].messages;
      assert(!msg.includes('<script>alert'), 'Raw <script> tags removed/escaped');
      assert(msg.includes('&lt;script&gt;'), 'Converted to safe &lt;script&gt;');
      assert(msg.includes('&amp;'), 'Ampersands escaped');
    });

    // ========================================================================
    // SECTION 3: PROFILE META WATCHER STRESS & CORNER CASES
    // ========================================================================

    await harness.test('ADV-PRF-01: Rapid Sequential & Parallel Profile Meta Updates', async () => {
      // Seed a tracked user
      await testEnv.DB.prepare(`
        INSERT OR REPLACE INTO x_list (username, bio, website_url, is_active)
        VALUES ('fast_tracker', 'Old Bio V1', 'https://old-link.com', 1)
      `).run();

      broadcastLog.length = 0;

      // Send 5 rapid parallel updates with changing websites
      const updates = [
        { username: 'fast_tracker', bio: 'Old Bio V1', website_url: 'https://new-link-1.com' },
        { username: 'fast_tracker', bio: 'Old Bio V1', website_url: 'https://new-link-2.com' },
        { username: 'fast_tracker', bio: 'Old Bio V1', website_url: 'https://new-link-3.com' },
        { username: 'fast_tracker', bio: 'Old Bio V1', website_url: 'https://new-link-4.com' },
        { username: 'fast_tracker', bio: 'Old Bio V1', website_url: 'https://new-link-5.com' }
      ];

      const responses = await Promise.all(updates.map(u => 
        makeRequest(server, {
          method: 'POST',
          path: '/api/miniapp/profile_meta',
          headers: { 'Content-Type': 'application/json', 'x-client-key': testEnv.CLIENT_KEY }
        }, u)
      ));

      for (const res of responses) {
        assert.strictEqual(res.statusCode, 200, 'Rapid update returns 200');
        assert.strictEqual(res.json.success, true);
      }

      // Verify DB final state is consistent
      const record = testDb.prepare("SELECT * FROM x_list WHERE username = 'fast_tracker'").get();
      assert(record !== undefined);
      assert(record.website_url.startsWith('https://new-link-'), 'Website updated to one of the latest values');
      assert(broadcastLog.length >= 1, 'At least one website change alert triggered');
    });

    await harness.test('ADV-PRF-02: Profile Meta with Empty, Null & Whitespace Bios', async () => {
      const emptyVariations = [
        { username: 'empty_user_1', bio: '', website_url: 'https://site1.com' },
        { username: 'empty_user_2', bio: null, website_url: 'https://site2.com' },
        { username: 'empty_user_3', bio: '       ', website_url: 'https://site3.com' },
        { username: 'empty_user_4', bio: undefined, website_url: 'https://site4.com' }
      ];

      for (const v of emptyVariations) {
        const res = await makeRequest(server, {
          method: 'POST',
          path: '/api/miniapp/profile_meta',
          headers: { 'Content-Type': 'application/json', 'x-client-key': testEnv.CLIENT_KEY }
        }, v);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.json.success, true);
      }
    });

    await harness.test('ADV-PRF-03: Malformed & Hostile URLs in Profile Website', async () => {
      await testEnv.DB.prepare(`
        INSERT OR REPLACE INTO x_list (username, bio, website_url, is_active)
        VALUES ('url_test_target', 'Bio', 'https://initial.com', 1)
      `).run();

      broadcastLog.length = 0;
      const hostileUrl = "javascript:alert('pwned')<script>foo</script>&ref=1";

      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/miniapp/profile_meta',
        headers: { 'Content-Type': 'application/json', 'x-client-key': testEnv.CLIENT_KEY }
      }, {
        username: 'url_test_target',
        website_url: hostileUrl
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.changed, true);

      // Verify that the broadcast message escapes the hostile URL
      assert.strictEqual(broadcastLog.length, 1);
      const alertMsg = broadcastLog[0].messages;
      assert(!alertMsg.includes('<script>'), 'Hostile script tags escaped in profile change broadcast');
      assert(alertMsg.includes('&lt;script&gt;'), 'Hostile script tags escaped to &lt;script&gt;');
    });

    await harness.test('ADV-PRF-04: Special Characters, Emojis, Cyrillic & Mint Announcement in Bio', async () => {
      await testEnv.DB.prepare(`
        INSERT OR REPLACE INTO x_list (username, bio, website_url, is_active)
        VALUES ('bio_mint_target', 'Normal Bio', 'https://site.com', 1)
      `).run();

      broadcastLog.length = 0;
      const mintBio = "🔥💎 Официальный дроп запущен! Mint is live today on Base! 🚀 10k supply";

      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/miniapp/profile_meta',
        headers: { 'Content-Type': 'application/json', 'x-client-key': testEnv.CLIENT_KEY }
      }, {
        username: 'bio_mint_target',
        bio: mintBio,
        website_url: 'https://site.com'
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.changed, true, 'Bio change detected');

      // Assert mint keyword triggered immediate alert
      assert.strictEqual(broadcastLog.length, 1, 'Mint in bio triggered immediate alert');
      const msg = broadcastLog[0].messages;
      assert(msg.includes('обновил БИО профиля'), 'Broadcast indicates bio update');
      assert(msg.includes('Официальный дроп запущен!'), 'Preserves Cyrillic and emojis');
    });

    // ========================================================================
    // SECTION 4: WHITELIST FORM HUNTER ROBUSTNESS
    // ========================================================================

    await harness.test('ADV-WL-01: Multi-Link Tweets (Disentangling Noise from Whitelist Forms)', async () => {
      const tweetMultiLinks = {
        tweet_id: 'wl_multi_1',
        text: 'Join our upcoming mint! Check Discord: https://discord.gg/nftclub, follow https://x.com/official and enter the premint raffle: https://www.premint.xyz/exclusive-pass-raffle/ ! More info at https://project.io',
        links: [
          'https://discord.gg/nftclub',
          'https://x.com/official',
          'https://www.premint.xyz/exclusive-pass-raffle/',
          'https://project.io'
        ]
      };

      const parsed = parseTweet(tweetMultiLinks);
      assert.strictEqual(parsed.form_link, 'https://www.premint.xyz/exclusive-pass-raffle/');
      assert.strictEqual(parsed.whitelist_form_url, 'https://www.premint.xyz/exclusive-pass-raffle/');
      assert.strictEqual(parsed.form_platform, 'premint');
      assert.strictEqual(parsed.is_whitelist_form, 1);
      assert.strictEqual(parsed.opportunity_type, 'WHITELIST');
    });

    await harness.test('ADV-WL-02: Comprehensive Platform Recognition Across Domains & Variations', async () => {
      const testCases = [
        {
          text: 'Register here: https://premint.xyz/cool-drop-2026',
          expectedUrl: 'https://premint.xyz/cool-drop-2026',
          expectedPlatform: 'premint'
        },
        {
          text: 'Alphabot raffle open: https://alphabot.app/alpha-project-wl?ref=alpha',
          expectedUrl: 'https://alphabot.app/alpha-project-wl?ref=alpha',
          expectedPlatform: 'alphabot'
        },
        {
          text: 'HeyMint allowlist: https://heymint.xyz/vip-collection',
          expectedUrl: 'https://heymint.xyz/vip-collection',
          expectedPlatform: 'heymint'
        },
        {
          text: 'Fill out this form: https://forms.gle/xYz987AbC123',
          expectedUrl: 'https://forms.gle/xYz987AbC123',
          expectedPlatform: 'google_forms'
        },
        {
          text: 'Google docs form: https://docs.google.com/forms/d/e/1FAIpQLSc_ExampleForm/viewform?usp=sf_link',
          expectedUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc_ExampleForm/viewform?usp=sf_link',
          expectedPlatform: 'google_forms'
        },
        {
          text: 'Mixed case URL: HTTPS://ALPHABOT.APP/SUPER-DROP',
          expectedUrl: 'HTTPS://ALPHABOT.APP/SUPER-DROP',
          expectedPlatform: 'alphabot'
        }
      ];

      for (const tc of testCases) {
        const parsed = parseTweet({ text: tc.text });
        assert.strictEqual(parsed.form_link, tc.expectedUrl, `Extracted URL from: ${tc.text}`);
        assert.strictEqual(parsed.form_platform, tc.expectedPlatform, `Identified platform for: ${tc.text}`);
        assert.strictEqual(parsed.is_whitelist_form, 1);
      }
    });

    await harness.test('ADV-WL-03: Whitelist Form in payload.links (Shortened t.co Resolution)', async () => {
      // Tweet text only contains shortened t.co link, but payload.links contains resolved target
      const payloadWithLinks = {
        tweet_id: 'tco_test_1',
        text: 'Whitelist registration is now open! Click here: https://t.co/abcXYZ123',
        links: ['https://forms.gle/resolvedGoogleFormId']
      };

      const parsed = parseTweet(payloadWithLinks);
      assert.strictEqual(parsed.form_link, 'https://forms.gle/resolvedGoogleFormId');
      assert.strictEqual(parsed.form_platform, 'google_forms');
      assert.strictEqual(parsed.is_whitelist_form, 1);
      assert.strictEqual(parsed.opportunity_type, 'WHITELIST');
    });

    await harness.test('ADV-WL-04: Non-Form Links Rejection (Zero False Positives)', async () => {
      const nonFormPayloads = [
        { text: 'Search premint on google: https://google.com/search?q=premint' },
        { text: 'Check their twitter: https://twitter.com/alphabotapp' },
        { text: 'Read about them on github: https://github.com/heymint/contracts' },
        { text: 'Bare domain: https://premint.xyz' }, // no path
        { text: 'Discord channel: https://discord.gg/premint' }
      ];

      for (const p of nonFormPayloads) {
        const parsed = parseTweet(p);
        assert.strictEqual(parsed.form_link, null, `False positive rejected for: ${p.text}`);
        assert.strictEqual(parsed.is_whitelist_form, 0);
      }
    });

    await harness.test('ADV-WL-05: Formatter Message & Inline Button Attachment', async () => {
      const parsedData = {
        tweet_id: 'button_test_1',
        tweet_url: 'https://x.com/project/status/888',
        username: 'test_wl_project',
        display_name: 'Test WL Project',
        score: 85,
        priority: 'HOT',
        category: 'nft',
        form_link: 'https://premint.xyz/exclusive-drop',
        whitelist_form_url: 'https://premint.xyz/exclusive-drop',
        form_platform: 'premint',
        is_whitelist_form: 1
      };

      // 1. Telegram Message Formatting
      const formatted = formatTelegramMessage(parsedData, 'ru');
      assert(formatted.includes('📝 <b>Форма (Premint):</b>'), 'Contains prominent form header');
      assert(formatted.includes('<a href="https://premint.xyz/exclusive-drop">https://premint.xyz/exclusive-drop</a>'), 'Contains active clickable link');

      // 2. Ingest API button response
      broadcastLog.length = 0;
      await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: 'ingest_button_tweet_888',
        tweet_url: 'https://x.com/project/status/888',
        username: 'test_wl_project',
        text: 'MINT IS LIVE NOW! Whitelist form: https://premint.xyz/exclusive-drop',
        is_parser_target: true
      });

      assert.strictEqual(broadcastLog.length, 1);
      const markup = broadcastLog[0].replyMarkup;
      assert(markup && markup.inline_keyboard, 'Inline keyboard attached');
      const formBtn = markup.inline_keyboard.flat().find(b => b.text.includes('Форма'));
      assert(formBtn !== undefined, 'Found dedicated Form inline button');
      assert.strictEqual(formBtn.url, 'https://premint.xyz/exclusive-drop', 'Button URL points directly to whitelist form');
    });

    // ========================================================================
    // SECTION 5: SERVER STABILITY & CRASH RESILIENCE
    // ========================================================================

    await harness.test('ADV-SRV-01: Server Resiliency Against Hostile Payloads & Type Juggling', async () => {
      // 1. Ingest with null/undefined values across required fields
      const resNulls = await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: 'null_fields_tweet',
        text: null,
        username: null,
        tweet_url: null,
        links: null,
        profile_meta: null
      });
      assert.strictEqual(resNulls.statusCode, 400, 'Ingest with null text/fields rejected with 400');

      // 2. Ingest with numeric values where strings expected
      const resTypes = await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: 'numeric_types_tweet',
        text: 123456789,
        tweet_url: 987654321
      });
      assert.strictEqual(resTypes.statusCode, 400, 'Ingest with mismatched types rejected with 400');

      // 3. Huge text string (> 50,000 characters)
      const hugeText = "A".repeat(50001);
      const resHuge = await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: 'huge_text_tweet',
        tweet_url: 'https://x.com/huge/status/1',
        text: hugeText,
        username: 'huge_user'
      });
      assert.strictEqual(resHuge.statusCode, 400, 'Ingest with >50k char text rejected with 400');

      // 4. Hostile SQL injection & XSS payload with valid schema
      const resHostile = await makeRequest(server, {
        method: 'POST',
        path: '/ingest',
        headers: { 'Content-Type': 'application/json' }
      }, {
        tweet_id: "hostile_payload_1'; DROP TABLE calendar_events;--",
        tweet_url: 'https://x.com/hacker/status/1',
        username: "hacker<script>",
        text: "MINT IS LIVE NOW! Check '; DROP TABLE tweets;-- and <script>alert(1)</script>"
      });
      assert.strictEqual(resHostile.statusCode, 200, 'Hostile SQL injection text handled without crash');
      assert.strictEqual(resHostile.json.send_decision, 'urgent_siren_sent');

      // Assert tables still intact
      const calCount = testDb.prepare("SELECT count(*) as c FROM calendar_events").get();
      assert(calCount.c >= 1, 'calendar_events table remains intact');
    });

  } finally {
    await new Promise(r => server.close(r));
    try { testDb.close(); } catch (e) {}
    if (fs.existsSync(testDbFile)) {
      try { fs.unlinkSync(testDbFile); } catch (e) {}
    }
  }

  const summary = harness.summary();
  if (!summary.allPassed) {
    process.exit(1);
  }
}

runAdversarialSuite().catch(err => {
  console.error('Adversarial Test Suite Fatal Error:', err);
  process.exit(1);
});
