// Alchemy Address Activity Webhooks integration

const ACCOUNTS = [
  {
    tokenKey: 'ALCHEMY_AUTH_TOKEN',
    networks: ['ETH_MAINNET', 'ARB_MAINNET', 'BASE_MAINNET', 'MATIC_MAINNET', 'BNB_MAINNET']
  },
  {
    tokenKey: 'ALCHEMY_AUTH_TOKEN_2',
    networks: ['OPT_MAINNET', 'AVAX_MAINNET', 'LINEA_MAINNET', 'ZKSYNC_MAINNET', 'ROBINHOOD_MAINNET']
  }
];

export async function initAlchemyWebhooks(env) {
  const webhookUrl = 'https://nft-radar.icoshef.workers.dev/evm/webhook';

  for (const account of ACCOUNTS) {
    const token = env[account.tokenKey];
    if (!token) continue;

    try {
      const res = await fetch('https://dashboard.alchemy.com/api/team-webhooks', {
        headers: { 'X-Alchemy-Token': token }
      });
      const data = await res.json();
      const existingWebhooks = data.data || [];
      const existingNetworks = existingWebhooks.map(w => w.network);

      for (const targetNet of account.networks) {
        if (!existingNetworks.includes(targetNet)) {
          console.log('Creating missing webhook for', targetNet, 'on', account.tokenKey);
          await fetch('https://dashboard.alchemy.com/api/create-webhook', {
            method: 'POST',
            headers: { 'X-Alchemy-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              network: targetNet,
              webhook_type: 'ADDRESS_ACTIVITY',
              webhook_url: webhookUrl,
              addresses: []
            })
          });
        } else {
          // If it exists, let's check if it's inactive and reactivate it
          const wh = existingWebhooks.find(w => w.network === targetNet);
          if (wh && !wh.is_active) {
            console.log('Reactivating webhook', wh.id);
            await fetch('https://dashboard.alchemy.com/api/update-webhook', {
              method: 'PUT',
              headers: { 'X-Alchemy-Token': token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ webhook_id: wh.id, is_active: true })
            });
          }
        }
      }
    } catch (e) {
      console.error('Error in initAlchemyWebhooks for', account.tokenKey, e);
    }
  }
}

export async function updateAlchemyAddresses(env, addresses) {
  for (const account of ACCOUNTS) {
    const token = env[account.tokenKey];
    if (!token) continue;

    try {
      // 1. Get all webhooks for this token
      const res = await fetch('https://dashboard.alchemy.com/api/team-webhooks', {
        headers: { 'X-Alchemy-Token': token }
      });
      const data = await res.json();
      const webhooks = data.data || [];

      // 2. Add addresses to all Activity webhooks
      for (const wh of webhooks) {
        if (wh.webhook_type === 'ADDRESS_ACTIVITY') {
          await fetch('https://dashboard.alchemy.com/api/update-webhook-addresses', {
            method: 'PATCH',
            headers: { 'X-Alchemy-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              webhook_id: wh.id,
              addresses_to_add: addresses,
              addresses_to_remove: []
            })
          });
        }
      }
    } catch (e) {
      console.error('Error updating addresses for', account.tokenKey, e);
    }
  }
}

export function parseAlchemyWebhook(body) {
  if (!body || !body.event || !body.event.activity) return [];
  
  const network = body.event.network || 'EVM';
  
  const chainNames = {
    'ETH_MAINNET': 'Ethereum',
    'ARB_MAINNET': 'Arbitrum',
    'OPT_MAINNET': 'Optimism',
    'MATIC_MAINNET': 'Polygon',
    'BASE_MAINNET': 'Base',
    'BNB_MAINNET': 'BSC',
    'AVAX_MAINNET': 'Avalanche',
    'LINEA_MAINNET': 'Linea',
    'ZKSYNC_MAINNET': 'ZkSync',
    'ROBINHOOD_MAINNET': 'Robinhood',
    'SCROLL_MAINNET': 'Scroll'
  };
  const chainName = chainNames[network] || network;

  const getExplorer = (net, hash) => {
    switch(net) {
      case 'ETH_MAINNET': return `https://etherscan.io/tx/${hash}`;
      case 'ARB_MAINNET': return `https://arbiscan.io/tx/${hash}`;
      case 'OPT_MAINNET': return `https://optimistic.etherscan.io/tx/${hash}`;
      case 'MATIC_MAINNET': return `https://polygonscan.com/tx/${hash}`;
      case 'BASE_MAINNET': return `https://basescan.org/tx/${hash}`;
      case 'BNB_MAINNET': return `https://bscscan.com/tx/${hash}`;
      case 'AVAX_MAINNET': return `https://snowtrace.io/tx/${hash}`;
      case 'LINEA_MAINNET': return `https://lineascan.build/tx/${hash}`;
      case 'ZKSYNC_MAINNET': return `https://explorer.zksync.io/tx/${hash}`;
      case 'ROBINHOOD_MAINNET': return `https://explorer.robinhood.com/tx/${hash}`;
      case 'SCROLL_MAINNET': return `https://scrollscan.com/tx/${hash}`;
      default: return `https://etherscan.io/tx/${hash}`;
    }
  };

  let messages = [];

  for (const tx of body.event.activity) {
    const isToken = tx.category === 'token' || tx.category === 'erc20';
    const isInternal = tx.category === 'internal';
    const isExternal = tx.category === 'external'; 
    const isERC721 = tx.category === 'erc721' || tx.category === 'erc1155';

    const from = tx.fromAddress || tx.from;
    const to = tx.toAddress || tx.to;
    const hash = tx.hash;
    const val = tx.value; 
    const asset = tx.asset; 
    const explorerUrl = getExplorer(network, hash);

    if (val === 0 || val === '0' || val === 0.0) continue;

    if (isExternal || isInternal || isToken) {
      messages.push({ category: 'transfer', network: chainName, asset: asset || 'ETH', value: val, hash, from, to, explorerUrl });
    } else if (isERC721) {
      messages.push({ category: 'nft', network: chainName, asset: 'NFT', tokenId: tx.erc721TokenId || 'Unknown', hash, from, to, explorerUrl });
    }
  }

  return messages;
}
