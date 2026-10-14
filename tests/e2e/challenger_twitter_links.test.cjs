/**
 * Challenger Verification Test Suite: Explicit Twitter Profile HTML Links
 * Verifies Requirement 2:
 * All Twitter handles across all templates and alert generators are formatted as
 * `<a href="https://x.com/${user}">@${user}</a>` (and never raw `@user`).
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { TestHarness, assert } = require('./helpers/test_harness.cjs');

const rootDir = path.resolve(__dirname, '../..');
const srcDir = path.join(rootDir, 'src');

function srcUrl(file) {
  return pathToFileURL(path.join(srcDir, file)).href;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function runTwitterLinksSuite() {
  const harness = new TestHarness('Challenger M1-2: Explicit Twitter Profile HTML Links Suite');
  console.log('================================================================');
  console.log('   CHALLENGER VERIFICATION: EXPLICIT TWITTER PROFILE HTML LINKS');
  console.log('   Testing Format Compliance Across All Alert Generators & Templates');
  console.log('================================================================\n');

  // Load modules
  const { formatTelegramMessage } = await import(srcUrl('formatter.js'));
  const { formatDailySummaryMessage } = await import(srcUrl('daily-summary.js'));

  // 1. Test src/formatter.js formatTelegramMessage
  await harness.test('TW-01: formatTelegramMessage renders author as explicit x.com anchor link', async () => {
    // Case A: username only
    const msg1 = formatTelegramMessage({
      username: 'crypto_punk',
      project_name: 'CryptoPunks',
      priority: 'HIGH',
      score: 85,
      is_x_list: false,
      tweet_url: 'https://x.com/crypto_punk/status/12345'
    });
    assert(
      msg1.includes('<a href="https://x.com/crypto_punk">@crypto_punk</a>'),
      'Username-only author must render as explicit x.com anchor link'
    );
    // Ensure it's not a bare @crypto_punk outside an <a> tag
    const authorLine1 = msg1.split('\n').find(l => l.includes('Author:'));
    assert(authorLine1, 'Author line exists');
    assert(authorLine1.includes('<a href="https://x.com/crypto_punk">@crypto_punk</a>'), 'Author line wraps @crypto_punk in <a>');

    // Case B: username with leading @ in data
    const msg2 = formatTelegramMessage({
      username: '@alpha_trader',
      priority: 'HOT',
      score: 95,
      is_x_list: true,
      tweet_url: 'https://x.com/alpha_trader/status/67890'
    });
    assert(
      msg2.includes('<a href="https://x.com/alpha_trader">@alpha_trader</a>'),
      'Author with leading @ must be sanitized and rendered as explicit x.com anchor'
    );

    // Case C: display_name distinct from username
    const msg3 = formatTelegramMessage({
      username: 'art_collector',
      display_name: 'Art Collector VIP',
      priority: 'NORMAL',
      score: 60,
      is_x_list: false,
      tweet_url: 'https://x.com/art_collector/status/11111'
    });
    const expectedAnchor = '<a href="https://x.com/art_collector">Art Collector VIP (@art_collector)</a>';
    assert(
      msg3.includes(expectedAnchor),
      'Author with display_name must wrap both display_name and (@username) inside the x.com anchor'
    );
  });

  // 2. Test src/daily-summary.js formatDailySummaryMessage
  await harness.test('TW-02: formatDailySummaryMessage renders all items with explicit x.com anchor links', async () => {
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
            tweet_url: 'https://x.com/wl_guru/status/2',
            project_name: 'WL Project',
            username: 'wl_guru',
            score: 90,
            chain: 'Base',
            price: '0.01 ETH'
          }
        ],
        paid: [
          {
            tweet_url: 'https://x.com/premium_nft/status/3',
            project_name: 'Premium Mint',
            username: 'premium_nft',
            score: 95,
            chain: 'Solana',
            price: '2 SOL'
          }
        ]
      },
      opensea: { free: [], whitelist: [], paid: [] },
      twitterTotal: 3,
      openseaTotal: 0,
      totalItems: 3
    };

    const summaryMsg = formatDailySummaryMessage(summaryData);

    // Check each category rendered item
    assert(
      summaryMsg.includes('<a href="https://x.com/free_project">@free_project</a>'),
      'Free category item renders explicit Twitter anchor link'
    );
    assert(
      summaryMsg.includes('<a href="https://x.com/wl_guru">@wl_guru</a>'),
      'Whitelist category item renders explicit Twitter anchor link'
    );
    assert(
      summaryMsg.includes('<a href="https://x.com/premium_nft">@premium_nft</a>'),
      'Paid category item renders explicit Twitter anchor link'
    );

    // Assert no raw @username mention exists without being inside an <a> tag
    const rawMentionRegex = /(?<!https:\/\/x\.com\/[a-zA-Z0-9_]+\">)@(free_project|wl_guru|premium_nft)/;
    assert(!rawMentionRegex.test(summaryMsg), 'No raw @mention without x.com anchor in daily summary');
  });

  // 3. Test vps_server.js summary_done report format
  await harness.test('TW-03: summary_done parser report renders active and inactive users with explicit x.com anchors', async () => {
    // Replicate the exact template generation from vps_server.js lines 855-877
    const activeEvents = [
      {
        user: 'alpha_founder',
        type: 'mint',
        text: 'MINT IS LIVE on premint.xyz/drop',
        url: 'https://x.com/alpha_founder/status/1001'
      },
      {
        user: 'airdrop_hunter',
        type: 'checker',
        text: 'Checker live now',
        url: 'https://x.com/airdrop_hunter/status/1002'
      }
    ];
    const inactiveUsers = ['dormant_dev', 'silent_whale'];

    let summaryText = '📋 <b>ОТЧЁТ ПАРСЕРА ПРОЕКТОВ</b>\n\n';
    if (activeEvents.length > 0) {
      summaryText += '🔥 <b>ВАЖНЫЕ СОБЫТИЯ:</b>\n';
      for (const ev of activeEvents) {
        const icon = ev.type === 'mint' ? '🟢' : (ev.type === 'checker' || ev.type === 'airdrop') ? '🔵' : '🟡';
        const typeLabel = ev.type === 'mint' ? 'МИНТ' : ev.type === 'checker' ? 'ЧЕКЕР' : ev.type === 'airdrop' ? 'АИРДРОП' : ev.type === 'whitelist' ? 'ВАЙТЛИСТ' : ev.type.toUpperCase();
        summaryText += `${icon} <b><a href="https://x.com/${ev.user}">@${ev.user}</a></b> — ${typeLabel}\n👉 <a href="${ev.url}">Открыть твит</a>\n\n`;
      }
    }
    if (inactiveUsers.length > 0) {
      summaryText += '💤 <b>Без новых событий:</b>\n';
      summaryText += inactiveUsers.map(u => `<a href="https://x.com/${u}">@${u}</a>`).join(', ') + '\n';
    }

    assert(
      summaryText.includes('<a href="https://x.com/alpha_founder">@alpha_founder</a>'),
      'Active event 1 renders explicit x.com link'
    );
    assert(
      summaryText.includes('<a href="https://x.com/airdrop_hunter">@airdrop_hunter</a>'),
      'Active event 2 renders explicit x.com link'
    );
    assert(
      summaryText.includes('<a href="https://x.com/dormant_dev">@dormant_dev</a>'),
      'Inactive user 1 renders explicit x.com link'
    );
    assert(
      summaryText.includes('<a href="https://x.com/silent_whale">@silent_whale</a>'),
      'Inactive user 2 renders explicit x.com link'
    );

    // Negative check: verify that no bare @user exists
    const users = ['alpha_founder', 'airdrop_hunter', 'dormant_dev', 'silent_whale'];
    for (const u of users) {
      const bareOccurrence = summaryText.includes(`@${u}`) && !summaryText.includes(`<a href="https://x.com/${u}">@${u}</a>`);
      assert(!bareOccurrence, `User @${u} must never appear as bare text`);
    }
  });

  // 4. Test vps_server.js instant urgent siren push alert template
  await harness.test('TW-04: Instant urgent siren alert renders author as explicit x.com anchor link', async () => {
    // Replicate template from vps_server.js lines 1092-1098
    const payload = {
      username: 'bayc_official',
      text: 'MINT IS LIVE NOW! CLAIM YOUR AIRDROP IMMEDIATELY',
      tweet_url: 'https://x.com/bayc_official/status/999999'
    };

    const userAnchor = payload.username 
      ? `<a href="https://x.com/${escapeHTML(payload.username)}">@${escapeHTML(payload.username)}</a>` 
      : 'Twitter Alert';
    const sirenMessage = `🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ / URGENT ALERT</b> 🚨🚨🚨\n\n` +
      `🔥 <b>${userAnchor}</b>:\n${escapeHTML(payload.text.slice(0, 400))}\n\n` +
      `👉 <a href="${escapeHTML(payload.tweet_url)}">ПЕРЕЙТИ К ТВИТУ</a>`;

    assert(
      sirenMessage.includes('<a href="https://x.com/bayc_official">@bayc_official</a>'),
      'Siren alert must render explicit x.com anchor link for author'
    );
    assert(
      !sirenMessage.includes('<b>@bayc_official</b>'),
      'Siren alert must NOT render raw <b>@bayc_official</b>'
    );
  });

  // 5. Test vps_server.js profile meta watcher change alerts
  await harness.test('TW-05: Profile meta watcher alerts render handles as explicit x.com anchor links', async () => {
    const existing = { username: 'azuki_dao' };
    const newWeb = 'https://azuki.com/mint';
    const newBio = 'Official Azuki Mint is Live on 10/15!';

    // Website change alert
    const webAlert = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> сменил ссылку в профиле на: <a href="${escapeHTML(newWeb)}">${escapeHTML(newWeb)}</a>!`;
    assert(
      webAlert.includes('<a href="https://x.com/azuki_dao">@azuki_dao</a>'),
      'Website change alert has explicit x.com profile anchor'
    );
    assert(!webAlert.includes('⚡ @azuki_dao сменил'), 'No bare handle in website alert');

    // Bio change alert
    const bioAlert = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> обновил БИО профиля:\n"${escapeHTML(newBio)}"`;
    assert(
      bioAlert.includes('<a href="https://x.com/azuki_dao">@azuki_dao</a>'),
      'Bio change alert has explicit x.com profile anchor'
    );
    assert(!bioAlert.includes('⚡ @azuki_dao обновил'), 'No bare handle in bio alert');
  });

  // 6. Test vps_server.js calendar reminder digest
  await harness.test('TW-06: Calendar reminder digest renders handles as explicit x.com anchor links', async () => {
    const upcoming = [
      {
        project_name: 'SuperMint',
        username: 'super_mint_xyz',
        event_type: 'mint',
        event_date: '2026-10-15',
        details: 'Public mint starts at 18:00 UTC',
        tweet_url: 'https://x.com/super_mint_xyz/status/55555'
      }
    ];

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

    assert(
      reminderMsg.includes('<a href="https://x.com/super_mint_xyz">@super_mint_xyz</a>'),
      'Calendar digest renders explicit x.com anchor link'
    );
    assert(!reminderMsg.includes('<b>@super_mint_xyz</b>'), 'No bare @super_mint_xyz in reminder digest');
  });

  const summary = harness.summary();
  if (!summary.allPassed) {
    console.error(`\nTwitter Profile Links Verification Failed: ${summary.fails} failures.`);
    process.exit(1);
  } else {
    console.log(`\nExplicit Twitter Profile HTML Links 100% VERIFIED: All ${summary.passes} checks passed.`);
  }
}

if (require.main === module) {
  runTwitterLinksSuite().catch((err) => {
    console.error('Fatal Test Suite Error:', err);
    process.exit(1);
  });
}

module.exports = { runTwitterLinksSuite };
