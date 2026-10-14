import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import cron from 'node-cron';
import Database from 'better-sqlite3';

// Import our original logic


import { startTelegramBot, handleTelegramWebhook, checkPriceAlerts, checkCoinAlerts } from './src/telegram-grammy.js';

import { parseTweet } from './src/parser.js';
import { calculateScore } from './src/scoring.js';
import { checkDuplicate, saveTweet, markSent } from './src/dedupe.js';
import { formatTelegramMessage } from './src/formatter.js';
import { sendTelegramMessage } from './src/telegram.js';
import { passesQualityGate } from './src/quality-gate.js';
import { canSendOpportunity } from './src/opportunity-gate.js';
import { getProjectAlertStatus } from './src/project-dedupe.js';

import { runAIFilter } from './src/ai-classifier.js';

import { parseTransaction } from './src/helius.js';
import { searchBinance } from './src/binance.js';
import { searchGeckoTerminal } from './src/geckoterminal.js';

import {
  buildDailySummary,
  formatDailySummaryMessage,
  getDailySummaryRecord,
  recordDailySummarySent
} from './src/daily-summary.js';

import {
  formatOpenSeaDropMessage,
  markOpenSeaDropSent,
  scanOpenSeaDrops,
  recordOpenSeaScanStatus,
  getOpenSeaScanStatus
} from './src/opensea.js';




// Setup Express
const app = express();
app.use(cors());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = fs.existsSync('/root/nft-radar/public') ? '/root/nft-radar/public' : path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
 // We will map it in upload
app.use(express.json({ limit: '50mb' }));


// Polyfills for Cloudflare Worker DB
const db = new Database('./bot.db');
db.pragma('journal_mode = WAL');

try {
  db.prepare('ALTER TABLE tweets ADD COLUMN reported_in_summary INTEGER DEFAULT 0').run();
  console.log('Added reported_in_summary column to tweets table');
} catch (e) {
  // Column likely already exists, ignore
}

try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_chat_id TEXT,
      project_name TEXT,
      username TEXT,
      event_type TEXT,
      event_date TEXT,
      details TEXT,
      tweet_url TEXT,
      track_profile INTEGER DEFAULT 0,
      tracking_expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  console.log('Ensured calendar_events table exists');
} catch (e) {
  console.error('calendar_events table init error:', e);
}

try { db.prepare('ALTER TABLE calendar_events ADD COLUMN owner_chat_id TEXT').run(); } catch (e) {}
try { db.prepare('ALTER TABLE calendar_events ADD COLUMN track_profile INTEGER DEFAULT 0').run(); } catch (e) {}
try { db.prepare('ALTER TABLE calendar_events ADD COLUMN tracking_expires_at TEXT').run(); } catch (e) {}
try { db.prepare("UPDATE calendar_events SET owner_chat_id = '332680373' WHERE owner_chat_id IS NULL").run(); } catch (e) {}

try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      category TEXT DEFAULT 'nft',
      tracking_expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_user_targets_chat ON user_targets(chat_id, is_active)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_user_targets_user ON user_targets(username, is_active)').run();
  console.log('Ensured user_targets table exists');
} catch (e) {
  console.error('user_targets table init error:', e);
}

const RESERVED_TWITTER_PATHS = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'intent', 'privacy', 'tos', 'about']);

