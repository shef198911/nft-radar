import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import cron from 'node-cron';
import Database from 'better-sqlite3';

// Import our original logic


import { startTelegramBot, checkPriceAlerts, checkCoinAlerts } from './src/telegram-grammy.js';

// Setup Express
const app = express();
app.use(cors());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static('/root/nft-radar/public'));
app.get('/', (req, res) => res.sendFile('/root/nft-radar/public/index.html'));
 // We will map it in upload
app.use(express.json({ limit: '50mb' }));

// Polyfills for Cloudflare Worker DB
const db = new Database('./bot.db');
db.pragma('journal_mode = WAL');

// Simple Cloudflare D1 adapter
const env = {
  DB: {
    prepare: (query) => {
      let binds = [];
      const stmtObj = {
        bind: (...args) => {
          binds = args;
          return stmtObj;
        },
        first: async () => db.prepare(query).get(...binds),
        all: async () => ({ results: db.prepare(query).all(...binds) }),
        run: async () => ({ success: true, meta: db.prepare(query).run(...binds) })
      };
      return stmtObj;
    },
    batch: async (statements) => {
       // Mock for batch
       const tx = db.transaction((stmts) => {
         for (const s of stmts) {
           s.run();
         }
       });
       tx(statements);
    }
  },
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY,
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  ALCHEMY_AUTH_TOKEN: process.env.ALCHEMY_AUTH_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

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

app.post('/ingest', async (req, res) => {
   res.json({ status: 'ok', send_decision: 'vps_proxy' });
});

// Cron Jobs
cron.schedule('*/5 * * * *', () => {
   console.log('Running 5m crons...');
   checkCoinAlerts(env);
});

cron.schedule('0 18 * * *', () => {
   console.log('Running daily crons...');
   
});

const PORT = 3000;

app.get('/api/miniapp/data', async (req, res) => {
  try {
    const chatId = req.query.chat_id || '332680373'; // Default to admin for testing if empty
    
    // 1. Fetch Tokens
    const coinsQuery = await env.DB.prepare(`
      SELECT t.* FROM coin_trackers t
      JOIN coin_collections c ON t.collection_id = c.id
      JOIN profiles p ON c.profile_id = p.id
      WHERE p.chat_id = ?
    `).bind(chatId).all();

    // 2. Fetch NFTs
    const nftsQuery = await env.DB.prepare('SELECT * FROM price_alerts WHERE chat_id = ? AND is_active = 1').bind(chatId).all();

    // 3. Fetch Wallets
    const evmQuery = await env.DB.prepare('SELECT * FROM evm_wallets WHERE chat_id = ?').bind(chatId).all();
    const solQuery = await env.DB.prepare('SELECT * FROM solana_wallets WHERE chat_id = ?').bind(chatId).all();

    res.json({ 
        coins: coinsQuery.results || [], 
        nfts: nftsQuery.results || [], 
        evm: evmQuery.results || [], 
        sol: solQuery.results || [] 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/miniapp/coins', async (req, res) => {
  try {
    const { chat_id, ticker, network, trigger_percent } = req.body;
    let profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chat_id).first();
    if (!profile) {
       await env.DB.prepare('INSERT INTO profiles (chat_id, name, created_at) VALUES (?, ?, ?)').bind(chat_id, 'User', new Date().toISOString()).run();
       profile = await env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(chat_id).first();
    }
    let coll = await env.DB.prepare('SELECT id FROM coin_collections WHERE profile_id = ?').bind(profile.id).first();
    if (!coll) {
       await env.DB.prepare('INSERT INTO coin_collections (profile_id) VALUES (?)').bind(profile.id).run();
       coll = await env.DB.prepare('SELECT id FROM coin_collections WHERE profile_id = ?').bind(profile.id).first();
    }
    await env.DB.prepare('INSERT INTO coin_trackers (collection_id, ticker, network, trigger_percent, baseline_price) VALUES (?, ?, ?, ?, ?)')
      .bind(coll.id, ticker, network, trigger_percent, '0').run();
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
    await env.DB.prepare('INSERT INTO price_alerts (chat_id, collection_slug, threshold_percent, baseline_price, is_active) VALUES (?, ?, ?, ?, 1)')
      .bind(chat_id, collection_slug, threshold_percent, '0').run();
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
    await env.DB.prepare('INSERT INTO solana_wallets (chat_id, address, name) VALUES (?, ?, ?)')
      .bind(chat_id, address, name).run();
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
    await env.DB.prepare('DELETE FROM solana_wallets WHERE id = ? AND chat_id = ?')
      .bind(req.params.id, chat_id).run();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});