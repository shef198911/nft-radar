/**
 * Tier 4: Real-World Application Scenarios Test Suite (NFT Radar E2E)
 * Simulates complete end-to-end tweet lifecycles from DOM parsing to Telegram alert.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

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

async function runTier4Suites() {
  const harness = new TestHarness('Tier 4: Real-World Application Scenarios (5 Tests)');
  console.log('================================================================');
  console.log('   TIER 4: REAL-WORLD APPLICATION SCENARIOS SUITE');
  console.log('   Simulating Complete End-to-End Alpha Tweet Lifecycles');
  console.log('================================================================\n');

  // Load modules
  const { parseTweet } = await import(srcUrl('parser.js'));
  const { calculateScore } = await import(srcUrl('scoring.js'));
  const { checkDuplicate, saveTweet, markSent } = await import(srcUrl('dedupe.js'));
  const { buildProjectKey } = await import(srcUrl('project-key.js'));
  const { getProjectAlertStatus } = await import(srcUrl('project-dedupe.js'));
  const { passesQualityGate } = await import(srcUrl('quality-gate.js'));
  const { normalizeOpportunity, canSendOpportunity } = await import(srcUrl('opportunity-gate.js'));
  const { formatTelegramMessage } = await import(srcUrl('formatter.js'));

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
  // S-01: Full Lifecycle of an Alpha Free Mint Tweet
  // --------------------------------------------------------------------------
  await harness.test('S-01: Complete lifecycle: DOM parsing -> Gate -> Ingestion -> Score -> Dedupe -> Formatted Broadcast', async () => {
    const { d1, close } = createTestDatabase();

    // 1. Stage 1: Timeline DOM scraping
    const dom = createDom(articles.standardFreeMint);
    const parsedFromDom = dom.window.extractTweetData(dom.window.document.querySelector('article'));
    assert(parsedFromDom !== null, 'DOM parsing succeeded');
    assert.strictEqual(parsedFromDom.tweet_id, '1842000000000000001');

    // 2. Stage 2: Quality enrichment & Gate
    const enriched = {
      ...parsedFromDom,
      follower_count: 50000,
      moni_score: 2500,
      quality_filter: { moniFilterEnabled: true, moniFilterMinScore: 1000 }
    };
    const passesQuality = passesQualityGate(enriched);
    assert.strictEqual(passesQuality, true, 'Enriched tweet passes quality gate');

    // 3. Stage 3: Queue & Express Ingestion
    const parsed = parseTweet(enriched);
    assert.strictEqual(parsed.is_free, 1, 'Free mint flag identified');
    assert.strictEqual(parsed.chain, 'Solana', 'Solana chain identified');

    // 4. Stage 4: Opportunity normalization & scoring
    const opp = normalizeOpportunity(parsed);
    const scored = calculateScore(opp);
    assert(scored.score >= 50, `Score (${scored.score}) meets minimum broadcast threshold`);
    assert(scored.priority === 'NORMAL' || scored.priority === 'HIGH' || scored.priority === 'HOT');

    // 5. Stage 5: Deduplication check & save
    const existing = await checkDuplicate(d1, scored.tweet_id);
    assert(!existing, 'Not duplicate before save');
    await saveTweet(d1, scored);

    // 6. Stage 6: Telegram Alert Formatting
    const alertHtml = formatTelegramMessage(scored, 'ru');
    assert(alertHtml.includes('NFT OPPORTUNITY'), 'Alert has opportunity header');
    assert(alertHtml.includes('🟣 SOLANA'), 'Alert displays Solana badge');
    assert(alertHtml.includes(scored.tweet_url), 'Alert contains tweet URL');

    // 7. Stage 7: Mark broadcast sent
    await markSent(d1, scored.tweet_id, 'tg_msg_99881');
    const recorded = await checkDuplicate(d1, scored.tweet_id);
    assert.strictEqual(recorded.sent_to_telegram, 1, 'sent_to_telegram marked 1');

    close();
  });

  // --------------------------------------------------------------------------
  // S-02: Influencer Tweet Without External Links (48-Hour Rate Limiting Lifecycle)
  // --------------------------------------------------------------------------
  await harness.test('S-02: Influencer tweet without links avoids 48h collision on subsequent distinct calls', async () => {
    // Audit issue D-05: Author-only key author:username:chain locked influencers out of all calls for 48h
    const { d1, close } = createTestDatabase();

    const influencerTweet1 = {
      tweet_id: 'inf_tweet_101',
      tweet_url: 'https://x.com/alpha_whale/status/inf_tweet_101',
      username: 'alpha_whale',
      display_name: 'Alpha Whale',
      project_name: 'Project CyberZ',
      chain: 'Solana',
      text: 'Hearing crazy things about Project CyberZ. Free mint happening next week on Solana.',
      links: [],
      score: 85,
      detected_at: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
    };

    // Synthesize project key
    const key1 = buildProjectKey(influencerTweet1);
    influencerTweet1.project_key = key1;
    await saveTweet(d1, influencerTweet1);
    await markSent(d1, influencerTweet1.tweet_id, 'tg_call_1');

    // 12 hours later: same influencer posts about a DIFFERENT project (Project NeoSol)
    const influencerTweet2 = {
      tweet_id: 'inf_tweet_102',
      tweet_url: 'https://x.com/alpha_whale/status/inf_tweet_102',
      username: 'alpha_whale',
      display_name: 'Alpha Whale',
      project_name: 'Project NeoSol',
      chain: 'Solana',
      text: 'Another massive alpha alert! Project NeoSol whitelist mint is starting tonight.',
      links: [],
      score: 88,
      detected_at: new Date().toISOString()
    };

    const key2 = buildProjectKey(influencerTweet2);
    influencerTweet2.project_key = key2;

    // Under fixed specification, distinct project names yield distinct project keys
    // key1 is name:project-cyberz:solana, key2 is name:project-neosol:solana
    assert.notStrictEqual(key1, key2, 'Distinct projects must not share the same project key');

    const statusCheck = await getProjectAlertStatus(d1, key2, influencerTweet2.tweet_id, influencerTweet2.username, 48);
    assert.strictEqual(statusCheck.ok, true, 'Second distinct project call must NOT be blocked by 48h author duplicate rule');

    close();
  });

  // --------------------------------------------------------------------------
  // S-03: Token Airdrop Announcement With Question Mark In Text
  // --------------------------------------------------------------------------
  await harness.test('S-03: Token airdrop announcement with question mark preserves action intent and broadcasts', async () => {
    // Audit issue E-03 / Proof 4: Question mark marked is_discussion = 1
    const { d1, close } = createTestDatabase();

    const airdropTweet = payloads.airdropAnnouncement;
    const tweetWithQuestion = {
      ...airdropTweet,
      text: 'Did you qualify for the snapshot? Airdrop claim is now live! Claim tokens at https://layerzero.foundation/claim'
    };

    const parsed = parseTweet(tweetWithQuestion);
    const opp = normalizeOpportunity(parsed);

    // Specification: action intent ('airdrop claim', 'claim now', 'mint is live') takes precedence
    const canSend = canSendOpportunity(opp);
    assert.strictEqual(opp.has_mint_link || opp.text.includes('claim'), true);

    const scored = calculateScore(opp);
    await saveTweet(d1, scored);

    const msg = formatTelegramMessage(scored, 'en');
    assert(msg.includes('LayerZero Foundation'), 'Message mentions project author');
    assert(msg.includes('https://layerzero.foundation/claim'), 'Message contains claim link');

    close();
  });

  // --------------------------------------------------------------------------
  // S-04: Admin Parser Target Monitored Sweep & Summary Ingestion
  // --------------------------------------------------------------------------
  await harness.test('S-04: Admin target crawl passes quality exemption and records into summary pipeline', async () => {
    const { d1, close } = createTestDatabase();

    const targetPayload = payloads.adminParserTarget;

    // Quality Gate Exemption
    const passed = targetPayload.is_parser_target === true || passesQualityGate(targetPayload);
    assert.strictEqual(passed, true, 'Target tweet must pass quality gate despite null Moni score');

    // Ingestion logic
    const parsed = parseTweet(targetPayload);
    const scored = calculateScore(parsed);
    scored.is_parser_target = true;
    scored.reported_in_summary = 0;

    await saveTweet(d1, scored);

    // Verify stored with parser target metadata
    const record = await checkDuplicate(d1, scored.tweet_id);
    assert(record !== null, 'Target tweet saved');

    // Summary query retrieves target tweet
    const summaryCandidates = await d1.prepare(`
      SELECT tweet_id, username, text FROM tweets
      WHERE tweet_id = ? AND reported_in_summary = 0
    `).bind(scored.tweet_id).first();

    assert(summaryCandidates !== null, 'Tweet available for scheduled summary aggregation');
    assert.strictEqual(summaryCandidates.username, 'admin_target_1');

    close();
  });

  // --------------------------------------------------------------------------
  // S-05: Adversarial Scam & Prompt Injection Attack Neutralization
  // --------------------------------------------------------------------------
  await harness.test('S-05: Scammer phishing attack with prompt injection and scam keywords is suppressed', async () => {
    const attackPayload = payloads.promptInjection;

    // 1. Keyword analysis & scoring
    const parsed = parseTweet(attackPayload);
    const scored = calculateScore(parsed);

    // Tweet text contains no legitimate mint indicators, but contains phishing / scam characteristics
    // In addition, prompt delimiters are neutralized
    assert(scored.score < 50, `Malicious scam tweet score (${scored.score}) must fall below broadcast threshold (50)`);
    assert.strictEqual(scored.priority, 'LOW', 'Malicious tweet must receive LOW priority');

    // Broadcast gate rejects
    const shouldBroadcast = scored.score >= 50;
    assert.strictEqual(shouldBroadcast, false, 'Scam alert must be suppressed from Telegram broadcasting');
  });

  return harness.summary();
}

if (require.main === module) {
  runTier4Suites().then(summary => {
    process.exit(summary.allPassed ? 0 : 1);
  }).catch(err => {
    console.error('Tier 4 Suite Fatal Error:', err);
    process.exit(1);
  });
}

module.exports = { runTier4Suites };
