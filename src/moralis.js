export async function createMoralisStream(env) {
  const stateKey = 'moralis_stream_id';
  const state = await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind(stateKey).first();
  
  if (state && state.value) return state.value;

  const response = await fetch('https://api.moralis-streams.com/streams/evm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.MORALIS_API_KEY
    },
    body: JSON.stringify({
      webhookUrl: 'https://nft-radar.icoshef.workers.dev/evm/webhook',
      description: 'EVM Wallet Tracker',
      tag: 'evm',
      includeNativeTxs: true,
      includeContractLogs: true,
      includeInternalTxs: true,
      chainIds: ['0x1', '0x38', '0x89', '0xa4b1', '0x2105', '0xa'], // ETH, BSC, Polygon, Arbitrum, Base, Optimism
      demo: false
    })
  });

  const data = await response.json();
  if (data.id) {
    await env.DB.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(stateKey, data.id).run();
    return data.id;
  }
  throw new Error('Failed to create Moralis Stream: ' + JSON.stringify(data));
}

export async function addAddressToMoralisStream(env, streamId, address) {
  await fetch(`https://api.moralis-streams.com/streams/evm/${streamId}/address`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.MORALIS_API_KEY
    },
    body: JSON.stringify({ address: address.toLowerCase() }) // Moralis accepts string or array
  });
}

export async function removeAddressFromMoralisStream(env, streamId, address) {
  await fetch(`https://api.moralis-streams.com/streams/evm/${streamId}/address`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.MORALIS_API_KEY
    },
    body: JSON.stringify({ address: address.toLowerCase() })
  });
}

// Format the webhook payload from Moralis
export function parseMoralisWebhook(body) {
  // Moralis payload structure:
  // body.txs, body.erc20Transfers, body.nftTransfers, body.chainId
  const chainId = body.chainId;
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const shorten = (addr) => addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : 'Unknown';

  const chainNames = {
    '0x1': 'Ethereum',
    '0x38': 'BSC',
    '0x89': 'Polygon',
    '0xa4b1': 'Arbitrum',
    '0x2105': 'Base',
    '0xa': 'Optimism'
  };
  const chainName = chainNames[chainId] || 'EVM';
  const explorerUrl = chainId === '0x38' ? 'https://bscscan.com/tx/' : 
                      chainId === '0x89' ? 'https://polygonscan.com/tx/' :
                      chainId === '0xa4b1' ? 'https://arbiscan.io/tx/' :
                      chainId === '0x2105' ? 'https://basescan.org/tx/' :
                      chainId === '0xa' ? 'https://optimistic.etherscan.io/tx/' :
                      'https://etherscan.io/tx/';

  let messages = [];

  // Parse Native Txs
  if (body.txs && body.txs.length > 0) {
    for (const tx of body.txs) {
      if (tx.value !== '0') {
        const val = (parseInt(tx.value) / 1e18).toFixed(4);
        const msg = `⟠ <b>NATIVE TRANSFER (${chainName})</b>\n\n💰 <b>Сумма:</b>\n${val} ETH/BNB/MATIC\n\n👤 <b>От:</b>\n${shorten(tx.fromAddress)}\n👤 <b>Кому:</b>\n${shorten(tx.toAddress)}\n\n⏳ ${time}\n<a href="${explorerUrl}${tx.hash}">[ 🔗 Открыть в Explorer ]</a>`;
        messages.push({ category: 'transfer', formatted: msg, hash: tx.hash, from: tx.fromAddress, to: tx.toAddress });
      }
    }
  }

  // Parse ERC20 Transfers
  if (body.erc20Transfers && body.erc20Transfers.length > 0) {
    for (const tx of body.erc20Transfers) {
      const decimals = tx.tokenDecimals ? parseInt(tx.tokenDecimals) : 18;
      const val = (parseInt(tx.value) / Math.pow(10, decimals)).toFixed(4);
      const msg = `🪙 <b>TOKEN TRANSFER (${chainName})</b>\n\n💰 <b>Сумма:</b>\n${val} ${tx.tokenSymbol || 'Token'}\n\n👤 <b>От:</b>\n${shorten(tx.from)}\n👤 <b>Кому:</b>\n${shorten(tx.to)}\n\n⏳ ${time}\n<a href="${explorerUrl}${tx.transactionHash}">[ 🔗 Открыть в Explorer ]</a>`;
      messages.push({ category: 'transfer', formatted: msg, hash: tx.transactionHash, from: tx.from, to: tx.to });
    }
  }

  // Parse NFT Transfers
  if (body.nftTransfers && body.nftTransfers.length > 0) {
    for (const tx of body.nftTransfers) {
      const msg = `🖼 <b>NFT TRANSFER (${chainName})</b>\n\n🆔 <b>Token ID:</b>\n${tx.tokenId}\n\n👤 <b>От:</b>\n${shorten(tx.from)}\n👤 <b>Кому:</b>\n${shorten(tx.to)}\n\n⏳ ${time}\n<a href="${explorerUrl}${tx.transactionHash}">[ 🔗 Открыть в Explorer ]</a>`;
      messages.push({ category: 'nft', formatted: msg, hash: tx.transactionHash, from: tx.from, to: tx.to });
    }
  }

  return messages;
}
