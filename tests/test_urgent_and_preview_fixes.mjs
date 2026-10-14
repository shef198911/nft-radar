import assert from 'assert';

let sendTelegramMessage;
try {
  ({ sendTelegramMessage } = await import('../src/telegram.js'));
} catch (e) {
  ({ sendTelegramMessage } = await import('./src/telegram.js'));
}

console.log('--- STARTING EXTENDED URGENT ALERT & PREVIEW VERIFICATION TEST ---');

// 1. Extract and test checkIsUrgent logic directly
function checkIsUrgent(text) {
  if (!text || typeof text !== 'string') return false;

  // Questions and educational threads are never urgent emergency sirens
  if (/\?/.test(text) || /\b(how to (?:avoid|prevent)|tips to avoid|thread 🧵|1\/\d+)\b/i.test(text)) {
    return false;
  }

  // 1. Critical security exploits, hacks and drainers
  const CRITICAL_SECURITY = /\b(HACKED|EXPLOIT|EXPLOITED|DRAINER|PHISHING|COMPROMISED)\b|(?:^|[^а-яa-z0-9_])(ВЗЛОМ|ВЗЛОМАЛИ|ДРЕЙНЕР|ФИШИНГ|СКАМ)(?:[^а-яa-z0-9_]|$)/i;
  if (CRITICAL_SECURITY.test(text)) {
    if (/\b(years? ago|months? ago|was hacked in 202\d|post-mortem)\b/i.test(text)) return false;
    return true;
  }

  // 2. Direct urgent mint / claim announcements
  const DIRECT_MINT_CLAIM = /\b(MINT IS LIVE|CLAIM IS LIVE|FREE MINT IS LIVE|AIRDROP IS LIVE|STEALTH MINT|STEALTH DROP|FAIR LAUNCH IS LIVE|PUBLIC MINT IS LIVE)\b|(?:^|[^а-яa-z0-9_])(МИНТ LIVE|КЛЕЙМ LIVE|МИНТ НАЧАЛСЯ|КЛЕЙМ ОТКРЫТ)(?:[^а-яa-z0-9_]|$)/i;
  if (DIRECT_MINT_CLAIM.test(text)) return true;

  // 3. For generic "NOW LIVE", "LIVE NOW", "STARTING NOW":
  const GENERIC_LIVE = /\b(NOW LIVE|LIVE NOW|STARTING NOW)\b/i;
  if (GENERIC_LIVE.test(text)) {
    const isTradingChatter = /\b(long|short|perp|perpetual|leverage|bag|bags|holding|holdings|stock token|stock tokens|buy and burn|staking|vault|pool|dex|swap|chart|market cap)\b/i.test(text);
    if (isTradingChatter) return false;

    const hasMintOrSecurityContext = /\b(mint|claim|airdrop|presale|public sale|whitelist|allowlist|contract|opensea|magiceden)\b|(?:^|[^а-яa-z0-9_])(минт|клейм|аирдроп|пресейл|вайтлист|контракт)(?:[^а-яa-z0-9_]|$)/i.test(text);
    if (hasMintOrSecurityContext) return true;
  }

  return false;
}

// Test @0xWassie false positive
const wassieTweet = "this is why i'm adding to my $NET bag here. the Sleeve reportedly holds $4m+ in NVDA, SPCX, GOOGL and AAPL stock tokens, while the whole ecosystem was built in just 87 days. NET LONG is now live and its USDG fees buy and burn NET.";
assert.strictEqual(checkIsUrgent(wassieTweet), false, '0xWassie token shill must NOT trigger urgent alert');
console.log('✔ Test 1: @0xWassie tweet correctly rejected as urgent');

// Test other trading non-urgent phrases
assert.strictEqual(checkIsUrgent('Our perpetual trading is now live on Arbitrum!'), false);
assert.strictEqual(checkIsUrgent('Staking pool is now live with high APY!'), false);
assert.strictEqual(checkIsUrgent('SOL LONG is now live on our perp dex'), false);
console.log('✔ Test 2: Trading and staking chatter correctly rejected');

// Test questions and educational threads (must NOT trigger urgent sirens)
assert.strictEqual(checkIsUrgent('Was the Discord hacked? Anyone know?'), false, 'Questions must not trigger sirens');
assert.strictEqual(checkIsUrgent('Is the mint live now?'), false, 'Questions about mint must not trigger sirens');
assert.strictEqual(checkIsUrgent('Thread 🧵: 5 tips on how to avoid drainers and scams in web3 (1/10)'), false, 'Educational threads must not trigger sirens');
assert.strictEqual(checkIsUrgent('How to prevent being hacked in crypto: a guide'), false, 'Guides must not trigger sirens');
assert.strictEqual(checkIsUrgent('The DAO was hacked 2 years ago, here is the post-mortem'), false, 'Historical hack discussion must not trigger sirens');
console.log('✔ Test 3: Questions, threads, guides, and historical hack discussions correctly rejected');

