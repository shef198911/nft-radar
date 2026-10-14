import { getWalletBalance, updateWebhook } from './helius.js';

async function callTelegramApi(env, method, payload) {
  return await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function handleSolanaCallback(data, chatId, messageId, env, update) {
  const now = new Date().toISOString();

  if (data === 'solana_add') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_SOL_ADDRESS', null, now, chatId).run();
    await callTelegramApi(env, 'editMessageText', {
      chat_id: chatId, message_id: messageId,
      text: "➕ <b>Добавление Solana-кошелька</b>\n\nОтправьте Solana wallet address.\n\nНапример:\n<code>7xKX...AbCd</code>",
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "solana_home" }]] }
    });
    return true;
  }

  if (data.startsWith('solana_confirm:')) {
    const addr = data.split(':')[1];
    const stateDataStr = JSON.stringify({ addr });
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_SOL_NAME', stateDataStr, now, chatId).run();
    await callTelegramApi(env, 'editMessageText', {
      chat_id: chatId, message_id: messageId,
      text: "🏷 <b>Название кошелька</b>\n\nВведите название.\nНапример:\nWhale #1\nSmart Money\nNFT Trader",
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустить", callback_data: `solana_save_noname:${addr}` }]] }
    });
    return true;
  }

  if (data.startsWith('solana_save_noname:')) {
    const addr = data.split(':')[1];
    const name = `${addr.slice(0, 4)}...${addr.slice(-4)}`;
    const { meta } = await env.DB.prepare('INSERT INTO solana_wallets (chat_id, address, name, created_at) VALUES (?, ?, ?, ?)').bind(chatId, addr, name, now).run();
    const walletId = meta.last_row_id;
    await env.DB.prepare('INSERT INTO solana_filters (wallet_id) VALUES (?)').bind(walletId).run();
    
    const { results: allWallets } = await env.DB.prepare('SELECT DISTINCT address FROM solana_wallets').all();
    await updateWebhook(env, allWallets.map(w => w.address));

    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
    
    update.callback_query.data = 'solana_home';
    return false; 
  }

  if (data === 'solana_home') {
    const { results } = await env.DB.prepare('SELECT id FROM solana_wallets WHERE chat_id = ?').bind(chatId).all();
    const count = results ? results.length : 0;
    
    const text = `◎ <b>Solana Wallet Tracker</b>\n\nОтслеживается:\n${count} кошелька(ов)\n\nАктивных уведомлений:\n${count}\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;
    const kb = [
      [{ text: "👛 Мои кошельки", callback_data: "solana_list" }],
      [{ text: "➕ Добавить кошелёк", callback_data: "solana_add" }],
      [{ text: "🔔 Уведомления", callback_data: "solana_filters_main" }],
      [{ text: "◀️ Wallet Tracker", callback_data: "wallet_home" }]
    ];
    await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    return true;
  }

  if (data === 'solana_list') {
    const { results } = await env.DB.prepare('SELECT * FROM solana_wallets WHERE chat_id = ?').bind(chatId).all();
    let text = `◎ <b>Solana Wallets</b>\n\nОтслеживается:\n${results ? results.length : 0} кошелька(ов)\n\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;
    let kb = [];
    if (results) {
      for (const w of results) {
        kb.push([{ text: `🟢 ${w.name}`, callback_data: `view_sol:${w.id}` }]);
      }
    }
    kb.push([{ text: "➕ Добавить кошелёк", callback_data: "solana_add" }]);
    kb.push([{ text: "◀️ Solana", callback_data: "solana_home" }]);
    await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    return true;
  }

  if (data.startsWith('view_sol:')) {
    const id = data.split(':')[1];
    const w = await env.DB.prepare('SELECT * FROM solana_wallets WHERE id = ? AND chat_id = ?').bind(id, chatId).first();
    if (!w) return true;

    let bal = '?';
    try { bal = await getWalletBalance(w.address, env); } catch(e){}

    const text = `◎ Solana\n\n👛 <b>${w.name}</b>\n<code>${w.address}</code>\n\n💰 Portfolio\n${bal} SOL`;
    const kb = [
      [{ text: "🔔 События", callback_data: `sol_filters:${id}` }],
      [{ text: "🔗 Открыть кошелёк", url: `https://solscan.io/account/${w.address}` }],
      [{ text: "🗑 Удалить", callback_data: `sol_del:${id}` }],
      [{ text: "◀️ Solana Wallets", callback_data: "solana_list" }]
    ];
    await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    return true;
  }

  if (data.startsWith('sol_del:')) {
    const id = data.split(':')[1];
    await env.DB.prepare('DELETE FROM solana_filters WHERE wallet_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM solana_wallets WHERE id = ?').bind(id).run();
    
    const { results: allWallets } = await env.DB.prepare('SELECT DISTINCT address FROM solana_wallets').all();
    if (allWallets && allWallets.length > 0) {
      await updateWebhook(env, allWallets.map(w => w.address));
    }
    update.callback_query.data = 'solana_home';
    return false; 
  }

  if (data.startsWith('sol_filters:')) {
    const id = data.split(':')[1];
    const filters = await env.DB.prepare('SELECT * FROM solana_filters WHERE wallet_id = ?').bind(id).first();
    if (!filters) return true;

    const kb = [
      [{ text: `SWAP ${filters.notify_swap ? '🟢 ON' : '🔴 OFF'}`, callback_data: `sol_t_f:${id}:swap` }],
      [{ text: `Transfers ${filters.notify_transfer ? '🟢 ON' : '🔴 OFF'}`, callback_data: `sol_t_f:${id}:transfer` }],
      [{ text: `NFT Sales ${filters.notify_nft ? '🟢 ON' : '🔴 OFF'}`, callback_data: `sol_t_f:${id}:nft` }],
      [{ text: `Mints ${filters.notify_mint ? '🟢 ON' : '🔴 OFF'}`, callback_data: `sol_t_f:${id}:mint` }],
      [{ text: "◀️ Кошелёк", callback_data: `view_sol:${id}` }]
    ];
    await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: "🔔 <b>События</b>\n\nВыберите уведомления:", parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    return true;
  }

  if (data.startsWith('sol_t_f:')) {
    const parts = data.split(':');
    const id = parts[1];
    const field = parts[2];
    const col = `notify_${field}`;
    await env.DB.prepare(`UPDATE solana_filters SET ${col} = CASE WHEN ${col} = 1 THEN 0 ELSE 1 END WHERE wallet_id = ?`).bind(id).run();
    update.callback_query.data = `sol_filters:${id}`;
    return false;
  }

  return false;
}

