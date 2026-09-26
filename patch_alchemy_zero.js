const fs = require('fs');

let code = fs.readFileSync('worker/src/alchemy.js', 'utf8');

const replacement = `
    const explorerUrl = getExplorer(network, hash);

    if (val === 0 || val === '0' || val === 0.0) continue;

    if (isExternal || isInternal || isToken) {`;

code = code.replace(`
    const explorerUrl = getExplorer(network, hash);

    if (isExternal || isInternal || isToken) {`, replacement);

fs.writeFileSync('worker/src/alchemy.js', code);
