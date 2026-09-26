const fs = require('fs');
let code = fs.readFileSync('worker/src/alchemy.js', 'utf8');
code = code.replace("const isToken = tx.category === 'token';", "const isToken = tx.category === 'token' || tx.category === 'erc20';");
fs.writeFileSync('worker/src/alchemy.js', code);
