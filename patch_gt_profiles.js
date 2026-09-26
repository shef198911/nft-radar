const fs = require('fs');
let code = fs.readFileSync('worker/src/profiles.js', 'utf8');

code = code.replace("import { searchDexScreener } from './dexscreener.js';", "import { searchGeckoTerminal } from './geckoterminal.js';");
code = code.split("searchDexScreener(query)").join("searchGeckoTerminal(query)");
code = code.split("searchDexScreener(contract)").join("searchGeckoTerminal(contract)");
code = code.split("Ищу токен на DexScreener...").join("Ищу токен на GeckoTerminal...");
code = code.split("🔗 DexScreener").join("🔗 GeckoTerminal");
code = code.split("url_https://dexscreener.com/").join("url_https://geckoterminal.com/");

fs.writeFileSync('worker/src/profiles.js', code);
