import { Router } from 'itty-router';
import { parseTweet } from './parser.js';
import { calculateScore } from './scoring.js';
import { checkDuplicate, saveTweet, markSent } from './dedupe.js';
import { formatTelegramMessage } from './formatter.js';
import { sendTelegramMessage } from './telegram.js';

const router = Router();

router.get('/health', () => {
  return new Response(JSON.stringify({ status: 'ok', database: 'ok', telegram: 'ok' }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.get('/stats', async (request, env) => {
  try {
    const total = await env.DB.prepare("SELECT COUNT(*) as count FROM tweets").first();
    const today = await env.DB.prepare("SELECT COUNT(*) as count FROM tweets WHERE date(created_at) = date('now')").first();
    const sent = await env.DB.prepare("SELECT COUNT(*) as count FROM tweets WHERE sent_to_telegram = 1 AND date(created_at) = date('now')").first();
    
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
  const clientKey = request.headers.get('x-client-key');
  if (clientKey !== env.CLIENT_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }
  
  if (!payload.tweet_id || !payload.tweet_url || !payload.text) {
    return new Response('Missing required fields', { status: 400 });
  }
  
  // Dedupe check
  const isDuplicate = await checkDuplicate(env.DB, payload.tweet_id);
  if (isDuplicate) {
    return new Response(JSON.stringify({ status: 'duplicate' }), { 
      status: 409, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  // Parse
  const parsed = parseTweet(payload);
  
  // Score
  const scored = calculateScore(parsed);

  // Save to DB initially
  await saveTweet(env.DB, scored);

  // Send to Telegram if score >= MIN_TELEGRAM_SCORE (default 50)
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
    return router.handle(request, env, ctx);
  }
};
