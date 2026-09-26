const fs = require('fs');

let code = fs.readFileSync('worker/src/alchemy.js', 'utf8');

code = code.replace(/'POLYGON_MAINNET'/g, "'MATIC_MAINNET'");
code = code.replace(/body\.event\.network === 'POLYGON_MAINNET'/g, "body.event.network === 'MATIC_MAINNET'");

fs.writeFileSync('worker/src/alchemy.js', code);
