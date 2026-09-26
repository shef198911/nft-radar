const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');

// 1. Add processEvmQueue function at the end of the file, just before export default
const processorCode = `
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
      const { results: wallets } = await env.DB.prepare(\`SELECT w.chat_id, w.name, w.address, f.notify_transfer, f.notify_nft FROM evm_wallets w JOIN evm_filters f ON w.id = f.wallet_id WHERE LOWER(w.address) IN (\${placeholders})\`).bind(...involvedArr).all();
      
      if (!wallets || wallets.length === 0) continue;
      
      for (const w of wallets) {
        const myAddr = w.address.toLowerCase();
        let myMsgs = txMsgs.filter(m => (m.from && m.from.toLowerCase() === myAddr) || (m.to && m.to.toLowerCase() === myAddr));
        myMsgs = myMsgs.filter(m => (m.category === 'transfer' && w.notify_transfer) || (m.category === 'nft' && w.notify_nft));
        
        if (myMsgs.length === 0) continue;
        
        const isMultiple = myMsgs.length > 1;
        const shorten = (a) => a ? \`\${a.slice(0, 4)}..\${a.slice(-4)}\` : 'Unknown';
        
        const net = myMsgs[0].network;
        let netIcon = '🔗';
        if (net === 'Polygon') netIcon = '<tg-emoji emoji-id="5397954355477377973">🟣</tg-emoji>';
        else if (net === 'Base' || net === 'Arbitrum' || net === 'Linea') netIcon = '🔵';
        else if (net === 'Optimism' || net === 'Avalanche' || net === 'Robinhood') netIcon = '🔴';
        else if (net === 'BSC') netIcon = '🟡';
        else if (net === 'Ethereum' || net === 'ETH') netIcon = '<tg-emoji emoji-id="5400219289301054663">🌐</tg-emoji>';
        
        let formatted = \`<a href="https://etherscan.io/address/\${w.address}"><b>\${w.name}</b></a> · \${netIcon} <b>\${net.toUpperCase()}</b>\\n\`;
        
        if (isMultiple) {
          formatted += \`\\n🔄 <b>Свап / Мульти-транзакция</b>\\n\`;
          for (const msg of myMsgs) {
            const isReceived = msg.to && msg.to.toLowerCase() === myAddr;
            if (msg.category === 'transfer') {
              formatted += \`\${isReceived ? '📥 Получено:' : '📤 Отправлено:'} \${msg.value} \${msg.asset}\\n\`;
            } else {
              formatted += \`\${isReceived ? '🖼 Получен' : '🖼 Отправлен'} NFT ID \${msg.tokenId}\\n\`;
            }
          }
        } else {
          const msg = myMsgs[0];
          const isReceived = msg.to && msg.to.toLowerCase() === myAddr;
          const counterparty = isReceived ? shorten(msg.from) : shorten(msg.to);
          
          if (msg.category === 'transfer') {
            const icon = isReceived ? '🤑' : '💸';
            formatted += \`\\n\${icon} \${isReceived ? 'Получено:' : 'Отправлено:'} \${msg.value} \${msg.asset} \${isReceived ? '📥 От:' : '📤 На:'} \${counterparty}\\n\`;
          } else {
            formatted += \`\\n🖼 \${isReceived ? 'Получен NFT:' : 'Отправлен NFT:'} ID \${msg.tokenId} \${isReceived ? '📥 От:' : '📤 На:'} \${counterparty}\\n\`;
          }
        }
        
        formatted += \`\\n<a href="\${myMsgs[0].explorerUrl}">🔗 Tx hash</a>\`;
        
        await fetch(\`https://api.telegram.org/bot\${env.TELEGRAM_BOT_TOKEN}/sendMessage\`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: w.chat_id, text: formatted, parse_mode: 'HTML', disable_web_page_preview: true })
        });
      }
    }
    
    // cleanup
    const ids = results.map(r => r.id);
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      await env.DB.prepare(\`DELETE FROM evm_queue WHERE id IN (\${ph})\`).bind(...ids).run();
    }
  } catch(e) {
    console.error('processEvmQueue error', e);
  }
}

export default {
`;

code = code.replace('export default {', processorCode);

// 2. Replace the evm/webhook route handler
const originalRouteRegex = /router\.post\('\/evm\/webhook', async \(request, env\) => \{[\s\S]*?return new Response\('OK'\);\s*\}\s*catch \([^\)]+\) \{\s*console\.error\([^\)]+\);\s*return new Response\('OK'\);\s*\}\s*\}\);/;

const newRoute = `router.post('/evm/webhook', async (request, env, ctx) => {
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
});`;

code = code.replace(originalRouteRegex, newRoute);

fs.writeFileSync('worker/src/index.js', code);
