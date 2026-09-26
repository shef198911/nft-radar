const fs = require('fs');
let code = fs.readFileSync('worker/src/alchemy.js', 'utf8');

const oldNetworks = "const NETWORKS = ['ETH_MAINNET', 'ARB_MAINNET', 'OPT_MAINNET', 'BASE_MAINNET', 'MATIC_MAINNET'];";
const newNetworks = "const NETWORKS = ['ETH_MAINNET', 'BNB_MAINNET', 'MATIC_MAINNET', 'ARB_MAINNET', 'BASE_MAINNET'];";

code = code.replace(oldNetworks, newNetworks);
fs.writeFileSync('worker/src/alchemy.js', code);
