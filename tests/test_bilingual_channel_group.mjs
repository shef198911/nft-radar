import assert from 'node:assert/strict';

let formatTelegramMessage;
try {
  ({ formatTelegramMessage } = await import('../worker/src/formatter.js'));
} catch (e) {
  ({ formatTelegramMessage } = await import('./src/formatter.js'));
}

console.log('--- TEST 1: formatTelegramMessage localization ---');

const dummyTweetEn = {
  priority: 'HIGH',
  is_x_list: false,
  category: 'nft',
  project_name: 'Test Project',
  display_name: 'Test Project Official',
  username: 'testproject',
  chain: 'Ethereum',
  is_free: 1,
  score: 85,
  text: 'Free mint is live now! Mint your pass at https://test.xyz',
  tweet_url: 'https://x.com/testproject/status/123456789',
  whitelist_form_url: 'https://premint.xyz/test',
  form_platform: 'premint'
};

const msgEn = formatTelegramMessage(dummyTweetEn, 'en');
console.log('msgEn:\n', msgEn);
assert.ok(msgEn.includes('NFT OPPORTUNITY'), 'Should have English header');
assert.ok(msgEn.includes('Project:</b> Test Project'), 'Should have English Project label');
assert.ok(msgEn.includes('Author:</b>'), 'Should have English Author label');
assert.ok(msgEn.includes('Tags:</b> Free Mint'), 'Should have English Tags label');
assert.ok(msgEn.includes('Form (Premint):</b>'), 'Should have English Form label');
assert.ok(msgEn.includes('Open Tweet</a>'), 'Should have English Open Tweet link');
assert.ok(!msgEn.includes('Форма (Premint)'), 'Should NOT have Russian Form label');
assert.ok(!msgEn.includes('Открыть твит'), 'Should NOT have Russian link');

const dummyTweetRu = {
  ...dummyTweetEn,
  text_ru: 'Бесплатный минт уже идет! Заберите пропуск на https://test.xyz',
  text_en: dummyTweetEn.text
};

const msgRu = formatTelegramMessage(dummyTweetRu, 'ru');
console.log('msgRu:\n', msgRu);
assert.ok(msgRu.includes('NFT ВОЗМОЖНОСТЬ'), 'Should have Russian header');
assert.ok(msgRu.includes('Проект:</b> Test Project'), 'Should have Russian Project label');
assert.ok(msgRu.includes('Автор:</b>'), 'Should have Russian Author label');
assert.ok(msgRu.includes('Теги:</b> Free Минт'), 'Should have Russian Tags label');
assert.ok(msgRu.includes('Форма (Premint):</b>'), 'Should have Russian Form label');
assert.ok(msgRu.includes('Открыть твит</a>'), 'Should have Russian Open Tweet link');
assert.ok(msgRu.includes('Бесплатный минт уже идет!'), 'Should include Russian text');

console.log('--- TEST 2: Russian source tweet formatted for EN channel ---');
const russianSourceTweet = {
  priority: 'HOT',
  is_x_list: true,
  category: 'airdrop',
  opportunity_type: 'airdrop',
  username: 'LeonardJ_24',
  text: 'ОБНОВЛЕНИЕ ПО ЭЙРДРОПУ JUMPER $JUMP',
  text_ru: 'ОБНОВЛЕНИЕ ПО ЭЙРДРОПУ JUMPER $JUMP',
  text_en: 'JUMPER $JUMP AIRDROP UPDATE',
  tweet_url: 'https://x.com/LeonardJ_24/status/2110307599044190219',
  score: 100
};

const msgChannel = formatTelegramMessage(russianSourceTweet, 'en');
console.log('msgChannel:\n', msgChannel);
assert.ok(msgChannel.includes('JUMPER $JUMP AIRDROP UPDATE'), 'Channel message MUST have English text');
assert.ok(!msgChannel.includes('ОБНОВЛЕНИЕ ПО ЭЙРДРОПУ'), 'Channel message MUST NOT contain Russian tweet text');
assert.ok(msgChannel.includes('Open Tweet</a>'), 'Channel link MUST be in English');

const msgGroup = formatTelegramMessage(russianSourceTweet, 'ru');
console.log('msgGroup:\n', msgGroup);
assert.ok(msgGroup.includes('ОБНОВЛЕНИЕ ПО ЭЙРДРОПУ'), 'Group message MUST have Russian tweet text');
assert.ok(msgGroup.includes('Открыть твит</a>'), 'Group link MUST be in Russian');

console.log('--- TEST 3: Target classification and topic routing ---');

