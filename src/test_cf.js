export default {
  async fetch(request, env) {
    const endpoints = [
      'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      'https://api1.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      'https://api2.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      'https://api3.binance.com/api/v3/ticker/price?symbol=BTCUSDT'
    ];
    let results = [];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        results.push({ url, status: res.status, ok: res.ok });
      } catch (e) {
        results.push({ url, error: e.message });
      }
    }
    return new Response(JSON.stringify(results, null, 2));
  }
}
