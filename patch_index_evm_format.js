const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');

const evmWebhookCode = `
router.post('/evm/webhook', async (request, env) => {
  try {
    const body = await request.json();
    const { parseAlchemyWebhook } = await import('./alchemy.js');
    const messages = parseAlchemyWebhook(body);
    if (!messages || messages.length === 0) return new Response('OK');
    
    for (const msg of messages) {
      const fromAddr = msg.from ? msg.from.toLowerCase() : '';
      const toAddr = msg.to ? msg.to.toLowerCase() : '';
      
      const { results } = await env.DB.prepare('SELECT w.chat_id, w.name, w.address, f.notify_transfer, f.notify_swap, f.notify_nft FROM evm_wallets w JOIN evm_filters f ON w.id = f.wallet_id WHERE LOWER(w.address) = ? OR LOWER(w.address) = ?').bind(fromAddr, toAddr).all();
      
      if (results && results.length > 0) {
        for (const w of results) {
          let shouldSend = false;
          if (msg.category === 'transfer' && w.notify_transfer) shouldSend = true;
          if (msg.category === 'swap' && w.notify_swap) shouldSend = true;
          if (msg.category === 'nft' && w.notify_nft) shouldSend = true;
          
          if (shouldSend) {
            const isReceived = w.address.toLowerCase() === toAddr;
            const shorten = (a) => a ? \`\${a.slice(0, 4)}..\${a.slice(-4)}\` : 'Unknown';
            const counterparty = isReceived ? shorten(fromAddr) : shorten(toAddr);
            
            const netIcon = msg.network === 'Base' ? '🔵' : msg.network === 'Polygon' ? '🟣' : msg.network === 'Arbitrum' ? '🔵' : msg.network === 'Optimism' ? '🔴' : '🔗';
            
            let formatted = \`<a href="https://etherscan.io/address/\${w.address}"><b>\${w.name}</b></a> · \${netIcon} <b>\${msg.network.toUpperCase()}</b>\n\`;
            
            if (msg.category === 'transfer') {
                const icon = isReceived ? '🤑' : '💸';
                const action = isReceived ? 'Получено:' : 'Отправлено:';
                const dir = isReceived ? '📥 От:' : '📤 На:';
                formatted += \`\n\${icon} \${action} \${msg.value} \${msg.asset} \${dir} \${counterparty}\`;
            } else {
                const icon = isReceived ? '🖼' : '🖼';
                const action = isReceived ? 'Получен NFT:' : 'Отправлен NFT:';
                const dir = isReceived ? '📥 От:' : '📤 На:';
                formatted += \`\n\${icon} \${action} ID \${msg.tokenId} \${dir} \${counterparty}\`;
            }
            
            formatted += \`\n<a href="\${msg.explorerUrl}">🔗 Tx hash</a>\`;

            await fetch(\`https://api.telegram.org/bot\${env.TELEGRAM_BOT_TOKEN}/sendMessage\`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: w.chat_id, text: formatted, parse_mode: 'HTML', disable_web_page_preview: true })
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

code = code.replace(/router\.post\('\/evm\/webhook', async \(request, env\) => \{[\s\S]*?return new Response\('OK'\);\n  \} catch \(e\) \{\n    console\.error\(e\);\n    return new Response\('OK'\);\n  \}\n\}\);/, evmWebhookCode.trim());

fs.writeFileSync('worker/src/index.js', code);
