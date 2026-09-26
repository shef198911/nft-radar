const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');

const search = '${formatCrypto(msg.value)} ${msg.asset}';
const replace = '${formatCrypto(msg.value)} ${msg.tokenUrl ? `<a href="' + '${msg.tokenUrl}' + '">${msg.asset}</a>` : msg.asset}';

code = code.split(search).join(replace);

fs.writeFileSync('worker/src/index.js', code);
