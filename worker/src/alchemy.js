// Alchemy Address Activity Webhooks integration

const NETWORKS = [
  'ETH_MAINNET',
  'ARB_MAINNET',
  'OPT_MAINNET',
  'POLYGON_MAINNET',
  'BASE_MAINNET'
];

export async function initAlchemyWebhooks(env) {
  const token = env.ALCHEMY_AUTH_TOKEN;
  if (!token) return;

  // Check which webhooks we already created
  const state = await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind('alchemy_webhooks').first();
  let webhooks = {};
  if (state && state.value) {
    try { webhooks = JSON.parse(state.value); } catch(e){}
  }

  const webhookUrl = 'https://nft-radar.icoshef.workers.dev/evm/webhook';
  let updated = false;

  for (const network of NETWORKS) {
    if (!webhooks[network]) {
      try {
        const res = await fetch('https://dashboard.alchemy.com/api/create-webhook', {
          method: 'POST',
          headers: { 'X-Alchemy-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            network: network,
            webhook_type: 'ADDRESS_ACTIVITY',
            webhook_url: webhookUrl,
            addresses: [] // start empty
          })
        });
        const data = await res.json();
        if (data.data && data.data.id) {
          webhooks[network] = data.data.id;
          updated = true;
        }
      } catch (e) {
        console.error('Failed to create Alchemy webhook for', network, e);
      }
    }
  }

  if (updated) {
    await env.DB.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('alchemy_webhooks', JSON.stringify(webhooks)).run();
  }
}

export async function updateAlchemyAddresses(env, addresses) {
  const token = env.ALCHEMY_AUTH_TOKEN;
  if (!token) return;

  const state = await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind('alchemy_webhooks').first();
  if (!state || !state.value) return;
  const webhooks = JSON.parse(state.value);

  // Note: For simplicity, we just add the newly added address. 
  // In a robust system, we would calculate diffs. Alchemy supports PATCH to add/remove.
  // We'll just append it to all webhooks.
  for (const network of NETWORKS) {
    const webhookId = webhooks[network];
    if (webhookId) {
      await fetch('https://dashboard.alchemy.com/api/update-webhook-addresses', {
        method: 'PATCH',
        headers: { 'X-Alchemy-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_id: webhookId,
          addresses_to_add: addresses,
          addresses_to_remove: []
        })
      });
    }
  }
}

export function parseAlchemyWebhook(body) {
  // Alchemy Address Activity Payload:
  // body.event.network, body.event.activity (array of txs)
  if (!body || !body.event || !body.event.activity) return [];
  
  const network = body.event.network || 'EVM';
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const shorten = (addr) => addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : 'Unknown';

  const chainNames = {
    'ETH_MAINNET': 'Ethereum',
    'ARB_MAINNET': 'Arbitrum',
    'OPT_MAINNET': 'Optimism',
    'POLYGON_MAINNET': 'Polygon',
    'BASE_MAINNET': 'Base'
  };
  const chainName = chainNames[network] || network;

  const getExplorer = (net, hash) => {
    switch(net) {
      case 'ETH_MAINNET': return `https://etherscan.io/tx/${hash}`;
      case 'ARB_MAINNET': return `https://arbiscan.io/tx/${hash}`;
      case 'OPT_MAINNET': return `https://optimistic.etherscan.io/tx/${hash}`;
      case 'POLYGON_MAINNET': return `https://polygonscan.com/tx/${hash}`;
      case 'BASE_MAINNET': return `https://basescan.org/tx/${hash}`;
      default: return `https://etherscan.io/tx/${hash}`;
    }
  };

  let messages = [];

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
}
