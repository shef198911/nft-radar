import { Router } from 'itty-router';
import { parseTweet } from './parser.js';
import { calculateScore } from './scoring.js';
import { checkDuplicate, saveTweet, markSent } from './dedupe.js';
import { formatTelegramMessage } from './formatter.js';
import { sendTelegramMessage } from './telegram.js';
import { passesQualityGate } from './quality-gate.js';

const router = Router();

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

function getTelegramTargets(env) {
  const targetsConfig = env.TELEGRAM_TARGETS_PRIVATE || env.TELEGRAM_TARGETS;
  if (targetsConfig) {
    try {
      const targets = JSON.parse(targetsConfig);
      if (Array.isArray(targets)) {
        return targets
          .map((target) => ({
            name: target.name || target.chat_id || target.chatId || 'telegram',
            chatId: target.chat_id || target.chatId,
            threadId: target.thread_id || target.threadId || null
          }))
          .filter((target) => target.chatId);
      }
    } catch (e) {
      console.error('Invalid TELEGRAM_TARGETS:', e.message);
    }
  }

  if (env.TELEGRAM_CHAT_ID) {
    return [{
      name: 'legacy',
      chatId: env.TELEGRAM_CHAT_ID,
      threadId: env.TELEGRAM_THREAD_ID || null
    }];
  }

  return [];
}

async function sendTelegramBroadcast(env, message, replyMarkup) {
  const targets = getTelegramTargets(env);
  if (!env.TELEGRAM_BOT_TOKEN || targets.length === 0) {
    console.warn('Missing Telegram token or targets');
    return { ok: false, results: [] };
  }

  const results = [];
  for (const target of targets) {
    const result = await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      target.chatId,
      message,
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
          chain IN ('Solana', 'Robinhood Chain', 'ARC')
          OR lower(text) LIKE '%solana%'
          OR lower(text) LIKE '% sol %'
          OR lower(text) LIKE '%robinhood%'
          OR lower(text) LIKE '%rh chain%'
          OR lower(text) LIKE '%arc chain%'
        )
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
  
  if (payload.text.length > 50000) return new Response('Text too long', { status: 400 });
  
  const existing = await checkDuplicate(env.DB, payload.tweet_id);
  if (existing) {
    if (existing.sent_to_telegram === 0) {
       const scored = calculateScore(parseTweet(payload));
       const minScore = parseInt(env.MIN_TELEGRAM_SCORE || '50', 10);
       if (scored.score >= minScore && passesQualityGate(scored)) {
           const msg = formatTelegramMessage(scored);
           if (msg) {
              const replyMarkup = {
                inline_keyboard: [[{ text: 'Open Tweet', url: payload.tweet_url }]]
              };
              const tgRes = await sendTelegramBroadcast(env, msg, replyMarkup);
              if (tgRes.ok) await markSent(env.DB, payload.tweet_id, formatTelegramMessageIds(tgRes.results));
           }
        }
       return new Response(JSON.stringify({ status: 'retry_attempted' }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ status: 'duplicate' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const parsed = parseTweet(payload);
  const scored = calculateScore(parsed);

  await saveTweet(env.DB, scored);

  const minScore = parseInt(env.MIN_TELEGRAM_SCORE || '50', 10);
  if (scored.score >= minScore && passesQualityGate(scored)) {
    const message = formatTelegramMessage(scored);
    if (message) {
      const replyMarkup = {
        inline_keyboard: [[{ text: 'Open Tweet', url: scored.tweet_url }]]
      };
      const tgRes = await sendTelegramBroadcast(env, message, replyMarkup);
      if (tgRes.ok) {
        await markSent(env.DB, scored.tweet_id, formatTelegramMessageIds(tgRes.results));
      }
    }
  }

  return new Response(JSON.stringify({ status: 'ok', score: scored.score }), {
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
  }
};
