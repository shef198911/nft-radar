/**
 * Targeted Verification Suite for Milestone 2 Chrome Extension Features (F9, F10, F11)
 *
 * Verifies genuine implementation of:
 * - F9: Thread Reader & Self-reply Concatenation (tweet-parser.js & content.js)
 * - F10: Profile Bio & Website Scraper (tweet-parser.js, content.js & service-worker.js)
 * - F11: Whitelist Form Hunter & Local Filter Bypass (filters.js & tweet-parser.js)
 * - Strict Isolation: Price trackers (Binance, GeckoTerminal, OpenSea) remain untouched
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { TestHarness, assert } = require('./helpers/test_harness.cjs');

const rootDir = path.resolve(__dirname, '../..');
const extDir = path.join(rootDir, 'extension');

// Import extension modules
const { passesLocalFilter, passesXListLocalFilter, hasWhitelistFormUrl, WHITELIST_FORM_PATTERNS } = require(path.join(extDir, 'filters.js'));
const { extractTweetData, extractProfileMeta } = require(path.join(extDir, 'tweet-parser.js'));

// Helper to create a JSDOM document
function createDOM(html = '<!DOCTYPE html><html><body></body></html>', url = 'https://x.com/home') {
  const dom = new JSDOM(html, { url });
  return dom;
}

// Helper to build a mock tweet article element
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
  isPinned = false
}) {
  const dom = createDOM();
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

  // Header / User-Name
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

  // Social context (pinned)
  if (isPinned) {
    const pinnedEl = doc.createElement('div');
    pinnedEl.setAttribute('data-testid', 'socialContext');
    pinnedEl.textContent = 'Pinned Tweet';
    article.appendChild(pinnedEl);
  }

  // Tweet text
  const textEl = doc.createElement('div');
  textEl.setAttribute('data-testid', 'tweetText');
  textEl.textContent = text;
  article.appendChild(textEl);

  // External links
  for (const l of links) {
    const a = doc.createElement('a');
    a.href = l.href;
    if (l.title) a.setAttribute('title', l.title);
    a.textContent = l.text || l.href;
    article.appendChild(a);
  }

  return { article, dom };
}

// Helper to build a mock profile DOM
function createProfileDOM({ username = 'targetproject', bio = 'Building the future of NFTs', websiteUrl = 'https://premint.xyz/coolproject' }) {
  const dom = createDOM('<!DOCTYPE html><html><body></body></html>', `https://x.com/${username}`);
  const doc = dom.window.document;

  const headerContainer = doc.createElement('div');
  headerContainer.setAttribute('data-testid', 'UserProfileHeader_Items');

  const nameEl = doc.createElement('div');
  nameEl.setAttribute('data-testid', 'UserName');
  nameEl.innerHTML = `<span>Target Project</span><span>@${username}</span>`;
  doc.body.appendChild(nameEl);

  if (bio) {
    const bioEl = doc.createElement('div');
    bioEl.setAttribute('data-testid', 'UserDescription');
    bioEl.textContent = bio;
    doc.body.appendChild(bioEl);
  }

  if (websiteUrl) {
    const urlEl = doc.createElement('div');
    urlEl.setAttribute('data-testid', 'UserUrl');
    const a = doc.createElement('a');
    a.href = `https://t.co/shortlink`;
    a.setAttribute('title', websiteUrl);
    a.textContent = websiteUrl.replace(/^https?:\/\//, '');
    urlEl.appendChild(a);
    doc.body.appendChild(urlEl);
  }

  return dom;
}

async function runM2Tests() {
  const harness = new TestHarness('Milestone 2: Chrome Extension Features');

  // =========================================================================
  // SUITE 1: F11 Whitelist Form Hunter & Local Filter Bypass (filters.js)
  // =========================================================================

  await harness.test('F11-01: Premint form URL in tweet text bypasses local filter without NFT keywords', async () => {
    const text = 'Check out our new community raffle at https://premint.xyz/exclusive-pass';
    const passes = passesLocalFilter(text);
    assert.strictEqual(passes, true, 'Tweet with Premint form should pass local filter');
  });

  await harness.test('F11-02: Alphabot naked domain in tweet text bypasses local filter', async () => {
    const text = 'Register now for spot: alphabot.app/alpha-project/raffle';
    const passes = passesLocalFilter(text);
    assert.strictEqual(passes, true, 'Tweet with Alphabot naked URL should pass local filter');
  });

  await harness.test('F11-03: Heymint form in links array bypasses local filter even when text has no keywords', async () => {
    const text = 'Important update for community members below';
    const links = ['https://heymint.xyz/special-mint-whitelist'];
    const passes = passesLocalFilter(text, links);
    assert.strictEqual(passes, true, 'Heymint link in links array should bypass local filter');
  });

  await harness.test('F11-04: Google Forms URL in links array bypasses local filter', async () => {
    const text = 'Fill the submission to apply';
    const links = ['https://forms.gle/9aBcDeFgHiJkLmNoP'];
    const passes = passesLocalFilter(text, links);
    assert.strictEqual(passes, true, 'forms.gle link should bypass local filter');
  });

  await harness.test('F11-05: docs.google.com/forms URL in text bypasses local filter', async () => {
    const text = 'Apply here: https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform';
    const passes = passesLocalFilter(text);
    assert.strictEqual(passes, true, 'docs.google.com/forms should bypass local filter');
  });

  await harness.test('F11-06: Whitelist form bypasses utility and holder-gate reject patterns', async () => {
    const text = 'Holders only can register: https://premint.xyz/holder-raffle';
    const passes = passesLocalFilter(text);
    assert.strictEqual(passes, true, 'Whitelist form should bypass holder-gate filter');
  });

  await harness.test('F11-07: Malicious drainer/scam tweets are still rejected even with form URL', async () => {
    const text = 'Send ETH to claim: https://premint.xyz/fake-scam';
    const passes = passesLocalFilter(text);
    assert.strictEqual(passes, false, 'Scam/drainer tweets must remain rejected');
  });

  await harness.test('F11-08: General non-opportunity tweet without whitelist form is rejected', async () => {
    const text = 'Having lunch today with some friends, lovely weather outside.';
    const passes = passesLocalFilter(text);
    assert.strictEqual(passes, false, 'Non-opportunity tweet without form should be rejected');
  });

  // =========================================================================
  // SUITE 2: F11 Whitelist Form Hunter in Tweet Parser (tweet-parser.js)
  // =========================================================================

  await harness.test('F11-09: Parser extracts premint.xyz link from anchor tags and sets platform fields', async () => {
    const { article, dom } = createTweetArticle({
      tweetId: '1001',
      username: 'nftproject',
      text: 'WL raffle is open now!',
      links: [{ href: 'https://t.co/abc123', title: 'https://premint.xyz/super-raffle', text: 'premint.xyz/super-raffle' }]
    });
    global.window = dom.window;
    global.document = dom.window.document;

    const data = extractTweetData(article);
    assert.ok(data, 'Parsed tweet data should not be null');
    assert.strictEqual(data.is_whitelist_form, true, 'is_whitelist_form must be true');
    assert.strictEqual(data.form_platform, 'premint', 'form_platform must be premint');
    assert.strictEqual(data.form_link, 'https://premint.xyz/super-raffle', 'form_link must match unshortened URL');
  });

  await harness.test('F11-10: Parser extracts alphabot.app from raw text when not in anchors', async () => {
    const { article, dom } = createTweetArticle({
      tweetId: '1002',
      username: 'alphaproject',
      text: 'Join the whitelist raffle: alphabot.app/alpha-project-raffle good luck!'
    });
    global.window = dom.window;
    global.document = dom.window.document;

    const data = extractTweetData(article);
    assert.ok(data, 'Parsed tweet data should not be null');
    assert.strictEqual(data.is_whitelist_form, true, 'is_whitelist_form must be true');
    assert.strictEqual(data.form_platform, 'alphabot', 'form_platform must be alphabot');
    assert.strictEqual(data.form_link, 'https://alphabot.app/alpha-project-raffle', 'form_link must be normalized with https://');
  });

  await harness.test('F11-11: Parser extracts heymint.xyz and google_forms correctly', async () => {
    const { article: a1, dom: dom1 } = createTweetArticle({
      tweetId: '1003',
      username: 'heymintproject',
      text: 'Submit wallet: https://heymint.xyz/mint-wl'
    });
    global.window = dom1.window;
    global.document = dom1.window.document;
    const d1 = extractTweetData(a1);
    assert.strictEqual(d1.form_platform, 'heymint');
    assert.strictEqual(d1.is_whitelist_form, true);

    const { article: a2, dom: dom2 } = createTweetArticle({
      tweetId: '1004',
      username: 'formsproject',
      text: 'Fill out https://forms.gle/xyz987 to get allowlist'
    });
    global.window = dom2.window;
    global.document = dom2.window.document;
    const d2 = extractTweetData(a2);
    assert.strictEqual(d2.form_platform, 'google_forms');
    assert.strictEqual(d2.is_whitelist_form, true);
  });

  // =========================================================================
  // SUITE 3: F9 Thread Reader & Self-Reply Detection (tweet-parser.js)
  // =========================================================================

  await harness.test('F9-01: Root tweet correctly marked as is_reply=false, is_self_reply=false', async () => {
    const { article, dom } = createTweetArticle({
      tweetId: '2001',
      username: 'creator1',
      text: '1/3 Announcing our official collection mint details below!'
    });
    global.window = dom.window;
    global.document = dom.window.document;

    const data = extractTweetData(article);
    assert.strictEqual(data.is_reply, false, 'Root tweet is not a reply');
    assert.strictEqual(data.is_self_reply, false, 'Root tweet is not a self-reply');
    assert.strictEqual(data.reply_to, null, 'Root tweet reply_to should be null');
  });

  await harness.test('F9-02: Author self-reply identified via "Replying to @creator1"', async () => {
    const { article, dom } = createTweetArticle({
      tweetId: '2002',
      username: 'creator1',
      headerText: 'Replying to @creator1',
      text: '2/3 Here is the mint link: https://premint.xyz/mint'
    });
    global.window = dom.window;
    global.document = dom.window.document;

    const data = extractTweetData(article);
    assert.strictEqual(data.is_reply, true, 'Self-reply has is_reply=true');
    assert.strictEqual(data.is_self_reply, true, 'Self-reply has is_self_reply=true');
    assert.strictEqual(data.reply_to.toLowerCase(), 'creator1', 'reply_to matches author');
  });

  await harness.test('F9-03: Non-author reply identified as is_self_reply=false', async () => {
    const { article, dom } = createTweetArticle({
      tweetId: '2003',
      username: 'randomuser',
      headerText: 'Replying to @creator1',
      text: 'Great project, looking forward to it!'
    });
    global.window = dom.window;
    global.document = dom.window.document;

    const data = extractTweetData(article);
    assert.strictEqual(data.is_reply, true, 'Reply has is_reply=true');
    assert.strictEqual(data.is_self_reply, false, 'Non-author reply has is_self_reply=false');
    assert.strictEqual(data.reply_to.toLowerCase(), 'creator1', 'reply_to matches original author');
  });

  await harness.test('F9-04: Status URL browsing context identifies self-reply on /author/status/xxx', async () => {
    const dom = createDOM('<!DOCTYPE html><html><body></body></html>', 'https://x.com/creator1/status/2001');
    const { article } = createTweetArticle({
      tweetId: '2002',
      username: 'creator1',
      text: 'Thread continuation inside status page view'
    });
    global.window = dom.window;
    global.document = dom.window.document;

    const data = extractTweetData(article);
    assert.strictEqual(data.is_self_reply, true, 'Author reply in status page context must be recognized as self-reply');
  });

  // =========================================================================
  // SUITE 4: F9 Thread Concatenation in Content Script (content.js)
  // =========================================================================

  await harness.test('F9-05: Content script processArticles concatenates consecutive author tweets', async () => {
    const dom = createDOM('<!DOCTYPE html><html><body></body></html>', 'https://x.com/threadauthor');
    global.window = dom.window;
    global.document = dom.window.document;
    const sentMessages = [];
    global.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          sentMessages.push(msg);
          return { success: true };
        },
        onMessage: {
          addListener: () => {}
        }
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ settings: { moniFilterEnabled: false, minFollowers: 0 } }),
          set: (obj, cb) => cb && cb()
        }
      }
    };

    // Load content scripts in manifest order
    const filtersCode = fs.readFileSync(path.join(extDir, 'filters.js'), 'utf8');
    const moniCode = fs.readFileSync(path.join(extDir, 'moni-score.js'), 'utf8');
    const parserCode = fs.readFileSync(path.join(extDir, 'tweet-parser.js'), 'utf8');
    const contentCode = fs.readFileSync(path.join(extDir, 'content.js'), 'utf8');
    dom.window.eval(filtersCode);
    dom.window.eval(moniCode);
    dom.window.eval(parserCode);
    dom.window.eval(contentCode);
    dom.window.getFollowerCountViaHover = async () => 5000;

    // Create 3 consecutive articles by same author (Root + 2 thread continuations)
    const { article: a1 } = createTweetArticle({
      tweetId: '3001',
      username: 'threadauthor',
      text: '1/3 Big mint announcement coming today! $SOL',
      time: new Date().toISOString()
    });
    const { article: a2 } = createTweetArticle({
      tweetId: '3002',
      username: 'threadauthor',
      headerText: 'Replying to @threadauthor',
      text: '2/3 Whitelist form: https://premint.xyz/alpha-whitelist',
      time: new Date().toISOString()
    });
    const { article: a3 } = createTweetArticle({
      tweetId: '3003',
      username: 'threadauthor',
      headerText: 'Replying to @threadauthor',
      text: '3/3 Contract address: 0x1234567890123456789012345678901234567890',
      time: new Date().toISOString()
    });

    const articles = [a1, a2, a3];
    dom.window.processArticles(articles, false);

    // Wait for async hover queue processing
    let waitIters = 0;
    while (dom.window.isHoverQueueBusy && dom.window.isHoverQueueBusy() && waitIters < 30) {
      await new Promise(r => setTimeout(r, 50));
      waitIters++;
    }
    await new Promise(r => setTimeout(r, 150));

    // Verify sentMessages contains TRANSLATE_AND_ENQUEUE for the root tweet with concatenated content
    const enqueued = sentMessages.find(m => m.type === 'TRANSLATE_AND_ENQUEUE');
    assert.ok(enqueued, 'TRANSLATE_AND_ENQUEUE must be dispatched for concatenated thread');
    const payload = enqueued.payload;

    assert.strictEqual(payload.tweet_id, '3001', 'Root tweet ID is preserved');
    assert.strictEqual(payload.thread_count, 3, 'thread_count must be 3');
    assert.deepStrictEqual(payload.thread_ids, ['3001', '3002', '3003'], 'thread_ids must contain all 3 tweet IDs');
    assert.ok(payload.text.includes('1/3 Big mint announcement'), 'Payload text contains root tweet');
    assert.ok(payload.text.includes('--- [Thread Continuation] ---\n2/3 Whitelist form:'), 'Payload text contains continuation 1');
    assert.ok(payload.text.includes('--- [Thread Continuation] ---\n3/3 Contract address:'), 'Payload text contains continuation 2');

    // Verify merged whitelist form
    assert.strictEqual(payload.is_whitelist_form, true, 'Whitelist form from continuation must be merged');
    assert.strictEqual(payload.form_platform, 'premint', 'Platform must be merged');
    assert.strictEqual(payload.form_link, 'https://premint.xyz/alpha-whitelist', 'Form link must be merged');

    // Verify merged contracts and cashtags
    assert.ok(payload.cashtags.includes('$SOL'), 'Cashtags must be preserved');
    assert.ok(payload.contracts.includes('0x1234567890123456789012345678901234567890'), 'Contracts must be merged');

    // Verify subsequent tweets were NOT sent as duplicate individual messages
    const duplicateEnqueued = sentMessages.filter(m => m.type === 'TRANSLATE_AND_ENQUEUE');
    assert.strictEqual(duplicateEnqueued.length, 1, 'Sub-tweets must not be emitted as separate enqueued messages');
  });

  await harness.test('F9-06: Thread lookahead stops at different author boundary and rejects foreign replies', async () => {
    const dom = createDOM('<!DOCTYPE html><html><body></body></html>', 'https://x.com/search');
    global.window = dom.window;
    global.document = dom.window.document;
    const sentMessages = [];
    global.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          sentMessages.push(msg);
          return { success: true };
        },
        onMessage: {
          addListener: () => {}
        }
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ settings: { moniFilterEnabled: false, minFollowers: 0 } }),
          set: (obj, cb) => cb && cb()
        }
      }
    };

    // Load content scripts in manifest order
    const filtersCode = fs.readFileSync(path.join(extDir, 'filters.js'), 'utf8');
    const moniCode = fs.readFileSync(path.join(extDir, 'moni-score.js'), 'utf8');
    const parserCode = fs.readFileSync(path.join(extDir, 'tweet-parser.js'), 'utf8');
    const contentCode = fs.readFileSync(path.join(extDir, 'content.js'), 'utf8');
    dom.window.eval(filtersCode);
    dom.window.eval(moniCode);
    dom.window.eval(parserCode);
    dom.window.eval(contentCode);
    dom.window.getFollowerCountViaHover = async () => 5000;

    const { article: a1 } = createTweetArticle({
      tweetId: '4001',
      username: 'alice',
      text: 'NFT mint is live now! Mint free: https://mint.xyz',
      time: new Date().toISOString()
    });
    const { article: a2 } = createTweetArticle({
      tweetId: '4002',
      username: 'bob',
      headerText: 'Replying to @alice',
      text: 'Congrats Alice!',
      time: new Date().toISOString()
    });

    const articles = [a1, a2];
    dom.window.processArticles(articles, false);
    let waitIters = 0;
    while (dom.window.isHoverQueueBusy && dom.window.isHoverQueueBusy() && waitIters < 30) {
      await new Promise(r => setTimeout(r, 50));
      waitIters++;
    }
    await new Promise(r => setTimeout(r, 150));

    const enqueued = sentMessages.filter(m => m.type === 'TRANSLATE_AND_ENQUEUE');
    assert.strictEqual(enqueued.length, 1, 'Only Alice root tweet should be enqueued');
    assert.strictEqual(enqueued[0].payload.username, 'alice');
    assert.strictEqual(enqueued[0].payload.thread_count, 1, 'Thread count should remain 1 when next author is different');
    assert.ok(!enqueued[0].payload.text.includes('Congrats Alice!'), 'Bob comment must not be concatenated');
  });

  // =========================================================================
  // SUITE 5: F10 Profile Bio & Website Scraper (tweet-parser.js & content.js)
  // =========================================================================

  await harness.test('F10-01: extractProfileMeta extracts Bio text and Website Link from DOM', async () => {
    const profileDom = createProfileDOM({
      username: 'solanaproject',
      bio: 'Leading Solana NFT Ecosystem. Minting Oct 2026.',
      websiteUrl: 'https://premint.xyz/solanaproject-pass'
    });

    const meta = extractProfileMeta('solanaproject', profileDom.window.document);
    assert.ok(meta, 'Profile meta should not be null');
    assert.strictEqual(meta.username, 'solanaproject');
    assert.strictEqual(meta.bio, 'Leading Solana NFT Ecosystem. Minting Oct 2026.');
    assert.strictEqual(meta.website_url, 'https://premint.xyz/solanaproject-pass');
  });

  await harness.test('F10-02: extractProfileMeta fallbacks cleanly when fields are missing', async () => {
    const profileDom = createProfileDOM({
      username: 'emptyprofile',
      bio: null,
      websiteUrl: null
    });

    const meta = extractProfileMeta('emptyprofile', profileDom.window.document);
    assert.ok(meta);
    assert.strictEqual(meta.username, 'emptyprofile');
    assert.strictEqual(meta.bio, null);
    assert.strictEqual(meta.website_url, null);
  });

  await harness.test('F10-03: content.js dispatches PROFILE_META_SCRAPED on profile page scan', async () => {
    const profileDom = createProfileDOM({
      username: 'mintwatcher',
      bio: 'Official mint profile',
      websiteUrl: 'https://mint.watcher.xyz'
    });
    global.window = profileDom.window;
    global.document = profileDom.window.document;

    const runtimeMessages = [];
    global.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          runtimeMessages.push(msg);
          return { success: true };
        },
        onMessage: {
          addListener: () => {}
        }
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ settings: {} }),
          set: (obj, cb) => cb && cb()
        }
      }
    };

    const parserCode = fs.readFileSync(path.join(extDir, 'tweet-parser.js'), 'utf8');
    const contentCode = fs.readFileSync(path.join(extDir, 'content.js'), 'utf8');
    profileDom.window.eval(parserCode);
    profileDom.window.eval(contentCode);

    // Call checkAndScrapeProfileMeta on the profile DOM
    profileDom.window.checkAndScrapeProfileMeta();

    const profileMetaMsg = runtimeMessages.find(m => m.type === 'PROFILE_META_SCRAPED');
    assert.ok(profileMetaMsg, 'PROFILE_META_SCRAPED must be sent');
    assert.strictEqual(profileMetaMsg.payload.username, 'mintwatcher');
    assert.strictEqual(profileMetaMsg.payload.bio, 'Official mint profile');
    assert.strictEqual(profileMetaMsg.payload.website_url, 'https://mint.watcher.xyz');
  });

  // =========================================================================
  // SUITE 6: F10 Background Service Worker Integration (service-worker.js)
  // =========================================================================

  await harness.test('F10-04: Service Worker handles PROFILE_META_SCRAPED and POSTs to /api/miniapp/profile_meta', async () => {
    let receivedPayload = null;
    let receivedAuthHeader = null;

    // Start a temporary test server listening for /api/miniapp/profile_meta
    const testServer = http.createServer((req, res) => {
      if (req.url === '/api/miniapp/profile_meta' && req.method === 'POST') {
        receivedAuthHeader = req.headers['x-client-key'];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          receivedPayload = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, changed: true }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(r => testServer.listen(0, '127.0.0.1', r));
    const port = testServer.address().port;

    try {
      // Mock service worker environment
      let onMessageListener = null;
      global.importScripts = () => {};
      global.chrome = {
        runtime: {
          onMessage: {
            addListener: (fn) => { onMessageListener = fn; }
          },
          sendMessage: () => Promise.resolve()
        },
        storage: {
          local: {
            get: (keys, cb) => cb({
              settings: {
                workerUrl: `http://127.0.0.1:${port}`,
                clientKey: 'TEST_SECRET_KEY_123'
              }
            }),
            set: () => Promise.resolve()
          }
        },
        alarms: {
          create: () => {},
          clear: () => {},
          onAlarm: {
            addListener: () => {}
          }
        },
        tabs: {}
      };

      // Read service worker code and execute in test sandbox
      const swCode = fs.readFileSync(path.join(extDir, 'service-worker.js'), 'utf8');
      eval(swCode);

      assert.ok(typeof onMessageListener === 'function', 'Service worker must register onMessage listener');

      // Dispatch PROFILE_META_SCRAPED
      const mockMeta = {
        username: 'monitoredproject',
        bio: 'Updated mint bio',
        website_url: 'https://newmint.xyz'
      };

      onMessageListener({
        type: 'PROFILE_META_SCRAPED',
        payload: mockMeta
      }, {}, () => {});

      // Wait for fetch to reach testServer
      let waitCount = 0;
      while (!receivedPayload && waitCount < 30) {
        await new Promise(r => setTimeout(r, 100));
        waitCount++;
      }

      assert.ok(receivedPayload, 'Service worker must forward payload to backend HTTP server');
      assert.strictEqual(receivedPayload.username, 'monitoredproject');
      assert.strictEqual(receivedPayload.bio, 'Updated mint bio');
      assert.strictEqual(receivedPayload.website_url, 'https://newmint.xyz');
      assert.strictEqual(receivedAuthHeader, 'TEST_SECRET_KEY_123', 'x-client-key header must be sent');
    } finally {
      testServer.close();
    }
  });

  // =========================================================================
  // SUITE 7: Price Tracker Strict Isolation Verification
  // =========================================================================

  await harness.test('ISOLATION-01: Price tracker source files remain 100% untouched', async () => {
    const files = ['src/binance.js', 'src/geckoterminal.js', 'src/opensea.js'];
    for (const f of files) {
      const fullPath = path.join(rootDir, f);
      assert.ok(fs.existsSync(fullPath), `${f} must exist`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(content.length > 500, `${f} must have substantial code`);
    }
  });

  await harness.test('ISOLATION-02: Extension code does not import or alter price trackers', async () => {
    const extFiles = ['filters.js', 'tweet-parser.js', 'content.js', 'service-worker.js'];
    for (const ef of extFiles) {
      const content = fs.readFileSync(path.join(extDir, ef), 'utf8');
      assert.ok(!content.includes('binance.js'), `${ef} must not reference binance.js`);
      assert.ok(!content.includes('geckoterminal.js'), `${ef} must not reference geckoterminal.js`);
      assert.ok(!content.includes('opensea.js'), `${ef} must not reference opensea.js`);
    }
  });

  const summary = harness.summary();
  if (!summary.allPassed) {
    console.error(`\nFAILED: ${summary.fails} / ${summary.total} tests failed.`);
    process.exit(1);
  } else {
    console.log(`\nSUCCESS: All ${summary.passes} / ${summary.total} tests passed flawlessly.`);
    process.exit(0);
  }
}

if (require.main === module) {
  runM2Tests().catch(err => {
    console.error('Fatal error running M2 tests:', err);
    process.exit(1);
  });
}

module.exports = { runM2Tests };
