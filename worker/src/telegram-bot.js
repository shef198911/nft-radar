import { fetchOpenSeaJson, getOpenSeaApiKey } from './opensea.js';
import { handleSolanaCallback, handleSolanaText } from './telegram-solana.js';
import { t } from './i18n.js';

async function callTelegramApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  return await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function getThresholdText(alert) {
  return alert.threshold_type === 'abs' ? `${alert.threshold_abs} ETH` : `${alert.threshold_percent}%`;
}

function calculateBounds(base, alert) {
  if (alert.threshold_type === 'abs') {
    return {
      upper: (base + alert.threshold_abs).toFixed(4),
      lower: Math.max(0, base - alert.threshold_abs).toFixed(4)
    };
  } else {
    return {
      upper: (base * (1 + alert.threshold_percent / 100)).toFixed(4),
      lower: (base * (1 - alert.threshold_percent / 100)).toFixed(4)
    };
  }
}

async function sendLanguageMenu(env, chatId, messageIdToEdit = null) {
  const text = "Выберите язык / Choose language:";
  const reply_markup = {
    inline_keyboard: [
      [{ text: "🇷🇺 Русский", callback_data: "set_lang:ru" }, { text: "🇬🇧 English", callback_data: "set_lang:en" }]
    ]
  };
  if (messageIdToEdit) {
    await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageIdToEdit, text, reply_markup });
  } else {
    await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text, reply_markup });
  }
}

async function sendHomeMenu(env, chatId, user, messageIdToEdit = null) {
  if (!user.language) {
    return await sendLanguageMenu(env, chatId, messageIdToEdit);
  }

  const text = `🤖 <b>Crypto Tracker</b>\n\nДобро пожаловать в мультитул.\nВыберите нужный раздел:`;
  const reply_markup = {
    inline_keyboard: [
      [{ text: "🖼 NFT Tracker", callback_data: "nft_home" }, { text: "👛 Wallet Tracker", callback_data: "wallet_home" }],
      [{ text: "⚙️ Настройки", callback_data: "settings" }, { text: "📖 Как это работает", callback_data: "how_it_works" }]
    ]
  };

  if (messageIdToEdit) {
    await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageIdToEdit, text, parse_mode: 'HTML', reply_markup });
  } else {
    await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup });
  }
}

async function sendNftHome(env, chatId, user, messageId) {
  const lang = user.language || 'ru';
  const { results } = await env.DB.prepare('SELECT id, is_active FROM price_alerts WHERE chat_id = ?').bind(chatId).all();
  const tracked = results ? results.length : 0;
  const active = results ? results.filter(r => r.is_active === 1).length : 0;
  
  let lastCheck = t(lang, 'time_never');
  const alert = await env.DB.prepare('SELECT updated_at FROM price_alerts ORDER BY updated_at DESC LIMIT 1').first();
  if (alert && alert.updated_at) {
    lastCheck = new Date(alert.updated_at).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }

  const text = `🖼 <b>NFT Tracker</b>\n\nОтслеживается коллекций: ${tracked}\nАктивных алертов: ${active}\nПоследняя проверка: ${lastCheck}`;
  const reply_markup = {
    inline_keyboard: [
      [{ text: "📊 Мои коллекции", callback_data: "my_colls" }, { text: "➕ Добавить коллекцию", callback_data: "track_add" }],
      [{ text: "◀️ Главное меню", callback_data: "home" }]
    ]
  };
  await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup });
}

async function sendWalletHome(env, chatId, messageId) {
  const text = `👛 <b>Wallet Tracker</b>\n\nВыберите блокчейн:`;
  const reply_markup = {
    inline_keyboard: [
      [{ text: "🟣 Solana", callback_data: "solana_home" }, { text: "🔷 EVM", callback_data: "evm_home" }],
      [{ text: "◀️ Главное меню", callback_data: "home" }]
    ]
  };
  await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup });
}

