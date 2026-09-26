const fs = require('fs');

let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const checkCoinAlertsStr = `
export async function checkCoinAlerts(env) {
  const { results: trackers } = await env.DB.prepare(\`
    SELECT t.*, c.target_chat_id, p.chat_id as owner_chat_id 
    FROM coin_trackers t 
    JOIN coin_collections c ON t.collection_id = c.id
    JOIN profiles p ON c.profile_id = p.id
  \`).all();
  
  if (!trackers || trackers.length === 0) return;

  const addresses = [...new Set(trackers.map(t => t.contract_address))];
  
  // Batch into 30
  const batches = [];
  for (let i = 0; i < addresses.length; i += 30) {
    batches.push(addresses.slice(i, i + 30));
  }
  
  const currentPrices = {};
  
  for (const batch of batches) {
    const tokens = await getDexScreenerTokensByAddress(batch);
    for (const t of tokens) {
      currentPrices[t.contract_address] = t.priceUsd;
    }
  }

  for (const tracker of trackers) {
    const currentPrice = currentPrices[tracker.contract_address];
    if (!currentPrice) continue;
    
    const basePrice = tracker.baseline_price;
    const diff = (currentPrice - basePrice) / basePrice * 100;
    
    // Check if absolute difference is greater than trigger percent
    if (Math.abs(diff) >= tracker.trigger_percent) {
       const isUp = diff > 0;
       const emoji = isUp ? '🚀' : '📉';
       const pStr = currentPrice < 0.001 ? currentPrice.toFixed(8) : currentPrice.toFixed(4);
       
       const msg = \`\${emoji} <b>$wait\${tracker.ticker}</b> (\${tracker.network.toUpperCase()})\\n\\nЦена изменилась на <b>\${Math.abs(diff).toFixed(2)}%</b>!\\n\\nСтарая цена: $\${basePrice}\\nНовая цена: $\${pStr}\\n\\n<a href="https://dexscreener.com/\${tracker.network}/\${tracker.contract_address}">🔗 Открыть график DexScreener</a>\`;
       
       const chatId = tracker.target_chat_id || tracker.owner_chat_id;
       
       try {
         await fetch(\`https://api.telegram.org/bot\${env.TELEGRAM_BOT_TOKEN}/sendMessage\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true })
         });
         
         // Update baseline so it doesn't spam
         await env.DB.prepare('UPDATE coin_trackers SET baseline_price = ? WHERE id = ?').bind(currentPrice, tracker.id).run();
       } catch (e) {
         console.error('Failed to send coin alert', e);
       }
    }
  }
}
`;

code = code.replace("export async function checkPriceAlerts(env) {", checkCoinAlertsStr + "\nexport async function checkPriceAlerts(env) {");

fs.writeFileSync('worker/src/telegram-grammy.js', code);