function extractTwitterUsername(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  const urlMatch = s.match(/^(?:https?:\/\/)?(?:[a-zA-Z0-9_\-]+\.)?(?:twitter|x)\.com\/(?:#!\/)?(?:@)?([a-zA-Z0-9_]{1,30})/i);
  if (urlMatch) {
    const u = urlMatch[1].toLowerCase();
    return RESERVED_TWITTER_PATHS.has(u) ? null : u;
  }
  try {
    if (s.startsWith('http://') || s.startsWith('https://')) {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length > 0) s = parts[0];
    }
  } catch (e) {}
  s = s.replace(/^@+/, '').split(/[\/\?#\s]/)[0].trim();
  s = s.replace(/[^a-zA-Z0-9_]/g, '');
  if (!s || s.length > 30) return null;
  const res = s.toLowerCase();
  return RESERVED_TWITTER_PATHS.has(res) ? null : res;
}

async function autoCleanupExpiredCalendarTracking(env) {
  try {
    await env.DB.prepare(`
      UPDATE calendar_events 
      SET track_profile = 0 
      WHERE track_profile = 1 
      AND (
        (tracking_expires_at IS NOT NULL AND datetime(tracking_expires_at) <= datetime('now'))
        OR (tracking_expires_at IS NULL AND event_date IS NOT NULL AND datetime(event_date) <= datetime('now'))
      )
    `).run();
  } catch (e) {
    console.error('[CALENDAR] Auto-cleanup error:', e);
  }
  try {
    await env.DB.prepare(`
      UPDATE user_targets 
      SET is_active = 0 
      WHERE is_active = 1 
      AND tracking_expires_at IS NOT NULL 
      AND datetime(tracking_expires_at) <= datetime('now')
    `).run();
  } catch (e) {
    console.error('[USER_TARGETS] Auto-cleanup error:', e);
  }
}

async function getUserTrackedProfiles(env, chatId) {
  await autoCleanupExpiredCalendarTracking(env);
  const adminChatId = env.ADMIN_CHAT_ID || '332680373';
  const effectiveChatId = String(chatId || adminChatId);
  const isAdmin = (effectiveChatId === String(adminChatId) || effectiveChatId === '332680373');

  let calRows = [];
  try {
    const res = await env.DB.prepare(`
      SELECT id, username, project_name, event_type, tracking_expires_at, created_at, 'calendar' as source
      FROM calendar_events 
      WHERE (owner_chat_id = ? OR (owner_chat_id IS NULL AND ? = '332680373'))
      AND track_profile = 1 
      AND username IS NOT NULL 
      AND (
        (tracking_expires_at IS NOT NULL AND datetime(tracking_expires_at) > datetime('now'))
        OR (tracking_expires_at IS NULL AND (event_date IS NULL OR datetime(event_date) > datetime('now')))
      )
      ORDER BY datetime(created_at) DESC
    `).bind(effectiveChatId, effectiveChatId).all();
    calRows = res.results || [];
  } catch (e) {
    console.error('[GET_USER_TARGETS] Error querying calendar_events:', e);
  }

  let userRows = [];
  try {
    const res = await env.DB.prepare(`
      SELECT id, username, display_name as project_name, category as event_type, tracking_expires_at, created_at, 'custom' as source
      FROM user_targets
      WHERE chat_id = ?
      AND is_active = 1
      AND username IS NOT NULL 
      AND (tracking_expires_at IS NULL OR datetime(tracking_expires_at) > datetime('now'))
      ORDER BY datetime(created_at) DESC
    `).bind(effectiveChatId).all();
    userRows = res.results || [];
  } catch (e) {
    console.error('[GET_USER_TARGETS] Error querying user_targets:', e);
  }

  let adminXRows = [];
  if (isAdmin) {
    try {
      const res = await env.DB.prepare(`
        SELECT id, username, display_name as project_name, category as event_type, NULL as tracking_expires_at, created_at, 'admin' as source
        FROM x_list
        WHERE is_active = 1
        AND username IS NOT NULL
        ORDER BY datetime(created_at) DESC
      `).all();
      adminXRows = res.results || [];
    } catch (e) {
      console.error('[GET_USER_TARGETS] Error querying x_list for admin:', e);
    }
  }

  const profileMap = new Map();

  function mergeEntry(r, source) {
    const raw = r.username || (r.project_name && r.project_name.startsWith('@') ? r.project_name : null);
    const clean = extractTwitterUsername(raw);
    if (!clean) return;
    const existing = profileMap.get(clean);
    if (!existing) {
      profileMap.set(clean, {
        id: r.id,
        username: clean,
        formatted_username: `@${clean}`,
        profile_url: `https://x.com/${clean}`,
        display_name: r.project_name || clean,
        category: r.event_type || 'nft',
        tracking_expires_at: r.tracking_expires_at || null,
        created_at: r.created_at,
        source: source,
        calendar_event_id: source === 'calendar' ? r.id : null,
        user_target_id: source === 'custom' ? r.id : null,
        x_list_id: source === 'admin' ? r.id : null
      });
    } else {
      if (source === 'calendar') {
        existing.source = 'calendar';
        existing.calendar_event_id = r.id;
        if (r.project_name) existing.display_name = r.project_name;
      } else if (source === 'admin') {
        existing.x_list_id = r.id;
        if (!existing.source || existing.source === 'custom') {
          existing.source = 'admin';
        }
      } else {
        existing.user_target_id = r.id;
      }
      if (r.tracking_expires_at) {
        if (!existing.tracking_expires_at || new Date(r.tracking_expires_at) > new Date(existing.tracking_expires_at)) {
          existing.tracking_expires_at = r.tracking_expires_at;
        }
      }
    }
  }

  for (const r of adminXRows) {
    mergeEntry(r, 'admin');
  }
  for (const r of userRows) {
    mergeEntry(r, 'custom');
  }
  for (const r of calRows) {
    mergeEntry(r, 'calendar');
  }

  return Array.from(profileMap.values());
}

try { db.prepare('ALTER TABLE x_list ADD COLUMN bio TEXT').run(); } catch (e) {}
try { db.prepare('ALTER TABLE x_list ADD COLUMN website_url TEXT').run(); } catch (e) {}
try { db.prepare('ALTER TABLE x_list ADD COLUMN updated_at TEXT').run(); } catch (e) {}
try { db.prepare("ALTER TABLE x_list ADD COLUMN category TEXT DEFAULT 'nft'").run(); } catch (e) {}

try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS evm_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT,
      payload TEXT,
      created_at INTEGER,
      status TEXT DEFAULT 'pending'
    )
  `).run();
} catch (e) {}

// Simple Cloudflare D1 adapter
let global_env = null;
const env = {
  DB: {
    prepare: (query) => {
      function createBound(binds = []) {
        return {
          query,
          binds,
          bind: (...args) => createBound(args),
          first: async (...args) => {
            const b = args.length > 0 ? args : binds;
            return db.prepare(query).get(...b);
          },
          all: async (...args) => {
            const b = args.length > 0 ? args : binds;
            return { results: db.prepare(query).all(...b) };
          },
          run: async (...args) => {
            const b = args.length > 0 ? args : binds;
            return { success: true, meta: db.prepare(query).run(...b) };
          }
        };
      }
      return createBound([]);
    },
    batch: async (statements) => {
      const tx = db.transaction((stmts) => {
        for (const s of stmts) {
          if (s && s.query && s.binds) {
            db.prepare(s.query).run(...s.binds);
          } else if (s && typeof s.run === 'function') {
            s.run();
          }
        }
      });
      return tx(statements);
    }
  },
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  TELEGRAM_TARGETS: process.env.TELEGRAM_TARGETS,
  TELEGRAM_TARGETS_PRIVATE: process.env.TELEGRAM_TARGETS_PRIVATE,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY,
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  ALCHEMY_AUTH_TOKEN: process.env.ALCHEMY_AUTH_TOKEN || '',
  CLIENT_KEY: process.env.CLIENT_KEY || 'radar_secret_key_123',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  MIN_TELEGRAM_SCORE: process.env.MIN_TELEGRAM_SCORE || '50',
};
global_env = env;

// Mount Webhooks
app.post('/telegram/webhook', async (req, res) => {
  // We need to pass a mocked 'request' object to GramJS
  try {
    const fakeRequest = {
      method: 'POST',
      headers: new Headers(req.headers),
      json: async () => req.body,
    };
    await handleTelegramWebhook(fakeRequest, env);
    res.send('OK');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error');
  }
});


// --- HELPERS FROM WORKER ---
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getClientKey(req) { return req.headers['x-client-key'] || req.query.key; }

function isAuthorized(req, env) {
  return getClientKey(req) === env.CLIENT_KEY;
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

function extractAIText(data) {
  if (!data) return '';
  if (typeof data.response === 'string') return data.response.trim();
  if (data.response && typeof data.response === 'object') {
    if (data.response.translation) return String(data.response.translation).trim();
    if (data.response.text) return String(data.response.text).trim();
    if (data.response.content) return String(data.response.content).trim();
  }
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    const content = String(data.choices[0].message.content).trim();
    try {
      const parsed = JSON.parse(content);
      if (parsed.translation) return String(parsed.translation).trim();
      if (parsed.text) return String(parsed.text).trim();
    } catch (_) {}
    return content;
  }
  if (data.result?.response) {
    return String(data.result.response).trim();
  }
  return '';
}

async function translateChunkMyMemory(text, from, to) {
  if (!text || !text.trim()) return '';
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= 450) {
      chunks.push(remaining);
      break;
    }
    let idx = remaining.lastIndexOf('\n', 450);
    if (idx === -1) idx = remaining.lastIndexOf('. ', 450);
    if (idx === -1) idx = remaining.lastIndexOf(' ', 450);
    if (idx === -1) idx = 450;
    chunks.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).trim();
  }
  const translated = [];
  for (const chunk of chunks) {
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${from}|${to}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const trans = data?.responseData?.translatedText;
        if (trans && typeof trans === 'string' && trans.trim()) {
          translated.push(trans.trim());
          continue;
        }
      }
    } catch (_) {}
    translated.push(chunk);
  }
  return translated.join('\n');
}

async function translateToRussian(text) {
  if (!text || typeof text !== 'string') return '';
  if (!/[a-zA-Z]/.test(text) && /[а-яА-ЯёЁ]/.test(text)) return text; // Already pure Russian

  // 1. Cloudflare AI proxy
  try {
    const res = await fetch("https://cloudflare-ai-proxy.icoshef.workers.dev/?key=radar_secret_key_123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Translate this crypto tweet to Russian accurately. Keep all cashtags ($XYZ), handles (@user), links, and numbers intact. Output ONLY the Russian translation without any conversational prefixes or quotes:\n\n${text.slice(0, 1500)}`,
        model: "@cf/meta/llama-3.2-3b-instruct"
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      let aiText = extractAIText(data);
      if (aiText) {
        aiText = aiText.replace(/^["'`]|["'`]$/g, '').trim();
        if (/[а-яА-ЯёЁ]/.test(aiText)) return aiText;
      }
    }
  } catch (e) {
    console.warn('[TRANSLATE-RU] Cloudflare AI fallback failed:', e.message);
  }

  // 2. Chunked MyMemory API
  try {
    const memRu = await translateChunkMyMemory(text, 'en', 'ru');
    if (memRu && /[а-яА-ЯёЁ]/.test(memRu)) return memRu;
  } catch (e) {
    console.warn('[TRANSLATE-RU] MyMemory fallback failed:', e.message);
  }

  return text;
}

async function translateToEnglish(text) {
  if (!text || typeof text !== 'string') return '';
  if (!/[а-яА-ЯёЁ]/.test(text)) return text; // Already English or non-Cyrillic

  // 1. Cloudflare AI proxy
  try {
    const res = await fetch("https://cloudflare-ai-proxy.icoshef.workers.dev/?key=radar_secret_key_123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Translate this crypto tweet to English accurately. Keep all cashtags ($XYZ), handles (@user), links, and numbers intact. Output ONLY the English translation without any conversational prefixes or quotes:\n\n${text.slice(0, 1500)}`,
        model: "@cf/meta/llama-3.2-3b-instruct"
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      let aiText = extractAIText(data);
      if (aiText) {
        aiText = aiText.replace(/^["'`]|["'`]$/g, '').trim();
        if (aiText && !/[а-яА-ЯёЁ]/.test(aiText)) {
          return aiText;
        }
      }
    }
  } catch (e) {
    console.warn('[TRANSLATE-EN] Cloudflare AI failed:', e.message);
  }

  // 2. Chunked MyMemory API
  try {
    const memEn = await translateChunkMyMemory(text, 'ru', 'en');
    if (memEn && !/[а-яА-ЯёЁ]/.test(memEn)) return memEn;
  } catch (e) {
    console.warn('[TRANSLATE-EN] MyMemory fallback failed:', e.message);
  }

  // Never return raw Russian text when English was requested!
  return '';
}

async function ensureBilingualTexts(scored, rawText, rawTranslatedText) {
  const text = (rawText || '').trim();
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(text);

  let textEn = '';
  let textRu = '';

  if (hasCyrillic) {
    textRu = text;
    textEn = await translateToEnglish(text);
  } else {
    textEn = text;
    if (rawTranslatedText && typeof rawTranslatedText === 'string' && /[а-яА-ЯёЁ]/.test(rawTranslatedText.trim())) {
      textRu = rawTranslatedText.trim();
    } else {
      textRu = await translateToRussian(text);
    }
  }

  // Strict guarantee: text_en MUST NOT contain Cyrillic text
  scored.text_en = (!textEn || /[а-яА-ЯёЁ]/.test(textEn)) ? '' : textEn;
  scored.text_ru = textRu || text;
  scored.translated_text = scored.text_ru;

  return { textEn: scored.text_en, textRu: scored.text_ru };
}


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
  // Stricter filtering: require explicit mint/claim/airdrop/contract context,
  // and reject token/trading/financial chatter (perps, bags, stock tokens, buy and burn, etc.)
  const GENERIC_LIVE = /\b(NOW LIVE|LIVE NOW|STARTING NOW)\b/i;
  if (GENERIC_LIVE.test(text)) {
    const isTradingChatter = /\b(long|short|perp|perpetual|leverage|bag|bags|holding|holdings|stock token|stock tokens|buy and burn|staking|vault|pool|dex|swap|chart|market cap)\b/i.test(text);
    if (isTradingChatter) return false;

    const hasMintOrSecurityContext = /\b(mint|claim|airdrop|presale|public sale|whitelist|allowlist|contract|opensea|magiceden)\b|(?:^|[^а-яa-z0-9_])(минт|клейм|аирдроп|пресейл|вайтлист|контракт)(?:[^а-яa-z0-9_]|$)/i.test(text);
    if (hasMintOrSecurityContext) return true;
  }

  return false;
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

            // Topic routing applies ONLY to group chats (e.g. -1001270981759), NEVER to the channel!
            if (chatId === '-1001270981759' || target.name === 'group') {
              if (category && categoryThreads && categoryThreads[category.toLowerCase()]) {
                threadId = categoryThreads[category.toLowerCase()];
              } else if (isXList) {
                threadId = 346298; // X Radar Alpha topic
              } else {
                threadId = 346199; // Nft Radar X topic
              }
            } else if (chatId === '-1004469660618' || target.name === 'channel') {
              // Channels NEVER have topics/threads in Telegram
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
    if (category && categoryThreads && categoryThreads[category.toLowerCase()]) {
      threadId = categoryThreads[category.toLowerCase()];
    } else if (threadId && isXList) {
      threadId = 346298;
    }
    return [{
      name: 'legacy',
      chatId: env.TELEGRAM_CHAT_ID,
      threadId
    }];
  }

  return [];
}

async function sendTelegramBroadcast(env, messages, replyMarkup, isXList = false, isParserTarget = false, category = null) {
  const targets = getTelegramTargets(env, isXList, isParserTarget, category);
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

async function handleProfileMetaUpdate(env, profileMeta) {
  if (!profileMeta || !profileMeta.username) {
    return { success: false, changed: false };
  }
  const username = String(profileMeta.username).replace(/^@/, '').toLowerCase().trim();
  if (!username) return { success: false, changed: false };

  const newBio = typeof profileMeta.bio === 'string' ? profileMeta.bio.trim() : null;
  const newWeb = typeof profileMeta.website_url === 'string' ? profileMeta.website_url.trim() : null;

  const existing = await env.DB.prepare('SELECT id, username, bio, website_url FROM x_list WHERE lower(username) = ?')
    .bind(username).first();

  if (existing) {
    const oldWeb = (existing.website_url || '').trim();
    const oldBio = (existing.bio || '').trim();

    const webChanged = !!(newWeb && oldWeb && newWeb !== oldWeb);
    const bioChanged = !!(newBio && oldBio && newBio !== oldBio);
    const bioHasMintAlert = bioChanged && /\b(mint|live|claim|tge|airdrop|whitelist|premint)\b/i.test(newBio);
    if (webChanged || bioHasMintAlert) {
      let alertMsgRu = '';
      let alertMsgEn = '';
      if (webChanged) {
        alertMsgRu = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> сменил ссылку в профиле на: <a href="${escapeHTML(newWeb)}">${escapeHTML(newWeb)}</a>!`;
        alertMsgEn = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> updated bio link to: <a href="${escapeHTML(newWeb)}">${escapeHTML(newWeb)}</a>!`;
      } else {
        alertMsgRu = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> обновил БИО профиля:\n"${escapeHTML(newBio)}"`;
        alertMsgEn = `⚡ <a href="https://x.com/${escapeHTML(existing.username)}">@${escapeHTML(existing.username)}</a> updated bio:\n"${escapeHTML(newBio)}"`;
      }
      try {
        await sendTelegramBroadcast(env, { ru: alertMsgRu, en: alertMsgEn }, null, false, false);
      } catch (e) {
        console.error('[PROFILE WATCHER] Alert send error:', e);
      }

      // Also deliver direct alert to any users tracking this profile in calendar_events or user_targets
      try {
        const calTrackers = await env.DB.prepare(`
          SELECT DISTINCT owner_chat_id as chat_id
          FROM calendar_events 
          WHERE (lower(username) = ? OR lower(username) = ? OR replace(lower(username), '@', '') = ?) 
          AND track_profile = 1 
          AND (
            (tracking_expires_at IS NOT NULL AND datetime(tracking_expires_at) > datetime('now'))
            OR (tracking_expires_at IS NULL AND (event_date IS NULL OR datetime(event_date) > datetime('now')))
          )
        `).bind(username, '@' + username, username).all();

        const userTrackers = await env.DB.prepare(`
          SELECT DISTINCT chat_id 
          FROM user_targets 
          WHERE lower(username) = ? 
          AND is_active = 1 
          AND (tracking_expires_at IS NULL OR datetime(tracking_expires_at) > datetime('now'))
        `).bind(username).all();

        const allTrackers = new Set([
          ...(calTrackers.results || []).map(r => r.chat_id),
          ...(userTrackers.results || []).map(r => r.chat_id)
        ].filter(Boolean));

        if (allTrackers.size > 0) {
          const { sendTelegramMessage } = await import('./src/telegram.js');
          for (const trackerChatId of allTrackers) {
            if (trackerChatId !== (env.ADMIN_CHAT_ID || '332680373')) {
              await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, trackerChatId, alertMsgRu);
            }
          }
        }
      } catch (err) {
        console.error('[PROFILE WATCHER] Direct user alert error:', err);
      }
    }

    await env.DB.prepare(`
      UPDATE x_list 
      SET bio = COALESCE(?, bio), website_url = COALESCE(?, website_url), updated_at = ?
      WHERE id = ?
    `).bind(newBio || null, newWeb || null, new Date().toISOString(), existing.id).run();

    return { success: true, changed: webChanged || bioChanged };
  } else {
    // Only monitor bio / website changes for profiles already tracked in x_list
    // Never auto-insert arbitrary scraped accounts into x_list!
    return { success: true, changed: false, not_tracked: true };
  }
}

async function checkCalendarReminders(env) {
  try {
    const { results: upcoming } = await env.DB.prepare(`
      SELECT * FROM calendar_events 
      WHERE (
        (datetime(event_date) IS NOT NULL AND datetime(event_date) >= datetime('now', '-1 hours') AND datetime(event_date) <= datetime('now', '+48 hours'))
        OR lower(event_date) LIKE '%tomorrow%'
        OR lower(event_date) LIKE '%сегодня%'
        OR lower(event_date) LIKE '%today%'
      )
      ORDER BY event_date ASC
    `).all();

    if (!upcoming || upcoming.length === 0) return { count: 0 };

    const { sendTelegramMessage } = await import('./src/telegram.js');
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const byOwner = new Map();

    for (const ev of upcoming) {
      const owner = ev.owner_chat_id || adminChatId;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push(ev);
    }

    for (const [ownerId, events] of byOwner.entries()) {
      let reminderMsg = '📅 <b>КАЛЕНДАРЬ СОБЫТИЙ (Ближайшие 24-48ч)</b>\n\n';
      for (const ev of events) {
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

      try {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, ownerId, reminderMsg);
      } catch (err) {
        console.error(`Calendar reminder error for ${ownerId}:`, err);
      }
    }

    return { count: upcoming.length };
  } catch (e) {
    console.error('[CALENDAR CRON ERROR]:', e);
    return { count: 0, error: e.message };
  }
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
  if (scored.is_x_list || scored.is_parser_target) {
    if (scored.score < 70) return { ok: false, reason: 'ai_score_too_low' };
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

app.get('/health', async (req, res) => {
  const env = global_env;
  let dbStatus = 'ok';
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch (e) {
    dbStatus = 'error: ' + e.message;
  }
  return res.json({
    status: 'ok',
    version: '2.0.0',
    db: dbStatus,
    telegram: 'grammy_polling'
  });
});

app.get('/stats', async (req, res) => {
  const env = global_env;
  if (!isAuthorized(req, env)) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const { results } = await env.DB.prepare("SELECT opportunity_type, COUNT(*) as count FROM tweets GROUP BY opportunity_type").all();
    return res.json({ stats: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/daily-summary', async (req, res) => {
  const env = global_env;
  if (!isAuthorized(req, env)) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const dryRun = req.query.dry_run === 'true';
    const force = req.query.force === 'true';
    const result = await sendDailySummary(env, new Date(), { dryRun, force });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/opensea/status', async (req, res) => {
  const env = global_env;
  if (!isAuthorized(req, env)) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const status = await getOpenSeaScanStatus(env.DB);
    return res.json(status);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/opensea/scan', async (req, res) => {
  const env = global_env;
  if (!isAuthorized(req, env)) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const dryRun = req.query.dry_run === 'true';
    const result = await runOpenSeaScan(env, { dryRun });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/sources', async (req, res) => {
  const env = global_env;
  if (!isAuthorized(req, env)) {
    return res.status(401).send('Unauthorized');
  }

  const limit = parseLimit(req.query.limit);

  try {
    const { results } = await env.DB.prepare(`
      SELECT
        username,
        MAX(display_name) AS display_name,
        MAX(avatar_url) AS avatar_url,
        MAX(followers_count) AS followers_count,
        MAX(created_at) AS created_at
      FROM x_list
      WHERE is_active = 1
      GROUP BY username
      ORDER BY RANDOM()
      LIMIT ?
    `).bind(limit).all();

    return res.json({ accounts: results });
  } catch (error) {
    return res.status(500).send(error.message);
  }
});

app.get('/api/miniapp/admin/targets', async (req, res) => {
  const env = global_env;
  const authChatId = getAuthChatId(req, env);
  const adminChatId = env.ADMIN_CHAT_ID || '332680373';
  if (env.TELEGRAM_BOT_TOKEN ? (authChatId !== adminChatId && req.query.chat_id !== adminChatId) : (req.query.chat_id !== adminChatId && authChatId !== adminChatId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await autoCleanupExpiredCalendarTracking(env);
    const category = req.query.category;
    let query = 'SELECT id, username, category, display_name FROM x_list WHERE is_active = 1';
    let binds = [];
    if (category) {
      query += ' AND lower(category) = lower(?)';
      binds.push(category);
    }
    query += ' ORDER BY id ASC';
    const stmt = binds.length > 0 ? env.DB.prepare(query).bind(...binds) : env.DB.prepare(query);
    const { results } = await stmt.all();

    const seenUsernames = new Set();
    const targets = [];
    for (const r of (results || [])) {
      const u = (r.username || '').toLowerCase().trim();
      if (u && !seenUsernames.has(u)) {
        seenUsernames.add(u);
        targets.push({
          id: r.id,
          username: r.username,
          category: r.category || 'nft',
          display_name: r.display_name || r.username
        });
      }
    }

    // Also merge active tracked profiles from calendar_events
    try {
      const { results: calTargets } = await env.DB.prepare(`
        SELECT id, username, project_name, event_type 
        FROM calendar_events 
        WHERE track_profile = 1 
        AND username IS NOT NULL 
        AND (
          (tracking_expires_at IS NOT NULL AND datetime(tracking_expires_at) > datetime('now'))
          OR (tracking_expires_at IS NULL AND (event_date IS NULL OR datetime(event_date) > datetime('now')))
        )
      `).all();

      for (const ct of (calTargets || [])) {
        const u = (ct.username || '').toLowerCase().trim();
        if (u && !seenUsernames.has(u)) {
          seenUsernames.add(u);
          targets.push({
            id: ct.id,
            username: ct.username,
            category: ct.event_type || 'nft',
            display_name: ct.project_name || ct.username
          });
        }
      }
    } catch (e) {
      console.error('[TARGETS] Error merging calendar targets:', e);
    }

    // Also merge active tracked profiles from user_targets
    try {
      const { results: usrTargets } = await env.DB.prepare(`
        SELECT id, username, display_name, category 
        FROM user_targets 
        WHERE is_active = 1 
        AND username IS NOT NULL 
        AND (tracking_expires_at IS NULL OR datetime(tracking_expires_at) > datetime('now'))
      `).all();

      for (const ut of (usrTargets || [])) {
        const u = (ut.username || '').toLowerCase().trim();
        if (u && !seenUsernames.has(u)) {
          seenUsernames.add(u);
          targets.push({
            id: ut.id,
            username: ut.username,
            category: ut.category || 'nft',
            display_name: ut.display_name || ut.username
          });
        }
      }
    } catch (e) {
      console.error('[TARGETS] Error merging user targets:', e);
    }

    return res.json({ targets });
  } catch (error) {
    return res.status(500).send(error.message);
  }
});

app.delete('/api/miniapp/admin/targets', async (req, res) => {
  const env = global_env;
  const authChatId = getAuthChatId(req, env);
  const adminChatId = env.ADMIN_CHAT_ID || '332680373';
  if (env.TELEGRAM_BOT_TOKEN ? (authChatId !== adminChatId && req.query.chat_id !== adminChatId) : (req.query.chat_id !== adminChatId && authChatId !== adminChatId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { id, username } = req.query;
    if (id) {
      await env.DB.prepare('DELETE FROM x_list WHERE id = ?').bind(id).run();
    } else if (username) {
      await env.DB.prepare('DELETE FROM x_list WHERE lower(username) = lower(?)').bind(username.toLowerCase()).run();
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).send(error.message);
  }
});

app.put('/api/miniapp/admin/targets/category', async (req, res) => {
  const env = global_env;
  const authChatId = getAuthChatId(req, env);
  const adminChatId = env.ADMIN_CHAT_ID || '332680373';
  if (env.TELEGRAM_BOT_TOKEN ? (authChatId !== adminChatId && req.body?.chat_id !== adminChatId) : (req.body?.chat_id !== adminChatId && authChatId !== adminChatId && req.query.chat_id !== adminChatId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { username, id, category } = req.body || {};
    if (!category || (!username && !id)) {
      return res.status(400).json({ error: 'Missing category and username or id' });
    }
    const cleanCat = String(category).toLowerCase().trim();
    if (id) {
      await env.DB.prepare('UPDATE x_list SET category = ? WHERE id = ?').bind(cleanCat, id).run();
    } else {
      await env.DB.prepare('UPDATE x_list SET category = ? WHERE lower(username) = lower(?)').bind(cleanCat, username.trim()).run();
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/miniapp/admin/targets/:id/category', async (req, res) => {
  const env = global_env;
  const authChatId = getAuthChatId(req, env);
  const adminChatId = env.ADMIN_CHAT_ID || '332680373';
  if (env.TELEGRAM_BOT_TOKEN ? (authChatId !== adminChatId && req.body?.chat_id !== adminChatId) : (req.body?.chat_id !== adminChatId && authChatId !== adminChatId && req.query.chat_id !== adminChatId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { category } = req.body || {};
    if (!category) {
      return res.status(400).json({ error: 'Missing category' });
    }
    const cleanCat = String(category).toLowerCase().trim();
    await env.DB.prepare('UPDATE x_list SET category = ? WHERE id = ?').bind(cleanCat, req.params.id).run();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- USER TRACKED PROFILES ENDPOINTS (Unified Multi-tenant Watcher) ---
app.get('/api/miniapp/user/targets', async (req, res) => {
  const env = global_env;
  try {
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const chatId = String(authChatId || req.query.chat_id || adminChatId);
    const isAdmin = (chatId === String(adminChatId) || chatId === '332680373');

    const targets = await getUserTrackedProfiles(env, chatId);
    return res.json({
      success: true,
      targets,
      count: targets.length,
      max: isAdmin ? 999999 : 5,
      is_admin: isAdmin
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/miniapp/user/targets', async (req, res) => {
  const env = global_env;
  try {
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const chatId = String(authChatId || req.body?.chat_id || req.query?.chat_id || adminChatId);
    const isAdmin = (chatId === String(adminChatId) || chatId === '332680373');

    const { urls, username, category } = req.body || {};
    const rawInputs = [];
    if (Array.isArray(urls)) {
      for (const item of urls) {
        if (typeof item === 'string') {
          rawInputs.push(...item.split(/[\r\n,]+/));
        }
      }
    } else if (typeof urls === 'string') {
      rawInputs.push(...urls.split(/[\r\n,]+/));
    }
    if (username) {
      if (typeof username === 'string') {
        rawInputs.push(...username.split(/[\r\n,]+/));
      }
    }

    const targetCategory = (category || 'nft').toLowerCase().trim();
    const handlesToAdd = [];
    for (const raw of rawInputs) {
      const u = extractTwitterUsername(raw);
      if (u && !handlesToAdd.includes(u)) {
        handlesToAdd.push(u);
      }
    }

    if (handlesToAdd.length === 0) {
      return res.status(400).json({ error: 'Укажите корректный Twitter ник (@username) или ссылку' });
    }

    // Unified quota validation: max 5 active profiles per regular user, UNLIMITED for admin
    const currentTargets = await getUserTrackedProfiles(env, chatId);
    const currentSet = new Set(currentTargets.map(t => t.username.toLowerCase()));
    const brandNewHandles = handlesToAdd.filter(h => !currentSet.has(h));

    if (!isAdmin && (currentTargets.length + brandNewHandles.length > 5)) {
      const freeSlots = Math.max(0, 5 - currentTargets.length);
      return res.status(400).json({
        error: `Лимит 5 профилей исчерпан. У вас уже отслеживается ${currentTargets.length}/5 профилей. Доступно мест: ${freeSlots}.`
      });
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    let addedCount = 0;

    for (const u of handlesToAdd) {
      const existing = await env.DB.prepare('SELECT id FROM user_targets WHERE chat_id = ? AND lower(username) = ?')
        .bind(chatId, u).first();

      if (existing) {
        await env.DB.prepare(`
          UPDATE user_targets 
          SET is_active = 1, tracking_expires_at = ?, category = ?, created_at = ?
          WHERE id = ?
        `).bind(expiresAt, targetCategory, now, existing.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO user_targets (chat_id, username, display_name, category, tracking_expires_at, created_at, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).bind(chatId, u, u, targetCategory, expiresAt, now).run();
      }

      // Ensure profile is in x_list for scraper
      try {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO x_list (username, display_name, is_active, category, created_at)
          VALUES (?, ?, 1, ?, ?)
        `).bind(u, u, targetCategory, now).run();
        await env.DB.prepare('UPDATE x_list SET is_active = 1 WHERE lower(username) = ?')
          .bind(u).run();
      } catch (e) {
        console.error('Error updating x_list for target:', e);
      }

      addedCount++;
    }

    const updatedTargets = await getUserTrackedProfiles(env, chatId);
    return res.json({
      success: true,
      added: addedCount,
      targets: updatedTargets,
      count: updatedTargets.length,
      max: isAdmin ? 999999 : 5,
      is_admin: isAdmin
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

const handleUserTargetDelete = async (req, res) => {
  const env = global_env;
  try {
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const chatId = String(authChatId || req.query.chat_id || req.body?.chat_id || adminChatId);
    const isAdmin = (chatId === String(adminChatId) || chatId === '332680373');

    const rawUsername = req.params?.username || req.query?.username || req.body?.username;
    const cleanUsername = extractTwitterUsername(rawUsername);

    if (!cleanUsername) {
      return res.status(400).json({ error: 'Missing username' });
    }

    // 1. Untrack from calendar_events for this user (support username stored with or without leading @)
    try {
      await env.DB.prepare(`
        UPDATE calendar_events 
        SET track_profile = 0, tracking_expires_at = NULL 
        WHERE (lower(username) = ? OR lower(username) = ? OR replace(lower(username), '@', '') = ?) 
        AND (owner_chat_id = ? OR (owner_chat_id IS NULL AND ? = '332680373'))
      `).bind(cleanUsername, '@' + cleanUsername, cleanUsername, chatId, chatId).run();
    } catch (e) {
      console.error('Error untracking calendar_events:', e);
    }

    // 2. Untrack from user_targets for this user
    try {
      await env.DB.prepare(`
        UPDATE user_targets 
        SET is_active = 0 
        WHERE lower(username) = ? 
        AND chat_id = ?
      `).bind(cleanUsername, chatId).run();
    } catch (e) {
      console.error('Error untracking user_targets:', e);
    }

    // 3. If admin, also untrack from x_list
    if (isAdmin) {
      try {
        await env.DB.prepare(`
          UPDATE x_list 
          SET is_active = 0 
          WHERE (lower(username) = ? OR lower(username) = ? OR replace(lower(username), '@', '') = ?)
        `).bind(cleanUsername, '@' + cleanUsername, cleanUsername).run();
      } catch (e) {
        console.error('Error untracking x_list for admin:', e);
      }
    }

    const updatedTargets = await getUserTrackedProfiles(env, chatId);
    return res.json({
      success: true,
      username: cleanUsername,
      targets: updatedTargets,
      count: updatedTargets.length,
      max: isAdmin ? 999999 : 5,
      is_admin: isAdmin
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

app.delete('/api/miniapp/user/targets/:username', handleUserTargetDelete);
app.delete('/api/miniapp/user/targets', handleUserTargetDelete);

// --- CALENDAR ENDPOINTS (F1 & Multi-Tenant Tracking) ---
app.get('/api/miniapp/calendar', async (req, res) => {
  const env = global_env;
  try {
    await autoCleanupExpiredCalendarTracking(env);
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const chatId = String(authChatId || req.query.chat_id || adminChatId);
    const isAdmin = (chatId === String(adminChatId) || chatId === '332680373');
    const eventType = req.query.event_type;

    let query = 'SELECT * FROM calendar_events WHERE owner_chat_id = ?';
    let binds = [chatId];
    if (eventType && eventType !== 'all') {
      query += ' AND lower(event_type) = lower(?)';
      binds.push(eventType);
    }
    query += ' ORDER BY event_date ASC';
    const stmt = env.DB.prepare(query).bind(...binds);
    const { results } = await stmt.all();

    // Calculate active tracked profiles count for this user (max 5, unified with user targets)
    const currentTrackedProfiles = await getUserTrackedProfiles(env, chatId);
    const trackedCount = currentTrackedProfiles.length;

    return res.json({ 
      events: results || [],
      tracked_count: trackedCount,
      max_tracking: isAdmin ? 999999 : 5,
      is_admin: isAdmin
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/miniapp/calendar', async (req, res) => {
  const env = global_env;
  try {
    await autoCleanupExpiredCalendarTracking(env);
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const chatId = String(authChatId || req.body?.chat_id || req.query?.chat_id || adminChatId);
    const isAdmin = (chatId === String(adminChatId) || chatId === '332680373');

    const { project_name, username, event_type, event_date, details, tweet_url, track_profile } = req.body || {};
    if (!event_date || (!project_name && !username)) {
      return res.status(400).json({ error: 'Missing required calendar fields (event_date and project_name or username)' });
    }
    const cleanUsername = username ? extractTwitterUsername(username) : null;
    const cleanEventType = event_type ? String(event_type).toLowerCase().trim() : 'mint';
    const now = new Date().toISOString();

    let shouldTrack = track_profile ? 1 : 0;
    let expiresAt = null;

    if (shouldTrack) {
      if (!cleanUsername) {
        return res.status(400).json({ error: 'Для включения отслеживания профиля укажите Twitter ник (@username)' });
      }

      // Check quota: max 5 active profiles (unified with user targets) - unlimited for admin
      const currentTrackedProfiles = await getUserTrackedProfiles(env, chatId);
      const isAlreadyTracked = currentTrackedProfiles.some(p => p.username.toLowerCase() === cleanUsername.toLowerCase());
      if (!isAdmin && !isAlreadyTracked && currentTrackedProfiles.length >= 5) {
        return res.status(400).json({ error: 'Лимит 5 профилей исчерпан. Отключите один из активных, чтобы добавить новый.' });
      }

      // TTL: 15 days max or event date, whichever comes first
      const max15Days = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      const evDate = new Date(event_date);
      if (!isNaN(evDate.getTime())) {
        const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
        if (evDate.getTime() < twelveHoursAgo) {
          return res.status(400).json({ error: 'Дата события уже в прошлом (более 12 ч), отслеживание невозможно' });
        }
        const minTracking = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const targetExpiry = evDate.getTime() < minTracking.getTime() ? minTracking : evDate;
        expiresAt = (targetExpiry.getTime() < max15Days.getTime() ? targetExpiry : max15Days).toISOString();
      } else {
        expiresAt = max15Days.toISOString();
      }

      // Ensure profile is in x_list for scraper
      try {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO x_list (username, display_name, is_active, category, created_at)
          VALUES (?, ?, 1, ?, ?)
        `).bind(cleanUsername.toLowerCase(), project_name || cleanUsername, cleanEventType, now).run();
      } catch (e) {}
    }

    const result = await env.DB.prepare(`
      INSERT INTO calendar_events (owner_chat_id, project_name, username, event_type, event_date, details, tweet_url, track_profile, tracking_expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      chatId,
      project_name || cleanUsername || 'Project',
      cleanUsername,
      cleanEventType,
      event_date,
      details || null,
      tweet_url || null,
      shouldTrack,
      expiresAt,
      now
    ).run();

    return res.json({ 
      success: true, 
      id: result.meta?.last_row_id || result.meta?.lastInsertRowid || result.id || 1,
      track_profile: shouldTrack,
      tracking_expires_at: expiresAt
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/miniapp/calendar/:id/toggle_tracking', async (req, res) => {
  const env = global_env;
  try {
    await autoCleanupExpiredCalendarTracking(env);
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const chatId = String(authChatId || req.body?.chat_id || req.query?.chat_id || adminChatId);
    const isAdmin = (chatId === String(adminChatId) || chatId === '332680373');
    const id = req.params.id;

    const event = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    if (!event) {
      return res.status(404).json({ error: 'Событие не найдено' });
    }
    if (event.owner_chat_id && event.owner_chat_id !== chatId && chatId !== adminChatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const enableTracking = !!req.body?.track_profile;

    if (enableTracking) {
      const cleanUsername = event.username ? extractTwitterUsername(event.username) : null;
      if (!cleanUsername) {
        return res.status(400).json({ error: 'Для включения отслеживания укажите Twitter ник (@username) в событии' });
      }

      // Check quota: max 5 active profiles (unified with user targets) - unlimited for admin
      const currentTrackedProfiles = await getUserTrackedProfiles(env, chatId);
      const isAlreadyTracked = currentTrackedProfiles.some(p => p.username.toLowerCase() === cleanUsername.toLowerCase());
      if (!isAdmin && !isAlreadyTracked && currentTrackedProfiles.length >= 5) {
        return res.status(400).json({ error: 'Лимит 5 профилей исчерпан. Отключите один из активных, чтобы включить этот.' });
      }

      const max15Days = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      const evDate = new Date(event.event_date);
      let expiresAt;
      if (!isNaN(evDate.getTime())) {
        const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
        if (evDate.getTime() < twelveHoursAgo) {
          return res.status(400).json({ error: 'Дата события уже в прошлом (более 12 ч), отслеживание невозможно' });
        }
        const minTracking = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const targetExpiry = evDate.getTime() < minTracking.getTime() ? minTracking : evDate;
        expiresAt = (targetExpiry.getTime() < max15Days.getTime() ? targetExpiry : max15Days).toISOString();
      } else {
        expiresAt = max15Days.toISOString();
      }

      if (!event.owner_chat_id) {
        await env.DB.prepare(`
          UPDATE calendar_events 
          SET track_profile = 1, tracking_expires_at = ?, owner_chat_id = ?
          WHERE id = ?
        `).bind(expiresAt, chatId, id).run();
      } else {
        await env.DB.prepare(`
          UPDATE calendar_events 
          SET track_profile = 1, tracking_expires_at = ?
          WHERE id = ?
        `).bind(expiresAt, id).run();
      }

      // Ensure profile is in x_list for scraper
      try {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO x_list (username, display_name, is_active, category, created_at)
          VALUES (?, ?, 1, ?, ?)
        `).bind(cleanUsername.toLowerCase(), event.project_name || cleanUsername, event.event_type || 'mint', new Date().toISOString()).run();
      } catch (e) {}

      return res.json({ success: true, track_profile: 1, tracking_expires_at: expiresAt });
    } else {
      await env.DB.prepare(`
        UPDATE calendar_events 
        SET track_profile = 0, tracking_expires_at = NULL
        WHERE id = ?
      `).bind(id).run();

      return res.json({ success: true, track_profile: 0, tracking_expires_at: null });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/miniapp/calendar/:id', async (req, res) => {
  const env = global_env;
  try {
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const chatId = authChatId || req.query.chat_id || adminChatId;
    const id = req.params.id;

    if (chatId === adminChatId) {
      await env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
    } else {
      await env.DB.prepare('DELETE FROM calendar_events WHERE id = ? AND owner_chat_id = ?').bind(id, chatId).run();
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/miniapp/profile_meta', async (req, res) => {
  const env = global_env;
  try {
    if (!isAuthorized(req, env)) {
      return res.status(401).send('Unauthorized');
    }
    const result = await handleProfileMetaUpdate(env, req.body);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- ROUTES ---


let summaryLock = false;
app.post('/api/miniapp/admin/targets/summary_done', async (req, res) => { 
    const startT = Date.now(); 
    console.log('[SUMMARY] Webhook called from ext_id:', req.query.ext_id);

    const env = global_env;
    const adminChatId = process.env.ADMIN_CHAT_ID || '332680373';
    if (req.query.chat_id !== adminChatId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    if (summaryLock && req.query.force !== '1') {
        console.log('[SUMMARY] Locked, returning early');
        return res.json({ success: true, msg: 'locked' });
    }
    summaryLock = true;
    setTimeout(() => { summaryLock = false; }, 60000 * 1); // 1 min lock
  
  try {
    await autoCleanupExpiredCalendarTracking(env);

    function extractSummaryDetails(text) {
      if (!text) return '';
      const clean = text.replace(/https?:\/\/\S+/g, '').trim();
      const details = [];
      
      const dateMatch = clean.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}|\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*|\b\d+\s*(?:hours?|hrs?|days?|дней|часов|ч)\b|\btomorrow\b|\btonight\b|\bзавтра\b|\bсегодня\b/i);
      if (dateMatch) {
        let d = dateMatch[0].trim();
        if (/october 14|14 october/i.test(d)) d = '14 Октября';
        else if (/october|oct/i.test(d)) d = d.replace(/october|oct/i, 'Октября');
        else if (/hours?|hrs?/i.test(d)) d = d.replace(/hours?|hrs?/i, 'ч');
        details.push(d);
      }
      
      const supplyMatch = clean.match(/\b(\d{3,5})\s*(?:Minds|NFTs?|supply|items|passes?|коллекци[яи]|шт)?\b/i);
      if (supplyMatch && supplyMatch[1] && !dateMatch?.[0]?.includes(supplyMatch[1])) {
        details.push(`${supplyMatch[1]} шт`);
      }
      
      const platMatch = clean.match(/OpenSea|Magic\s*Eden|Blur|Tensor|Uniswap|Solana|Ethereum|Base|Arbitrum/i);
      if (platMatch) {
        details.push(platMatch[0]);
      }
      
      if (/free\s*mint|freemint/i.test(clean)) details.push('Free Mint');
      else if (/leaderboards?\s*lock/i.test(clean)) details.push('Leaderboards Lock');
      
      return details.length > 0 ? `(${details.join(' • ')})` : '';
    }

    const { sendTelegramMessage } = await import('./src/telegram.js');

    // 1. Identify distinct users with active tracked profiles in calendar_events or user_targets
    const { results: calendarUserRows } = await env.DB.prepare(`
      SELECT DISTINCT owner_chat_id 
      FROM calendar_events 
      WHERE track_profile = 1 
      AND username IS NOT NULL 
      AND (
        (tracking_expires_at IS NOT NULL AND datetime(tracking_expires_at) > datetime('now'))
        OR (tracking_expires_at IS NULL AND (event_date IS NULL OR datetime(event_date) > datetime('now')))
      )
    `).all();

    const { results: userTargetRows } = await env.DB.prepare(`
      SELECT DISTINCT chat_id as owner_chat_id
      FROM user_targets 
      WHERE is_active = 1 
      AND username IS NOT NULL 
      AND (tracking_expires_at IS NULL OR datetime(tracking_expires_at) > datetime('now'))
    `).all();

    const distinctChatIds = new Set([
      ...(calendarUserRows || []).map(r => r.owner_chat_id),
      ...(userTargetRows || []).map(r => r.owner_chat_id)
    ].filter(Boolean));
    // Always include admin
    distinctChatIds.add(adminChatId);

    const allReportedTweetIds = [];

    // 2. Build and dispatch tailored summary to each user
    for (const chatId of distinctChatIds) {
      let userTargetList = [];
      if (chatId === adminChatId) {
        // Admin gets active x_list targets + any admin tracked profiles
        const { results: xListTargets } = await env.DB.prepare(`SELECT username FROM x_list WHERE is_active = 1`).all();
        const adminProfiles = await getUserTrackedProfiles(env, adminChatId);
        const seen = new Set();
        for (const t of [...(xListTargets || []), ...adminProfiles]) {
          const u = (t.username || '').toLowerCase().trim();
          if (u && !seen.has(u)) { seen.add(u); userTargetList.push(u); }
        }
      } else {
        // Regular user gets their unified tracked profiles
        const userProfiles = await getUserTrackedProfiles(env, chatId);
        userTargetList = userProfiles.map(p => (p.username || '').toLowerCase().trim()).filter(Boolean);
      }

      if (userTargetList.length === 0) continue;

      const reportLines = [];

      for (const user of userTargetList) {
        const { results: tweets } = await env.DB.prepare(`
          SELECT tweet_id, tweet_url, opportunity_type, text, score 
          FROM tweets 
          WHERE COALESCE(NULLIF(lower(username), ''), '__unknown__') = ? 
          AND datetime(detected_at) >= datetime('now', '-36 hours')
          AND (score >= 70 OR opportunity_type IN ('mint', 'airdrop', 'checker', 'whitelist', 'tge', 'tokenomics'))
          AND (reported_in_summary IS NULL OR reported_in_summary = 0)
          ORDER BY detected_at DESC
        `).bind(user).all();

        if (!tweets || tweets.length === 0) {
          reportLines.push(`Компания <a href="https://x.com/${user}">@${user}</a> - нет твитов`);
        } else {
          for (const tw of tweets) {
            allReportedTweetIds.push(tw.tweet_id);
            const rawType = (tw.opportunity_type || 'новость').toLowerCase();
            const typeLabel = rawType === 'mint' ? 'минт' : rawType === 'checker' ? 'чекер' : rawType === 'airdrop' ? 'аирдроп' : rawType === 'whitelist' ? 'вайтлист' : rawType === 'tge' ? 'TGE' : rawType;
            const details = extractSummaryDetails(tw.text);
            const detailStr = details ? ` ${details}` : '';
            let formStr = '';
            const formMatch = tw.text && tw.text.match(/https?:\/\/(?:www\.)?(?:premint\.xyz|alphabot\.app|heymint\.xyz|forms\.gle|docs\.google\.com\/forms)\/[^\s"'\)]+/i);
            if (formMatch) {
              formStr = ` • <a href="${escapeHTML(formMatch[0])}">форма</a>`;
            }
            reportLines.push(`Компания <a href="https://x.com/${user}">@${user}</a> - ${typeLabel}${detailStr} - <a href="${tw.tweet_url}">открыть твит</a>${formStr}`);
          }
        }
      }

      const title = chatId === adminChatId ? '📋 <b>Отчет парсера профилей:</b>' : '📋 <b>Отчет по отслеживаемым проектам:</b>';
      const summaryText = `${title}\n\n${reportLines.join('\n')}`;

      try {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, summaryText, null, null, true);
      } catch (tgErr) {
        console.error(`Failed to send summary to chatId ${chatId}:`, tgErr);
      }
    }

    if (allReportedTweetIds.length > 0) {
      for (const id of allReportedTweetIds) {
        await env.DB.prepare(`UPDATE tweets SET reported_in_summary = 1 WHERE tweet_id = ?`).bind(id).run();
      }
    }

    return res.json({ success: true });
  } catch (e) {
    summaryLock = false; 
    console.error('Summary error', e);
    return res.status(500).json({ error: e.message });
  }
});

// --- CONCURRENCY MUTEX ---
const projectLocks = new Map();
class Mutex {
    constructor() { this.queue = []; this.locked = false; }
    async lock() {
        if (!this.locked) { this.locked = true; return; }
        return new Promise(resolve => this.queue.push(resolve));
    }
    unlock() {
        if (this.queue.length > 0) { const next = this.queue.shift(); next(); }
        else { this.locked = false; }
    }
}
function getLock(key) {
    if (!projectLocks.has(key)) projectLocks.set(key, new Mutex());
    return projectLocks.get(key);
}

// --- ROUTES ---
app.post('/ingest', async (req, res) => {
  try {
    const env = global_env;
    console.log('[INGEST] Received webhook:', req.body ? req.body.tweet_id : 'no body');
    console.log('[INGEST] Key:', getClientKey(req), 'Expected:', env ? env.CLIENT_KEY : 'env is null');

    if (!isAuthorized(req, env)) {
      return res.status(401).send('Unauthorized');
    }

    const contentLength = (req.headers['content-length']||'');
    if (contentLength && parseInt(contentLength, 10) > 102400) { 
       return res.status(400).send('Payload too large');
    }

    let payload = req.body;
    
    if (!payload || typeof payload !== 'object') return res.status(400).send('Invalid format');
    if (typeof payload.tweet_id !== 'string' || typeof payload.tweet_url !== 'string' || typeof payload.text !== 'string') {
      return res.status(400).send('Missing or invalid required fields');
    }
    
    const safeTweetUrl = validateTweetUrl(payload.tweet_url);
    if (!safeTweetUrl) {
      return res.status(400).send('Invalid tweet URL');
    }
    payload.tweet_url = safeTweetUrl;
    
    if (payload.text && typeof payload.text === 'string') {
      payload.text = payload.text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    }

    if (!payload.text || payload.text.length === 0) {
      return res.status(400).send('Empty text');
    }

    if (payload.text.length > 50000) return res.status(400).send('Text too long');

    // --- BLACKLIST ---
    const BLACKLISTED_HANDLES = ['playonmint'];
    const lowerText = payload.text.toLowerCase();
    const lowerUser = (payload.username || '').toLowerCase();
    const isBlacklisted = BLACKLISTED_HANDLES.some(h => 
      lowerText.includes(h) || lowerUser.includes(h) || 
      (payload.project_name && payload.project_name.toLowerCase().includes(h))
    );
    if (isBlacklisted) {
      console.log('[INGEST] Blacklisted project/user:', lowerUser, 'text contains:', BLACKLISTED_HANDLES.filter(h => lowerText.includes(h)));
      return res.json({ status: 'blacklisted', reason: 'project_blacklisted' });
    }
    
    const tweetLock = getLock(payload.tweet_id);
    await tweetLock.lock();
    try {
      let forceTestMode = false;

      if (!payload.is_x_list && !payload.is_parser_target && payload.username) {
        const cleanU = extractTwitterUsername(payload.username);
        if (cleanU) {
          try {
            const inXList = await env.DB.prepare('SELECT id FROM x_list WHERE lower(username) = ? AND is_active = 1').bind(cleanU).first();
            if (inXList) {
              payload.is_x_list = true;
              payload.is_parser_target = true;
            } else {
              const inUserTargets = await env.DB.prepare('SELECT id FROM user_targets WHERE lower(username) = ? AND is_active = 1 AND (tracking_expires_at IS NULL OR datetime(tracking_expires_at) > datetime(\'now\'))').bind(cleanU).first();
              if (inUserTargets) {
                payload.is_x_list = true;
                payload.is_parser_target = true;
              }
            }
          } catch (e) {}
        }
      }

      const existing = await checkDuplicate(env.DB, payload.tweet_id);
      if (existing && !forceTestMode) {
        if (payload.is_x_list || payload.is_parser_target) {
          return res.status(409).json({ status: 'duplicate_x_list_ignored' });
        }

        if (existing.sent_to_telegram === 0) {
           let scored = calculateScore(parseTweet(payload));
           scored.is_x_list = false; // it is not x_list if it reached here

             const sendDecision = await shouldSendTelegram(env.DB, env, scored);
               console.log("[EOD_TEST] sendDecision:", sendDecision, "is_parser_target:", payload.is_parser_target);
               if (sendDecision.ok) {
                 await ensureBilingualTexts(scored, payload.text, payload.translated_text);
                 const messages = {
                   ru: formatTelegramMessage(scored, 'ru'),
                   en: formatTelegramMessage(scored, 'en')
                 };
                 if (messages.ru && messages.en) {
                    const formUrl = scored.whitelist_form_url || scored.form_link;
                    const platRu = scored.form_platform ? (scored.form_platform === 'premint' ? 'Premint' : scored.form_platform === 'alphabot' ? 'Alphabot' : scored.form_platform === 'heymint' ? 'HeyMint' : scored.form_platform === 'google_forms' ? 'Google Форма' : 'Вайтлист') : 'Вайтлист';
                    const platEn = scored.form_platform ? (scored.form_platform === 'premint' ? 'Premint' : scored.form_platform === 'alphabot' ? 'Alphabot' : scored.form_platform === 'heymint' ? 'HeyMint' : scored.form_platform === 'google_forms' ? 'Google Form' : 'Whitelist') : 'Whitelist';

                    const replyMarkup = {
                      ru: {
                        inline_keyboard: [
                          [{ text: '🚨 Открыть твит', url: payload.tweet_url }],
                          ...(formUrl ? [[{ text: `📝 Форма (${platRu})`, url: formUrl }]] : [])
                        ]
                      },
                      en: {
                        inline_keyboard: [
                          [{ text: '🚨 Open Tweet', url: payload.tweet_url }],
                          ...(formUrl ? [[{ text: `📝 Form (${platEn})`, url: formUrl }]] : [])
                        ]
                      }
                    };
                    const tgRes = await sendTelegramBroadcast(env, messages, replyMarkup, !!payload.is_x_list, !!payload.is_parser_target, scored.category);
                    if (tgRes.ok) await markSent(env.DB, payload.tweet_id, formatTelegramMessageIds(tgRes.results));
                 }
              }
           return res.json({ status: 'retry_attempted', send_decision: sendDecision.reason || 'sent' });
        }
        return res.status(409).json({ status: 'duplicate' });
      }

      if (payload.profile_meta && typeof payload.profile_meta === 'object') {
        try {
          await handleProfileMetaUpdate(env, payload.profile_meta);
        } catch (pmErr) {
          console.error('[PROFILE META ERROR]', pmErr);
        }
      }

      const parsed = parseTweet(payload);


      let scored = calculateScore(parsed);
      scored.is_x_list = !!payload.is_x_list;
      scored.is_parser_target = !!payload.is_parser_target;
      scored.category = parsed.category || payload.category || 'nft';
      if (!scored.category && payload.username) {
        try {
          const xRec = await env.DB.prepare('SELECT category FROM x_list WHERE lower(username) = ?').bind(payload.username.toLowerCase()).first();
          if (xRec && xRec.category) scored.category = xRec.category;
        } catch (e) {}
      }
      if (payload.translated_text) { scored.translated_text = payload.translated_text; }

      // F4: Check for instant urgent triggers
      const isUrgent = checkIsUrgent(payload.text || '');

      if (payload.is_x_list || payload.is_parser_target) {
        const aiResult = await runAIFilter(payload.text, env);
        if (!aiResult) {
          console.warn("[AI] AI completely failed, falling back to standard scoring");
          const minScore = parseInt(env.MIN_TELEGRAM_SCORE || '50', 10);
          if (scored.score < minScore && !isUrgent) {
            if (!existing) await saveTweet(env.DB, scored);
            return res.json({
              status: 'ok',
              score: scored.score,
              project_key: scored.project_key,
              send_decision: 'score_fallback'
            });
          }
        } else if ((!aiResult.relevant || aiResult.engagement_bait || aiResult.score < 3) && !isUrgent) {
          if (!existing) await saveTweet(env.DB, scored);
          return res.json({
            status: 'ok',
            score: scored.score,
            project_key: scored.project_key,
            send_decision: 'ai_rejected',
            ai_result: aiResult
          });
        } else {
          scored.score = (aiResult && aiResult.score) ? aiResult.score * 10 : scored.score;
          if (aiResult && aiResult.category) scored.opportunity_type = aiResult.category;
        }
        if (payload.translated_text) {
          scored.translated_text = payload.translated_text;
        }
      }

      if (!existing) await saveTweet(env.DB, scored);

      // F4: Instant Urgent Siren Alert Broadcast (bypasses delayed summary)
      if (isUrgent) {
        const { textEn, textRu } = await ensureBilingualTexts(scored, payload.text, payload.translated_text);

        const cleanUser = String(payload.username || '').replace(/^@/, '').trim();
        const userAnchorRu = cleanUser 
          ? `<a href="https://x.com/${escapeHTML(cleanUser)}">@${escapeHTML(cleanUser)}</a>` 
          : 'Оповещение X';
        const userAnchorEn = cleanUser 
          ? `<a href="https://x.com/${escapeHTML(cleanUser)}">@${escapeHTML(cleanUser)}</a>` 
          : 'Twitter Alert';

        let tweetUrl = payload.tweet_url;
        if (!tweetUrl || !tweetUrl.includes('/status/')) {
          if (scored.tweet_url && scored.tweet_url.includes('/status/')) {
            tweetUrl = scored.tweet_url;
          } else if (cleanUser && payload.tweet_id) {
            tweetUrl = `https://x.com/${cleanUser}/status/${payload.tweet_id}`;
          }
        }
        if (tweetUrl) {
          tweetUrl = tweetUrl.replace('x.com/@', 'x.com/').replace('twitter.com/@', 'twitter.com/');
        }

        const sirenMessageRu = `🚨🚨🚨 <b>СРОЧНЫЙ АЛЕРТ</b> 🚨🚨🚨\n\n` +
          `🔥 <b>${userAnchorRu}</b>:\n${escapeHTML(textRu.slice(0, 3000))}\n\n` +
          `👉 <a href="${escapeHTML(tweetUrl)}">ПЕРЕЙТИ К ТВИТУ</a>`;

        let cleanTextEn = (textEn || '').trim();
        if (cleanTextEn && /[а-яА-ЯёЁ]/.test(cleanTextEn)) {
          cleanTextEn = '';
        }

        const sirenMessageEn = `🚨🚨🚨 <b>URGENT ALERT</b> 🚨🚨🚨\n\n` +
          `🔥 <b>${userAnchorEn}</b>:` +
          (cleanTextEn ? `\n${escapeHTML(cleanTextEn.slice(0, 3000))}` : '') + `\n\n` +
          `👉 <a href="${escapeHTML(tweetUrl)}">OPEN TWEET</a>`;

        const formUrl = scored.whitelist_form_url || scored.form_link;
        const platRu = scored.form_platform ? (scored.form_platform === 'premint' ? 'Premint' : scored.form_platform === 'alphabot' ? 'Alphabot' : scored.form_platform === 'heymint' ? 'HeyMint' : scored.form_platform === 'google_forms' ? 'Google Форма' : 'Вайтлист') : 'Вайтлист';
        const platEn = scored.form_platform ? (scored.form_platform === 'premint' ? 'Premint' : scored.form_platform === 'alphabot' ? 'Alphabot' : scored.form_platform === 'heymint' ? 'HeyMint' : scored.form_platform === 'google_forms' ? 'Google Form' : 'Whitelist') : 'Whitelist';

        const replyMarkup = {
          ru: {
            inline_keyboard: [
              [{ text: '🚨 Открыть твит', url: tweetUrl }],
              ...(formUrl ? [[{ text: `📝 Форма (${platRu})`, url: formUrl }]] : [])
            ]
          },
          en: {
            inline_keyboard: [
              [{ text: '🚨 Open Tweet', url: tweetUrl }],
              ...(formUrl ? [[{ text: `📝 Form (${platEn})`, url: formUrl }]] : [])
            ]
          }
        };

        const messages = {
          ru: sirenMessageRu,
          en: sirenMessageEn
        };

        const tgRes = await sendTelegramBroadcast(env, messages, replyMarkup, !!payload.is_x_list, false, scored.category);
        if (tgRes.ok) {
          await markSent(env.DB, scored.tweet_id, formatTelegramMessageIds(tgRes.results));
        }
        return res.json({
          status: 'ok',
          score: scored.score,
          project_key: scored.project_key,
          send_decision: 'urgent_siren_sent'
        });
      }

      let sendDecision = await shouldSendTelegram(env.DB, env, scored);
      console.log("[EOD_TEST] sendDecision:", sendDecision, "is_parser_target:", payload.is_parser_target);
      
      // Do not send individual messages for non-urgent parser targets (batched into summary_done)
      if (payload.is_parser_target) {
         sendDecision = { ok: false, reason: 'delayed_summary' };
      }

      if (sendDecision.ok) {
        await ensureBilingualTexts(scored, payload.text, payload.translated_text);
        const messages = {
          ru: formatTelegramMessage(scored, 'ru'),
          en: formatTelegramMessage(scored, 'en')
        };
        if (messages.ru && messages.en) {
          const formUrl = scored.whitelist_form_url || scored.form_link;
          const platRu = scored.form_platform ? (scored.form_platform === 'premint' ? 'Premint' : scored.form_platform === 'alphabot' ? 'Alphabot' : scored.form_platform === 'heymint' ? 'HeyMint' : scored.form_platform === 'google_forms' ? 'Google Форма' : 'Вайтлист') : 'Вайтлист';
          const platEn = scored.form_platform ? (scored.form_platform === 'premint' ? 'Premint' : scored.form_platform === 'alphabot' ? 'Alphabot' : scored.form_platform === 'heymint' ? 'HeyMint' : scored.form_platform === 'google_forms' ? 'Google Form' : 'Whitelist') : 'Whitelist';

          const replyMarkup = {
            ru: {
              inline_keyboard: [
                [{ text: '🚨 Открыть твит', url: scored.tweet_url }],
                ...(formUrl ? [[{ text: `📝 Форма (${platRu})`, url: formUrl }]] : [])
              ]
            },
            en: {
              inline_keyboard: [
                [{ text: '🚨 Open Tweet', url: scored.tweet_url }],
                ...(formUrl ? [[{ text: `📝 Form (${platEn})`, url: formUrl }]] : [])
              ]
            }
          };
          const tgRes = await sendTelegramBroadcast(env, messages, replyMarkup, !!payload.is_x_list, !!payload.is_parser_target, scored.category);
          if (tgRes.ok) {
            await markSent(env.DB, scored.tweet_id, formatTelegramMessageIds(tgRes.results));
          }
        }
      }

      return res.json({
        status: 'ok',
        score: scored.score,
        project_key: scored.project_key,
        send_decision: sendDecision.reason || 'sent'
      });
    } finally {
      tweetLock.unlock();
      if (!tweetLock.locked && tweetLock.queue.length === 0) {
        projectLocks.delete(payload.tweet_id);
      }
    }
  } catch (err) {
    console.error('[INGEST ERROR]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});



app.post('/helius/webhook', async (req, res) => {
    try {
        let payloads = req.body;
        if (!Array.isArray(payloads)) payloads = [payloads];
        
        for (const tx of payloads) {
            const sig = tx.signature;
            const existing = await global_env.DB.prepare('SELECT signature FROM solana_tx_cache WHERE signature = ?').bind(sig).first();
            if (existing) continue;

            const walletsQuery = await global_env.DB.prepare('SELECT id, chat_id, address, name FROM solana_wallets').all();
            const wallets = walletsQuery.results || [];
            if (!wallets.length) continue;

            let matchedWallet = null;
            for (const w of wallets) {
                if (tx.feePayer === w.address || 
                    (tx.nativeTransfers && tx.nativeTransfers.some(t => t.toUserAccount === w.address || t.fromUserAccount === w.address)) ||
                    (tx.tokenTransfers && tx.tokenTransfers.some(t => t.toUserAccount === w.address || t.fromUserAccount === w.address))) {
                    matchedWallet = w;
                    break;
                }
            }

            if (matchedWallet) {
                await global_env.DB.prepare('INSERT INTO solana_tx_cache (signature) VALUES (?)').bind(sig).run();
                const parsed = parseTransaction(tx, matchedWallet.address);
                if (!parsed) continue;

                let msg = `🟣 <b>Solana Wallet Activity</b>\n\n`;
                msg += `👤 <b>Wallet:</b> ${matchedWallet.name} (<code>${matchedWallet.address}</code>)\n`;
                msg += `🔄 <b>Type:</b> ${parsed.type}\n`;
                if (parsed.description) msg += `📝 <b>Details:</b> ${parsed.description}\n`;
                msg += `\n<a href="https://solscan.io/tx/${sig}">View on Solscan</a>`;
                
                await fetch(`https://api.telegram.org/bot${global_env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        chat_id: matchedWallet.chat_id,
                        text: msg,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    })
                });
            }
        }
        res.json({success: true});
    } catch(e) {
        console.error('Helius webhook error:', e);
        res.status(500).send(e.message);
    }
});

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

app.post('/evm/webhook', async (req, res) => {
  const env = global_env;

  try {
    const body = req.body;
    const { parseAlchemyWebhook } = await import('./src/alchemy.js');
    const messages = parseAlchemyWebhook(body);
    
    if (!messages || messages.length === 0) return res.send('OK');
    
    const stmt = env.DB.prepare('INSERT INTO evm_queue (hash, payload, created_at) VALUES (?, ?, ?)');
    const batch = messages.map(msg => stmt.bind(msg.hash, JSON.stringify(msg), Date.now()));
    await env.DB.batch(batch);
    
    setTimeout(async () => {
      try {
        await processEvmQueue(env);
      } catch (err) {
        console.error('[EVM_QUEUE ERROR]', err);
      }
    }, 10000);
    
    return res.send('OK');
  } catch (e) {
    console.error(e);
    return res.send('OK');
  }
});


app.get('/debug', (req, res) => {
  const env = global_env;
  if (!isAuthorized(req, env)) {
    return res.status(401).send('Unauthorized');
  }
  return res.json({
    status: "ok",
    env: {
      MIN_SCORE: env.MIN_TELEGRAM_SCORE
    }
  });
});



cron.schedule('0 18 * * *', () => {
   console.log('Running daily crons...');
   runOpenSeaScan(global_env).catch(console.error);
   sendDailySummary(global_env).catch(console.error);
   
});

const PORT = 3000;


const chatInfoCache = new Map();
const MAX_CHAT_INFO_CACHE = 1000;

function setChatInfoCache(key, value) {
  if (chatInfoCache.size >= MAX_CHAT_INFO_CACHE) {
    const oldestKey = chatInfoCache.keys().next().value;
    chatInfoCache.delete(oldestKey);
  }
  chatInfoCache.set(key, value);
}

function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const checkString = Array.from(params.keys())
      .sort()
      .map(key => `${key}=${params.get(key)}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    if (computedHash !== hash) {
       console.log('[AUTH FAIL] expected:', hash, 'got:', computedHash, 'token_len:', botToken.length);
       return null;
    }

    const userStr = params.get('user');
    if (userStr) {
      const userObj = JSON.parse(userStr);
      return userObj.id ? String(userObj.id) : null;
    }
    return params.get('chat_id') || params.get('id') || null;
  } catch (e) {
    return null;
  }
}

function getAuthChatId(req, env) {
  let initData = req.headers['x-telegram-init-data'] || req.query?.initData;
  const authHeader = req.headers['authorization'];
  if (!initData && authHeader && authHeader.toLowerCase().startsWith('tma ')) {
    initData = authHeader.slice(4).trim();
  }
  if (!initData && typeof req.body === 'object' && req.body?.initData) {
    initData = req.body.initData;
  }
  const token = env?.TELEGRAM_BOT_TOKEN || global_env?.TELEGRAM_BOT_TOKEN;
  console.log('[AUTH] initData:', initData ? initData.substring(0,20)+'...' : 'none', 'token exists:', !!token);
  if (!initData || !token) return null;
  const res = validateTelegramInitData(initData, token);
  console.log('[AUTH] result:', res);
  return res;
}

app.get('/api/miniapp/chat_info/:id', async (req, res) => {
  try {
    const chatId = req.params.id;
    if (chatInfoCache.has(chatId)) {
       const cached = chatInfoCache.get(chatId);
       chatInfoCache.delete(chatId);
       chatInfoCache.set(chatId, cached);
       return res.json(cached);
    }
    const tgres = await fetch(`https://api.telegram.org/bot${global_env.TELEGRAM_BOT_TOKEN}/getChat?chat_id=${chatId}`);
    const data = await tgres.json();
    if (data.ok) {
       let has_photo = false;
       let file_path = null;
       const title = data.result.title || data.result.first_name || data.result.username || chatId;
       if (data.result.photo && data.result.photo.small_file_id) {
           const fileRes = await fetch(`https://api.telegram.org/bot${global_env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${data.result.photo.small_file_id}`);
           const fileData = await fileRes.json();
           if (fileData.ok) {
              has_photo = true;
              file_path = fileData.result.file_path;
           }
       }
       const info = { title, has_photo, file_path };
       setChatInfoCache(chatId, info);
       return res.json({ title: info.title, has_photo: info.has_photo });
    }
    return res.json({ title: chatId, has_photo: false });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/miniapp/chat_photo/:id', async (req, res) => {
  try {
    const chatId = req.params.id;
    const info = chatInfoCache.get(chatId);
    if (!info || !info.file_path) return res.status(404).send('Not found');
    
    const photoRes = await fetch(`https://api.telegram.org/file/bot${global_env.TELEGRAM_BOT_TOKEN}/${info.file_path}`);
    if (!photoRes.ok) return res.status(404).send('Not found');
    
    res.set('Content-Type', photoRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    
    // Pipe the response body to Express res
    const arrayBuffer = await photoRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch(e) {
    res.status(500).send('Error');
  }
});

app.get('/api/miniapp/data', async (req, res) => {
  try {
    const chatId = getAuthChatId(req, global_env);
    if (!chatId) {
      return res.status(401).json({ error: 'Unauthorized: Valid Telegram initData required' });
    }
    
    // 1. Fetch Tokens
    const coinsQuery = await env.DB.prepare(`
      SELECT t.* FROM coin_trackers t
      JOIN coin_collections c ON t.collection_id = c.id
      JOIN profiles p ON c.profile_id = p.id
      WHERE p.chat_id = ?
    `).bind(chatId).all();

    const collectionsQuery = await env.DB.prepare(`
      SELECT c.* FROM coin_collections c
      JOIN profiles p ON c.profile_id = p.id
      WHERE p.chat_id = ?
    `).bind(chatId).all();

    // 2. Fetch NFTs
    const nftsQuery = await env.DB.prepare('SELECT * FROM price_alerts WHERE chat_id = ? AND is_active = 1').bind(chatId).all();

    // 3. Fetch Wallets
    const evmQuery = await env.DB.prepare('SELECT * FROM evm_wallets WHERE chat_id = ?').bind(chatId).all();
    const solQuery = await env.DB.prepare('SELECT * FROM solana_wallets WHERE chat_id = ?').bind(chatId).all();
    const profileQuery = await env.DB.prepare('SELECT name FROM profiles WHERE chat_id = ?').bind(chatId).first();

    res.json({ 
        profileName: profileQuery ? profileQuery.name : null,
        collections: collectionsQuery.results || [],
        coins: coinsQuery.results || [], 
        nfts: nftsQuery.results || [], 
        evm: evmQuery.results || [], 
        sol: solQuery.results || [] 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.delete('/api/miniapp/profile', async (req, res) => {
  try {
    const authChatId = getAuthChatId(req, global_env);
    if (!authChatId) {
      return res.status(401).json({ error: 'Unauthorized: Valid Telegram initData required' });
    }
    const chatId = authChatId;
    let profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chatId).first();
    if (profile) {
      const collections = await env.DB.prepare('SELECT id FROM coin_collections WHERE profile_id = ?').bind(profile.id).all();
      if (collections.results) {
         for (let col of collections.results) {
            await env.DB.prepare('DELETE FROM coin_trackers WHERE collection_id = ?').bind(col.id).run();
         }
      }
      await env.DB.prepare('DELETE FROM coin_collections WHERE profile_id = ?').bind(profile.id).run();
      await env.DB.prepare('DELETE FROM profiles WHERE chat_id = ?').bind(chatId).run();
      
      // Also delete NFTs and Wallets associated with this chat_id to fully clear the profile
      await env.DB.prepare('DELETE FROM price_alerts WHERE chat_id = ?').bind(chatId).run();
      await env.DB.prepare('DELETE FROM evm_wallets WHERE chat_id = ?').bind(chatId).run();
      await env.DB.prepare('DELETE FROM solana_wallets WHERE chat_id = ?').bind(chatId).run();
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/miniapp/profile', async (req, res) => {
  try {
    const authChatId = getAuthChatId(req, global_env);
    const chatId = authChatId || req.body?.chat_id;
    if (!chatId) {
      return res.status(401).json({ error: 'Unauthorized: Valid Telegram initData required' });
    }
    const { name } = req.body;
    let profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chatId).first();
    if (!profile) {
       await env.DB.prepare('INSERT INTO profiles (chat_id, name, created_at) VALUES (?, ?, ?)').bind(chatId, name || 'Мой профиль', new Date().toISOString()).run();
    } else {
       await env.DB.prepare('UPDATE profiles SET name = ? WHERE chat_id = ?').bind(name || 'Мой профиль', chatId).run();
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/miniapp/search_coin', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json({ results: [] });
    
    let results = [];
    
    try {
       const binanceTokens = await searchBinance(query, global_env);
       if (binanceTokens && binanceTokens.length > 0) {
           let cgIcon = 'https://i.imgur.com/aFgZc4K.png';
           try {
               const cgRes = await fetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(query));
               if (cgRes.ok) {
                   const cgData = await cgRes.json();
                   if (cgData.coins && cgData.coins.length > 0) {
                       cgIcon = cgData.coins[0].thumb || cgIcon;
                   }
               }
           } catch(e) {}

           for (const t of binanceTokens) {
               results.push({
                   id: t.contract_address, name: t.name, ticker: t.ticker, type: 'CEX',
                   icon: cgIcon, price: t.priceUsd,
                   network: t.network, contract_address: t.contract_address
               });
           }
       }
    } catch(e) { console.error('Binance search error:', e); }

    try {
       if (results.length === 0) {
           const geckoTokens = await searchGeckoTerminal(query);
           if (geckoTokens && geckoTokens.length > 0) {
               for (const t of geckoTokens.slice(0,3)) {
                   results.push({
                       id: t.contract_address, name: t.name, ticker: t.ticker, type: 'DEX',
                       icon: 'https://i.imgur.com/aFgZc4K.png', price: t.priceUsd,
                       network: t.network, contract_address: t.contract_address
                   });
               }
           }
       }
    } catch(e) { console.error('GeckoTerminal search error:', e); }
    
    res.json({ results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/miniapp/coins', async (req, res) => {
  try {
    const { chat_id, collection_id, ticker, network, trigger_percent, contract_address, baseline_price, icon } = req.body;
    let profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chat_id).first();
    if (!profile) {
       await env.DB.prepare('INSERT INTO profiles (chat_id, name, created_at) VALUES (?, ?, ?)').bind(chat_id, 'Мой профиль', new Date().toISOString()).run();
       profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chat_id).first();
    }
    
    let collId = collection_id;
    if (!collId) {
      let coll = await env.DB.prepare('SELECT id FROM coin_collections WHERE profile_id = ?').bind(profile.id).first();
      if (!coll) {
         await env.DB.prepare('INSERT INTO coin_collections (profile_id) VALUES (?)').bind(profile.id).run();
         coll = await env.DB.prepare('SELECT id FROM coin_collections WHERE profile_id = ?').bind(profile.id).first();
      }
      collId = coll.id;
    }

    await env.DB.prepare('INSERT INTO coin_trackers (collection_id, ticker, network, trigger_percent, baseline_price, contract_address, icon) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(collId, ticker, network, trigger_percent, baseline_price || 0, contract_address || null, icon || null).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/miniapp/collections', async (req, res) => {
  try {
    const { chat_id, name } = req.body;
    let profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chat_id).first();
    if (!profile) {
       await env.DB.prepare('INSERT INTO profiles (chat_id, name, created_at) VALUES (?, ?, ?)').bind(chat_id, 'Мой профиль', new Date().toISOString()).run();
       profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chat_id).first();
    }
    await env.DB.prepare('INSERT INTO coin_collections (profile_id, name, created_at) VALUES (?, ?, ?)').bind(profile.id, name || 'Collection', new Date().toISOString()).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/miniapp/collections/:id/chat', async (req, res) => {
  try {
    const { chat_id, target_chat } = req.body;
    await env.DB.prepare('UPDATE coin_collections SET target_chat_id = ? WHERE id = ? AND profile_id = (SELECT id FROM profiles WHERE chat_id = ?)')
      .bind(target_chat, req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/miniapp/coins/:id', async (req, res) => {
  try {
    const { chat_id, trigger_percent } = req.body;
    await env.DB.prepare('UPDATE coin_trackers SET trigger_percent = ? WHERE id = ? AND collection_id IN (SELECT id FROM coin_collections WHERE profile_id = (SELECT id FROM profiles WHERE chat_id = ?))')
      .bind(trigger_percent, req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/miniapp/coins/:id/chat', async (req, res) => {
  try {
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/miniapp/coins/:id', async (req, res) => {
  try {
    const { chat_id } = req.body;
    await env.DB.prepare('DELETE FROM coin_trackers WHERE id = ? AND collection_id IN (SELECT id FROM coin_collections WHERE profile_id = (SELECT id FROM profiles WHERE chat_id = ?))')
      .bind(req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/miniapp/nfts', async (req, res) => {
  try {
    const { chat_id, collection_slug, threshold_percent } = req.body;
    let slug = collection_slug.trim();
    if (slug.includes('opensea.io/collection/')) {
        const parts = slug.split('opensea.io/collection/');
        slug = parts[1].split('/')[0].split('?')[0];
    }
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO price_alerts (chat_id, collection_slug, collection_name, threshold_percent, baseline_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(chat_id, slug, slug, threshold_percent, 0, now, now).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/miniapp/nfts/:id', async (req, res) => {
  try {
    const { chat_id, threshold_percent } = req.body;
    await env.DB.prepare('UPDATE price_alerts SET threshold_percent = ? WHERE id = ? AND chat_id = ?')
      .bind(threshold_percent, req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/miniapp/nfts/:id', async (req, res) => {
  try {
    const { chat_id } = req.body;
    await env.DB.prepare('DELETE FROM price_alerts WHERE id = ? AND chat_id = ?')
      .bind(req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/miniapp/wallets/evm', async (req, res) => {
  try {
    const { chat_id, address, name } = req.body;
    await env.DB.prepare('INSERT INTO evm_wallets (chat_id, address, name) VALUES (?, ?, ?)')
      .bind(chat_id, address, name).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/miniapp/wallets/evm/:id/filters', async (req, res) => {
  try {
    const { chat_id, filter_swaps, filter_transfers, filter_nfts, filter_mints } = req.body;
    await env.DB.prepare('UPDATE evm_wallets SET filter_swaps = ?, filter_transfers = ?, filter_nfts = ?, filter_mints = ? WHERE id = ? AND chat_id = ?')
      .bind(filter_swaps, filter_transfers, filter_nfts, filter_mints, req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/miniapp/wallets/evm/:id', async (req, res) => {
  try {
    const { chat_id } = req.body;
    await env.DB.prepare('DELETE FROM evm_wallets WHERE id = ? AND chat_id = ?')
      .bind(req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/miniapp/wallets/solana', async (req, res) => {
    try {
      const { chat_id, address, name } = req.body;
      await global_env.DB.prepare('INSERT INTO solana_wallets (chat_id, address, name) VALUES (?, ?, ?)')
        .bind(chat_id, address, name).run();
      
      const walletsQuery = await global_env.DB.prepare('SELECT address FROM solana_wallets').all();
      const addresses = (walletsQuery.results || []).map(w => w.address);
      if (addresses.length > 0) {
          const { updateWebhook } = await import('./src/helius.js');
          await updateWebhook(global_env, addresses).catch(e => console.error('Helius webhook error:', e));
      }

      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/miniapp/wallets/solana/:id/filters', async (req, res) => {
  try {
    const { chat_id, filter_swaps, filter_transfers, filter_nfts, filter_mints } = req.body;
    await env.DB.prepare('UPDATE solana_wallets SET filter_swaps = ?, filter_transfers = ?, filter_nfts = ?, filter_mints = ? WHERE id = ? AND chat_id = ?')
      .bind(filter_swaps, filter_transfers, filter_nfts, filter_mints, req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.delete('/api/miniapp/wallets/solana/:id', async (req, res) => {
    try {
      const { chat_id } = req.body;
      await global_env.DB.prepare('DELETE FROM solana_wallets WHERE id = ? AND chat_id = ?')
        .bind(req.params.id, chat_id).run();
      
      const walletsQuery = await global_env.DB.prepare('SELECT address FROM solana_wallets').all();
      const addresses = (walletsQuery.results || []).map(w => w.address);
      const { updateWebhook } = await import('./src/helius.js');
      await updateWebhook(global_env, addresses).catch(e => console.error('Helius webhook error:', e));

      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});


app.get('/api/miniapp/admin/test_parser', async (req, res) => {
  const authChatId = getAuthChatId(req, global_env);
  const adminChatId = global_env.ADMIN_CHAT_ID || '332680373';
  if (global_env.TELEGRAM_BOT_TOKEN ? (authChatId !== adminChatId) : (req.query.chat_id !== adminChatId && authChatId !== adminChatId)) {
    return res.status(403).send('Forbidden');
  }
  
  res.json({ success: true, message: 'Started parser test' });
});

app.post('/api/miniapp/admin/parser_targets', async (req, res) => {
  const env = global_env;
  try {
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    const { chat_id, urls, category } = req.body || {};
    if (env.TELEGRAM_BOT_TOKEN ? (authChatId !== adminChatId) : (chat_id !== adminChatId && authChatId !== adminChatId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const targetCategory = (category || 'nft').toLowerCase().trim();
    
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS x_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        avatar_url TEXT,
        followers_count INTEGER DEFAULT 0,
        category TEXT DEFAULT 'nft',
        created_at TEXT,
        is_active INTEGER DEFAULT 1
      )
    `).run();

    let added = 0;
    for (let url of (urls || [])) {
      if (!url.trim()) continue;
      let username = url;
      try {
        const parsed = new URL(url);
        username = parsed.pathname.split('/').filter(p => p).pop();
      } catch(e) {
        username = url.replace('@', '').replace('https://x.com/', '').replace('https://twitter.com/', '').split('/')[0].trim();
      }
      if (username) {
         try {
           await env.DB.prepare('INSERT OR IGNORE INTO x_list (username, category, created_at, is_active) VALUES (?, ?, ?, 1)')
             .bind(username.toLowerCase(), targetCategory, new Date().toISOString()).run();
           if (category) {
             await env.DB.prepare('UPDATE x_list SET category = ? WHERE lower(username) = lower(?)')
               .bind(targetCategory, username.toLowerCase()).run();
           }
           added++;
         } catch(e) { console.error('insert x_list err', e) }
      }
    }
    res.json({ success: true, added });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/miniapp/admin/stats', async (req, res) => {
  const env = global_env;
  try {
    const authChatId = getAuthChatId(req, env);
    const adminChatId = env.ADMIN_CHAT_ID || '332680373';
    if (env.TELEGRAM_BOT_TOKEN ? (authChatId !== adminChatId) : (req.query.chat_id !== adminChatId && authChatId !== adminChatId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const users = await env.DB.prepare('SELECT COUNT(*) as c FROM profiles').first();
    const trackers = await env.DB.prepare('SELECT COUNT(*) as c FROM coin_trackers').first();
    const alerts = await env.DB.prepare('SELECT COUNT(*) as c FROM price_alerts').first();
    const xlist = await env.DB.prepare('SELECT COUNT(*) as c FROM x_list WHERE is_active = 1').first().catch(() => ({c:0}));
    const tweets = await env.DB.prepare('SELECT COUNT(*) as c FROM tweets').first().catch(() => ({c:0}));
    res.json({ success: true, stats: { 
       users: users?.c || 0, 
       trackers: trackers?.c || 0, 
       alerts: alerts?.c || 0,
       xlist: xlist?.c || 0,
       tweets: tweets?.c || 0
    } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/test-daily', async (req, res) => {
  try {
    const r = await sendDailySummary(global_env, new Date(), { force: true });
    res.json(r);
  } catch(e) {
    res.json({error: e.message});
  }
});

app.get('/test-calendar-reminders', async (req, res) => {
  try {
    const r = await checkCalendarReminders(global_env);
    res.json(r);
  } catch(e) {
    res.json({error: e.message});
  }
});

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    // Register webhook with Telegram
    try {
        const webhookUrl = `https://45-158-185-9.nip.io/telegram/webhook`;
        const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const d = await r.json();
        console.log('Webhook set:', d.ok ? 'OK' : d.description);
    } catch(e) { console.error("Webhook setup error:", e); }
});



// Crons
// Calendar events reminder cron (every 6 hours)
cron.schedule('0 */6 * * *', async () => {
    console.log('Running Calendar reminders cron...');
    try {
        await checkCalendarReminders(env);
    } catch (e) {
        console.error('[CRON ERROR] checkCalendarReminders:', e);
    }
});

cron.schedule('*/5 * * * *', async () => {
    console.log('Running 5m crons...');
    try {
        await checkPriceAlerts(env);
    } catch (e) {
        console.error('[CRON ERROR] checkPriceAlerts:', e);
    }
    try {
        await checkCoinAlerts(env);
    } catch (e) {
        console.error('[CRON ERROR] checkCoinAlerts:', e);
    }
});