export async function handleTelegramWebhook(request, env) {
  if (request.method !== 'POST') return new Response('OK');
  let update;
  try { update = await request.json(); } catch (e) { return new Response('OK'); }

  const now = new Date().toISOString();

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id.toString();
    const messageId = cb.message.message_id;
    const data = cb.data;

    await callTelegramApi(env, 'answerCallbackQuery', { callback_query_id: cb.id });

    let user = await env.DB.prepare('SELECT state, state_data, language FROM telegram_users WHERE chat_id = ?').bind(chatId).first();
    if (!user) {
      user = { state: 'IDLE', state_data: null, language: null };
      await env.DB.prepare('INSERT INTO telegram_users (chat_id, state, updated_at) VALUES (?, ?, ?)').bind(chatId, 'IDLE', now).run();
    }
    const lang = user.language || 'ru';

    if (data.startsWith('set_lang:')) {
      const newLang = data.split(':')[1];
      await env.DB.prepare('UPDATE telegram_users SET language = ?, state = ?, updated_at = ? WHERE chat_id = ?').bind(newLang, 'IDLE', now, chatId).run();
      user.language = newLang;
      await sendHomeMenu(env, chatId, user, messageId);
      return new Response('OK');
    }

    if (data === 'home') {
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
      await sendHomeMenu(env, chatId, user, messageId);
      return new Response('OK');
    }
    
    if (data === 'nft_home') {
      await sendNftHome(env, chatId, user, messageId);
      return new Response('OK');
    }
    
    if (data === 'wallet_home') {
      await sendWalletHome(env, chatId, messageId);
      return new Response('OK');
    }

    if (data === 'evm_home') {
      await callTelegramApi(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: "В разработке / Soon", show_alert: true });
      return new Response('OK');
    }

    // Solana Delegation
    const handledSol = await handleSolanaCallback(data, chatId, messageId, env, update);
    if (handledSol) return new Response('OK');
    // For recursing solana actions that return false
    if (!handledSol && (data === 'solana_home' || data.startsWith('sol_del:') || data.startsWith('sol_t_f:'))) {
        return handleTelegramWebhook({ method: 'POST', json: () => Promise.resolve(update) }, env);
    }

    // --- NFT LOGIC ---
    if (data === 'my_colls' || data === 'active_alerts') {
      const { results } = await env.DB.prepare('SELECT id, collection_name, is_active FROM price_alerts WHERE chat_id = ?').bind(chatId).all();
      let msgText = t(lang, 'no_collections');
      let kb = [];
      if (results && results.length > 0) {
        msgText = t(lang, 'my_collections');
        for (const r of results) {
          const status = r.is_active ? '🟢' : '🔴';
          kb.push([{ text: `${status} ${r.collection_name}`, callback_data: `view_coll:${r.id}` }]);
        }
      }
      kb.push([{ text: "◀️ NFT Tracker", callback_data: "nft_home" }]);
      
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: msgText, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
      return new Response('OK');
    }

    if (data === 'track_add') {
      await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_LINK', now, chatId).run();
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: t(lang, 'send_link'), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_cancel'), callback_data: "nft_home" }]] } });
      return new Response('OK');
    }

    if (data === 'settings') {
      const kb = [
        [{ text: t(lang, 'btn_lang'), callback_data: "settings_lang" }],
        [{ text: "◀️ Главное меню", callback_data: "home" }]
      ];
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: "⚙️ <b>Настройки</b>", parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
      return new Response('OK');
    }

    if (data === 'how_it_works') {
      const txt = lang === 'ru' ? "Бот позволяет отслеживать цены NFT коллекций на OpenSea и активность кошельков Solana. Выберите нужный раздел в меню." : "This bot tracks OpenSea NFT floors and Solana wallets.";
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: txt, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_home'), callback_data: "home" }]] } });
      return new Response('OK');
    }

    if (data === 'settings_lang') {
      await sendLanguageMenu(env, chatId, messageId);
      return new Response('OK');
    }

    if (data.startsWith('setup_alert:')) {
      const slug = data.split(':')[1];
      const stateDataStr = JSON.stringify(JSON.parse(user.state_data || '{}'));
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_THRESHOLD', stateDataStr, now, chatId).run();
      
      const kb = [
        [{ text: "5%", callback_data: `set_thr:5` }, { text: "10%", callback_data: `set_thr:10` }, { text: "20%", callback_data: `set_thr:20` }],
        [{ text: "0.01 ETH", callback_data: "set_thr:0.01eth" }, { text: "0.05 ETH", callback_data: "set_thr:0.05eth" }],
        [{ text: t(lang, 'btn_custom_threshold'), callback_data: "set_thr_custom" }],
        [{ text: t(lang, 'btn_cancel'), callback_data: "nft_home" }]
      ];
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: t(lang, 'ask_threshold'), parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
      return new Response('OK');
    }

    if (data === 'set_thr_custom') {
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: "Введите значение (например, 15% или 0.05)", parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_cancel'), callback_data: "nft_home" }]] } });
      return new Response('OK');
    }

    if (data.startsWith('set_thr:')) {
      const val = data.split(':')[1];
      update.callback_query.message.text = val;
      return handleTelegramWebhook({ method: 'POST', json: () => Promise.resolve({ message: update.callback_query.message, chat: update.callback_query.message.chat }) }, env);
    }

    if (data.startsWith('view_coll:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT * FROM price_alerts WHERE id = ? AND chat_id = ?').bind(id, chatId).first();
      if (!alert) return new Response('OK');
      
      const bounds = calculateBounds(alert.baseline_price, alert);
      const text = t(lang, 'alert_card', {
        name: alert.collection_name, 
        floor: alert.baseline_price, 
        threshold: getThresholdText(alert),
        upper: bounds.upper, lower: bounds.lower, 
        status: alert.is_active ? '🟢 ACTIVE' : '🔴 PAUSED',
        updated: new Date(alert.updated_at).toLocaleTimeString(lang==='ru'?'ru-RU':'en-US', {hour:'2-digit', minute:'2-digit'})
      });
      
      const kb = [
        [{ text: t(lang, 'btn_refresh_floor'), callback_data: `refresh_coll:${id}` }],
        [{ text: t(lang, 'btn_edit_threshold'), callback_data: `edit_alert:${id}` }],
        [{ text: t(lang, 'btn_history'), callback_data: `hist_coll:${id}` }],
        [{ text: alert.is_active ? t(lang, 'btn_pause') : t(lang, 'btn_resume'), callback_data: `do_del:${id}:pause` }],
        [{ text: t(lang, 'btn_delete'), callback_data: `del_coll:${id}` }],
        [{ text: "◀️ Назад", callback_data: "my_colls" }]
      ];
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
      return new Response('OK');
    }

    if (data.startsWith('edit_alert:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT * FROM price_alerts WHERE id = ?').bind(id).first();
      if (!alert) return new Response('OK');
      
      const stateData = JSON.stringify({ edit_id: id, name: alert.collection_name, floor: alert.baseline_price });
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_EDIT_THRESHOLD', stateData, now, chatId).run();
      
      const kb = [
        [{ text: "5%", callback_data: `set_thr:5` }, { text: "10%", callback_data: `set_thr:10` }],
        [{ text: "0.01 ETH", callback_data: "set_thr:0.01eth" }, { text: "0.05 ETH", callback_data: "set_thr:0.05eth" }],
        [{ text: "◀️ Назад", callback_data: `view_coll:${id}` }]
      ];
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: "Установите новый порог:", parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
      return new Response('OK');
    }

    if (data.startsWith('refresh_coll:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT collection_slug FROM price_alerts WHERE id = ?').bind(id).first();
      if (!alert) return new Response('OK');
      try {
        const apiKey = await getOpenSeaApiKey(env);
        const stats = await fetchOpenSeaJson(`/collections/${alert.collection_slug}/stats`, apiKey);
        if (stats.total && typeof stats.total.floor_price === 'number') {
          await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?').bind(stats.total.floor_price, now, id).run();
        }
      } catch(e) {}
      update.callback_query.data = `view_coll:${id}`;
      return handleTelegramWebhook({ method: 'POST', json: () => Promise.resolve(update) }, env);
    }

    if (data.startsWith('hist_coll:')) {
      const id = data.split(':')[1];
      const { results } = await env.DB.prepare('SELECT * FROM alert_history WHERE alert_id = ? ORDER BY created_at DESC LIMIT 5').bind(id).all();
      let text = "📖 <b>История алертов</b>\n\n";
      if (!results || results.length === 0) text += "Пусто.";
      else {
        results.forEach(r => {
          const d = new Date(r.created_at).toLocaleDateString();
          const p = r.percent_change.toFixed(1);
          text += `${r.direction === 'up' ? '🟢' : '🔴'} ${d}: ${r.old_price} ➔ ${r.new_price} (${r.direction === 'up'?'+':'-'}${p}%)\n`;
        });
      }
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "◀️ Назад", callback_data: `view_coll:${id}` }]] } });
      return new Response('OK');
    }

    if (data.startsWith('del_coll:')) {
      const id = data.split(':')[1];
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: t(lang, 'confirm_delete'), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "Да, удалить", callback_data: `do_del:${id}:del` }, { text: "Нет", callback_data: `view_coll:${id}` }]] } });
      return new Response('OK');
    }

    if (data.startsWith('do_del:')) {
      const parts = data.split(':');
      const id = parts[1];
      const action = parts[2];
      if (action === 'del') {
        await env.DB.prepare('DELETE FROM price_alerts WHERE id = ?').bind(id).run();
        update.callback_query.data = 'my_colls';
        return handleTelegramWebhook({ method: 'POST', json: () => Promise.resolve(update) }, env);
      } else if (action === 'pause') {
        await env.DB.prepare('UPDATE price_alerts SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(id).run();
        update.callback_query.data = `view_coll:${id}`;
        return handleTelegramWebhook({ method: 'POST', json: () => Promise.resolve(update) }, env);
      }
    }
  }

  // --- Handle Text Messages ---
  if (!update.message || !update.message.text) return new Response('OK');
  if (update.message.chat.type !== 'private') return new Response('OK');
  
  const chatId = update.message.chat.id.toString();
  const text = update.message.text.trim();

  let user = await env.DB.prepare('SELECT state, state_data, language FROM telegram_users WHERE chat_id = ?').bind(chatId).first();
  if (!user) {
    user = { state: 'IDLE', state_data: null, language: null };
    await env.DB.prepare('INSERT INTO telegram_users (chat_id, state, updated_at) VALUES (?, ?, ?)').bind(chatId, 'IDLE', now).run();
  }

  if (text === '/start' || text === '/home' || text === '/cancel') {
    if (text === '/start') {
      user.language = null; // force language selection
      await env.DB.prepare('UPDATE telegram_users SET language = NULL WHERE chat_id = ?').bind(chatId).run();
    }
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
    await sendHomeMenu(env, chatId, user);
    return new Response('OK');
  }

  const handledSolText = await handleSolanaText(text, chatId, user, env);
  if (handledSolText) return new Response('OK');
  const lang = user.language || 'ru';

  if (user.state === 'WAITING_LINK') {
    try {
      let slug = text.trim();
      if (slug.includes('opensea.io/collection/')) slug = slug.split('opensea.io/collection/')[1].split('/')[0].split('?')[0];
      
      const apiKey = await getOpenSeaApiKey(env);
      const collectionRes = await fetchOpenSeaJson(`/collections/${slug}`, apiKey);
      
      if (!collectionRes.collection) throw new Error("Not found");
      const name = collectionRes.collection.name;
      
      const statsRes = await fetchOpenSeaJson(`/collections/${slug}/stats`, apiKey);
      const floor = statsRes.total.floor_price;
      const volume = statsRes.total.volume.toFixed(2);
      
      const stateData = JSON.stringify({ slug, name, floor });
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', stateData, now, chatId).run();
      
      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: t(lang, 'collection_found', { name, floor, change24h: '0', volume }),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_create_alert'), callback_data: `setup_alert:${slug}` }], [{ text: t(lang, 'btn_cancel'), callback_data: "nft_home" }]] }
      });
    } catch (e) {
      await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text: t(lang, 'collection_not_found'), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_try_again'), callback_data: "track_add" }, { text: t(lang, 'btn_home'), callback_data: "home" }]] } });
    }
    return new Response('OK');
  }

  if (user.state === 'WAITING_THRESHOLD' || user.state === 'WAITING_EDIT_THRESHOLD') {
    const isPercent = text.includes('%');
    const val = parseFloat(text.replace('%', '').replace(/eth/i, '').replace(',', '.').trim());
    
    if (isNaN(val) || val <= 0) {
      await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text: t(lang, 'invalid_number'), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_home'), callback_data: "home" }]] } });
      return new Response('OK');
    }

    const type = isPercent ? 'percent' : 'abs';
    const percentVal = isPercent ? val : 0;
    const absVal = isPercent ? 0 : val;

    if (user.state === 'WAITING_THRESHOLD') {
      try {
        const data = JSON.parse(user.state_data);
        const { meta } = await env.DB.prepare(`
          INSERT INTO price_alerts (chat_id, collection_slug, collection_name, baseline_price, threshold_percent, threshold_type, threshold_abs, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).bind(chatId, data.slug, data.name, data.floor, percentVal, type, absVal, now, now).run();
        
        await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
        
        const thrText = isPercent ? `${val}%` : `${val} ETH`;
        const alertObj = { threshold_type: type, threshold_abs: absVal, threshold_percent: percentVal };
        const bounds = calculateBounds(data.floor, alertObj);
        
        await callTelegramApi(env, 'sendMessage', {
          chat_id: chatId,
          text: t(lang, 'alert_created', { name: data.name, floor: data.floor, threshold: thrText, upper: bounds.upper, lower: bounds.lower }),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_my_collections'), callback_data: "my_colls" }, { text: t(lang, 'btn_home'), callback_data: "nft_home" }]] }
        });
      } catch (e) {
        await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', now, chatId).run();
        await sendHomeMenu(env, chatId, user);
      }
    } else if (user.state === 'WAITING_EDIT_THRESHOLD') {
      const data = JSON.parse(user.state_data);
      const id = data.edit_id;
      await env.DB.prepare(`
        UPDATE price_alerts SET threshold_type = ?, threshold_abs = ?, threshold_percent = ?, updated_at = ? WHERE id = ? AND chat_id = ?
      `).bind(type, absVal, percentVal, now, id, chatId).run();
      
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
      
      const thrText = isPercent ? `${val}%` : `${val} ETH`;
      const alertObj = { threshold_type: type, threshold_abs: absVal, threshold_percent: percentVal };
      const bounds = calculateBounds(data.floor, alertObj);

      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: t(lang, 'alert_changed', { name: data.name, floor: data.floor, threshold: thrText, upper: bounds.upper, lower: bounds.lower }),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_back'), callback_data: `view_coll:${id}` }, { text: t(lang, 'btn_home'), callback_data: "nft_home" }]] }
      });
    }

    return new Response('OK');
  }

  // Fallback
  await sendHomeMenu(env, chatId, user);
  return new Response('OK');
}

export async function checkPriceAlerts(env) {
  const { results: alerts } = await env.DB.prepare('SELECT * FROM price_alerts WHERE is_active = 1').all();
  if (!alerts || alerts.length === 0) return;

  const now = new Date().toISOString();
  let apiKey;
  try {
    apiKey = await getOpenSeaApiKey(env);
  } catch (e) {
    return;
  }

  const uniqueSlugs = [...new Set(alerts.map(a => a.collection_slug))];
  const currentPrices = {};

  for (const slug of uniqueSlugs) {
    try {
      const stats = await fetchOpenSeaJson(`/collections/${slug}/stats`, apiKey);
      if (stats.total && typeof stats.total.floor_price === 'number') {
         currentPrices[slug] = {
           floor: stats.total.floor_price,
           volume: stats.total.volume || 0,
           sales: stats.total.sales || 0
         };
      }
    } catch (e) {
      console.error(`Failed to fetch stats for ${slug}: ${e.message}`);
    }
  }

  for (const alert of alerts) {
    const stats = currentPrices[alert.collection_slug];
    if (!stats) continue;

    const currentFloor = stats.floor;
    const baseFloor = alert.baseline_price;
    
    if (baseFloor === null || baseFloor === 0) {
      await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?').bind(currentFloor, now, alert.id).run();
      continue;
    }

    const diff = Math.abs(currentFloor - baseFloor);
    const percentChange = (diff / baseFloor) * 100;
    
    let isTriggered = false;
    let thresholdText = getThresholdText(alert);

    if (alert.threshold_type === 'abs') {
      if (diff >= alert.threshold_abs) isTriggered = true;
    } else {
      if (percentChange >= alert.threshold_percent) isTriggered = true;
    }

    if (isTriggered) {
      const user = await env.DB.prepare('SELECT language FROM telegram_users WHERE chat_id = ?').bind(alert.chat_id).first();
      const lang = user?.language || 'ru';
      
      const isUp = currentFloor > baseFloor;
      const icon = isUp ? '📈' : '📉';
      const direction = isUp ? 'up' : 'down';
      const changeStr = (isUp ? '+' : '-') + percentChange.toFixed(2);
      const time = new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });

      const msg = t(lang, 'trigger_msg', {
        name: alert.collection_name, old: baseFloor, new: currentFloor, icon,
        percent: changeStr, threshold: thresholdText, change24h: '0', time
      });
      
      await callTelegramApi(env, 'sendMessage', {
        chat_id: alert.chat_id, text: msg, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "👀 Открыть / Monitoring", callback_data: `view_coll:${alert.id}` }]] }
      });
      
      await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?').bind(currentFloor, now, alert.id).run();
      await env.DB.prepare('INSERT INTO alert_history (alert_id, direction, percent_change, old_price, new_price, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(alert.id, direction, percentChange, baseFloor, currentFloor, now).run();
    }
  }
}
