    const { parseAlchemyWebhook } = await import('./alchemy.js');
    const messages = parseAlchemyWebhook(body);
    if (!messages || messages.length === 0) return new Response('OK');
    
    // Group messages by transaction hash
    const byHash = {};
    for (const msg of messages) {
      if (!byHash[msg.hash]) byHash[msg.hash] = [];
      byHash[msg.hash].push(msg);
    }
    
    for (const hash in byHash) {
      const txMsgs = byHash[hash];
      
      // Collect all involved addresses
      const involved = new Set();
      for (const msg of txMsgs) {
        if (msg.from) involved.add(msg.from.toLowerCase());
        if (msg.to) involved.add(msg.to.toLowerCase());
      }
      
      const involvedArr = Array.from(involved);
      if (involvedArr.length === 0) continue;
      
      const placeholders = involvedArr.map(() => '?').join(',');
      const { results } = await env.DB.prepare(`SELECT w.chat_id, w.name, w.address, f.notify_transfer, f.notify_nft FROM evm_wallets w JOIN evm_filters f ON w.id = f.wallet_id WHERE LOWER(w.address) IN (${placeholders})`).bind(...involvedArr).all();
      
      if (!results || results.length === 0) continue;
      
      for (const w of results) {
        const myAddr = w.address.toLowerCase();
        
        // Filter messages for this specific wallet
        let myMsgs = txMsgs.filter(m => (m.from && m.from.toLowerCase() === myAddr) || (m.to && m.to.toLowerCase() === myAddr));
        
        // Apply user filters
        myMsgs = myMsgs.filter(m => (m.category === 'transfer' && w.notify_transfer) || (m.category === 'nft' && w.notify_nft));
        
        if (myMsgs.length === 0) continue;
        
        const isMultiple = myMsgs.length > 1;
        const shorten = (a) => a ? `${a.slice(0, 4)}..${a.slice(-4)}` : 'Unknown';
        
        const net = myMsgs[0].network;
        let netIcon = '🔗';
        if (net === 'Polygon') netIcon = '<tg-emoji emoji-id="5397954355477377973">🟣</tg-emoji>';
        else if (net === 'Base' || net === 'Arbitrum' || net === 'Linea') netIcon = '🔵';
        else if (net === 'Optimism' || net === 'Avalanche' || net === 'Robinhood') netIcon = '🔴';
        else if (net === 'BSC') netIcon = '🟡';
        else if (net === 'Ethereum' || net === 'ETH') netIcon = '<tg-emoji emoji-id="5400219289301054663">🌐</tg-emoji>';
        
        let formatted = `<a href="https://etherscan.io/address/${w.address}"><b>${w.name}</b></a> · ${netIcon} <b>${net.toUpperCase()}</b>\n`;
        
        if (isMultiple) {
          formatted += `\n🔄 <b>Свап / Мульти-транзакция</b>\n`;
          for (const msg of myMsgs) {
            const isReceived = msg.to && msg.to.toLowerCase() === myAddr;
            if (msg.category === 'transfer') {
              formatted += `${isReceived ? '📥 Получено:' : '📤 Отправлено:'} ${msg.value} ${msg.asset}\n`;
            } else {
              formatted += `${isReceived ? '🖼 Получен' : '🖼 Отправлен'} NFT ID ${msg.tokenId}\n`;
            }
          }
        } else {
          const msg = myMsgs[0];
          const isReceived = msg.to && msg.to.toLowerCase() === myAddr;
          const counterparty = isReceived ? shorten(msg.from) : shorten(msg.to);
          
          if (msg.category === 'transfer') {
            const icon = isReceived ? '🤑' : '💸';
            formatted += `\n${icon} ${isReceived ? 'Получено:' : 'Отправлено:'} ${msg.value} ${msg.asset} ${isReceived ? '📥 От:' : '📤 На:'} ${counterparty}\n`;
          } else {
            formatted += `\n🖼 ${isReceived ? 'Получен NFT:' : 'Отправлен NFT:'} ID ${msg.tokenId} ${isReceived ? '📥 От:' : '📤 На:'} ${counterparty}\n`;
          }
        }
        
        formatted += `\n<a href="${myMsgs[0].explorerUrl}">🔗 Tx hash</a>`;
        
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: w.chat_id, text: formatted, parse_mode: 'HTML', disable_web_page_preview: true })
        });
      }
    }
    return new Response('OK');
