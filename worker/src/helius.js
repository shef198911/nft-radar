export async function getWalletBalance(address, env) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [address]
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result.value / 1e9; // lamports to SOL
}

export async function updateWebhook(env, addresses) {
  const webhookKey = 'helius_webhook_id';
  const state = await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind(webhookKey).first();
  
  const webhookUrl = `https://nft-radar.icoshef.workers.dev/helius/webhook`;
  
  if (state && state.value) {
    const webhookId = state.value;
    const url = `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${env.HELIUS_API_KEY}`;
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: ['Any'],
        accountAddresses: addresses,
        webhookType: 'enhanced'
      })
    });
  } else {
    const url = `https://api.helius.xyz/v0/webhooks?api-key=${env.HELIUS_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: ['Any'],
        accountAddresses: addresses,
        webhookType: 'enhanced'
      })
    });
    const data = await response.json();
    if (data.webhookID) {
      await env.DB.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(webhookKey, data.webhookID).run();
    }
  }
}

export function parseTransaction(tx, monitoredAddress) {
  const sig = tx.signature;
  let type = tx.type;
  const source = tx.source;
  const time = new Date(tx.timestamp * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  
  const shorten = (addr) => addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : 'Unknown';
  
  let formatted = '';
  let category = 'other'; // swap, transfer, nft, mint, stake, other

  if (type === 'SWAP') {
    category = 'swap';
    const swapEvent = tx.events?.swap;
    let sentAmount = 0, sentToken = 'SOL', recvAmount = 0, recvToken = 'SOL';
    
    // Fallback manual parsing if swapEvent is missing or unhelpful
    let userSent = tx.tokenTransfers.filter(t => t.fromUserAccount === monitoredAddress);
    let userRecv = tx.tokenTransfers.filter(t => t.toUserAccount === monitoredAddress);
    let solSent = tx.nativeTransfers.filter(t => t.fromUserAccount === monitoredAddress);
    let solRecv = tx.nativeTransfers.filter(t => t.toUserAccount === monitoredAddress);

    if (swapEvent) {
      // Logic for native swap event
      // To keep it simple, we'll try to extract from native/token transfers directly for the monitored wallet
    }
    
    // We just find what the monitored wallet sent and received
    let outStrs = [];
    let inStrs = [];
    
    for (const t of solSent) outStrs.push(`🔴 ${(t.amount / 1e9).toFixed(4)} SOL`);
    for (const t of userSent) outStrs.push(`🔴 ${t.tokenAmount} ${t.mint.slice(0,4)}`); // Ideally fetch symbol
    
    for (const t of solRecv) inStrs.push(`🟢 ${(t.amount / 1e9).toFixed(4)} SOL`);
    for (const t of userRecv) inStrs.push(`🟢 ${t.tokenAmount} ${t.mint.slice(0,4)}`);

    formatted = `🔄 <b>SWAP</b>\n\nОтдал:\n${outStrs.join('\n') || '🔴 0'}\n\nПолучил:\n${inStrs.join('\n') || '🟢 0'}\n\nDEX: ${source}\n⏱ ${time}`;
  } 
  else if (type === 'TRANSFER') {
    category = 'transfer';
    let isSol = false;
    let isReceived = false;
    let amountStr = '';
    let party = '';
    
    // Native
    const nativeIn = tx.nativeTransfers.find(t => t.toUserAccount === monitoredAddress);
    const nativeOut = tx.nativeTransfers.find(t => t.fromUserAccount === monitoredAddress);
    
    // Token
    const tokenIn = tx.tokenTransfers.find(t => t.toUserAccount === monitoredAddress);
    const tokenOut = tx.tokenTransfers.find(t => t.fromUserAccount === monitoredAddress);

    if (nativeIn) {
      isSol = true; isReceived = true; amountStr = `◎ ${(nativeIn.amount / 1e9).toFixed(4)} SOL`; party = nativeIn.fromUserAccount;
    } else if (nativeOut) {
      isSol = true; isReceived = false; amountStr = `◎ ${(nativeOut.amount / 1e9).toFixed(4)} SOL`; party = nativeOut.toUserAccount;
    } else if (tokenIn) {
      isReceived = true; amountStr = `🪙 ${tokenIn.tokenAmount} ${tokenIn.mint.slice(0,4)}`; party = tokenIn.fromUserAccount;
    } else if (tokenOut) {
      isReceived = false; amountStr = `🪙 ${tokenOut.tokenAmount} ${tokenOut.mint.slice(0,4)}`; party = tokenOut.toUserAccount;
    }

    const title = isReceived ? (isSol ? '🟢 SOL RECEIVED' : '🟢 TOKEN RECEIVED') : (isSol ? '🔴 SOL SENT' : '🔴 TOKEN SENT');
    const partyTitle = isReceived ? 'От:' : 'Кому:';
    
    formatted = `<b>${title}</b>\n\n${isReceived ? 'Получено:' : 'Отправлено:'}\n${amountStr}\n\n${partyTitle}\n${shorten(party)}\n\n⏱ ${time}`;
  }
  else if (type === 'NFT_SALE' || type === 'NFT_BID' || type === 'NFT_LISTING') {
    category = 'nft';
    const isSale = type === 'NFT_SALE';
    const nftEvent = tx.events?.nft;
    const isSeller = nftEvent?.seller === monitoredAddress;
    const isBuyer = nftEvent?.buyer === monitoredAddress;
    
    let title = '';
    let verb = '';
    let price = nftEvent ? (nftEvent.amount / 1e9).toFixed(4) + ' SOL' : '?';

    if (isSale) {
      if (isSeller) {
        title = '🔴 NFT SALE'; verb = 'Продано:';
      } else if (isBuyer) {
        title = '🟢 NFT PURCHASE'; verb = 'Куплено:';
      } else {
        title = '🛒 NFT MARKET'; verb = 'Сделка:';
      }
    } else {
      title = `🛒 ${type.replace('_', ' ')}`; verb = 'Действие:';
    }

    formatted = `<b>${title}</b>\n\n${verb}\n🖼 NFT\n\nЦена:\n${price}\n\nMarket: ${source}\n⏱ ${time}`;
  }
  else if (type === 'NFT_MINT') {
    category = 'mint';
    formatted = `🟣 <b>NFT MINT</b>\n\nПолучено:\n🖼 NFT\n\n⏱ ${time}`;
  }
  else if (type === 'TOKEN_MINT' || type === 'MINT') {
    category = 'mint';
    formatted = `🟣 <b>TOKEN MINT</b>\n\n⏱ ${time}`;
  }
  else if (type === 'BURN') {
    category = 'mint';
    formatted = `🔥 <b>TOKEN BURN</b>\n\n⏱ ${time}`;
  }
  else if (type.includes('STAKE')) {
    category = 'stake';
    formatted = `🔒 <b>STAKING</b>\n\nДействие: ${type}\n\n⏱ ${time}`;
  }
  else {
    formatted = `⚡ <b>WALLET ACTIVITY</b>\n\nОбнаружена новая активность.\n\nПрограмма:\n${source}\n\n⏱ ${time}`;
  }

  formatted += `\n\nTx:\n${shorten(sig)}\n\n<a href="https://solscan.io/tx/${sig}">[ 🔗 Открыть транзакцию ]</a>`;

  return { category, formatted, signature: sig };
}