function isChannelTarget(target) {
  if (!target) return false;
  const chatId = String(target.chatId || target.chat_id || '');
  const name = String(target.name || '').toLowerCase();
  const type = String(target.type || '').toLowerCase();

  if (chatId === '-1004469660618') return true;
  if (chatId === '-1001270981759' || chatId === '332680373') return false;
  if (target.threadId || target.thread_id) return false;
  if (name === 'channel' || type === 'channel') return true;
  if (name === 'group' || name === 'admin' || type === 'group' || type === 'supergroup') return false;
  return name.includes('channel');
}

function getTelegramTargets(env, isXList = false, isParserTarget = false, category = null) {
  if (isParserTarget) {
    return [{ name: 'admin', chatId: '332680373', threadId: null }];
  }
  let targetsConfig = env.TELEGRAM_TARGETS_PRIVATE || env.TELEGRAM_TARGETS;
  if (typeof targetsConfig === 'string' && targetsConfig.trim() === '0') {
    targetsConfig = env.TELEGRAM_TARGETS;
  }
  let categoryThreads = {};
  if (env.TELEGRAM_CATEGORY_THREADS) {
    try {
      categoryThreads = typeof env.TELEGRAM_CATEGORY_THREADS === 'string'
        ? JSON.parse(env.TELEGRAM_CATEGORY_THREADS)
        : env.TELEGRAM_CATEGORY_THREADS;
    } catch (e) {}
  }

  if (targetsConfig) {
    try {
      const targets = JSON.parse(targetsConfig);
      if (Array.isArray(targets)) {
        return targets
          .map((target) => {
            const chatId = String(target.chat_id || target.chatId || '');
            let threadId = target.thread_id || target.threadId || null;

            if (chatId === '-1001270981759' || target.name === 'group') {
              if (category && categoryThreads && categoryThreads[category.toLowerCase()]) {
                threadId = categoryThreads[category.toLowerCase()];
              } else if (isXList) {
                threadId = 346298; // X Radar Alpha topic
              } else {
                threadId = 346199; // Nft Radar X topic
              }
            } else if (chatId === '-1004469660618' || target.name === 'channel') {
              threadId = null;
            }

            return {
              name: target.name || target.chat_id || target.chatId || (chatId === '-1004469660618' ? 'channel' : 'group'),
              chatId,
              threadId
            };
          })
          .filter((target) => target.chatId);
      }
    } catch (e) {
      console.error('Invalid TELEGRAM_TARGETS:', e.message);
    }
  }

  return [];
}

const mockEnv = {
  TELEGRAM_TARGETS: JSON.stringify([
    { chatId: '-1001270981759', name: 'group', threadId: 346199 },
    { chatId: '-1004469660618', name: 'channel' }
  ]),
  TELEGRAM_CATEGORY_THREADS: JSON.stringify({
    nft: 555555
  })
};

// Test A: Normal NFT post (!isXList)
const targetsNormal = getTelegramTargets(mockEnv, false, false, null);
assert.equal(targetsNormal.length, 2);
const groupNormal = targetsNormal.find(t => t.name === 'group');
const channelNormal = targetsNormal.find(t => t.name === 'channel');
assert.equal(groupNormal.threadId, 346199, 'Group should get NFT Radar topic 346199');
assert.equal(channelNormal.threadId, null, 'Channel must NEVER have threadId');
assert.equal(isChannelTarget(groupNormal), false, 'Group must not be identified as channel');
assert.equal(isChannelTarget(channelNormal), true, 'Channel must be identified as channel');

// Test B: X-List post (isXList = true)
const targetsXList = getTelegramTargets(mockEnv, true, false, null);
const groupXList = targetsXList.find(t => t.name === 'group');
const channelXList = targetsXList.find(t => t.name === 'channel');
assert.equal(groupXList.threadId, 346298, 'Group should get X Radar Alpha topic 346298');
assert.equal(channelXList.threadId, null, 'Channel must NEVER have threadId');

// Test C: Category threads present
const targetsCat = getTelegramTargets(mockEnv, false, false, 'nft');
const groupCat = targetsCat.find(t => t.name === 'group');
const channelCat = targetsCat.find(t => t.name === 'channel');
assert.equal(groupCat.threadId, 555555, 'Group should get category topic 555555');
assert.equal(channelCat.threadId, null, 'Channel must STILL NEVER have threadId even with categoryThreads');

// Test D: TELEGRAM_TARGETS_PRIVATE = "0" fallback
const mockEnvZero = {
  TELEGRAM_TARGETS: mockEnv.TELEGRAM_TARGETS,
  TELEGRAM_TARGETS_PRIVATE: '0'
};
const targetsZero = getTelegramTargets(mockEnvZero, false, false, null);
assert.equal(targetsZero.length, 2, 'Should fallback from "0" to TELEGRAM_TARGETS');