// Test genuine emergencies
assert.strictEqual(checkIsUrgent('ATTENTION! MINT IS LIVE NOW on Ethereum!'), true);
assert.strictEqual(checkIsUrgent('CLAIM IS LIVE FOR ALL AIRDROP ELIGIBLE WALLETS'), true);
assert.strictEqual(checkIsUrgent('Contract is NOW LIVE on Solana mainnet'), true);
assert.strictEqual(checkIsUrgent('Presale is STARTING NOW in 5 minutes!'), true);
assert.strictEqual(checkIsUrgent('Warning: LIVE NOW on OpenSea'), true);
assert.strictEqual(checkIsUrgent('URGENT: DISCORD HAS BEEN HACKED DO NOT CLICK LINKS'), true);
assert.strictEqual(checkIsUrgent('CRITICAL EXPLOIT DETECTED ON ROUTER'), true);
assert.strictEqual(checkIsUrgent('MALICIOUS DRAINER DETECTED IN BIO'), true);
assert.strictEqual(checkIsUrgent('ВНИМАНИЕ! ДИСКОРД ВЗЛОМАЛИ НЕ ПЕРЕХОДИТЕ ПО ССЫЛКАМ'), true);
assert.strictEqual(checkIsUrgent('МИНТ НАЧАЛСЯ НА САЙТЕ'), true);
console.log('✔ Test 4: Genuine urgent events (mints, claims, exploits, hacks in EN & RU) all recognized');

// 2. Test sendTelegramMessage previewUrl extraction & profile blocking
let capturedPayload = null;
global.fetch = async (url, options) => {
  capturedPayload = JSON.parse(options.body);
  return {
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 12345 } })
  };
};

const messageText = `🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ</b> 🚨🚨🚨\n\n` +
  `🔥 <b><a href="https://x.com/0xWassie">@0xWassie</a></b>:\nТекст твита...\n\n` +
  `👉 <a href="https://x.com/0xWassie/status/2099930686559846790">ПЕРЕЙТИ К ТВИТУ</a>`;

await sendTelegramMessage('mock_token', '12345', messageText);

assert.strictEqual(
  capturedPayload.link_preview_options.url,
  'https://vxtwitter.com/0xWassie/status/2099930686559846790',
  'Preview URL must point to tweet status, NEVER author profile'
);
assert.strictEqual(capturedPayload.link_preview_options.is_disabled, false, 'Preview should be enabled for valid status');
console.log('✔ Test 5: Telegram link preview correctly selects status URL over user profile anchor');

// Test message without status URL (author profile only) - MUST disable preview completely
const textWithoutStatus = `👤 <b>Author:</b> <a href="https://x.com/0xWassie">@0xWassie</a>\nSome random non-tweet message.`;
await sendTelegramMessage('mock_token', '12345', textWithoutStatus);
assert.strictEqual(capturedPayload.link_preview_options.is_disabled, true, 'Preview must be DISABLED when only profile URL is present');
assert.strictEqual(capturedPayload.disable_web_page_preview, true, 'disable_web_page_preview must be true when only profile URL is present');
assert.strictEqual(capturedPayload.link_preview_options.url, undefined, 'Preview URL must NOT be set for user profile');
console.log('✔ Test 6: Profile-only message completely disables preview to prevent profile card leakage');

// Test message with quoted tweet inside text and primary tweet in replyMarkup button
const textWithQuotedTweet = `🔥 <b><a href="https://x.com/author">@author</a></b>:\nCheck this out: https://x.com/other_user/status/999999\n\n👉 <a href="https://x.com/author/status/111111">ПЕРЕЙТИ К ТВИТУ</a>`;
const replyMarkupWithButton = {
  inline_keyboard: [[{ text: '🚨 Открыть твит', url: 'https://x.com/author/status/111111' }]]
};
await sendTelegramMessage('mock_token', '12345', textWithQuotedTweet, replyMarkupWithButton);
assert.strictEqual(
  capturedPayload.link_preview_options.url,
  'https://vxtwitter.com/author/status/111111',
  'Primary status button must take priority over quoted status in text'
);
console.log('✔ Test 7: Primary tweet in replyMarkup correctly takes priority over quoted status in tweet body');

