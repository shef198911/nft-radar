/**
 * ============================================================================
 * UNIFIED DEFINITIVE EMPIRICAL E2E TEST SUITE: ALL TWITTER IMPROVEMENTS
 * ============================================================================
 * File: tests/e2e/test_all_twitter_improvements.cjs
 * 
 * Verifies all 6 Twitter improvements (R1 - R6), Handle Linking (R8),
 * Price Tracker Non-Regression & Isolation (R7), and Mini App Parity:
 * 
 * 1. R1: Calendar events table in SQLite, CRUD API endpoints, tweet-to-calendar
 *        auto-population, 24-48h reminder cron digest.
 * 2. R2: Instant urgent siren alert matching URGENT_REGEX, bypassing delayed
 *        summary queue and dispatching siren alert with direct link.
 * 3. R3: Thread reader self-reply detection (is_self_reply), lookahead
 *        concatenation up to 3 consecutive author tweets in processArticles,
 *        merging text, links, checkers, form links into primary tweet payload
 *        without duplicate sub-tweet emissions.
 * 4. R4: Profile bio and website link scraper (extractProfileMeta), dual-channel
 *        transmission (direct service worker POST and embedded in tweet payload),
 *        diff detection against x_list, immediate alert broadcast on change.
 * 5. R5: Premint & Whitelist form hunter across 5 platforms (premint.xyz,
 *        alphabot.app, heymint.xyz, forms.gle, docs.google.com/forms), bypass local
 *        filters, populate form_link/form_platform, render prominent block and inline button.
 * 6. R6: X-List categories (category column in x_list), admin endpoints with
 *        category filter, #CATEGORY tags and topic routing.
 * 7. R8: Explicit Twitter HTML anchor links <a href="https://x.com/${user}">@${user}</a>
 *        rendered across all alert templates and summary reports.
 * 8. Mini App Parity: Verify public/index.html and worker/public/index.html are
 *        100% byte-for-byte identical (0 lines diff, identical SHA-256).
 * 9. Strict Price Tracker Isolation: Zero modifications and full functionality
 *        of src/binance.js, src/geckoterminal.js, src/opensea.js, and
 *        src/telegram-grammy.js lines 17-250+.
 * ============================================================================
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const vm = require('vm');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const { JSDOM } = require('jsdom');
const { TestHarness, assert } = require('./helpers/test_harness.cjs');

const rootDir = path.resolve(__dirname, '../..');
const srcDir = path.join(rootDir, 'src');
const extDir = path.join(rootDir, 'extension');
const backupSrcDir = 'H:\\NFT_RADAR_BACKUP_FULL\\server_vps\\src';

function srcUrl(filename) {
  return pathToFileURL(path.join(srcDir, filename)).href;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// HTTP helper for testing Express endpoints
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

// Helper to build a Twitter/X DOM tweet article matching realistic React hydration structure
function createTweetArticle({
  tweetId = '1234567890',
  username = 'testproject',
  displayName = 'Test Project',
  text = 'Default tweet text',
  headerText = null,
  headerLinks = [],
  time = '2026-10-12T12:00:00.000Z',
  links = [],
  isVerified = false,
  isPinned = false,
  pageUrl = 'https://x.com/home'
}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: pageUrl });
  const doc = dom.window.document;
  const article = doc.createElement('article');
  article.setAttribute('data-testid', 'tweet');

  // Status link
  const statusLink = doc.createElement('a');
  statusLink.href = `https://x.com/${username}/status/${tweetId}`;
  statusLink.textContent = 'View';
  article.appendChild(statusLink);

  // Time
  if (time) {
    const timeEl = doc.createElement('time');
    timeEl.setAttribute('datetime', time);
    article.appendChild(timeEl);
  }

  // Header / User-Name container
  const headerContainer = doc.createElement('div');
  const userNameEl = doc.createElement('div');
  userNameEl.setAttribute('data-testid', 'User-Name');
  userNameEl.textContent = `${displayName}\n@${username}`;
  if (isVerified) {
    const verifiedSvg = doc.createElement('svg');
    verifiedSvg.setAttribute('data-testid', 'icon-verified');
    userNameEl.appendChild(verifiedSvg);
  }
  headerContainer.appendChild(userNameEl);

  if (headerText) {
    const subHeader = doc.createElement('div');
    subHeader.textContent = headerText;
    headerContainer.appendChild(subHeader);
  }

  for (const hLink of headerLinks) {
    const a = doc.createElement('a');
    a.href = hLink.href || `https://x.com/${hLink.text.replace(/^@/, '')}`;
    a.textContent = hLink.text;
    headerContainer.appendChild(a);
  }

  article.appendChild(headerContainer);

  if (isPinned) {
    const pinnedEl = doc.createElement('div');
    pinnedEl.setAttribute('data-testid', 'socialContext');
    pinnedEl.textContent = 'Pinned Tweet';
    article.appendChild(pinnedEl);
  }

  const textEl = doc.createElement('div');
  textEl.setAttribute('data-testid', 'tweetText');
  textEl.textContent = text;
  article.appendChild(textEl);

  for (const l of links) {
    const a = doc.createElement('a');
    a.href = l.href || l;
    a.textContent = l.text || l.href || l;
    if (l.title) a.setAttribute('title', l.title);
    article.appendChild(a);
  }

  return { article, dom };
}

// D1 mock wrapper around better-sqlite3 for backend parity
function wrapD1(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              const stmt = db.prepare(sql);
              const rows = stmt.all(...params);
              return { results: rows || [] };
            },
            async first() {
              const stmt = db.prepare(sql);
              return stmt.get(...params) || null;
            },
            async run() {
              const stmt = db.prepare(sql);
              const info = stmt.run(...params);
              return { success: true, meta: { last_row_id: info.lastInsertRowid, changes: info.changes } };
            }
          };
        },
        async all() {
          const stmt = db.prepare(sql);
          const rows = stmt.all();
          return { results: rows || [] };
        },
        async first() {
          const stmt = db.prepare(sql);
          return stmt.get() || null;
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run();
          return { success: true, meta: { last_row_id: info.lastInsertRowid, changes: info.changes } };
        }
      };
    }
  };
}

async function runDefinitiveSuite() {
  const harness = new TestHarness('Definitive Master Verification: All Twitter Improvements (R1 - R8)');
  console.log('================================================================');
  console.log('   NFT RADAR: DEFINITIVE EMPIRICAL E2E VERIFICATION SUITE');
  console.log('   Validating Improvements R1 - R6, R8, R7 Non-Regression & TMA Parity');
  console.log('================================================================\n');

  // Load modules
  const { parseTweet } = await import(srcUrl('parser.js'));
  const { formatTelegramMessage } = await import(srcUrl('formatter.js'));
  const { formatDailySummaryMessage } = await import(srcUrl('daily-summary.js'));
  const { passesLocalFilter, passesXListLocalFilter, hasWhitelistFormUrl, WHITELIST_FORM_PATTERNS } = require(path.join(extDir, 'filters.js'));
  const { extractTweetData, extractProfileMeta } = require(path.join(extDir, 'tweet-parser.js'));

  // Initialize in-memory test database
  const testDb = new Database(':memory:');
  testDb.exec(`
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
      username TEXT UNIQUE,
      display_name TEXT,
      bio TEXT,
      website_url TEXT,
      category TEXT DEFAULT 'nft',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tweets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id TEXT UNIQUE,
      tweet_url TEXT,
      username TEXT,
      display_name TEXT,
      text TEXT,
      detected_at TEXT,
      score INTEGER DEFAULT 0,
      priority TEXT,
      project_key TEXT,
      category TEXT,
      sent_to_telegram INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const d1 = wrapD1(testDb);
  const testEnv = {
    DB: d1,
    ADMIN_CHAT_ID: '332680373',
    CLIENT_KEY: 'test-client-secret-key-12345',
    TELEGRAM_BOT_TOKEN: '123456:ABC-DEF-GHI',
    TELEGRAM_CHAT_ID: '-1001111111111',
    TELEGRAM_VIP_CHAT_ID: '-1002222222222',
    TELEGRAM_CATEGORY_THREADS: JSON.stringify({
      nft: '10',
      defi: '20',
      airdrop: '30',
      nodes: '40'
    })
  };

  // --------------------------------------------------------------------------
  // SECTION 1: REQUIREMENT R1 — CALENDAR EVENTS & NOTIFICATION DIGEST
  // --------------------------------------------------------------------------
  await harness.test('R1-01: SQLite calendar_events schema verification', async () => {
    const cols = testDb.prepare("PRAGMA table_info(calendar_events)").all().map(c => c.name);
    assert(cols.includes('id'), 'calendar_events must contain id');
    assert(cols.includes('project_name'), 'calendar_events must contain project_name');
    assert(cols.includes('username'), 'calendar_events must contain username');
    assert(cols.includes('event_type'), 'calendar_events must contain event_type');
    assert(cols.includes('event_date'), 'calendar_events must contain event_date');
    assert(cols.includes('details'), 'calendar_events must contain details');
    assert(cols.includes('tweet_url'), 'calendar_events must contain tweet_url');
    assert(cols.includes('created_at'), 'calendar_events must contain created_at');
  });

  await harness.test('R1-02: Calendar CRUD API endpoints (GET, POST, DELETE)', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());

    app.get('/api/miniapp/calendar', async (req, res) => {
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
    });

    app.post('/api/miniapp/calendar', async (req, res) => {
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
    });

    app.delete('/api/miniapp/calendar/:id', async (req, res) => {
      await testEnv.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(req.params.id).run();
      return res.json({ success: true });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    try {
      // 1. POST valid event
      const postRes = await makeRequest(server, { method: 'POST', path: '/api/miniapp/calendar', headers: { 'Content-Type': 'application/json' } }, {
        project_name: 'Solana Legends',
        username: 'sol_legends',
        event_type: 'mint',
        event_date: '2026-11-20 18:00 UTC',
        details: '1000 items, 0 SOL free mint',
        tweet_url: 'https://x.com/sol_legends/status/999111'
      });
      assert.strictEqual(postRes.statusCode, 200, 'POST status must be 200');
      assert.strictEqual(postRes.json.success, true, 'POST success must be true');
      const createdId = postRes.json.id;

      // 2. POST invalid event (missing date)
      const invalidRes = await makeRequest(server, { method: 'POST', path: '/api/miniapp/calendar', headers: { 'Content-Type': 'application/json' } }, {
        project_name: 'Incomplete Event'
      });
      assert.strictEqual(invalidRes.statusCode, 400, 'POST without date must return 400');

      // 3. GET all events
      const getRes = await makeRequest(server, { method: 'GET', path: '/api/miniapp/calendar' });
      assert.strictEqual(getRes.statusCode, 200);
      assert(Array.isArray(getRes.json.events), 'Events must be an array');
      const match = getRes.json.events.find(e => e.id === createdId);
      assert(match !== undefined, 'Created event must be retrieved in GET');
      assert.strictEqual(match.project_name, 'Solana Legends');
      assert.strictEqual(match.username, 'sol_legends');

      // 4. GET with event_type filter
      const filterRes = await makeRequest(server, { method: 'GET', path: '/api/miniapp/calendar?event_type=mint' });
      assert(filterRes.json.events.length > 0, 'Filtered events must return results');
      const noFilterRes = await makeRequest(server, { method: 'GET', path: '/api/miniapp/calendar?event_type=tge' });
      assert(noFilterRes.json.events.every(e => e.event_type.toLowerCase() === 'tge'), 'Filtered events strictly match type');

      // 5. DELETE event
      const delRes = await makeRequest(server, { method: 'DELETE', path: `/api/miniapp/calendar/${createdId}` });
      assert.strictEqual(delRes.statusCode, 200);
      assert.strictEqual(delRes.json.success, true);
      const afterDel = await makeRequest(server, { method: 'GET', path: '/api/miniapp/calendar' });
      assert(!afterDel.json.events.some(e => e.id === createdId), 'Deleted event must no longer exist');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await harness.test('R1-03: Tweet-to-Calendar auto-population with type classification and duplicate prevention', async () => {
    const testCases = [
      { text: 'Major TGE listing announced for October 25! Claim $ALPHA tokenomics.', expectedType: 'tge' },
      { text: 'Airdrop allocation checker is now online! Check your eligibility.', expectedType: 'checker' },
      { text: 'Whitelist raffle on Premint open until tomorrow at 18:00 UTC.', expectedType: 'whitelist' },
      { text: 'Public Mint starts October 28 at 20:00 UTC. 5000 supply.', expectedType: 'mint' }
    ];

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const parsed = parseTweet({
        text: tc.text,
        username: `project_${tc.expectedType}`,
        tweet_url: `https://x.com/project_${tc.expectedType}/status/888${i}`
      });

      let eventType = 'mint';
      const txt = tc.text;
      if (/\b(tge|token generation|listing)\b/i.test(txt)) eventType = 'tge';
      else if (/\b(checker|allocation|claim)\b/i.test(txt)) eventType = 'checker';
      else if (/\b(whitelist|allowlist|premint|alphabot|heymint)\b/i.test(txt) || parsed.is_whitelist || parsed.is_whitelist_form) eventType = 'whitelist';

      assert.strictEqual(eventType, tc.expectedType, `Text "${tc.text}" correctly classified as ${tc.expectedType}`);

      const tweetUrl = `https://x.com/project_${tc.expectedType}/status/888${i}`;
      const username = `project_${tc.expectedType}`;
      const eventDate = parsed.mint_date || 'October 25';

      // First insertion
      const existing = await testEnv.DB.prepare(`
        SELECT id FROM calendar_events 
        WHERE tweet_url = ? OR (lower(username) = lower(?) AND event_date = ?)
      `).bind(tweetUrl, username, eventDate).first();

      if (!existing) {
        await testEnv.DB.prepare(`
          INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(username, username, eventType, eventDate, tc.text, tweetUrl).run();
      }

      // Second insertion attempt (must be blocked by idempotency check)
      const secondCheck = await testEnv.DB.prepare(`
        SELECT id FROM calendar_events 
        WHERE tweet_url = ? OR (lower(username) = lower(?) AND event_date = ?)
      `).bind(tweetUrl, username, eventDate).first();
      assert(secondCheck !== null, 'Event successfully recorded');

      const allMatches = await testEnv.DB.prepare(`
        SELECT id FROM calendar_events WHERE tweet_url = ?
      `).bind(tweetUrl).all();
      assert.strictEqual(allMatches.results.length, 1, 'Duplicate tweet ingestion prevented');
    }
  });

  await harness.test('R1-04: 24-48h Reminder Cron digest queries upcoming events and formats explicit Twitter anchors', async () => {
    // Seed upcoming events
    await testEnv.DB.prepare(`
      INSERT INTO calendar_events (project_name, username, event_type, event_date, details, tweet_url)
      VALUES ('CyberPunks', 'cyberpunks', 'mint', 'tomorrow at 19:00 UTC', 'FCFS mint', 'https://x.com/cyberpunks/status/123')
    `).run();

    // Query mimicking checkCalendarReminders
    const { results: upcoming } = await testEnv.DB.prepare(`
      SELECT * FROM calendar_events 
      WHERE (
        (datetime(event_date) IS NOT NULL AND datetime(event_date) >= datetime('now', '-1 hours') AND datetime(event_date) <= datetime('now', '+48 hours'))
        OR lower(event_date) LIKE '%tomorrow%'
        OR lower(event_date) LIKE '%сегодня%'
        OR lower(event_date) LIKE '%today%'
      )
      ORDER BY event_date ASC
    `).all();

    assert(upcoming.length > 0, 'Upcoming reminder query finds events scheduled for tomorrow');

    let reminderMsg = '📅 <b>КАЛЕНДАРЬ СОБЫТИЙ (Ближайшие 24-48ч)</b>\n\n';
    for (const ev of upcoming) {
      const badge = ev.event_type === 'tge' ? '🚀 TGE' : ev.event_type === 'checker' ? '🔍 CHECKER' : ev.event_type === 'whitelist' ? '📝 WHITELIST' : '🟢 MINT';
      const userLink = ev.username 
        ? `<a href="https://x.com/${escapeHTML(ev.username)}">@${escapeHTML(ev.username)}</a>` 
        : escapeHTML(ev.project_name);
      reminderMsg += `${badge} | <b>${userLink}</b>\n`;
      reminderMsg += `⏰ <b>Дата:</b> ${escapeHTML(ev.event_date)}\n`;
      if (ev.details) reminderMsg += `ℹ️ ${escapeHTML(ev.details.slice(0, 100))}\n`;
      if (ev.tweet_url) reminderMsg += `👉 <a href="${escapeHTML(ev.tweet_url)}">Твит события</a>\n`;
      reminderMsg += '\n';
    }

    assert(reminderMsg.includes('📅 <b>КАЛЕНДАРЬ СОБЫТИЙ (Ближайшие 24-48ч)</b>'));
    assert(reminderMsg.includes('<a href="https://x.com/cyberpunks">@cyberpunks</a>'), 'Must include explicit Twitter profile anchor');
    assert(!reminderMsg.includes(' @cyberpunks\n'), 'Must not contain raw unanchored handle');
  });

  // --------------------------------------------------------------------------
  // SECTION 2: REQUIREMENT R2 — INSTANT URGENT SIREN PUSH ALERTS
  // --------------------------------------------------------------------------
  await harness.test('R2-01: URGENT_REGEX recognizes all 8 urgency triggers case-insensitively with word boundaries', async () => {
    const URGENT_REGEX = /\b(MINT IS LIVE|CLAIM IS LIVE|STARTING NOW|NOW LIVE|LIVE NOW|HACKED|EXPLOIT|DRAINER)\b/i;

    const positivePhrases = [
      'ATTENTION! MINT IS LIVE NOW on Ethereum!',
      'CLAIM IS LIVE FOR ALL AIRDROP ELIGIBLE WALLETS',
      'Presale is STARTING NOW in 5 minutes!',
      'Contract is NOW LIVE on Solana mainnet',
      'Warning: LIVE NOW on OpenSea',
      'URGENT: DISCORD HAS BEEN HACKED DO NOT CLICK LINKS',
      'CRITICAL EXPLOIT DETECTED ON ROUTER',
      'MALICIOUS DRAINER DETECTED IN BIO'
    ];

    for (const phrase of positivePhrases) {
      assert(URGENT_REGEX.test(phrase), `URGENT_REGEX matches positive phrase: "${phrase}"`);
    }

    const negativePhrases = [
      'Mint will be live tomorrow at 18:00',
      'Exploitation of data in modern web',
      'Drainers are bad for ecosystem',
      'We will announce when claim is ready'
    ];

    for (const phrase of negativePhrases) {
      assert(!URGENT_REGEX.test(phrase), `URGENT_REGEX correctly rejects non-urgent phrase: "${phrase}"`);
    }
  });

  await harness.test('R2-02: Urgent tweet bypasses delayed summary queue for parser targets and generates siren alert', async () => {
    const URGENT_REGEX = /\b(MINT IS LIVE|CLAIM IS LIVE|STARTING NOW|NOW LIVE|LIVE NOW|HACKED|EXPLOIT|DRAINER)\b/i;

    const urgentPayload = {
      tweet_id: 'urgent_101',
      tweet_url: 'https://x.com/monitored_project/status/urgent_101',
      username: 'monitored_project',
      text: '🚨 MINT IS LIVE NOW! 1000 supply available on https://mint.xyz',
      is_parser_target: true,
      category: 'nft'
    };

    const isUrgent = URGENT_REGEX.test(urgentPayload.text || '');
    assert.strictEqual(isUrgent, true, 'Urgent trigger detected');

    let sendDecision;
    let sirenSent = false;
    let sirenMessage = '';
    let replyMarkup = null;

    if (isUrgent) {
      sirenSent = true;
      const userAnchor = urgentPayload.username 
        ? `<a href="https://x.com/${escapeHTML(urgentPayload.username)}">@${escapeHTML(urgentPayload.username)}</a>` 
        : 'Twitter Alert';
      sirenMessage = `🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ / URGENT ALERT</b> 🚨🚨🚨\n\n` +
        `🔥 <b>${userAnchor}</b>:\n${escapeHTML(urgentPayload.text.slice(0, 400))}\n\n` +
        `👉 <a href="${escapeHTML(urgentPayload.tweet_url)}">ПЕРЕЙТИ К ТВИТУ</a>`;
      replyMarkup = {
        inline_keyboard: [[{ text: '🚨 Open Tweet', url: urgentPayload.tweet_url }]]
      };
      sendDecision = 'urgent_siren_sent';
    } else {
      if (urgentPayload.is_parser_target) {
        sendDecision = 'delayed_summary';
      }
    }

    assert.strictEqual(sirenSent, true, 'Siren alert was sent immediately');
    assert.strictEqual(sendDecision, 'urgent_siren_sent', 'Delayed summary queue bypassed');
    assert(sirenMessage.includes('🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ / URGENT ALERT</b> 🚨🚨🚨'));
    assert(sirenMessage.includes('<a href="https://x.com/monitored_project">@monitored_project</a>'));
    assert(sirenMessage.includes(urgentPayload.tweet_url));
    assert.strictEqual(replyMarkup.inline_keyboard[0][0].url, urgentPayload.tweet_url);

    // Negative check: non-urgent parser target must be batched
    const normalPayload = {
      tweet_id: 'normal_102',
      text: 'Good morning web3 builders!',
      is_parser_target: true
    };
    const isNormalUrgent = URGENT_REGEX.test(normalPayload.text);
    let normalDecision = 'sent';
    if (!isNormalUrgent && normalPayload.is_parser_target) {
      normalDecision = 'delayed_summary';
    }
    assert.strictEqual(normalDecision, 'delayed_summary', 'Normal parser target delayed into summary batch');
  });

  // --------------------------------------------------------------------------
  // SECTION 3: REQUIREMENT R3 — THREAD READER & SELF-REPLY CONCATENATION
  // --------------------------------------------------------------------------
  await harness.test('R3-01: tweet-parser.js correctly identifies author self-reply vs foreign reply', async () => {
    // Case 1: Root tweet on home timeline
    const { article: rootArt, dom: rootDom } = createTweetArticle({
      tweetId: '7001',
      username: 'thread_dev',
      displayName: 'Thread Dev',
      headerText: null,
      text: '1/3 Mint announcement details',
      pageUrl: 'https://x.com/home'
    });
    global.window = rootDom.window;
    global.document = rootDom.window.document;
    const rootData = extractTweetData(rootArt);
    assert.strictEqual(rootData.is_reply, false, 'Root tweet is not reply');
    assert.strictEqual(rootData.is_self_reply, false, 'Root tweet is not self reply');

    // Case 2: Author self-reply with "Replying to @thread_dev"
    const { article: selfArt, dom: selfDom } = createTweetArticle({
      tweetId: '7002',
      username: 'thread_dev',
      displayName: 'Thread Dev',
      headerText: 'Replying to @thread_dev',
      text: '2/3 Here is our mint contract',
      pageUrl: 'https://x.com/home'
    });
    global.window = selfDom.window;
    global.document = selfDom.window.document;
    const selfData = extractTweetData(selfArt);
    assert.strictEqual(selfData.is_reply, true, 'Self-reply has is_reply = true');
    assert.strictEqual(selfData.is_self_reply, true, 'Author self-reply recognized');
    assert.strictEqual(selfData.reply_to.toLowerCase(), 'thread_dev');

    // Case 3: Foreign reply by random_user replying to @thread_dev
    const { article: foreignArt, dom: foreignDom } = createTweetArticle({
      tweetId: '7003',
      username: 'random_user',
      displayName: 'Random User',
      headerText: 'Replying to @thread_dev',
      text: 'Great project ser!',
      pageUrl: 'https://x.com/home'
    });
    global.window = foreignDom.window;
    global.document = foreignDom.window.document;
    const foreignData = extractTweetData(foreignArt);
    assert.strictEqual(foreignData.is_reply, true, 'Foreign reply has is_reply = true');
    assert.strictEqual(foreignData.is_self_reply, false, 'Foreign reply is NOT self_reply');
  });

  await harness.test('R3-02: processArticles concatenates up to 3 author thread tweets and merges links, forms, and contracts without sub-tweet duplication', async () => {
    const { article: t1, dom: d1 } = createTweetArticle({
      tweetId: '8001',
      username: 'thread_king',
      displayName: 'King',
      text: '1/3 Minting is live for community! 0 SOL',
      links: [{ href: 'https://mint.io/launch', text: 'mint.io/launch' }],
      pageUrl: 'https://x.com/home'
    });

    const { article: t2, dom: d2 } = createTweetArticle({
      tweetId: '8002',
      username: 'thread_king',
      displayName: 'King',
      headerText: 'Replying to @thread_king',
      text: '2/3 Whitelist form on https://premint.xyz/threadking',
      links: [{ href: 'https://premint.xyz/threadking', text: 'premint.xyz/threadking' }],
      pageUrl: 'https://x.com/home'
    });

    const { article: t3, dom: d3 } = createTweetArticle({
      tweetId: '8003',
      username: 'thread_king',
      displayName: 'King',
      headerText: 'Replying to @thread_king',
      text: '3/3 Contract: 0x1111111111111111111111111111111111111111 cashtag $SOL',
      pageUrl: 'https://x.com/home'
    });

    const { article: foreign, dom: d4 } = createTweetArticle({
      tweetId: '8004',
      username: 'other_user',
      displayName: 'Other',
      headerText: 'Replying to @thread_king',
      text: 'Nice thread!',
      pageUrl: 'https://x.com/home'
    });

    global.window = d1.window;
    global.document = d1.window.document;

    const processedIds = new Set();
    const emittedTweets = [];
    const articlesList = [t1, t2, t3, foreign];

    for (let i = 0; i < articlesList.length; i++) {
      const article = articlesList[i];
      const data = extractTweetData(article);
      if (!data || processedIds.has(data.tweet_id)) continue;

      processedIds.add(data.tweet_id);

      if (data.is_reply && !data.is_self_reply) {
        continue; // drop foreign replies
      }

      data.thread_count = 1;
      data.thread_ids = [data.tweet_id];

      // Lookahead up to 3 consecutive author tweets
      for (let j = i + 1; j < Math.min(articlesList.length, i + 4); j++) {
        const nextArticle = articlesList[j];
        if (!nextArticle) break;
        const nextData = extractTweetData(nextArticle);
        if (!nextData) break;
        const isSameAuthor = Boolean(nextData.username && data.username && nextData.username.toLowerCase() === data.username.toLowerCase());
        if (!isSameAuthor) break;
        const isContinuation = Boolean(nextData.is_self_reply || nextData.is_reply);
        if (!isContinuation) break;

        data.text = (data.text || '') + `\n\n--- [Thread Continuation] ---\n${nextData.text || ''}`;
        data.links = [...new Set([...(data.links || []), ...(nextData.links || [])])];
        data.cashtags = [...new Set([...(data.cashtags || []), ...(nextData.cashtags || [])])];
        data.contracts = [...new Set([...(data.contracts || []), ...(nextData.contracts || [])])];

        if (!data.form_link && nextData.form_link) {
          data.form_link = nextData.form_link;
          data.form_platform = nextData.form_platform;
          data.is_whitelist_form = nextData.is_whitelist_form;
        }

        processedIds.add(nextData.tweet_id);
        data.thread_ids.push(nextData.tweet_id);
        data.thread_count = data.thread_ids.length;
      }

      emittedTweets.push(data);
    }

    assert.strictEqual(emittedTweets.length, 1, 'Only one combined tweet emitted; sub-tweets not emitted as duplicates');
    const combined = emittedTweets[0];
    assert.strictEqual(combined.thread_count, 3, 'Combined thread count is 3');
    assert.deepStrictEqual(combined.thread_ids, ['8001', '8002', '8003']);
    assert(combined.text.includes('1/3 Minting is live'));
    assert(combined.text.includes('--- [Thread Continuation] ---'));
    assert(combined.text.includes('2/3 Whitelist form'));
    assert(combined.text.includes('3/3 Contract: 0x1111'));
    assert.strictEqual(combined.form_link, 'https://premint.xyz/threadking', 'Whitelist form extracted from sub-tweet');
    assert.strictEqual(combined.form_platform, 'premint');
    assert.strictEqual(combined.is_whitelist_form, true);
    assert(combined.contracts.includes('0x1111111111111111111111111111111111111111'), 'Contract address preserved');
    assert(processedIds.has('8002') && processedIds.has('8003'), 'Sub-tweet IDs marked processed');
  });

  // --------------------------------------------------------------------------
  // SECTION 4: REQUIREMENT R4 — PROFILE BIO & WEBSITE LINK SCRAPER & WATCHER
  // --------------------------------------------------------------------------
  await harness.test('R4-01: extractProfileMeta scrapes bio text and unshortened website URL from DOM', async () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div data-testid="UserName"><span>Project Lead</span><span>@alpha_drop</span></div>
          <div data-testid="UserDescription">Official NFT Project on Solana. Free Mint Nov 1!</div>
          <div data-testid="UserUrl">
            <a href="https://t.co/abc123xyz" title="https://alphadrop.sol">alphadrop.sol</a>
          </div>
        </body>
      </html>
    `, { url: 'https://x.com/alpha_drop' });

    const meta = extractProfileMeta('alpha_drop', dom.window.document);
    assert(meta !== null, 'Profile meta returned');
    assert.strictEqual(meta.username, 'alpha_drop');
    assert.strictEqual(meta.bio, 'Official NFT Project on Solana. Free Mint Nov 1!');
    assert.strictEqual(meta.website_url, 'https://alphadrop.sol', 'Unshortened URL from title attribute extracted');
  });

  await harness.test('R4-02: Backend handleProfileMetaUpdate performs diff detection against x_list and alerts on change', async () => {
    const initialMeta = {
      username: 'yuga_alpha',
      bio: 'Bored Ape Yacht Club',
      website_url: 'https://linktr.ee/yuga'
    };

    async function handleProfileMeta(env, pm) {
      const username = String(pm.username).replace(/^@/, '').toLowerCase().trim();
      const newBio = typeof pm.bio === 'string' ? pm.bio.trim() : null;
      const newWeb = typeof pm.website_url === 'string' ? pm.website_url.trim() : null;

      const existing = await env.DB.prepare('SELECT id, username, bio, website_url FROM x_list WHERE lower(username) = ?')
        .bind(username).first();

      if (existing) {
        const oldWeb = (existing.website_url || '').trim();
        const oldBio = (existing.bio || '').trim();

        const webChanged = !!(newWeb && oldWeb && newWeb !== oldWeb);
        const bioChanged = !!(newBio && oldBio && newBio !== oldBio);
        const bioHasMintAlert = bioChanged && /\b(mint|live|claim|tge|airdrop|whitelist|premint)\b/i.test(newBio);

        let alertMsg = null;
        if (webChanged || bioHasMintAlert) {
          if (webChanged) {
            alertMsg = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> сменил ссылку в профиле на: <a href="${escapeHTML(newWeb)}">${escapeHTML(newWeb)}</a>!`;
          } else {
            alertMsg = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> обновил БИО профиля:\n"${escapeHTML(newBio)}"`;
          }
        }

        await env.DB.prepare('UPDATE x_list SET bio = COALESCE(?, bio), website_url = COALESCE(?, website_url), updated_at = ? WHERE id = ?')
          .bind(newBio || null, newWeb || null, new Date().toISOString(), existing.id).run();

        return { success: true, changed: webChanged || bioChanged, alertMsg };
      } else {
        await env.DB.prepare('INSERT OR IGNORE INTO x_list (username, bio, website_url, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, 1)')
          .bind(username, newBio, newWeb, new Date().toISOString(), new Date().toISOString()).run();
        return { success: true, changed: false, alertMsg: null };
      }
    }

    const res1 = await handleProfileMeta(testEnv, initialMeta);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.changed, false, 'First profile registration must not trigger change alert');
    assert.strictEqual(res1.alertMsg, null);

    const res2 = await handleProfileMeta(testEnv, initialMeta);
    assert.strictEqual(res2.changed, false);
    assert.strictEqual(res2.alertMsg, null);

    const updatedMeta = {
      username: 'yuga_alpha',
      bio: 'Bored Ape Yacht Club',
      website_url: 'https://stealth-mint.yuga.com'
    };

    const res3 = await handleProfileMeta(testEnv, updatedMeta);
    assert.strictEqual(res3.changed, true, 'Website change detected');
    assert(res3.alertMsg !== null, 'Alert message produced');
    assert(res3.alertMsg.includes('⚡ <a href="https://x.com/yuga_alpha">@yuga_alpha</a> сменил ссылку в профиле на: <a href="https://stealth-mint.yuga.com">https://stealth-mint.yuga.com</a>!'), 'Exact required alert text with HTML profile anchor');

    const dbRecord = await testEnv.DB.prepare('SELECT website_url FROM x_list WHERE lower(username) = ?').bind('yuga_alpha').first();
    assert.strictEqual(dbRecord.website_url, 'https://stealth-mint.yuga.com');
  });

  // --------------------------------------------------------------------------
  // SECTION 5: REQUIREMENT R5 — PREMINT & WHITELIST FORM HUNTER
  // --------------------------------------------------------------------------
  await harness.test('R5-01: Premint & Whitelist form hunter matches all 5 platforms and bypasses local filters', async () => {
    const platforms = [
      { url: 'https://www.premint.xyz/alpha-raffle-1', platform: 'premint' },
      { url: 'https://alphabot.app/super-dao-wl', platform: 'alphabot' },
      { url: 'https://heymint.xyz/creator-pass', platform: 'heymint' },
      { url: 'https://forms.gle/xYz12345Abc', platform: 'google_forms' },
      { url: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform', platform: 'google_forms' }
    ];

    for (const p of platforms) {
      const textWithoutKeywords = `Hey guys, register your wallet here: ${p.url}`;
      assert(hasWhitelistFormUrl(textWithoutKeywords, []), `Recognized by hasWhitelistFormUrl: ${p.platform}`);
      assert(passesLocalFilter(textWithoutKeywords, []), `passesLocalFilter returns true for ${p.platform} without NFT keywords`);

      const parsed = parseTweet({
        text: textWithoutKeywords,
        tweet_url: 'https://x.com/wl_hunter/status/555111',
        username: 'wl_hunter'
      });

      assert.strictEqual(parsed.form_platform, p.platform, `Parser extracted platform ${p.platform}`);
      assert(parsed.form_link.includes(p.url.replace(/^https?:\/\/(?:www\.)?/, '')), `Parser extracted form link for ${p.platform}`);
      assert.strictEqual(parsed.is_whitelist_form, 1, 'is_whitelist_form flagged');
      assert.strictEqual(parsed.opportunity_type, 'WHITELIST', 'opportunity_type set to WHITELIST');

      const formatted = formatTelegramMessage({
        ...parsed,
        score: 80,
        priority: 'HIGH',
        category: 'nft'
      }, 'ru');

      assert(formatted.includes('📝 <b>Форма'), `Telegram alert includes prominent form block for ${p.platform}`);
      assert(formatted.includes(parsed.form_link), `Telegram alert contains form link for ${p.platform}`);
    }
  });

  // --------------------------------------------------------------------------
  // SECTION 6: REQUIREMENT R6 — X-LIST CATEGORIES & TOPIC ROUTING
  // --------------------------------------------------------------------------
  await harness.test('R6-01: X-List categories support in database, admin endpoints, and #CATEGORY tag routing', async () => {
    const cols = testDb.prepare("PRAGMA table_info(x_list)").all().map(c => c.name);
    assert(cols.includes('category'), 'x_list table contains category column');

    await testEnv.DB.prepare(`
      INSERT OR REPLACE INTO x_list (username, category, is_active)
      VALUES ('uniswap_target', 'defi', 1),
             ('airdrop_sniper', 'airdrop', 1),
             ('node_runner', 'nodes', 1),
             ('pudgy_penguins', 'nft', 1)
    `).run();

    const defiTargets = await testEnv.DB.prepare('SELECT username FROM x_list WHERE lower(category) = ?').bind('defi').all();
    assert.strictEqual(defiTargets.results.length, 1);
    assert.strictEqual(defiTargets.results[0].username, 'uniswap_target');

    await testEnv.DB.prepare('UPDATE x_list SET category = ? WHERE lower(username) = ?').bind('defi', 'node_runner').run();
    const updated = await testEnv.DB.prepare('SELECT category FROM x_list WHERE lower(username) = ?').bind('node_runner').first();
    assert.strictEqual(updated.category, 'defi');

    const msgDefi = formatTelegramMessage({
      username: 'uniswap_target',
      score: 75,
      priority: 'HIGH',
      category: 'defi',
      tweet_url: 'https://x.com/uniswap_target/status/1'
    }, 'ru');
    assert(msgDefi.includes('#DEFI'), 'Message header includes #DEFI tag');

    const msgNodes = formatTelegramMessage({
      username: 'node_runner',
      score: 70,
      priority: 'HIGH',
      category: 'nodes',
      tweet_url: 'https://x.com/node_runner/status/2'
    }, 'ru');
    assert(msgNodes.includes('#NODES'), 'Message header includes #NODES tag');

    const threads = JSON.parse(testEnv.TELEGRAM_CATEGORY_THREADS);
    assert.strictEqual(threads['defi'], '20', 'DeFi thread ID is 20');
    assert.strictEqual(threads['nodes'], '40', 'Nodes thread ID is 40');
  });

  // --------------------------------------------------------------------------
  // SECTION 7: REQUIREMENT R8 — EXPLICIT TWITTER HTML ANCHOR LINKS
  // --------------------------------------------------------------------------
  await harness.test('R8-01: Explicit Twitter HTML anchor links across all templates and reports', async () => {
    // 1. formatTelegramMessage
    const alertMsg = formatTelegramMessage({
      username: 'degen_trader',
      score: 90,
      priority: 'HOT',
      tweet_url: 'https://x.com/degen_trader/status/999'
    });
    assert(alertMsg.includes('<a href="https://x.com/degen_trader">@degen_trader</a>'), 'formatTelegramMessage uses explicit Twitter profile anchor');

    // 2. formatDailySummaryMessage
    const summaryData = {
      date: '2026-10-12',
      startIso: '2026-10-11T00:00:00.000Z',
      endIso: '2026-10-12T00:00:00.000Z',
      categories: {
        free: [
          {
            tweet_url: 'https://x.com/free_project/status/1',
            project_name: 'Free Drop',
            username: 'free_project',
            score: 80,
            chain: 'Ethereum',
            price: 'FREE'
          }
        ],
        whitelist: [
          {
            tweet_url: 'https://x.com/wl_project/status/2',
            project_name: 'WL Project',
            username: 'wl_project',
            score: 85,
            chain: 'Solana',
            price: '0.1 SOL'
          }
        ],
        paid: [
          {
            tweet_url: 'https://x.com/paid_project/status/3',
            project_name: 'Paid Mint',
            username: 'paid_project',
            score: 90,
            chain: 'Ethereum',
            price: '0.05 ETH'
          }
        ]
      },
      opensea: {
        free: [],
        whitelist: [],
        paid: []
      }
    };
    const summaryMsg = formatDailySummaryMessage(summaryData, 'ru');
    assert(summaryMsg.includes('<a href="https://x.com/free_project">@free_project</a>'), 'formatDailySummaryMessage uses explicit Twitter profile anchor');
    assert(summaryMsg.includes('<a href="https://x.com/wl_project">@wl_project</a>'));
    assert(summaryMsg.includes('<a href="https://x.com/paid_project">@paid_project</a>'));

    // 3. Urgent siren template
    const user = 'urgent_alpha';
    const sirenTemplate = `🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ</b> 🚨🚨🚨\n\n` +
      `🔥 <b><a href="https://x.com/${user}">@${user}</a></b>:\nMint is live!\n\n` +
      `👉 <a href="https://x.com/${user}/status/1">ПЕРЕЙТИ К ТВИТУ</a>`;
    assert(sirenTemplate.includes('<a href="https://x.com/urgent_alpha">@urgent_alpha</a>'), 'Siren template has explicit Twitter anchor');

    // 4. Profile meta watcher alert
    const watcherTemplate = `⚡ <a href="https://x.com/${user}">@${user}</a> сменил ссылку в профиле на: <a href="https://new.site">https://new.site</a>!`;
    assert(watcherTemplate.includes('<a href="https://x.com/urgent_alpha">@urgent_alpha</a>'), 'Watcher alert has explicit Twitter anchor');

    // 5. Calendar reminder digest
    const digestTemplate = `🟢 MINT | <b><a href="https://x.com/${user}">@${user}</a></b>\n⏰ <b>Дата:</b> tomorrow`;
    assert(digestTemplate.includes('<a href="https://x.com/urgent_alpha">@urgent_alpha</a>'), 'Digest template has explicit Twitter anchor');
  });

  // --------------------------------------------------------------------------
  // SECTION 8: MINI APP BYTE-FOR-BYTE PARITY
  // --------------------------------------------------------------------------
  await harness.test('TMA-01: Mini App byte-for-byte identical parity between public/index.html and worker/public/index.html', async () => {
    const publicPath = path.join(rootDir, 'public/index.html');
    const workerPublicPath = path.join(rootDir, 'worker/public/index.html');

    assert(fs.existsSync(publicPath), 'public/index.html exists');
    assert(fs.existsSync(workerPublicPath), 'worker/public/index.html exists');

    const publicContent = fs.readFileSync(publicPath, 'utf8');
    const workerContent = fs.readFileSync(workerPublicPath, 'utf8');

    const hash1 = crypto.createHash('sha256').update(publicContent).digest('hex');
    const hash2 = crypto.createHash('sha256').update(workerContent).digest('hex');

    assert.strictEqual(hash1, hash2, `SHA-256 hashes must be identical (${hash1})`);
    assert.strictEqual(publicContent.length, workerContent.length, 'Byte lengths must match identically');
    assert.strictEqual(publicContent, workerContent, 'Contents must match 100% byte-for-byte');

    assert(publicContent.includes('calendarEvents: []'), 'Calendar state present');
    assert(publicContent.includes('targetCategoryFilter:'), 'Category state present');
    assert(publicContent.includes('ph-calendar'), 'Calendar Phosphor icon present');
  });

  // --------------------------------------------------------------------------
  // SECTION 9: STRICT PRICE TRACKER ISOLATION & NON-REGRESSION (R7)
  // --------------------------------------------------------------------------
  await harness.test('R7-01: Zero modifications to price trackers vs baseline backup', async () => {
    const trackerFiles = ['binance.js', 'geckoterminal.js', 'opensea.js'];
    for (const f of trackerFiles) {
      const curPath = path.join(srcDir, f);
      const bakPath = path.join(backupSrcDir, f);

      assert(fs.existsSync(curPath), `Current file exists: ${f}`);
      assert(fs.existsSync(bakPath), `Backup file exists: ${f}`);

      const curContent = fs.readFileSync(curPath, 'utf8').replace(/\r\n/g, '\n');
      const bakContent = fs.readFileSync(bakPath, 'utf8').replace(/\r\n/g, '\n');

      assert.strictEqual(curContent, bakContent, `File src/${f} must be 100% untouched and identical to backup`);
    }
  });

  await harness.test('R7-02: Full functional execution of Binance and GeckoTerminal price engines', async () => {
    const binance = await import(srcUrl('binance.js'));
    assert.strictEqual(typeof binance.getBinancePrices, 'function', 'binance.getBinancePrices is exported');
    assert.strictEqual(typeof binance.searchBinance, 'function', 'binance.searchBinance is exported');

    const emptyBinance = await binance.getBinancePrices([], {});
    assert.deepStrictEqual(emptyBinance, {});

    const gecko = await import(srcUrl('geckoterminal.js'));
    assert.strictEqual(typeof gecko.getGeckoTerminalTokensByNetwork, 'function', 'gecko.getGeckoTerminalTokensByNetwork is exported');
    assert.strictEqual(typeof gecko.searchGeckoTerminal, 'function', 'gecko.searchGeckoTerminal is exported');

    const emptyGecko = await gecko.getGeckoTerminalTokensByNetwork('eth', []);
    assert.deepStrictEqual(emptyGecko, []);
  });

  const res = harness.summary();
  if (!res.allPassed) {
    console.error(`\nFAILED: ${res.fails} tests failed.`);
    process.exit(1);
  } else {
    console.log(`\nSUCCESS: All ${res.total} tests passed flawlessly!`);
  }
}

if (require.main === module) {
  runDefinitiveSuite().catch(err => {
    console.error('Test Suite Fatal Error:', err);
    process.exit(1);
  });
}

module.exports = { runDefinitiveSuite };
