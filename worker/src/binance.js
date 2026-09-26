export async function searchBinance(query, env) {
  let ticker = query.toUpperCase().trim();
  if (ticker.endsWith('USDT')) {
    ticker = ticker.replace('USDT', '');
  }
  
  const symbol = ticker + 'USDT';
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  
  try {
    const headers = {};
    if (env && env.BINANCE_API_KEY) {
      headers['X-MBX-APIKEY'] = env.BINANCE_API_KEY;
    }
    
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      return [{
        contract_address: symbol,
        network: 'binance',
        ticker: ticker,
        name: ticker,
        priceUsd: parseFloat(data.price)
      }];
    }
  } catch (e) {
    console.error('Binance search failed', e.message);
  }
  return [];
}

export async function getBinancePrices(symbols, env) {
  if (!symbols || symbols.length === 0) return {};
  
  const url = `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const prices = {};
  
  try {
    const headers = {};
    if (env && env.BINANCE_API_KEY) {
      headers['X-MBX-APIKEY'] = env.BINANCE_API_KEY;
    }
    
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
           prices[item.symbol] = parseFloat(item.price);
        }
      } else if (data.symbol) {
         prices[data.symbol] = parseFloat(data.price);
      }
    }
  } catch (e) {
    console.error('Binance batch price fetch failed', e.message);
  }
  
  return prices;
}