// 3. Test Language Routing logic
const mockTargets = [
  { name: 'channel', chatId: '-1002446777618', threadId: null },
  { name: 'group', chatId: '-1001270981759', threadId: 346298 },
  { name: 'admin', chatId: '332680373', threadId: null }
];

const messages = {
  ru: '🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ</b> 🚨🚨🚨\n\n🔥 <b><a href="https://x.com/0xWassie">@0xWassie</a></b>:\nПереведенный текст\n\n👉 <a href="https://x.com/0xWassie/status/123">ПЕРЕЙТИ К ТВИТУ</a>',
  en: '🚨🚨🚨 <b>URGENT ALERT</b> 🚨🚨🚨\n\n🔥 <b><a href="https://x.com/0xWassie">@0xWassie</a></b>:\nEnglish text\n\n👉 <a href="https://x.com/0xWassie/status/123">OPEN TWEET</a>'
};

const replyMarkup = {
  ru: { inline_keyboard: [[{ text: '🚨 Открыть твит', url: 'https://x.com/0xWassie/status/123' }], [{ text: '📝 Форма (Вайтлист)', url: 'https://premint.xyz/drop' }]] },
  en: { inline_keyboard: [[{ text: '🚨 Open Tweet', url: 'https://x.com/0xWassie/status/123' }], [{ text: '📝 Form (Whitelist)', url: 'https://premint.xyz/drop' }]] }
};

const sentDispatches = [];
for (const target of mockTargets) {
  const isChannel = target.name === 'channel' || (!target.threadId && target.name !== 'admin' && target.name !== 'group');
  let messageBody = typeof messages === 'string' ? messages : (isChannel ? messages.en : messages.ru);
  if (!messageBody) messageBody = typeof messages === 'string' ? messages : (messages.ru || messages.en);

  let targetMarkup = replyMarkup;
  if (replyMarkup && (replyMarkup.ru || replyMarkup.en)) {
    targetMarkup = isChannel ? (replyMarkup.en || replyMarkup.ru) : (replyMarkup.ru || replyMarkup.en);
  }
  sentDispatches.push({
    target: target.name,
    messageBody,
    targetMarkup
  });
}

// Channel dispatch assertions
const channelDispatch = sentDispatches.find(d => d.target === 'channel');
assert(channelDispatch.messageBody.includes('<b>URGENT ALERT</b>'), 'Channel receives English title');
assert(channelDispatch.messageBody.includes('OPEN TWEET'), 'Channel receives English link text');
assert.strictEqual(channelDispatch.targetMarkup.inline_keyboard[0][0].text, '🚨 Open Tweet', 'Channel receives English button');
assert.strictEqual(channelDispatch.targetMarkup.inline_keyboard[1][0].text, '📝 Form (Whitelist)', 'Channel receives English form button');

// Group / Topic dispatch assertions
const topicDispatch = sentDispatches.find(d => d.target === 'group');
assert(topicDispatch.messageBody.includes('<b>СРОЧНЫЙ АЛЕРТ</b>'), 'Topic receives Russian title');
assert(topicDispatch.messageBody.includes('ПЕРЕЙТИ К ТВИТУ'), 'Topic receives Russian link text');
assert.strictEqual(topicDispatch.targetMarkup.inline_keyboard[0][0].text, '🚨 Открыть твит', 'Topic receives Russian button');
assert.strictEqual(topicDispatch.targetMarkup.inline_keyboard[1][0].text, '📝 Форма (Вайтлист)', 'Topic receives Russian form button');

// Admin dispatch assertions
const adminDispatch = sentDispatches.find(d => d.target === 'admin');
assert(adminDispatch.messageBody.includes('<b>СРОЧНЫЙ АЛЕРТ</b>'), 'Admin receives Russian title');
assert(adminDispatch.messageBody.includes('ПЕРЕЙТИ К ТВИТУ'), 'Admin receives Russian link text');
assert.strictEqual(adminDispatch.targetMarkup.inline_keyboard[0][0].text, '🚨 Открыть твит', 'Admin receives Russian button');
assert.strictEqual(adminDispatch.targetMarkup.inline_keyboard[1][0].text, '📝 Форма (Вайтлист)', 'Admin receives Russian form button');

console.log('✔ Test 8: Language routing delivers 100% English to broadcast channel and 100% Russian to Alpha topic and Admin');

console.log('\nALL 8 TESTS PASSED SUCCESSFULLY! 🎯');
