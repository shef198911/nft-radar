import { Router } from 'itty-router';
import { parseTweet } from './parser.js';
import { calculateScore } from './scoring.js';
import { checkDuplicate, saveTweet, markSent } from './dedupe.js';
import { formatTelegramMessage } from './formatter.js';
import { sendTelegramMessage } from './telegram.js';

const router = Router();

router.get('/health', async (request, env) => {
  let dbStatus = 'ok';
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch (e) {
    dbStatus = 'error';
  }
  const tgStatus = (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) ? 'configured' : 'not_configured';
  return new Response(JSON.stringify({ status: 'ok', worker: 'ok', database: dbStatus, telegram: tgStatus }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.get('/stats', async (request, env) => {
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

router.post('/ingest', async (request, env) => {
  const url = new URL(request.url);
  const clientKey = request.headers.get('x-client-key') || url.searchParams.get('key');
  if (clientKey !== env.CLIENT_KEY) {
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
  
  if (!payload.tweet_url.includes('x.com/') && !payload.tweet_url.includes('twitter.com/')) {
    return new Response('Invalid tweet URL', { status: 400 });
  }
  
  if (payload.text.length > 50000) return new Response('Text too long', { status: 400 });
  
  const existing = await checkDuplicate(env.DB, payload.tweet_id);
  if (existing) {
    if (existing.sent_to_telegram === 0) {
       const scored = calculateScore(parseTweet(payload));
       const minScore = parseInt(env.MIN_TELEGRAM_SCORE || '50', 10);
       if (scored.score >= minScore) {
           const msg = formatTelegramMessage(scored);
           if (msg) {
              const tgRes = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
              if (tgRes.ok) await markSent(env.DB, payload.tweet_id, tgRes.message_id);
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
  if (scored.score >= minScore) {
    const message = formatTelegramMessage(scored);
    if (message) {
      const tgRes = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message);
      if (tgRes.ok) {
        await markSent(env.DB, scored.tweet_id, tgRes.message_id);
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
