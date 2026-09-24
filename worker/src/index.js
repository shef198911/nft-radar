import { Router } from 'itty-router';
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

import { handleTelegramWebhook, checkPriceAlerts } from './telegram-grammy.js';

const router = Router();


router.post('/helius/webhook', async (request, env) => {
  try {
    let payloads = await request.json();
    if (!Array.isArray(payloads)) payloads = [payloads];

    for (const tx of payloads) {
      const sig = tx.signature;
      
      // Check cache
      const cached = await env.DB.prepare('SELECT signature FROM solana_tx_cache WHERE signature = ?').bind(sig).first();
      if (cached) continue;

      // Classify
      // First, get all tracked wallets
      const { results: wallets } = await env.DB.prepare('SELECT id, chat_id, address, name FROM solana_wallets').all();
      if (!wallets || wallets.length === 0) continue;

      let matchedWallet = null;
      for (const w of wallets) {
        if (
           tx.feePayer === w.address || 
           (tx.nativeTransfers && tx.nativeTransfers.some(t => t.toUserAccount === w.address || t.fromUserAccount === w.address)) ||
           (tx.tokenTransfers && tx.tokenTransfers.some(t => t.toUserAccount === w.address || t.fromUserAccount === w.address)) ||
           (tx.accountData && tx.accountData.some(a => a.account === w.address))
        ) {
          matchedWallet = w;
          break;
        }
      }

      if (!matchedWallet) {
        await env.DB.prepare('INSERT INTO solana_tx_cache (signature, created_at) VALUES (?, ?)').bind(sig, new Date().toISOString()).run();
        continue;
      }

      const parsed = parseTransaction(tx, matchedWallet.address);
      const filters = await env.DB.prepare('SELECT * FROM solana_filters WHERE wallet_id = ?').bind(matchedWallet.id).first();
      
      let shouldSend = false;
      if (filters) {
        if (parsed.category === 'swap' && filters.notify_swap) shouldSend = true;
        if (parsed.category === 'transfer' && filters.notify_transfer) shouldSend = true;
        if (parsed.category === 'nft' && filters.notify_nft) shouldSend = true;
        if (parsed.category === 'mint' && filters.notify_mint) shouldSend = true;
        if (parsed.category === 'stake' && filters.notify_stake) shouldSend = true;
        if (parsed.category === 'other' && filters.notify_other) shouldSend = true;
      } else {
        shouldSend = true; // default
      }

      if (shouldSend) {
        const msg = `👛 <b>${matchedWallet.name}</b>\n\n${parsed.formatted}`;
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: matchedWallet.chat_id,
            text: msg,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: [[{ text: "👛 Открыть кошелёк", url: `https://solscan.io/account/${matchedWallet.address}` }]] }
          })
        });
      }

      await env.DB.prepare('INSERT INTO solana_tx_cache (signature, created_at) VALUES (?, ?)').bind(sig, new Date().toISOString()).run();
    }
    return new Response('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('Error', { status: 500 });
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

function getTelegramTargets(env, isXList = false) {
  const targetsConfig = env.TELEGRAM_TARGETS_PRIVATE || env.TELEGRAM_TARGETS;
  if (targetsConfig) {
    try {
      const targets = JSON.parse(targetsConfig);
      if (Array.isArray(targets)) {
        return targets
          .map((target) => {
            const chatId = target.chat_id || target.chatId;
            let threadId = target.thread_id || target.threadId || null;
            if (threadId && isXList) {
              threadId = 346298; // Special topic for X List
            }
            return {
              name: target.name || target.chat_id || target.chatId || 'telegram',
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
    const isChannel = !target.threadId;
    let messageBody = typeof messages === 'string' ? messages : (isChannel ? messages.en : messages.ru);
    if (!messageBody) messageBody = typeof messages === 'string' ? messages : messages.ru;

    const result = await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      target.chatId,
      messageBody,
      replyMarkup,
      target.threadId
    );
    if (!result.ok) {
      console.error(`Telegram target failed: ${target.name}`, result.error || 'unknown_error');
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
                  inline_keyboard: [[{ text: 'Open Tweet', url: payload.tweet_url }]]
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
        inline_keyboard: [[{ text: 'Open Tweet', url: scored.tweet_url }]]
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

router.all('*', () => new Response('Not Found', { status: 404 }));

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
        checkPriceAlerts(env)
      ]));
    } else {
      ctx.waitUntil(Promise.all([
        runOpenSeaScan(env),
        checkPriceAlerts(env)
      ]));
    }
  }
};
