const fs = require('fs');

let code = fs.readFileSync('worker/src/alchemy.js', 'utf8');

const getExplorerBlock = `
  const getExplorer = (net, hash) => {
    switch(net) {
      case 'ETH_MAINNET': return \`https://etherscan.io/tx/\${hash}\`;
      case 'ARB_MAINNET': return \`https://arbiscan.io/tx/\${hash}\`;
      case 'OPT_MAINNET': return \`https://optimistic.etherscan.io/tx/\${hash}\`;
      case 'MATIC_MAINNET': return \`https://polygonscan.com/tx/\${hash}\`;
      case 'BASE_MAINNET': return \`https://basescan.org/tx/\${hash}\`;
      case 'BNB_MAINNET': return \`https://bscscan.com/tx/\${hash}\`;
      case 'AVAX_MAINNET': return \`https://snowtrace.io/tx/\${hash}\`;
      case 'LINEA_MAINNET': return \`https://lineascan.build/tx/\${hash}\`;
      case 'ZKSYNC_MAINNET': return \`https://explorer.zksync.io/tx/\${hash}\`;
      case 'ROBINHOOD_MAINNET': return \`https://explorer.robinhood.com/tx/\${hash}\`;
      case 'SCROLL_MAINNET': return \`https://scrollscan.com/tx/\${hash}\`;
      default: return \`https://etherscan.io/tx/\${hash}\`;
    }
  };

  const getTokenUrl = (net, contractAddress) => {
    if (!contractAddress) return null;
    switch(net) {
      case 'ETH_MAINNET': return \`https://etherscan.io/token/\${contractAddress}\`;
      case 'ARB_MAINNET': return \`https://arbiscan.io/token/\${contractAddress}\`;
      case 'OPT_MAINNET': return \`https://optimistic.etherscan.io/token/\${contractAddress}\`;
      case 'MATIC_MAINNET': return \`https://polygonscan.com/token/\${contractAddress}\`;
      case 'BASE_MAINNET': return \`https://basescan.org/token/\${contractAddress}\`;
      case 'BNB_MAINNET': return \`https://bscscan.com/token/\${contractAddress}\`;
      case 'AVAX_MAINNET': return \`https://snowtrace.io/token/\${contractAddress}\`;
      case 'LINEA_MAINNET': return \`https://lineascan.build/token/\${contractAddress}\`;
      case 'ZKSYNC_MAINNET': return \`https://explorer.zksync.io/token/\${contractAddress}\`;
      case 'ROBINHOOD_MAINNET': return \`https://explorer.robinhood.com/token/\${contractAddress}\`;
      case 'SCROLL_MAINNET': return \`https://scrollscan.com/token/\${contractAddress}\`;
      default: return \`https://etherscan.io/token/\${contractAddress}\`;
    }
  };
`;

const replaceGetExplorer = /const getExplorer = [\s\S]*?default: return \`https:\/\/etherscan\.io\/tx\/\$\{hash\}\`;\s*\}\s*\};\s*/;

code = code.replace(replaceGetExplorer, getExplorerBlock);

const oldPush = `
    if (isExternal || isInternal || isToken) {
      messages.push({ category: 'transfer', network: chainName, asset: asset || 'ETH', value: val, hash, from, to, explorerUrl });
    } else if (isERC721) {
      messages.push({ category: 'nft', network: chainName, asset: 'NFT', tokenId: tx.erc721TokenId || 'Unknown', hash, from, to, explorerUrl });
    }`;

const newPush = `
    const contractAddress = tx.rawContract ? tx.rawContract.address : null;
    const tokenUrl = getTokenUrl(network, contractAddress);

    if (isExternal || isInternal || isToken) {
      messages.push({ category: 'transfer', network: chainName, asset: asset || 'ETH', value: val, hash, from, to, explorerUrl, tokenUrl });
    } else if (isERC721) {
      messages.push({ category: 'nft', network: chainName, asset: 'NFT', tokenId: tx.erc721TokenId || 'Unknown', hash, from, to, explorerUrl, tokenUrl });
    }`;

code = code.replace(oldPush, newPush);

fs.writeFileSync('worker/src/alchemy.js', code);
