const fs = require('fs');

let code = fs.readFileSync('worker/src/alchemy.js', 'utf8');

code = code.replace(/let messages = \[\];[\s\S]*return messages;\n\}/, `let messages = [];

  for (const tx of body.event.activity) {
    const isToken = tx.category === 'token';
    const isInternal = tx.category === 'internal';
    const isExternal = tx.category === 'external'; // Native ETH
    const isERC721 = tx.category === 'erc721' || tx.category === 'erc1155';

    const from = tx.fromAddress || tx.from;
    const to = tx.toAddress || tx.to;
    const hash = tx.hash;
    const val = tx.value; 
    const asset = tx.asset; 
    const explorerUrl = getExplorer(network, hash);

    if (isExternal || isInternal || isToken) {
      messages.push({ category: 'transfer', network: chainName, asset: asset || 'ETH', value: val, hash, from, to, explorerUrl });
    } else if (isERC721) {
      messages.push({ category: 'nft', network: chainName, asset: 'NFT', tokenId: tx.erc721TokenId || 'Unknown', hash, from, to, explorerUrl });
    }
  }

  return messages;
}`);

fs.writeFileSync('worker/src/alchemy.js', code);
