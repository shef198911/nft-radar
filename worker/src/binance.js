export async function searchBinance(query, env) {
  let ticker = query.toUpperCase().trim();
  if (ticker.endsWith('USDT')) {
    ticker = ticker.replace('USDT', '');
  }
  
  const symbol = ticker + 'USDT';
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  
  try {
    const headers = {
       'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (env && env.BINANCE_API_KEY) {
      headers['X-MBX-APIKEY'] = env.BINANCE_API_KEY;
    }
    
    const res = await fetch(url, { headers });
    console.log('[BINANCE_SEARCH_24H]', symbol, res.status);
    if (res.ok) {
      const data = await res.json();
      return [{
        contract_address: symbol,
        network: 'binance',
        ticker: ticker,
        name: ticker,
        priceUsd: parseFloat(data.lastPrice),
        priceChange: parseFloat(data.priceChange),
        priceChangePercent: parseFloat(data.priceChangePercent)
      }];
    }
  } catch (e) {
    console.error('Binance search failed', e.message);
  }
  return [];
}

export async function getBinancePrices(symbols, env) {
  if (!symbols || symbols.length === 0) return {};
  
  const headers = {
     'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  if (env && env.BINANCE_API_KEY) headers['X-MBX-APIKEY'] = env.BINANCE_API_KEY;

  const prices = {};
  
  // Normalize symbols for Binance API (append USDT if missing)
  const normalizedSymbols = symbols.map(s => {
      let t = s.toUpperCase().trim();
      return t.endsWith('USDT') ? t : t + 'USDT';
  });
  
  // Try batch fetch first
  try {
    const url = `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(normalizedSymbols))}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
           const idx = normalizedSymbols.indexOf(item.symbol);
           if (idx !== -1) prices[symbols[idx]] = parseFloat(item.price);
        }
      } else if (data.symbol) {
         const idx = normalizedSymbols.indexOf(data.symbol);
         if (idx !== -1) prices[symbols[idx]] = parseFloat(data.price);
      }
      return prices;
    }
  } catch (e) {
    console.error('Binance batch price fetch failed', e.message);
  }

  // Fallback: fetch all prices if batch fails
  try {
    const url = `https://api.binance.com/api/v3/ticker/price`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
           const idx = normalizedSymbols.indexOf(item.symbol);
           if (idx !== -1) {
               prices[symbols[idx]] = parseFloat(item.price);
           }
        }
      }
    }
  } catch(e) {
      console.error('Binance full price fetch failed', e.message);
  }
  
  return prices;
}
