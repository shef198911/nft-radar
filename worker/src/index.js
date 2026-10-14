import { Router } from 'itty-router';
import { parseTransaction } from './helius.js';
import { parseTweet } from './parser.js';
import { calculateScore } from './scoring.js';
import { checkDuplicate, saveTweet, markSent } from './dedupe.js';
import { formatTelegramMessage } from './formatter.js';
import { sendTelegramMessage } from './telegram.js';
import { passesQualityGate } from './quality-gate.js';
import { canSendOpportunity } from './opportunity-gate.js';
import { getProjectAlertStatus } from './project-dedupe.js';
import {
  buildDailySummary,
  formatDailySummaryMessage,
  getDailySummaryRecord,
  recordDailySummarySent
} from './daily-summary.js';
import {
  formatOpenSeaDropMessage,
  markOpenSeaDropSent,
  scanOpenSeaDrops,
  recordOpenSeaScanStatus,
  getOpenSeaScanStatus
} from './opensea.js';
import { runAIFilter } from './ai-classifier.js';

import { handleTelegramWebhook, checkPriceAlerts, checkCoinAlerts } from './telegram-grammy.js';

const router = Router();


router.post('/helius/webhook', async (request, env) => {
  try {
    const rawBody = await request.text();
    const res = await fetch('http://45.158.185.9:3000/helius/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody
    });
    return new Response(await res.text(), { status: res.status });
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});

router.post('/telegram/webhook', async (request, env) => {
  return await handleTelegramWebhook(request, env);
});

