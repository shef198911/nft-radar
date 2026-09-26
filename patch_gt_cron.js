const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

code = code.replace("import { searchDexScreener, getDexScreenerTokensByAddress } from './dexscreener.js';", "import { getGeckoTerminalTokensByNetwork } from './geckoterminal.js';");

// Rewrite checkCoinAlerts
const startIdx = code.indexOf('export async function checkCoinAlerts(env) {');
const endIdx = code.indexOf('export async function checkPriceAlerts(env) {');

const newFunc = `export async function checkCoinAlerts(env) {
  const { results: trackers } = await env.DB.prepare(\`
    SELECT t.*, c.target_chat_id, p.chat_id as owner_chat_id 
    FROM coin_trackers t 
    JOIN coin_collections c ON t.collection_id = c.id
    JOIN profiles p ON c.profile_id = p.id
  \`).all();
  
  if (!trackers || trackers.length === 0) return;

  // Group by network
  const byNetwork = {};
  for (const t of trackers) {
     if (!byNetwork[t.network]) byNetwork[t.network] = new Set();
     byNetwork[t.network].add(t.contract_address);
  }
  
  const currentPrices = {};
  
  for (const network of Object.keys(byNetwork)) {
     const addrs = Array.from(byNetwork[network]);
     // Batch into 30
     for (let i = 0; i < addrs.length; i += 30) {
        const batch = addrs.slice(i, i + 30);
        const tokens = await getGeckoTerminalTokensByNetwork(network, batch);
        for (const t of tokens) {
           currentPrices[network + '_' + t.contract_address] = t.priceUsd;
        }
     }
  }

  for (const tracker of trackers) {
    const currentPrice = currentPrices[tracker.network + '_' + tracker.contract_address];
    if (!currentPrice) continue;
    
    const basePrice = tracker.baseline_price;
    const diff = (currentPrice - basePrice) / basePrice * 100;
    
    if (Math.abs(diff) >= tracker.trigger_percent) {
       const isUp = diff > 0;
       const emoji = isUp ? '🚀' : '📉';
       const pStr = currentPrice < 0.001 ? currentPrice.toFixed(8) : currentPrice.toFixed(4);
       
       const msg = \`\${emoji} <b>$\${tracker.ticker}</b> (\${tracker.network.toUpperCase()})\\n\\nЦена изменилась на <b>\${Math.abs(diff).toFixed(2)}%</b>!\\n\\nСтарая цена: $\${basePrice}\\nНовая цена: $\${pStr}\\n\\n<a href="https://geckoterminal.com/\${tracker.network}/pools/\${tracker.contract_address}">🔗 Открыть график GeckoTerminal</a>\`;
       
       const chatId = tracker.target_chat_id || tracker.owner_chat_id;
       
       try {
         await fetch(\`https://api.telegram.org/bot\${env.TELEGRAM_BOT_TOKEN}/sendMessage\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true })
         });
         await env.DB.prepare('UPDATE coin_trackers SET baseline_price = ? WHERE id = ?').bind(currentPrice, tracker.id).run();
       } catch (e) {}
    }
  }
}
`;

code = code.substring(0, startIdx) + newFunc + code.substring(endIdx);
fs.writeFileSync('worker/src/telegram-grammy.js', code);