console.log('--- TEST 4: Russian tweet with missing/null text_en MUST NOT leak Russian to channel ---');
const russianTweetNoEn = {
  priority: 'HOT',
  is_x_list: true,
  category: 'airdrop',
  opportunity_type: 'airdrop',
  username: 'LeonardJ_24',
  text: 'ОБНОВЛЕНИЕ ПО ЭЙРДРОПУ JUMPER $JUMP',
  text_ru: 'ОБНОВЛЕНИЕ ПО ЭЙРДРОПУ JUMPER $JUMP',
  text_en: null,
  tweet_url: 'https://x.com/LeonardJ_24/status/2110307599044190219',
  score: 100
};
const msgNoEn = formatTelegramMessage(russianTweetNoEn, 'en');
console.log('msgNoEn:\n', msgNoEn);
assert.ok(!/[а-яА-ЯёЁ]/.test(msgNoEn), 'Channel message MUST NOT contain any Cyrillic when text_en is null');
assert.ok(msgNoEn.includes('Open Tweet</a>'), 'Channel link MUST be in English');

console.log('--- TEST 5: Russian tweet with dirty text_en containing Cyrillic MUST be rejected ---');
const russianTweetDirtyEn = {
  ...russianTweetNoEn,
  text_en: 'JUMPER ОБНОВЛЕНИЕ update'
};
const msgDirtyEn = formatTelegramMessage(russianTweetDirtyEn, 'en');
assert.ok(!/[а-яА-ЯёЁ]/.test(msgDirtyEn), 'Channel message MUST reject dirty text_en with Cyrillic');

console.log('--- TEST 6: sendTelegramBroadcast simulation (strict EN channel, strict RU group) ---');
async function simulateBroadcast(env, messages, replyMarkup, isXList = false) {
  const targets = getTelegramTargets(env, isXList);
  const sent = [];
  for (const target of targets) {
    const isChannel = isChannelTarget(target);
    let messageBody = '';
    if (typeof messages === 'string') {
      if (isChannel && /[а-яА-ЯёЁ]/.test(messages)) continue;
      messageBody = messages;
    } else if (messages && typeof messages === 'object') {
      messageBody = isChannel ? (messages.en || '') : (messages.ru || messages.en || '');
    }
    if (!messageBody || !messageBody.trim()) continue;

    let targetMarkup = null;
    if (replyMarkup && typeof replyMarkup === 'object') {
      if (replyMarkup.ru || replyMarkup.en) {
        targetMarkup = isChannel ? (replyMarkup.en || null) : (replyMarkup.ru || null);
      } else {
        targetMarkup = replyMarkup;
      }
    }
    sent.push({
      chatId: target.chatId,
      name: target.name,
      isChannel,
      messageBody,
      targetMarkup,
      threadId: isChannel ? null : target.threadId
    });
  }
  return sent;
}

const mockMessages = {
  ru: '🇷🇺 РУССКАЯ ВЕРСИЯ ДЛЯ ГРУППЫ',
  en: '🇬🇧 ENGLISH VERSION FOR CHANNEL'
};
const mockMarkup = {
  ru: { inline_keyboard: [[{ text: 'Открыть твит', url: 'https://x.com' }]] },
  en: { inline_keyboard: [[{ text: 'Open Tweet', url: 'https://x.com' }]] }
};

const broadcastResults = await simulateBroadcast(mockEnv, mockMessages, mockMarkup, false);
assert.equal(broadcastResults.length, 2);

const groupSent = broadcastResults.find(r => r.name === 'group');
const channelSent = broadcastResults.find(r => r.name === 'channel');

assert.equal(groupSent.messageBody, mockMessages.ru, 'Group MUST receive Russian version');
assert.equal(groupSent.targetMarkup.inline_keyboard[0][0].text, 'Открыть твит', 'Group MUST receive Russian buttons');
assert.equal(groupSent.threadId, 346199, 'Group MUST receive topic threadId 346199');

assert.equal(channelSent.messageBody, mockMessages.en, 'Channel MUST receive English version');
assert.equal(channelSent.targetMarkup.inline_keyboard[0][0].text, 'Open Tweet', 'Channel MUST receive English buttons');
assert.equal(channelSent.threadId, null, 'Channel MUST NEVER receive threadId');

console.log('--- TEST 7: Russian plain string suppressed for channel ---');
const russianStringResults = await simulateBroadcast(mockEnv, 'ТОЛЬКО РУССКИЙ ТЕКСТ', null, false);
assert.equal(russianStringResults.length, 1, 'Only group should receive Russian plain string');
assert.equal(russianStringResults[0].name, 'group');

console.log('Target classification & routing tests passed successfully!');
console.log('ALL TESTS PASSED SUCCESSFULLY! 🎯');


