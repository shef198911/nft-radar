export async function searchGeckoTerminal(query) {
  // Query can be a contract address or a ticker
  const url = `https://api.geckoterminal.com/api/v2/search/pools?query=${query}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) { console.error('GeckoTerminal search failed', res.status); return []; }
    const data = await res.json();
    if (!data.data) return [];
    
    const tokens = new Map();
    for (const pool of data.data) {
      if (!pool.relationships?.base_token?.data?.id) continue;
      
      const tokenIdFull = pool.relationships.base_token.data.id; // e.g. "eth_0xc02..."
      const parts = tokenIdFull.split('_');
      if (parts.length < 2) continue;
      
      const network = parts[0];
      const addr = parts.slice(1).join('_').toLowerCase();
      
      // Extract ticker from "WETH / USDT"
      const nameParts = pool.attributes.name.split(' / ');
      const ticker = nameParts.length > 0 ? nameParts[0].trim().split(' ')[0] : 'UNKNOWN';
      
      const liquidity = parseFloat(pool.attributes.reserve_in_usd || 0);
      
      if (!tokens.has(addr) || liquidity > tokens.get(addr).liquidityUsd) {
        tokens.set(addr, {
          contract_address: addr,
          network: network,
          ticker: ticker,
          name: ticker,
          priceUsd: parseFloat(pool.attributes.base_token_price_usd || 0),
          liquidityUsd: liquidity,
          url: `https://geckoterminal.com/${network}/pools/${pool.attributes.address}`
        });
      }
    }
    
    const results = Array.from(tokens.values()).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    return results.slice(0, 5);
  } catch (e) {
    console.error('GeckoTerminal search error:', e);
    return [];
  }
}

export async function getGeckoTerminalTokensByNetwork(network, addressesArray) {
  if (!addressesArray || addressesArray.length === 0) return [];
  const addrs = addressesArray.join(',');
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${addrs}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.data) return [];
    
    // API returns array if multiple, object if single. Let's normalize
    const dataArr = Array.isArray(json.data) ? json.data : [json.data];
    
    return dataArr.map(token => ({
       contract_address: token.attributes.address.toLowerCase(),
       network: network,
       ticker: token.attributes.symbol,
       priceUsd: parseFloat(token.attributes.price_usd || 0)
    }));
  } catch (e) {
    console.error('GeckoTerminal fetch error:', e);
    return [];
  }
}
