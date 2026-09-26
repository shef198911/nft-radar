const fs = require('fs');
let cfg = fs.readFileSync('worker/wrangler.jsonc', 'utf8');
if (!cfg.includes('HELIUS_API_KEY')) {
  cfg = cfg.replace('"vars": {', '"vars": {\n    "HELIUS_API_KEY": "df35408d-8969-4d22-bb67-cc686c6353b5",');
  fs.writeFileSync('worker/wrangler.jsonc', cfg);
}
