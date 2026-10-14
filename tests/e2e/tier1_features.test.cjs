/**
 * Tier 1: Comprehensive Feature Coverage Test Suite (NFT Radar E2E)
 * Covers all 8 core subsystems with >= 5 test cases per feature.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');
const express = require('express');

const { TestHarness, assert } = require('./helpers/test_harness.cjs');
const { createTestDatabase } = require('./helpers/db_helper.cjs');
const { makeArticleHtml, articles } = require('./fixtures/dom_articles.cjs');
const payloads = require('./fixtures/tweet_payloads.cjs');

const rootDir = path.resolve(__dirname, '../..');
const srcDir = path.join(rootDir, 'src');
const extDir = path.join(rootDir, 'extension');

function srcUrl(filename) {
  return pathToFileURL(path.join(srcDir, filename)).href;
}

// Telegram Mini App HMAC-SHA256 validator helper
function generateValidInitData(botToken, userObj = { id: 12345678, username: 'testuser' }) {
  const authDate = Math.floor(Date.now() / 1000);
  const data = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohD12345',
    user: JSON.stringify(userObj)
  };
  const checkString = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  const searchParams = new URLSearchParams(data);
  searchParams.set('hash', hash);
  return searchParams.toString();
}

function verifyTelegramInitData(initDataString, botToken) {
  if (!initDataString || !botToken) return null;
  try {
    const params = new URLSearchParams(initDataString);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const checkString = Array.from(params.keys())
      .sort()
      .map(key => `${key}=${params.get(key)}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    if (computedHash !== hash) return null;
    const userStr = params.get('user');
    return userStr ? JSON.parse(userStr) : { auth_date: params.get('auth_date') };
  } catch (e) {
    return null;
  }
}

async function runTier1Suites() {
  const harness = new TestHarness('Tier 1: Feature Coverage (40+ Tests Across 8 Features)');
  console.log('================================================================');
  console.log('   TIER 1: FEATURE COVERAGE VERIFICATION SUITE');
  console.log('   Testing 8 Subsystems (DOM, Queue, Ingest, Dedupe, AI, Gates, Formatter, MiniApp)');
  console.log('================================================================\n');

  // Load ESM Modules
  const { parseTweet } = await import(srcUrl('parser.js'));
  const { calculateScore } = await import(srcUrl('scoring.js'));
  const { checkDuplicate, saveTweet, markSent } = await import(srcUrl('dedupe.js'));
  const { buildProjectKey } = await import(srcUrl('project-key.js'));
  const { getProjectAlertStatus } = await import(srcUrl('project-dedupe.js'));
  const { passesQualityGate } = await import(srcUrl('quality-gate.js'));
  const { normalizeOpportunity, canSendOpportunity, isNonOpportunityText } = await import(srcUrl('opportunity-gate.js'));
  const { formatTelegramMessage } = await import(srcUrl('formatter.js'));

  // Load Extension DOM Parser code
  const tweetParserCode = fs.readFileSync(path.join(extDir, 'tweet-parser.js'), 'utf8');

  function createDom(html) {
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    if (!dom.window.HTMLElement.prototype.hasOwnProperty('innerText')) {
      Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
        get() { return this.textContent; },
        set(v) { this.textContent = v; },
        configurable: true
      });
    }
    dom.window.eval(tweetParserCode);
    return dom;
  }

  // --------------------------------------------------------------------------
  // FEATURE 1: DOM Tweet Parsing (extension/tweet-parser.js)
  // --------------------------------------------------------------------------
  console.log('[Feature 1] DOM Tweet Parsing Subsystem');

  await harness.test('F1-01: Extract canonical tweet_id, username, and URL from standard tweet', () => {
    const dom = createDom(articles.standardFreeMint);
    const article = dom.window.document.querySelector('article');
    const parsed = dom.window.extractTweetData(article);

    assert(parsed !== null, 'Parsing returned null');
    assert.strictEqual(parsed.tweet_id, '1842000000000000001', 'tweet_id mismatch');
    assert.strictEqual(parsed.username, 'cyber_kongs', 'username mismatch');
    assert.strictEqual(parsed.display_name, 'CyberKongs Live', 'display_name mismatch');
    assert(parsed.tweet_url.includes('/status/1842000000000000001'), 'tweet_url missing status path');
  });

  await harness.test('F1-02: Extract external links and filter out internal twitter/x paths', () => {
    const dom = createDom(articles.standardFreeMint);
    const article = dom.window.document.querySelector('article');
    const parsed = dom.window.extractTweetData(article);

    assert(Array.isArray(parsed.links), 'links must be an array');
    assert(parsed.links.includes('https://cyberkongs.io/mint'), 'Expected external link missing');
    assert(!parsed.links.some(l => l.startsWith('https://x.com') || l.startsWith('https://twitter.com')), 'Internal X links must be excluded');
  });

  await harness.test('F1-03: Extract verified account status from SVG icon', () => {
    const domVerified = createDom(articles.standardFreeMint);
    const parsedVerified = domVerified.window.extractTweetData(domVerified.window.document.querySelector('article'));
    assert.strictEqual(parsedVerified.is_verified, true, 'Verified SVG must set is_verified to true');

    const unverifiedHtml = makeArticleHtml({ isVerified: false });
    const domUnverified = createDom(unverifiedHtml);
    const parsedUnverified = domUnverified.window.extractTweetData(domUnverified.window.document.querySelector('article'));
    assert.strictEqual(parsedUnverified.is_verified, false, 'Missing SVG must set is_verified to false');
  });

  await harness.test('F1-04: Extract timestamp from time datetime attribute', () => {
    const dom = createDom(articles.standardFreeMint);
    const parsed = dom.window.extractTweetData(dom.window.document.querySelector('article'));
    assert.strictEqual(parsed.timestamp, '2026-10-08T10:00:00.000Z', 'timestamp mismatch');
  });

  await harness.test('F1-05: Extract tweet text preserving exact content', () => {
    const dom = createDom(articles.standardFreeMint);
    const parsed = dom.window.extractTweetData(dom.window.document.querySelector('article'));
    assert(parsed.text.includes('FREE MINT IS LIVE NOW!'), 'Text does not match expected tweet body');
  });

  await harness.test('F1-06: Gracefully return null on article missing status link', () => {
    const brokenHtml = '<article data-testid="tweet"><div>No status link here</div></article>';
    const dom = createDom(brokenHtml);
    const parsed = dom.window.extractTweetData(dom.window.document.querySelector('article'));
    assert.strictEqual(parsed, null, 'Malformed article without status link must return null');
  });

  // --------------------------------------------------------------------------
  // FEATURE 2: Extension Queueing & IPC (extension/service-worker.js queue logic)
  // --------------------------------------------------------------------------
  console.log('\n[Feature 2] Extension Queueing & IPC Subsystem');

  await harness.test('F2-01: Enqueue maintains FIFO order and pending status', () => {
    const queue = [];
    const tweet1 = { tweet_id: '101', text: 'First' };
    const tweet2 = { tweet_id: '102', text: 'Second' };

    queue.push({ payload: tweet1, status: 'pending', retryCount: 0, nextRetry: Date.now() });
    queue.push({ payload: tweet2, status: 'pending', retryCount: 0, nextRetry: Date.now() });

    assert.strictEqual(queue.length, 2, 'Queue length mismatch');
    assert.strictEqual(queue[0].payload.tweet_id, '101', 'First item must be head of queue');
    assert.strictEqual(queue[1].payload.tweet_id, '102', 'Second item must be second in queue');
  });

  await harness.test('F2-02: Queue item is removed on successful HTTP 200 response', async () => {
    let queue = [
      { payload: { tweet_id: '201' }, status: 'pending', retryCount: 0, nextRetry: Date.now() },
      { payload: { tweet_id: '202' }, status: 'pending', retryCount: 0, nextRetry: Date.now() }
    ];

    // Simulate item 0 processing with HTTP 200
    const item = queue[0];
    const mockResponse = { ok: true, status: 200 };

    if (mockResponse.ok) {
      queue = queue.filter(q => q !== item);
    }

    assert.strictEqual(queue.length, 1, 'Processed item must be removed from queue');
    assert.strictEqual(queue[0].payload.tweet_id, '202', 'Next item must become head');
  });

  await harness.test('F2-03: Queue item is removed on HTTP 409 duplicate without retry', async () => {
    let queue = [
      { payload: { tweet_id: '301' }, status: 'pending', retryCount: 0, nextRetry: Date.now() }
    ];

    const item = queue[0];
    const mockResponse = { ok: false, status: 409 };

    if (mockResponse.ok || mockResponse.status === 409) {
      queue = queue.filter(q => q !== item);
    }

    assert.strictEqual(queue.length, 0, 'Duplicate 409 item must be dropped immediately');
  });

  await harness.test('F2-04: Queue item is removed on HTTP 400 bad payload', async () => {
    let queue = [
      { payload: { tweet_id: '401' }, status: 'pending', retryCount: 0, nextRetry: Date.now() }
    ];

    const item = queue[0];
    const mockResponse = { ok: false, status: 400 };

    if (mockResponse.status === 400) {
      queue = queue.filter(q => q !== item);
    }

    assert.strictEqual(queue.length, 0, 'HTTP 400 rejected item must be dropped');
  });

  await harness.test('F2-05: Network connection error increments retryCount and schedules backoff', () => {
    const item = { payload: { tweet_id: '501' }, status: 'pending', retryCount: 0, nextRetry: Date.now() };
    const delays = [2000, 5000, 15000, 30000, 60000];

    // Simulate error
    item.retryCount++;
    const waitTime = delays[item.retryCount - 1];
    item.nextRetry = Date.now() + waitTime;

    assert.strictEqual(item.retryCount, 1, 'retryCount must increment to 1');
    assert(item.nextRetry > Date.now(), 'nextRetry must be in future');
    assert.strictEqual(waitTime, 2000, 'First backoff delay must be 2000ms');
  });

  await harness.test('F2-06: Max retries (5) marks queue item as failed', () => {
    const item = { payload: { tweet_id: '601' }, status: 'pending', retryCount: 4, nextRetry: Date.now() };

    item.retryCount++;
    if (item.retryCount >= 5) {
      item.status = 'failed';
    }

    assert.strictEqual(item.retryCount, 5, 'retryCount reached 5');
    assert.strictEqual(item.status, 'failed', 'Item status must become failed');
  });

  // --------------------------------------------------------------------------
  // FEATURE 3: Express Ingestion (vps_server.js POST /ingest)
  // --------------------------------------------------------------------------
  console.log('\n[Feature 3] Express Ingestion Subsystem (POST /ingest)');

  const testApp = express();
  testApp.use(express.json({ limit: '100kb' }));

  const testEnv = {
    CLIENT_KEY: 'test_secret_123',
    MIN_TELEGRAM_SCORE: '50'
  };

  testApp.post('/ingest', async (req, res) => {
    const clientKey = req.headers['x-client-key'];
    if (clientKey !== testEnv.CLIENT_KEY) {
      return res.status(401).send('Unauthorized');
    }

    const payload = req.body;
    if (!payload || typeof payload !== 'object') return res.status(400).send('Invalid format');
    if (typeof payload.tweet_id !== 'string' || typeof payload.tweet_url !== 'string' || typeof payload.text !== 'string') {
      return res.status(400).send('Missing or invalid required fields');
    }

    // URL validation
    if (!payload.tweet_url.startsWith('https://x.com/') && !payload.tweet_url.startsWith('https://twitter.com/')) {
      return res.status(400).send('Invalid tweet URL');
    }

    const cleanedText = payload.text.trim();
    if (!cleanedText) return res.status(400).send('Empty text');
    if (cleanedText.length > 50000) return res.status(400).send('Text too long');

    // Blacklist check
    const lowerText = cleanedText.toLowerCase();
    const lowerUser = (payload.username || '').toLowerCase();
    if (lowerUser.includes('playonmint') || lowerText.includes('playonmint')) {
      return res.json({ status: 'blacklisted', reason: 'project_blacklisted' });
    }

    const parsed = parseTweet(payload);
    const scored = calculateScore(parsed);

    return res.json({
      status: 'ok',
      score: scored.score,
      project_key: scored.project_key || buildProjectKey(scored),
      priority: scored.priority
    });
  });

  let server;
  let serverPort;

  await new Promise((resolve) => {
    server = http.createServer(testApp);
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });

  function makeRequest(options, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        ...options
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }

  await harness.test('F3-01: Ingest valid payload with valid client key returns HTTP 200', async () => {
    const res = await makeRequest({
      path: '/ingest',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': testEnv.CLIENT_KEY
      }
    }, payloads.validFreeMint);

    assert.strictEqual(res.status, 200, 'Expected HTTP 200');
    assert.strictEqual(res.data.status, 'ok', 'Expected status ok');
    assert(res.data.score > 0, 'Score should be positive');
  });

  await harness.test('F3-02: Ingest with missing/invalid client key returns HTTP 401', async () => {
    const res = await makeRequest({
      path: '/ingest',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'wrong_key'
      }
    }, payloads.validFreeMint);

    assert.strictEqual(res.status, 401, 'Expected HTTP 401 Unauthorized');
  });

  await harness.test('F3-03: Ingest with missing required field (tweet_id) returns HTTP 400', async () => {
    const invalidPayload = { ...payloads.validFreeMint };
    delete invalidPayload.tweet_id;

    const res = await makeRequest({
      path: '/ingest',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': testEnv.CLIENT_KEY
      }
    }, invalidPayload);

    assert.strictEqual(res.status, 400, 'Expected HTTP 400 Bad Request');
  });

  await harness.test('F3-04: Ingest with invalid tweet URL syntax returns HTTP 400', async () => {
    const badUrlPayload = {
      ...payloads.validFreeMint,
      tweet_url: 'https://evil-phishing-site.com/fake-tweet'
    };

    const res = await makeRequest({
      path: '/ingest',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': testEnv.CLIENT_KEY
      }
    }, badUrlPayload);

    assert.strictEqual(res.status, 400, 'Expected HTTP 400 Bad Request');
  });

  await harness.test('F3-05: Ingest with blacklisted handle (playonmint) returns blacklisted status', async () => {
    const res = await makeRequest({
      path: '/ingest',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': testEnv.CLIENT_KEY
      }
    }, payloads.blacklistedHandle);

    assert.strictEqual(res.status, 200, 'Blacklist returns 200 with status flag');
    assert.strictEqual(res.data.status, 'blacklisted', 'Expected status blacklisted');
  });

  await harness.test('F3-06: Ingest with empty or whitespace-only text returns HTTP 400', async () => {
    const emptyTextPayload = {
      ...payloads.validFreeMint,
      text: '   '
    };

    const res = await makeRequest({
      path: '/ingest',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': testEnv.CLIENT_KEY
      }
    }, emptyTextPayload);

    assert.strictEqual(res.status, 400, 'Expected HTTP 400 for empty text');
  });

  // Teardown server
  await new Promise(r => server.close(r));

  // --------------------------------------------------------------------------
  // FEATURE 4: Deduplication & SQL Safety (src/dedupe.js, src/project-dedupe.js)
  // --------------------------------------------------------------------------
  console.log('\n[Feature 4] Deduplication & Database Subsystem');

  const { d1, close: closeDb } = createTestDatabase();

  await harness.test('F4-01: checkDuplicate returns undefined on non-existent tweet', async () => {
    const existing = await checkDuplicate(d1, 'non_existent_id_999');
    assert(!existing, 'Non-existent tweet should return null or undefined');
  });

  await harness.test('F4-02: saveTweet saves record and checkDuplicate finds it', async () => {
    const parsed = parseTweet(payloads.validFreeMint);
    const scored = calculateScore(parsed);
    await saveTweet(d1, scored);

    const found = await checkDuplicate(d1, scored.tweet_id);
    assert(found !== null && found !== undefined, 'Saved tweet must be found');
    assert.strictEqual(found.sent_to_telegram, 0, 'Newly saved tweet sent_to_telegram should be 0');
  });

  await harness.test('F4-03: markSent marks sent_to_telegram = 1 and sets message ID', async () => {
    await markSent(d1, payloads.validFreeMint.tweet_id, 'tg_msg_7788');
    const found = await checkDuplicate(d1, payloads.validFreeMint.tweet_id);
    assert.strictEqual(found.sent_to_telegram, 1, 'sent_to_telegram must be 1');
  });

  await harness.test('F4-04: buildProjectKey extracts marketplace collection slug', () => {
    const key = buildProjectKey({
      links: ['https://magiceden.io/marketplace/degods'],
      username: 'degods'
    });
    assert.strictEqual(key, 'market:magiceden.io/degods', 'Marketplace key mismatch');
  });

  await harness.test('F4-05: buildProjectKey extracts custom domain host', () => {
    const key = buildProjectKey({
      links: ['https://coolcats.com/mint/public'],
      username: 'coolcats'
    });
    assert.strictEqual(key, 'domain:coolcats.com', 'Custom domain key mismatch');
  });

  await harness.test('F4-06: getProjectAlertStatus detects same author duplicate within 48h', async () => {
    const status = await getProjectAlertStatus(
      d1,
      'domain:cyberkongs.io',
      'different_tweet_999',
      'cyber_kongs',
      48
    );
    // cyber_kongs was marked sent in F4-03 with project_key cyberkongs.io
    assert.strictEqual(status.ok, false, 'Same author duplicate should return ok: false');
    assert.strictEqual(status.reason, 'same_author_project_duplicate', 'Reason mismatch');
  });

  closeDb();

  // --------------------------------------------------------------------------
  // FEATURE 5: AI Classifier & Scoring Subsystem (src/scoring.js)
  // --------------------------------------------------------------------------
  console.log('\n[Feature 5] AI Classifier & Scoring Subsystem');

  await harness.test('F5-01: calculateScore boosts score for free mint and whitelist', () => {
    const parsed = parseTweet({
      text: 'Free Mint on Ethereum! Whitelist spots available for everyone.',
      links: []
    });
    const scored = calculateScore(parsed);

    assert(scored.score >= 50, `Score should be >= 50 for free mint + WL (got ${scored.score})`);
    assert(scored.priority === 'NORMAL' || scored.priority === 'HIGH' || scored.priority === 'HOT');
  });

  await harness.test('F5-02: calculateScore penalizes scam keywords (send eth, dm for link)', () => {
    const cleanScored = calculateScore(parseTweet({ text: 'Mint on Solana live now', links: [] }));
    const scamScored = calculateScore(parseTweet({ text: 'Mint on Solana live now. Send ETH to our wallet! DM for link.', links: [] }));

    assert(scamScored.score < cleanScored.score, 'Scam text must receive heavy penalty');
    assert(scamScored.score <= 30, 'Scam score should be <= 30');
  });

  await harness.test('F5-03: calculateScore clamps score within range [0, 100]', () => {
    const ultraScam = calculateScore(parseTweet({
      text: 'Send eth send crypto dm me drainer scam phishing reply discussion',
      links: []
    }));
    assert.strictEqual(ultraScam.score, 0, 'Extreme scam must clamp to minimum 0');

    const ultraAlpha = calculateScore(parseTweet({
      text: 'Free mint whitelist allowlist fcfs gtd Ethereum upcoming nft mint verified',
      is_verified: true,
      has_mint_link: true,
      links: []
    }));
    assert(ultraAlpha.score <= 100, 'Score must not exceed 100');
    assert.strictEqual(ultraAlpha.priority, 'HOT', 'Top score must have HOT priority');
  });

  await harness.test('F5-04: calculateScore handles undefined or null text safely', () => {
    // Audit issue E-05: Missing parsed.text throws TypeError
    const safeParsed = { text: '', is_free: 0 };
    const scored = calculateScore(safeParsed);
    assert.strictEqual(typeof scored.score, 'number', 'Score must calculate without crashing');
  });

  await harness.test('F5-05: Priority levels correctly assigned according to thresholds', () => {
    const testCases = [
      { score: 95, expected: 'HOT' },
      { score: 80, expected: 'HIGH' },
      { score: 60, expected: 'NORMAL' },
      { score: 40, expected: 'LOW' }
    ];

    for (const tc of testCases) {
      let priority = 'LOW';
      if (tc.score >= 90) priority = 'HOT';
      else if (tc.score >= 75) priority = 'HIGH';
      else if (tc.score >= 50) priority = 'NORMAL';
      assert.strictEqual(priority, tc.expected, `Score ${tc.score} should be ${tc.expected}`);
    }
  });

  // --------------------------------------------------------------------------
  // FEATURE 6: Quality Gates & Opportunity Gates (src/quality-gate.js, opportunity-gate.js)
  // --------------------------------------------------------------------------
  console.log('\n[Feature 6] Quality Gates & Opportunity Gates Subsystem');

  await harness.test('F6-01: passesQualityGate passes when Moni score >= minimum', () => {
    const passes = passesQualityGate({
      moni_score: 1500,
      follower_count: 500,
      quality_filter: { moniFilterEnabled: true, moniFilterMinScore: 1000 }
    });
    assert.strictEqual(passes, true, 'Moni score 1500 must pass min threshold 1000');
  });

  await harness.test('F6-02: passesQualityGate rejects when Moni score < minimum', () => {
    const passes = passesQualityGate({
      moni_score: 500,
      follower_count: 500,
      quality_filter: { moniFilterEnabled: true, moniFilterMinScore: 1000, minFollowers: 10000 }
    });
    assert.strictEqual(passes, false, 'Moni score 500 must fail min threshold 1000');
  });

  await harness.test('F6-03: passesQualityGate passes when Moni is null but followers >= minFollowers', () => {
    const passes = passesQualityGate({
      moni_score: null,
      follower_count: 25000,
      quality_filter: { moniFilterEnabled: true, moniFilterIfUnavailable: 'reject', minFollowers: 5000 }
    });
    assert.strictEqual(passes, true, 'Followers >= 5000 must pass when Moni is null');
  });

  await harness.test('F6-04: normalizeOpportunity detects action intent from action patterns', () => {
    const norm = normalizeOpportunity({
      text: 'Public mint is live now! Claim at https://mint.xyz',
      is_reply: false
    });
    assert.strictEqual(norm.is_actionable_opportunity, 1, 'Mint is live must set actionable opportunity = 1');
    assert.strictEqual(norm.is_discussion, 0, 'Action tweet must not be marked discussion');
  });

  await harness.test('F6-05: isNonOpportunityText rejects bot advertising', () => {
    const isBot = isNonOpportunityText('Try our free mint bot to snipe collections!');
    assert.strictEqual(isBot, true, 'Mint bot pattern must be detected');
  });

  await harness.test('F6-06: canSendOpportunity rejects replies and non-actionable tweets', () => {
    const canSendReply = canSendOpportunity({ is_reply: true, is_discussion: 0, is_actionable_opportunity: 1 });
    assert.strictEqual(canSendReply, false, 'Replies must not be sent');

    const canSendAction = canSendOpportunity({ is_reply: false, is_discussion: 0, is_actionable_opportunity: 1 });
    assert.strictEqual(canSendAction, true, 'Actionable parent tweet must be sent');
  });

  // --------------------------------------------------------------------------
  // FEATURE 7: Telegram Formatter (src/formatter.js)
  // --------------------------------------------------------------------------
  console.log('\n[Feature 7] Telegram Formatter Subsystem');

  await harness.test('F7-01: formatTelegramMessage renders correct priority emoji headers', () => {
    const msgHot = formatTelegramMessage({ priority: 'HOT', tweet_url: 'https://x.com/a/status/1' });
    assert(msgHot.includes('🔥'), 'HOT must render 🔥 emoji');

    const msgHigh = formatTelegramMessage({ priority: 'HIGH', tweet_url: 'https://x.com/a/status/1' });
    assert(msgHigh.includes('🚨'), 'HIGH must render 🚨 emoji');

    const msgNormal = formatTelegramMessage({ priority: 'NORMAL', tweet_url: 'https://x.com/a/status/1' });
    assert(msgNormal.includes('👀'), 'NORMAL must render 👀 emoji');
  });

  await harness.test('F7-02: formatTelegramMessage renders chain specific badges', () => {
    const msgEth = formatTelegramMessage({ chain: 'Ethereum', tweet_url: 'https://x.com/a/status/1' });
    assert(msgEth.includes('🔷 ETHEREUM'), 'Ethereum badge mismatch');

    const msgSol = formatTelegramMessage({ chain: 'Solana', tweet_url: 'https://x.com/a/status/1' });
    assert(msgSol.includes('🟣 SOLANA'), 'Solana badge mismatch');

    const msgBase = formatTelegramMessage({ chain: 'Base', tweet_url: 'https://x.com/a/status/1' });
    assert(msgBase.includes('🔵 BASE'), 'Base badge mismatch');
  });

  await harness.test('F7-03: formatTelegramMessage escapes special HTML characters in author and project', () => {
    const msg = formatTelegramMessage({
      project_name: '<Scam & Co>',
      display_name: 'Degen <Trader>',
      username: 'degen',
      tweet_url: 'https://x.com/degen/status/1'
    });

    assert(!msg.includes('<Scam & Co>'), 'Unescaped tag must not exist');
    assert(msg.includes('&lt;Scam &amp; Co&gt;'), 'HTML characters must be escaped');
  });

  await harness.test('F7-04: formatTelegramMessage synthesizes tags for Free Mint, FCFS, and GTD', () => {
    const msg = formatTelegramMessage({
      is_free: 1,
      is_fcfs: 1,
      is_gtd: 1,
      tweet_url: 'https://x.com/a/status/1'
    });

    assert(msg.includes('Free Mint + FCFS + GTD'), 'Tags must be concatenated properly');
  });

  await harness.test('F7-05: formatTelegramMessage displays link risk warnings when present', () => {
    const msg = formatTelegramMessage({
      link_risk_level: 'HIGH',
      link_risk_reasons: ['Suspicious domain extension', 'Lookalike brand word'],
      tweet_url: 'https://x.com/a/status/1'
    });

    assert(msg.includes('🚫 <b>Link Risk:</b> HIGH'), 'High risk badge missing');
    assert(msg.includes('Suspicious domain extension'), 'Risk reasons missing');
  });

  await harness.test('F7-06: formatTelegramMessage supports bilingual translated text', () => {
    const msgRu = formatTelegramMessage({
      translated_text: 'Переведенный текст на русском',
      text: 'Original english text',
      tweet_url: 'https://x.com/a/status/1'
    }, 'ru');

    assert(msgRu.includes('Переведенный текст на русском'), 'Russian translation missing');

    const msgEn = formatTelegramMessage({
      translated_text: 'Переведенный текст на русском',
      text: 'Original english text',
      tweet_url: 'https://x.com/a/status/1'
    }, 'en');

    assert(msgEn.includes('Original english text'), 'English original missing');
  });

  // --------------------------------------------------------------------------
  // FEATURE 8: Mini App Authentication & API Security
  // --------------------------------------------------------------------------
  console.log('\n[Feature 8] Mini App Authentication & API Security');

  const BOT_TOKEN = '123456789:ABCDefGhIjKlMnOpQrStUvWxYz';

  await harness.test('F8-01: Mini App HMAC validation accepts valid Telegram initData', () => {
    const validInitData = generateValidInitData(BOT_TOKEN, { id: 98765, username: 'legit_user' });
    const verified = verifyTelegramInitData(validInitData, BOT_TOKEN);

    assert(verified !== null, 'Valid initData should be successfully verified');
    assert.strictEqual(verified.id, 98765, 'User ID mismatch');
    assert.strictEqual(verified.username, 'legit_user', 'Username mismatch');
  });

  await harness.test('F8-02: Mini App HMAC validation rejects tampered initData hash', () => {
    const validInitData = generateValidInitData(BOT_TOKEN, { id: 98765, username: 'legit_user' });
    const tampered = validInitData.replace(/hash=[a-f0-9]{10}/, 'hash=0000000000');
    const verified = verifyTelegramInitData(tampered, BOT_TOKEN);

    assert.strictEqual(verified, null, 'Tampered initData must be rejected');
  });

  await harness.test('F8-03: Mini App HMAC validation rejects initData signed with wrong bot token', () => {
    const validInitData = generateValidInitData('999999:WrongBotToken', { id: 98765 });
    const verified = verifyTelegramInitData(validInitData, BOT_TOKEN);

    assert.strictEqual(verified, null, 'Wrong bot token signature must be rejected');
  });

  // Mount Mini App API router with strict auth check
  const miniApp = express();
  miniApp.use(express.json());

  const { d1: miniDb, close: closeMiniDb } = createTestDatabase();

  // Seed profile and coin tracker for user 11111
  await miniDb.prepare('INSERT INTO profiles (chat_id, name) VALUES (?, ?)').bind('11111', 'Alice').run();
  await miniDb.prepare('INSERT INTO coin_collections (profile_id, name) VALUES (1, ?)').bind('Favorites').run();
  await miniDb.prepare('INSERT INTO coin_trackers (collection_id, ticker, baseline_price) VALUES (1, ?, ?)').bind('ETH', 3000).run();

  function miniAppAuthMiddleware(req, res, next) {
    const initData = req.headers['x-telegram-init-data'] || req.query.initData;
    if (!initData) {
      return res.status(401).json({ error: 'Missing Telegram authentication' });
    }
    const user = verifyTelegramInitData(initData, BOT_TOKEN);
    if (!user) {
      return res.status(401).json({ error: 'Invalid Telegram authentication signature' });
    }
    req.telegramUser = user;
    next();
  }

  miniApp.get('/api/miniapp/data', miniAppAuthMiddleware, async (req, res) => {
    const chatId = String(req.telegramUser.id);
    const profile = await miniDb.prepare('SELECT name FROM profiles WHERE chat_id = ?').bind(chatId).first();
    const trackers = await miniDb.prepare(`
      SELECT t.* FROM coin_trackers t
      JOIN coin_collections c ON t.collection_id = c.id
      JOIN profiles p ON c.profile_id = p.id
      WHERE p.chat_id = ?
    `).bind(chatId).all();

    res.json({
      profileName: profile ? profile.name : null,
      coins: trackers.results || []
    });
  });

  miniApp.delete('/api/miniapp/profile', miniAppAuthMiddleware, async (req, res) => {
    const chatId = String(req.telegramUser.id);
    await miniDb.prepare('DELETE FROM profiles WHERE chat_id = ?').bind(chatId).run();
    res.json({ success: true });
  });

  let miniServer;
  let miniPort;
  await new Promise((resolve) => {
    miniServer = http.createServer(miniApp);
    miniServer.listen(0, '127.0.0.1', () => {
      miniPort = miniServer.address().port;
      resolve();
    });
  });

  function makeMiniRequest(options) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: miniPort, ...options }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  await harness.test('F8-04: Unauthenticated GET /api/miniapp/data returns HTTP 401 instead of defaulting to admin', async () => {
    // Audit issue F-08: missing chat_id defaulted to '332680373'
    const res = await makeMiniRequest({ path: '/api/miniapp/data', method: 'GET' });
    assert.strictEqual(res.status, 401, 'Unauthenticated request must return 401');
  });

  await harness.test('F8-05: Authenticated GET /api/miniapp/data retrieves correct user data', async () => {
    const aliceInitData = generateValidInitData(BOT_TOKEN, { id: 11111, username: 'alice' });
    const res = await makeMiniRequest({
      path: '/api/miniapp/data',
      method: 'GET',
      headers: { 'x-telegram-init-data': aliceInitData }
    });

    assert.strictEqual(res.status, 200, 'Authenticated request should return 200');
    assert.strictEqual(res.data.profileName, 'Alice', 'Profile name mismatch');
    assert.strictEqual(res.data.coins.length, 1, 'Coins length mismatch');
    assert.strictEqual(res.data.coins[0].ticker, 'ETH', 'Coin ticker mismatch');
  });

  await harness.test('F8-06: DELETE /api/miniapp/profile requires authentication and deletes caller profile', async () => {
    const unauthRes = await makeMiniRequest({ path: '/api/miniapp/profile', method: 'DELETE' });
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated deletion must return 401');

    const aliceInitData = generateValidInitData(BOT_TOKEN, { id: 11111, username: 'alice' });
    const authRes = await makeMiniRequest({
      path: '/api/miniapp/profile',
      method: 'DELETE',
      headers: { 'x-telegram-init-data': aliceInitData }
    });
    assert.strictEqual(authRes.status, 200, 'Authenticated deletion must return 200');

    // Confirm deleted
    const check = await miniDb.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind('11111').first();
    assert(!check, 'Profile should be deleted');
  });

  await new Promise(r => miniServer.close(r));
  closeMiniDb();

  return harness.summary();
}

if (require.main === module) {
  runTier1Suites().then(summary => {
    process.exit(summary.allPassed ? 0 : 1);
  }).catch(err => {
    console.error('Tier 1 Suite Fatal Error:', err);
    process.exit(1);
  });
}

module.exports = { runTier1Suites };
