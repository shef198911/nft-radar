const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');
if (!code.includes("import { parseTransaction }")) {
  code = code.replace("import { Router } from 'itty-router';", "import { Router } from 'itty-router';\nimport { parseTransaction } from './helius.js';");
  fs.writeFileSync('worker/src/index.js', code);
}
