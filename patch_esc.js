const fs = require('fs');
let code = fs.readFileSync('worker/src/alchemy.js', 'utf8');
code = code.replace(/\\`/g, '`');
code = code.replace(/\\\$/g, '$');
fs.writeFileSync('worker/src/alchemy.js', code);
