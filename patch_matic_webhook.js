async function run() {
  const token = 'PP6k6i0EU1Yad7BTxn3xWZY-JoYLb_6K';

  // Now create MATIC_MAINNET webhook
  let res = await fetch('https://dashboard.alchemy.com/api/create-webhook', {
    method: 'POST',
    headers: { 'X-Alchemy-Token': token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ network: 'MATIC_MAINNET', webhook_type: 'ADDRESS_ACTIVITY', webhook_url: 'https://nft-radar.icoshef.workers.dev/evm/webhook', addresses: ['0xfcb57b03c5a51aaa89bff56c9cc69597cdbc395d'] })
  });
  const hook = await res.json();
  console.log('Created MATIC hook:', hook);
}
run();
