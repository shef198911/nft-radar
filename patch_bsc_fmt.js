const fs = require('fs');

let alchemy = fs.readFileSync('worker/src/alchemy.js', 'utf8');
alchemy = alchemy.replace(
  "    'BASE_MAINNET': 'Base'",
  "    'BASE_MAINNET': 'Base',\n    'BNB_MAINNET': 'BSC'"
);
alchemy = alchemy.replace(
  "      case 'BASE_MAINNET': return `https://basescan.org/tx/${hash}`;",
  "      case 'BASE_MAINNET': return `https://basescan.org/tx/${hash}`;\n      case 'BNB_MAINNET': return `https://bscscan.com/tx/${hash}`;"
);
fs.writeFileSync('worker/src/alchemy.js', alchemy);

let idx = fs.readFileSync('worker/src/index.js', 'utf8');
idx = idx.replace(
  "            else if (msg.network === 'Optimism') netIcon = '🔴';",
  "            else if (msg.network === 'Optimism') netIcon = '🔴';\n            else if (msg.network === 'BSC') netIcon = '🟡';"
);
fs.writeFileSync('worker/src/index.js', idx);