router.get('/telegram/setup', async (request, env) => {
  if (!isAuthorized(request, env)) return new Response('Unauthorized', { status: 401 });
  
  // Set webhook
  const hookUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=https://nft-radar.icoshef.workers.dev/telegram/webhook`;
  const hookRes = await fetch(hookUrl).then(r => r.json());
  
  // Set standard menu commands
  const cmdUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`;
  const cmdRes = await fetch(cmdUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start', description: '🏠 Главное меню' },
        { command: 'track', description: '➕ Добавить коллекцию' },
        { command: 'list', description: '📋 Мои подписки' }
      ]
    })
  }).then(r => r.json());

  return new Response(JSON.stringify({ webhook: hookRes, commands: cmdRes }), { headers: { 'Content-Type': 'application/json' } });
});

function getClientKey(request) {
  const url = new URL(request.url);
  return request.headers.get('x-client-key') || url.searchParams.get('key');
}

function isAuthorized(request, env) {
  return getClientKey(request) === env.CLIENT_KEY;
}

function validateTweetUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'x.com' && hostname !== 'twitter.com') return null;
    if (!/^\/[^/]+\/status\/\d+/.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString().replace('https://twitter.com/', 'https://x.com/');
  } catch (e) {
    return null;
  }
}

function isChannelTarget(target) {
  if (!target) return false;
  const chatId = String(target.chatId || target.chat_id || '');
  const name = String(target.name || '').toLowerCase();
  const type = String(target.type || '').toLowerCase();

  // Known Channel Chat IDs
  if (chatId === '-1004469660618' || chatId === '-1002446777618') return true;

  // Known Group or Admin Chat IDs
  if (chatId === '-1001270981759' || chatId === '-1002241604169' || chatId === '332680373') return false;

  // Group topics have a threadId; channels never have threadId
  if (target.threadId || target.thread_id) return false;

  // Explicit name or type checks
  if (name === 'channel' || type === 'channel') return true;
  if (name === 'group' || name === 'admin' || type === 'group' || type === 'supergroup') return false;

  return name.includes('channel');
}

function getTelegramTargets(env, isXList = false) {
  let targetsConfig = env.TELEGRAM_TARGETS_PRIVATE || env.TELEGRAM_TARGETS;
  if (typeof targetsConfig === 'string' && targetsConfig.trim() === '0') {
    targetsConfig = env.TELEGRAM_TARGETS;
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
              if (isXList) {
                threadId = 346298; // Special topic for X List
              } else {
                threadId = 346199; // Nft Radar X topic
              }
            } else if (chatId === '-1004469660618' || target.name === 'channel') {
              threadId = null;
            }
            return {
              name: target.name || (chatId === '-1004469660618' ? 'channel' : (chatId === '-1001270981759' ? 'group' : (chatId === '332680373' ? 'admin' : chatId))),
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

  if (env.TELEGRAM_CHAT_ID) {
    let threadId = env.TELEGRAM_THREAD_ID || null;
    if (threadId && isXList) threadId = 346298;
    return [{
      name: 'legacy',
      chatId: env.TELEGRAM_CHAT_ID,
      threadId
    }];
  }

  return [];
}

async function sendTelegramBroadcast(env, messages, replyMarkup, isXList = false) {
  const targets = getTelegramTargets(env, isXList);
  if (!env.TELEGRAM_BOT_TOKEN || targets.length === 0) {
    console.warn('Missing Telegram token or targets');
    return { ok: false, results: [] };
  }

  const results = [];
  for (const target of targets) {
    const isChannel = isChannelTarget(target);
    
    // Channel ALWAYS receives 100% English (messages.en)
    // Group and all topics/threads in the group ALWAYS receive 100% Russian (messages.ru)
    let messageBody = '';
    if (typeof messages === 'string') {
      if (isChannel && /[а-яА-ЯёЁ]/.test(messages)) {
        console.warn(`[BROADCAST] Suppressed Russian string message for English broadcast channel ${target.chatId}`);
        continue;
      }
      messageBody = messages;
    } else if (messages && typeof messages === 'object') {
      if (isChannel) {
        messageBody = messages.en || '';
      } else {
        messageBody = messages.ru || messages.en || '';
      }
    }

    if (!messageBody || !messageBody.trim()) {
      console.warn(`[BROADCAST] Empty message for target ${target.name} (${target.chatId}, isChannel: ${isChannel}), skipping`);
      continue;
    }

    let targetMarkup = null;
    if (replyMarkup && typeof replyMarkup === 'object') {
      if (replyMarkup.ru || replyMarkup.en) {
        targetMarkup = isChannel ? (replyMarkup.en || null) : (replyMarkup.ru || null);
      } else {
        targetMarkup = replyMarkup;
      }
    }

    const result = await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      target.chatId,
      messageBody,
      targetMarkup,
      isChannel ? null : target.threadId // Channel NEVER receives threadId
    );
    if (!result.ok) {
      console.error(`Telegram target failed: ${target.name} (${target.chatId})`, result.error || 'unknown_error');
    }
    results.push({ ...result, name: target.name });
  }

  return {
    ok: results.some((result) => result.ok),
    results
  };
}

function formatTelegramMessageIds(results) {
  return results
    .filter((result) => result.ok)
    .map((result) => `${result.name}:${result.message_id}`)
    .join(',');
}

function parseLimit(value, fallback = 25, max = 50) {
  const parsed = parseInt(value || '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function getProjectDedupeHours(env) {
  const parsed = parseInt(env.PROJECT_DEDUPE_HOURS || '48', 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 48;
  return Math.min(parsed, 168);
}

function getProjectMaxAuthors(env) {
  const parsed = parseInt(env.PROJECT_MAX_AUTHORS || '3', 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 3;
  return Math.min(parsed, 10);
}

async function shouldSendTelegram(db, env, scored) {
  if (scored.is_x_list) {
    if (scored.score < 5) return { ok: false, reason: 'ai_score_too_low' };
  } else {
    const minScore = parseInt(env.MIN_TELEGRAM_SCORE || '50', 10);
    if (scored.score < minScore) return { ok: false, reason: 'score' };
    if (!passesQualityGate(scored)) return { ok: false, reason: 'quality' };
    if (!canSendOpportunity(scored)) return { ok: false, reason: 'not_actionable' };
  }

  const projectAlertStatus = await getProjectAlertStatus(
    db,
    scored.project_key,
    scored.tweet_id,
    scored.username,
    getProjectDedupeHours(env),
    getProjectMaxAuthors(env),
    scored.is_x_list,
    scored.opportunity_type ? String(scored.opportunity_type).replace(/'/g, "''") : null
  );

  if (!projectAlertStatus?.ok) {
    return {
      ok: false,
      reason: projectAlertStatus?.reason || 'project_duplicate',
      duplicate: projectAlertStatus?.duplicate,
      author_count: projectAlertStatus?.author_count
    };
  }

  return { ok: true };
}

async function sendDailySummary(env, now = new Date(), options = {}) {
  const summary = await buildDailySummary(env.DB, now);
  const message = formatDailySummaryMessage(summary);

  if (options.dryRun) {
    return { ok: true, dry_run: true, summary, message };
  }

  if (!options.force) {
    const existing = await getDailySummaryRecord(env.DB, summary.summaryDate);
    if (existing) {
      return { ok: true, skipped: true, reason: 'already_sent', summary };
    }
  }

  if (summary.totalItems === 0) {
    await recordDailySummarySent(env.DB, summary.summaryDate, 'empty');
    return { ok: true, skipped: true, reason: 'empty', summary };
  }

  const tgRes = await sendTelegramBroadcast(env, message);
  if (tgRes.ok) {
    await recordDailySummarySent(env.DB, summary.summaryDate, formatTelegramMessageIds(tgRes.results));
  }

  return { ok: tgRes.ok, telegram: tgRes, summary };
}

async function runOpenSeaScan(env, options = {}) {
  const result = await scanOpenSeaDrops(env, options);
  if (!result.ok || options.dryRun) {
    if (!options.dryRun) {
      await recordOpenSeaScanStatus(env.DB, result, 0).catch(console.error);
    }
    return result;
  }

  const sent = [];
  for (const drop of result.sendable || []) {
    const message = formatOpenSeaDropMessage(drop);
    const replyMarkup = {
      inline_keyboard: [[{ text: 'Open OpenSea Drop', url: drop.opensea_url }]]
    };
    const tgRes = await sendTelegramBroadcast(env, message, replyMarkup);
    if (tgRes.ok) {
      const messageIds = formatTelegramMessageIds(tgRes.results);
      await markOpenSeaDropSent(env.DB, drop.slug, messageIds);
      sent.push({ slug: drop.slug, telegram_message_id: messageIds });
    }
  }

  if (!options.dryRun) {
    await recordOpenSeaScanStatus(env.DB, result, sent.length).catch(console.error);
  }
  return { ...result, sent_count: sent.length, sent };
}

router.get('/health', async (request, env) => {
  let dbStatus = 'ok';
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch (e) {
    dbStatus = 'error';
  }
  const targets = getTelegramTargets(env);
  const tgStatus = isAuthorized(request, env)
    ? ((env.TELEGRAM_BOT_TOKEN && targets.length > 0) ? 'configured' : 'not_configured')
    : 'hidden';
  return new Response(JSON.stringify({
    status: 'ok',
    worker: 'ok',
    database: dbStatus,
    telegram: tgStatus,
    telegram_targets: isAuthorized(request, env) ? targets.map((target) => target.name) : undefined
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.get('/stats', async (request, env) => {
  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const total = await env.DB.prepare("SELECT COUNT(*) as count FROM tweets").first();
    const today = await env.DB.prepare("SELECT COUNT(*) as count FROM tweets WHERE date(detected_at) = date('now')").first();
    const sent = await env.DB.prepare("SELECT COUNT(*) as count FROM tweets WHERE sent_to_telegram = 1 AND date(detected_at) = date('now')").first();
    
    return new Response(JSON.stringify({
      tweets_total: total ? total.count : 0,
      tweets_today: today ? today.count : 0,
      sent_today: sent ? sent.count : 0
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});

router.get('/daily-summary', async (request, env) => {
  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') !== '0';
  const force = url.searchParams.get('force') === '1';

  try {
    const result = await sendDailySummary(env, new Date(), { dryRun, force });
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});

router.get('/opensea/status', async (request, env) => {
  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const status = await getOpenSeaScanStatus(env.DB);
    return new Response(JSON.stringify(status), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

router.get('/opensea/scan', async (request, env) => {
  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') !== '0';

  try {
    const result = await runOpenSeaScan(env, { dryRun });
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
});

router.get('/sources', async (request, env) => {
  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));

  try {
    const { results } = await env.DB.prepare(`
      SELECT
        username,
        MAX(display_name) AS display_name,
        COUNT(*) AS tweet_count,
        SUM(CASE WHEN sent_to_telegram = 1 THEN 1 ELSE 0 END) AS sent_count,
        MAX(score) AS max_score,
        ROUND(AVG(score), 1) AS avg_score,
        MAX(follower_count) AS follower_count,
        MAX(detected_at) AS latest_detected
      FROM tweets
      WHERE username IS NOT NULL
        AND username != ''
        AND datetime(detected_at) >= datetime('now', '-21 days')
        AND (
          score >= 35
          OR sent_to_telegram = 1
          OR is_free = 1
          OR is_whitelist = 1
          OR is_allowlist = 1
          OR is_fcfs = 1
          OR is_gtd = 1
        )
        AND lower(username) NOT IN ('bankrbot')
        AND lower(username) NOT LIKE '%bot%'
      GROUP BY lower(username)
      HAVING sent_count >= 1
        OR tweet_count >= 2
        OR max_score >= 75
        OR follower_count >= 2000
      ORDER BY sent_count DESC, max_score DESC, tweet_count DESC, latest_detected DESC
      LIMIT ?
    `).bind(limit).all();

    const accounts = (results || []).map((row) => ({
      username: row.username,
      display_name: row.display_name,
      tweet_count: row.tweet_count,
      sent_count: row.sent_count,
      max_score: row.max_score,
      avg_score: row.avg_score,
      follower_count: row.follower_count,
      latest_detected: row.latest_detected
    }));

    return new Response(JSON.stringify({ accounts }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});

router.post('/ingest', async (request, env) => {
  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 102400) { 
     return new Response('Payload too large', { status: 400 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }
  
  if (!payload || typeof payload !== 'object') return new Response('Invalid format', { status: 400 });
  if (typeof payload.tweet_id !== 'string' || typeof payload.tweet_url !== 'string' || typeof payload.text !== 'string') {
    return new Response('Missing or invalid required fields', { status: 400 });
  }
  
  const safeTweetUrl = validateTweetUrl(payload.tweet_url);
  if (!safeTweetUrl) {
    return new Response('Invalid tweet URL', { status: 400 });
  }
  payload.tweet_url = safeTweetUrl;
  
  if (payload.text && typeof payload.text === 'string') {
    payload.text = payload.text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  }

  if (payload.text.length > 50000) return new Response('Text too long', { status: 400 });
  
  const existing = await checkDuplicate(env.DB, payload.tweet_id);
  if (existing) {
    if (payload.is_x_list) {
      return new Response(JSON.stringify({ status: 'duplicate_x_list_ignored' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }

    if (existing.sent_to_telegram === 0) {
       let scored = calculateScore(parseTweet(payload));
       scored.is_x_list = false; // it is not x_list if it reached here

         const sendDecision = await shouldSendTelegram(env.DB, env, scored);
         if (sendDecision.ok) {
             const messages = {
               ru: formatTelegramMessage(scored, 'ru'),
               en: formatTelegramMessage(scored, 'en')
             };
             if (messages.ru && messages.en) {
                const replyMarkup = {
                  ru: { inline_keyboard: [[{ text: '🚨 Открыть твит', url: payload.tweet_url }]] },
                  en: { inline_keyboard: [[{ text: '🚨 Open Tweet', url: payload.tweet_url }]] }
                };
                const tgRes = await sendTelegramBroadcast(env, messages, replyMarkup, !!payload.is_x_list);
                if (tgRes.ok) await markSent(env.DB, payload.tweet_id, formatTelegramMessageIds(tgRes.results));
             }
          }
       return new Response(JSON.stringify({ status: 'retry_attempted', send_decision: sendDecision.reason || 'sent' }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ status: 'duplicate' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const parsed = parseTweet(payload);
  let scored = calculateScore(parsed);
  scored.is_x_list = !!payload.is_x_list;

  if (payload.is_x_list) {
    const aiResult = await runAIFilter(payload.text, env);
    if (!aiResult) {
      console.warn("[AI] AI completely failed, falling back to standard scoring");
      const minScore = parseInt(env.MIN_TELEGRAM_SCORE || '50', 10);
      if (scored.score < minScore) {
        await saveTweet(env.DB, scored);
        return new Response(JSON.stringify({
          status: 'ok',
          score: scored.score,
          project_key: scored.project_key,
          send_decision: 'score_fallback'
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    } else if (!aiResult.relevant || aiResult.engagement_bait || aiResult.score < 3) {
      await saveTweet(env.DB, scored);
      return new Response(JSON.stringify({
        status: 'ok',
        score: scored.score,
        project_key: scored.project_key,
        send_decision: 'ai_rejected',
        ai_result: aiResult
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      scored.score = aiResult.score;
      scored.opportunity_type = aiResult.category;
    }
    if (aiResult && aiResult.translated_text) {
      scored.translated_text = aiResult.translated_text;
    }
  }

  await saveTweet(env.DB, scored);

  const sendDecision = await shouldSendTelegram(env.DB, env, scored);
  if (sendDecision.ok) {
    const messages = {
      ru: formatTelegramMessage(scored, 'ru'),
      en: formatTelegramMessage(scored, 'en')
    };
    if (messages.ru && messages.en) {
      const replyMarkup = {
        ru: { inline_keyboard: [[{ text: '🚨 Открыть твит', url: scored.tweet_url }]] },
        en: { inline_keyboard: [[{ text: '🚨 Open Tweet', url: scored.tweet_url }]] }
      };
      const tgRes = await sendTelegramBroadcast(env, messages, replyMarkup, !!payload.is_x_list);
      if (tgRes.ok) {
        await markSent(env.DB, scored.tweet_id, formatTelegramMessageIds(tgRes.results));
      }
    }
  }

  return new Response(JSON.stringify({
    status: 'ok',
    score: scored.score,
    project_key: scored.project_key,
    send_decision: sendDecision.reason || 'sent'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});


router.post('/evm/webhook', async (request, env, ctx) => {
  try {
    const body = await request.json();
    const { parseAlchemyWebhook } = await import('./alchemy.js');
    const messages = parseAlchemyWebhook(body);
    
    if (!messages || messages.length === 0) return new Response('OK');
    
    const stmt = env.DB.prepare('INSERT INTO evm_queue (hash, payload, created_at) VALUES (?, ?, ?)');
    const batch = messages.map(msg => stmt.bind(msg.hash, JSON.stringify(msg), Date.now()));
    await env.DB.batch(batch);
    
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil((async () => {
        await new Promise(r => setTimeout(r, 10000));
        await processEvmQueue(env);
      })());
    }
    
    return new Response('OK');
  } catch (e) {
    console.error(e);
    return new Response('OK');
  }
});


router.get('/debug', (req, env) => {
  return new Response(JSON.stringify({
    hasToken: !!env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    targets: env.TELEGRAM_TARGETS_PRIVATE,
    targetsOld: env.TELEGRAM_TARGETS
  }));
});

router.all('*', () => new Response('Not Found', { status: 404 }));


async function processEvmQueue(env) {
  try {
    const cutoff = Date.now() - 9000; // Give it 1 second buffer
    const { results } = await env.DB.prepare("UPDATE evm_queue SET status = 'processing' WHERE status = 'pending' AND created_at < ? RETURNING *").bind(cutoff).all();
    
    if (!results || results.length === 0) return;
    
    const byHash = {};
    for (const row of results) {
      try {
        const msg = JSON.parse(row.payload);
        if (!byHash[msg.hash]) byHash[msg.hash] = [];
        byHash[msg.hash].push(msg);
      } catch (e) {}
    }
    
    for (const hash in byHash) {
      const txMsgs = byHash[hash];
      
      const involved = new Set();
      for (const msg of txMsgs) {
        if (msg.from) involved.add(msg.from.toLowerCase());
        if (msg.to) involved.add(msg.to.toLowerCase());
      }
      
      const involvedArr = Array.from(involved);
      if (involvedArr.length === 0) continue;
      
      const placeholders = involvedArr.map(() => '?').join(',');
      const { results: wallets } = await env.DB.prepare(`SELECT w.chat_id, w.name, w.address, f.notify_transfer, f.notify_nft FROM evm_wallets w JOIN evm_filters f ON w.id = f.wallet_id WHERE LOWER(w.address) IN (${placeholders})`).bind(...involvedArr).all();
      
      if (!wallets || wallets.length === 0) continue;
      
      for (const w of wallets) {
        const myAddr = w.address.toLowerCase();
        let myMsgs = txMsgs.filter(m => (m.from && m.from.toLowerCase() === myAddr) || (m.to && m.to.toLowerCase() === myAddr));
        myMsgs = myMsgs.filter(m => (m.category === 'transfer' && w.notify_transfer) || (m.category === 'nft' && w.notify_nft));
        
        if (myMsgs.length === 0) continue;
        
        
const formatCrypto = (v) => { 
  const n = parseFloat(v); 
  if(isNaN(n) || n === 0) return v; 
  if(n < 1) return Number(n.toPrecision(4)).toString(); 
  if(n < 100) return Number(n.toPrecision(5)).toString(); 
  return Number(n.toFixed(2)).toString(); 
};
        const isMultiple = myMsgs.length > 1;
        const shorten = (a) => a ? `${a.slice(0, 4)}..${a.slice(-4)}` : 'Unknown';
        
        const net = myMsgs[0].network;
        let netIcon = '🔗';
        if (net === 'Polygon') netIcon = '<tg-emoji emoji-id="5397954355477377973">🟣</tg-emoji>';
        else if (net === 'Base' || net === 'Arbitrum' || net === 'Linea') netIcon = '🔵';
        else if (net === 'Optimism' || net === 'Avalanche' || net === 'Robinhood') netIcon = '🔴';
        else if (net === 'BSC') netIcon = '🟡';
        else if (net === 'Ethereum' || net === 'ETH') netIcon = '<tg-emoji emoji-id="5400219289301054663">🌐</tg-emoji>';
        let addressExplorer = `https://etherscan.io/address/${w.address}`;
        if (net === 'Arbitrum') addressExplorer = `https://arbiscan.io/address/${w.address}`;
        else if (net === 'Optimism') addressExplorer = `https://optimistic.etherscan.io/address/${w.address}`;
        else if (net === 'Polygon') addressExplorer = `https://polygonscan.com/address/${w.address}`;
        else if (net === 'Base') addressExplorer = `https://basescan.org/address/${w.address}`;
        else if (net === 'BSC') addressExplorer = `https://bscscan.com/address/${w.address}`;
        else if (net === 'Avalanche') addressExplorer = `https://snowtrace.io/address/${w.address}`;
        else if (net === 'Linea') addressExplorer = `https://lineascan.build/address/${w.address}`;
        else if (net === 'zkSync') addressExplorer = `https://explorer.zksync.io/address/${w.address}`;
        else if (net === 'Robinhood') addressExplorer = `https://robinhoodchain.blockscout.com/address/${w.address}`;
        else if (net === 'Scroll') addressExplorer = `https://scrollscan.com/address/${w.address}`;
        
        let formatted = `<a href="${addressExplorer}"><b>${w.name}</b></a> • ${netIcon} <b>${net.toUpperCase()}</b>
`;
if (isMultiple) {
          formatted += `\n🔄 <b>Swap</b>\n`;
          for (const msg of myMsgs) {
            const isReceived = msg.to && msg.to.toLowerCase() === myAddr;
            if (msg.category === 'transfer') {
              formatted += `${isReceived ? '📥 Получено:' : '📤 Отправлено:'} ${formatCrypto(msg.value)} ${msg.tokenUrl ? `<a href="${msg.tokenUrl}">${msg.asset}</a>` : msg.asset}\n`;
            } else {
              formatted += `${isReceived ? '🖼 Получен' : '🖼 Отправлен'} NFT ID ${msg.tokenId}\n`;
            }
          }
        } else {
          const msg = myMsgs[0];
          const isReceived = msg.to && msg.to.toLowerCase() === myAddr;
          const counterparty = isReceived ? shorten(msg.from) : shorten(msg.to);
          
          if (msg.category === 'transfer') {
            const icon = isReceived ? '🤑' : '💸';
            formatted += `\n${icon} ${isReceived ? 'Получено:' : 'Отправлено:'} ${formatCrypto(msg.value)} ${msg.tokenUrl ? `<a href="${msg.tokenUrl}">${msg.asset}</a>` : msg.asset} ${isReceived ? '📥 От:' : '📤 На:'} ${counterparty}\n`;
          } else {
            formatted += `\n🖼 ${isReceived ? 'Получен NFT:' : 'Отправлен NFT:'} ID ${msg.tokenId} ${isReceived ? '📥 От:' : '📤 На:'} ${counterparty}\n`;
          }
        }
        
        formatted += `\n<a href="${myMsgs[0].explorerUrl}">🔗 Tx hash</a>`;
        
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: w.chat_id, text: formatted, parse_mode: 'HTML', disable_web_page_preview: true })
        });
      }
    }
    
    // cleanup
    const ids = results.map(r => r.id);
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM evm_queue WHERE id IN (${ph})`).bind(...ids).run();
    }
  } catch(e) {
    console.error('processEvmQueue error', e);
  }
}

export default {

  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-client-key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response = await router.handle(request, env, ctx);
      if (!response) {
         response = new Response('Not Found', { status: 404 });
      }
      
      const newResponse = new Response(response.body, response);
      for (const [k, v] of Object.entries(corsHeaders)) {
        newResponse.headers.set(k, v);
      }
      return newResponse;
    } catch (e) {
      return new Response('Internal error: ' + e.message, { status: 500, headers: corsHeaders });
    }
  },

  async scheduled(controller, env, ctx) {
    const scheduledAt = controller?.scheduledTime ? new Date(controller.scheduledTime) : new Date();
    if (controller?.cron === '0 18 * * *') {
      ctx.waitUntil(Promise.all([
        runOpenSeaScan(env),
        sendDailySummary(env, scheduledAt),
        checkPriceAlerts(env),
        checkCoinAlerts(env)
      ]));
    } else {
      ctx.waitUntil(Promise.all([
        runOpenSeaScan(env),
        checkPriceAlerts(env),
        checkCoinAlerts(env)
      ]));
    }
  }
};
