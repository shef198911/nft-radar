export async function searchDexScreener(query) {
  // Query can be a contract address or a ticker
  const url = `https://api.dexscreener.com/latest/dex/search?q=${query}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.pairs) return [];
    
    // Group by baseToken.address to avoid duplicates (multiple pairs for same token)
    const tokens = new Map();
    for (const pair of data.pairs) {
      if (!pair.baseToken || !pair.baseToken.address) continue;
      
      const addr = pair.baseToken.address.toLowerCase();
      // Only keep the pair with the highest liquidity for this token
      if (!tokens.has(addr) || (pair.liquidity && pair.liquidity.usd > tokens.get(addr).liquidityUsd)) {
        tokens.set(addr, {
          contract_address: addr,
          network: pair.chainId,
          ticker: pair.baseToken.symbol,
          name: pair.baseToken.name,
          priceUsd: parseFloat(pair.priceUsd),
          liquidityUsd: pair.liquidity ? pair.liquidity.usd : 0,
          url: pair.url
        });
      }
    }
    
    // Convert to array and sort by liquidity descending
    const results = Array.from(tokens.values()).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    
    // Return top 5
    return results.slice(0, 5);
  } catch (e) {
    console.error('DexScreener search error:', e);
    return [];
  }
}

export async function getDexScreenerTokensByAddress(addresses) {
  // Addresses can be a string (comma-separated up to 30) or array
  const addrs = Array.isArray(addresses) ? addresses.join(',') : addresses;
  if (!addrs) return [];
  
  const url = `https://api.dexscreener.com/latest/dex/tokens/${addrs}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.pairs) return [];
    
    const tokens = new Map();
    for (const pair of data.pairs) {
       if (!pair.baseToken || !pair.baseToken.address) continue;
       const addr = pair.baseToken.address.toLowerCase();
       if (!tokens.has(addr) || (pair.liquidity && pair.liquidity.usd > tokens.get(addr).liquidityUsd)) {
          tokens.set(addr, {
             contract_address: addr,
             network: pair.chainId,
             ticker: pair.baseToken.symbol,
             priceUsd: parseFloat(pair.priceUsd)
          });
       }
    }
    return Array.from(tokens.values());
  } catch (e) {
    console.error('DexScreener fetch error:', e);
    return [];
  }
}
