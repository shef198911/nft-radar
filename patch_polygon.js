const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');

const oldRegex = /const netIcon = msg\.network === 'Base' \? '🔵' : msg\.network === 'Polygon' \? '🟣' : msg\.network === 'Arbitrum' \? '🔵' : msg\.network === 'Optimism' \? '🔴' : '🔗';/;

const newCode = `let netIcon = '🔗';
            if (msg.network === 'Polygon') netIcon = '<tg-emoji emoji-id="5397954355477377973">🟣</tg-emoji>';
            else if (msg.network === 'Base') netIcon = '🔵';
            else if (msg.network === 'Arbitrum') netIcon = '🔵';
            else if (msg.network === 'Optimism') netIcon = '🔴';
            else if (msg.network === 'Ethereum') netIcon = '🔵';`;

code = code.replace(oldRegex, newCode);

fs.writeFileSync('worker/src/index.js', code);
