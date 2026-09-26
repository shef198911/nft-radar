const fs = require('fs');

// Patch profiles.js
let profilesCode = fs.readFileSync('worker/src/profiles.js', 'utf8');

// Replace imports
profilesCode = profilesCode.replace(
  `import { searchGeckoTerminal } from './geckoterminal.js';`,
  `import { searchGeckoTerminal } from './geckoterminal.js';\nimport { searchBinance } from './binance.js';`
);

// In processCoinQuery
profilesCode = profilesCode.replace(
  `const tokens = await searchGeckoTerminal(query);`,
  `let tokens = await searchBinance(query, ctx.env);\n  if (!tokens || tokens.length === 0) {\n    tokens = await searchGeckoTerminal(query);\n  }`
);

// In handleCoinSelect
profilesCode = profilesCode.replace(
  `const tokens = await searchGeckoTerminal(contract);`,
  `let tokens = await searchBinance(contract, ctx.env);\n  if (!tokens || tokens.length === 0) {\n    tokens = await searchGeckoTerminal(contract);\n  }`
);

fs.writeFileSync('worker/src/profiles.js', profilesCode);

// Patch telegram-grammy.js
let grammyCode = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

grammyCode = grammyCode.replace(
  `import { getGeckoTerminalTokensByNetwork } from './geckoterminal.js';`,
  `import { getGeckoTerminalTokensByNetwork } from './geckoterminal.js';\nimport { getBinancePrices } from './binance.js';`
);

const oldLoop = `for (const network of Object.keys(byNetwork)) {
     const addrs = Array.from(byNetwork[network]);
     // Batch into 30
     for (let i = 0; i < addrs.length; i += 30) {
        const batch = addrs.slice(i, i + 30);
        const tokens = await getGeckoTerminalTokensByNetwork(network, batch);
        for (const t of tokens) {
           currentPrices[network + '_' + t.contract_address] = t.priceUsd;
        }
     }
  }`;

const newLoop = `for (const network of Object.keys(byNetwork)) {
     const addrs = Array.from(byNetwork[network]);
     
     if (network === 'binance') {
         // Fetch from Binance API
         const binancePrices = await getBinancePrices(addrs, env);
         for (const [symbol, price] of Object.entries(binancePrices)) {
             currentPrices['binance_' + symbol] = price;
         }
         continue;
     }

     // Batch into 30
     for (let i = 0; i < addrs.length; i += 30) {
        const batch = addrs.slice(i, i + 30);
        const tokens = await getGeckoTerminalTokensByNetwork(network, batch);
        for (const t of tokens) {
           currentPrices[network + '_' + t.contract_address] = t.priceUsd;
        }
     }
  }`;
  
grammyCode = grammyCode.replace(oldLoop, newLoop);

const oldLink = `<a href="https://geckoterminal.com/\${tracker.network}/pools/\${tracker.contract_address}">🔗 Открыть график GeckoTerminal</a>`;
const newLink = `\${tracker.network === 'binance' ? \`<a href="https://www.binance.com/en/trade/\${tracker.ticker}_USDT?type=spot">🔗 Открыть график Binance</a>\` : \`<a href="https://geckoterminal.com/\${tracker.network}/pools/\${tracker.contract_address}">🔗 Открыть график GeckoTerminal</a>\`}`;

grammyCode = grammyCode.replace(oldLink, newLink);

fs.writeFileSync('worker/src/telegram-grammy.js', grammyCode);

