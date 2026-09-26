const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');

code = code.replace(/else if \(msg.network === 'Ethereum'\) netIcon = '🔵';/, `else if (msg.network === 'Ethereum' || msg.network === 'ETH') netIcon = '<tg-emoji emoji-id="5400219289301054663">🌐</tg-emoji>';`);

fs.writeFileSync('worker/src/index.js', code);
