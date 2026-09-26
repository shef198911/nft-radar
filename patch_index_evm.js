const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');

const evmWebhookCode = `
router.post('/evm/webhook', async (request, env) => {
  try {
    const body = await request.json();
    const { parseAlchemyWebhook } = await import('./alchemy.js');
    const messages = parseAlchemyWebhook(body);
    if (!messages || messages.length === 0) return new Response('OK');
    
    // We get the involved addresses
    // For each message, we need to check which tracked wallet matches
    for (const msg of messages) {
      const fromAddr = msg.from ? msg.from.toLowerCase() : '';
      const toAddr = msg.to ? msg.to.toLowerCase() : '';
      
      const { results } = await env.DB.prepare('SELECT w.chat_id, f.notify_transfer, f.notify_swap, f.notify_nft FROM evm_wallets w JOIN evm_filters f ON w.id = f.wallet_id WHERE LOWER(w.address) = ? OR LOWER(w.address) = ?').bind(fromAddr, toAddr).all();
      
      if (results && results.length > 0) {
        for (const w of results) {
          let shouldSend = false;
          if (msg.category === 'transfer' && w.notify_transfer) shouldSend = true;
          if (msg.category === 'swap' && w.notify_swap) shouldSend = true;
          if (msg.category === 'nft' && w.notify_nft) shouldSend = true;
          
          if (shouldSend) {
            await fetch(\`https://api.telegram.org/bot\${env.TELEGRAM_BOT_TOKEN}/sendMessage\`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: w.chat_id, text: msg.formatted, parse_mode: 'HTML', disable_web_page_preview: true })
            });
          }
        }
      }
    }
    return new Response('OK');
  } catch (e) {
    console.error(e);
    return new Response('OK');
  }
});
`;

code = code.replace("router.all('*', () => new Response('Not Found', { status: 404 }));", evmWebhookCode + "\nrouter.all('*', () => new Response('Not Found', { status: 404 }));");

fs.writeFileSync('worker/src/index.js', code);
