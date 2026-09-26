const fs = require('fs');

let code = fs.readFileSync('worker/src/dexscreener.js', 'utf8');
code = code.replace(
  "if (!res.ok) return [];",
  "if (!res.ok) { console.error('DexScreener fetch failed', res.status, res.statusText); return []; }"
);
fs.writeFileSync('worker/src/dexscreener.js', code);
