const fs = require('fs');
let code = fs.readFileSync('worker/src/index.js', 'utf8');

code = code.replace(`import { checkPriceAlerts, handleTelegramWebhook } from './telegram-bot.js';`, `import { checkPriceAlerts, handleTelegramWebhook } from './telegram-bot.js';\nimport { parseTransaction } from './helius.js';`);

const heliusRoute = `
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
        const msg = \`👛 <b>\${matchedWallet.name}</b>\\n\\n\${parsed.formatted}\`;
        await fetch(\`https://api.telegram.org/bot\${env.TELEGRAM_BOT_TOKEN}/sendMessage\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: matchedWallet.chat_id,
            text: msg,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: [[{ text: "👛 Открыть кошелёк", url: \`https://solscan.io/account/\${matchedWallet.address}\` }]] }
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
`;

code = code.replace(`router.post('/telegram/webhook', async (request, env) => {`, heliusRoute + `\nrouter.post('/telegram/webhook', async (request, env) => {`);

fs.writeFileSync('worker/src/index.js', code);