export async function handleSolanaText(text, chatId, user, env) {
  const now = new Date().toISOString();
  
  if (user.state === 'WAITING_SOL_ADDRESS') {
    const addr = text;
    if (addr.length < 32) {
      await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text: "❌ Некорректный адрес. Попробуйте еще раз." });
      return true;
    }
    
    let bal = '?';
    try { bal = await getWalletBalance(addr, env); } catch(e){}

    const msg = `🔎 <b>Кошелёк найден</b>\n\n◎ Solana\n<code>${addr}</code>\n\nSOL:\n${bal} SOL\n\nДобавить этот кошелёк в мониторинг?`;
    await callTelegramApi(env, 'sendMessage', {
      chat_id: chatId, text: msg, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: "✅ Добавить", callback_data: `solana_confirm:${addr}` }, { text: "❌ Отмена", callback_data: "solana_home" }]] }
    });
    return true;
  }

  if (user.state === 'WAITING_SOL_NAME') {
    const name = text;
    const data = JSON.parse(user.state_data);
    
    const { meta } = await env.DB.prepare('INSERT INTO solana_wallets (chat_id, address, name, created_at) VALUES (?, ?, ?, ?)').bind(chatId, data.addr, name, now).run();
    const walletId = meta.last_row_id;
    await env.DB.prepare('INSERT INTO solana_filters (wallet_id) VALUES (?)').bind(walletId).run();
    
    const { results: allWallets } = await env.DB.prepare('SELECT DISTINCT address FROM solana_wallets').all();
    await updateWebhook(env, allWallets.map(w => w.address));

    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
    
    await callTelegramApi(env, 'sendMessage', {
      chat_id: chatId, text: "✅ <b>Кошелёк добавлен!</b>", parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: "◎ Открыть Solana Tracker", callback_data: "solana_home" }]] }
    });
    return true;
  }
  return false;
}
