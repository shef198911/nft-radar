import { fetchOpenSeaJson, getOpenSeaApiKey } from './opensea.js';

async function callTelegramApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  return await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function sendHomeMenu(env, chatId, messageIdToEdit = null) {
  const text = "👋 <b>Добро пожаловать в NFT Radar!</b>\n\nЗдесь вы можете настроить персональные уведомления об изменении цен (Floor Price) на ваши любимые коллекции в OpenSea.";
  const reply_markup = {
    inline_keyboard: [
      [{ text: "➕ Отслеживать коллекцию", callback_data: "track_add" }],
      [{ text: "📋 Мои подписки", callback_data: "track_list" }]
    ]
  };

  if (messageIdToEdit) {
    await callTelegramApi(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageIdToEdit,
      text: text,
      parse_mode: 'HTML',
      reply_markup: reply_markup
    });
  } else {
    await callTelegramApi(env, 'sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: reply_markup
    });
  }
}

export async function handleTelegramWebhook(request, env) {
  if (request.method !== 'POST') return new Response('OK');
  
  let update;
  try {
    update = await request.json();
  } catch (e) {
    return new Response('OK');
  }

  // --- Handle Callback Queries (Button Clicks) ---
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id.toString();
    const messageId = cb.message.message_id;
    const data = cb.data;
    const now = new Date().toISOString();

    // Answer the callback to remove the loading state on the button
    await callTelegramApi(env, 'answerCallbackQuery', { callback_query_id: cb.id });

    if (data === 'home') {
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
      await sendHomeMenu(env, chatId, messageId);
      return new Response('OK');
    }

    if (data === 'track_add') {
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_LINK', null, now, chatId).run();
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: "🔗 <b>Пришлите ссылку на коллекцию OpenSea</b>\n(например: <i>https://opensea.io/collection/jpeg-frens</i>)",
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 На главную", callback_data: "home" }]]
        }
      });
      return new Response('OK');
    }

    if (data === 'track_list') {
      const { results } = await env.DB.prepare('SELECT id, collection_name, threshold_type, threshold_abs, threshold_percent, baseline_price FROM price_alerts WHERE chat_id = ?').bind(chatId).all();
      
      let text = "<b>📋 Ваши отслеживаемые коллекции:</b>\n\n";
      let inline_keyboard = [];

      if (!results || results.length === 0) {
        text += "У вас пока нет подписок.";
      } else {
        text += "Нажмите на коллекцию для управления:";
        for (const row of results) {
          const thrText = row.threshold_type === 'abs' ? `${row.threshold_abs} ETH` : `${row.threshold_percent}%`;
          inline_keyboard.push([{ 
            text: `🔹 ${row.collection_name} (Порог: ${thrText})`, 
            callback_data: `track_view:${row.id}` 
          }]);
        }
      }

      inline_keyboard.push([{ text: "➕ Добавить", callback_data: "track_add" }, { text: "🏠 На главную", callback_data: "home" }]);

      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard }
      });
      return new Response('OK');
    }

    if (data.startsWith('track_view:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT * FROM price_alerts WHERE id = ? AND chat_id = ?').bind(id, chatId).first();
      if (!alert) {
        await sendHomeMenu(env, chatId, messageId);
        return new Response('OK');
      }

      const thrText = alert.threshold_type === 'abs' ? `${alert.threshold_abs} ETH` : `${alert.threshold_percent}%`;
      const text = `🔹 <b>${alert.collection_name}</b>\n\n📍 Текущая базовая цена: <b>${alert.baseline_price || 'неизвестно'} ETH</b>\n🎯 Порог срабатывания: <b>${thrText}</b>\n\n<i>Алерт сработает, если Floor Price изменится от базовой цены на указанный порог.</i>`;
      
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: "✏️ Изменить порог", callback_data: `track_edit_thr:${id}` }],
            [{ text: "🗑 Удалить", callback_data: `track_del:${id}` }],
            [{ text: "🔙 Назад к списку", callback_data: "track_list" }, { text: "🏠 На главную", callback_data: "home" }]
          ]
        }
      });
      return new Response('OK');
    }

    if (data.startsWith('track_edit_thr:')) {
      const id = data.split(':')[1];
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_EDIT_THRESHOLD', id, now, chatId).run();
      
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `🎯 <b>Укажите новый порог</b>\n\nНапишите <b>процент</b> (например: 15%), если хотите отслеживать процентное изменение.\nИли напишите <b>сумму в ETH</b> (например: 0.05), если хотите отслеживать изменение на конкретную сумму.`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: "Отмена", callback_data: `track_view:${id}` }]]
        }
      });
      return new Response('OK');
    }

    if (data.startsWith('track_del:')) {
      const id = data.split(':')[1];
      await env.DB.prepare('DELETE FROM price_alerts WHERE id = ? AND chat_id = ?').bind(id, chatId).run();
      
      // Return to list after delete
      const { results } = await env.DB.prepare('SELECT id, collection_name, threshold_type, threshold_abs, threshold_percent FROM price_alerts WHERE chat_id = ?').bind(chatId).all();
      let text = "✅ <b>Коллекция удалена!</b>\n\n<b>📋 Ваши отслеживаемые коллекции:</b>\n\n";
      let inline_keyboard = [];
      if (!results || results.length === 0) {
        text += "У вас пока нет подписок.";
      } else {
        for (const row of results) {
          const thrText = row.threshold_type === 'abs' ? `${row.threshold_abs} ETH` : `${row.threshold_percent}%`;
          inline_keyboard.push([{ text: `🔹 ${row.collection_name} (Порог: ${thrText})`, callback_data: `track_view:${row.id}` }]);
        }
      }
      inline_keyboard.push([{ text: "➕ Добавить", callback_data: "track_add" }, { text: "🏠 На главную", callback_data: "home" }]);

      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard }
      });
      return new Response('OK');
    }

    return new Response('OK');
  }

  // --- Handle Text Messages ---
  if (!update.message || !update.message.text) return new Response('OK');
  if (update.message.chat.type !== 'private') return new Response('OK');
  
  const chatId = update.message.chat.id.toString();
  const text = update.message.text.trim();
  const now = new Date().toISOString();

  let user = await env.DB.prepare('SELECT state, state_data FROM telegram_users WHERE chat_id = ?').bind(chatId).first();
  if (!user) {
    user = { state: 'IDLE', state_data: null };
    await env.DB.prepare('INSERT INTO telegram_users (chat_id, state, updated_at) VALUES (?, ?, ?)').bind(chatId, 'IDLE', now).run();
  }

  if (text === '/start' || text === '/home' || text === '/cancel' || text === '🏠 Главное меню') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
    
    // Always ensure the persistent bottom keyboard is present when returning to home
    await callTelegramApi(env, 'sendMessage', {
      chat_id: chatId,
      text: "Открываю главное меню...",
      reply_markup: {
        keyboard: [[{ text: "🏠 Главное меню" }]],
        resize_keyboard: true,
        is_persistent: true
      }
    }).then(res => res.json()).then(async data => {
      // Then send the actual inline menu
      await sendHomeMenu(env, chatId);
      // We can optionally delete the "Открываю главное меню..." message to keep it clean
      if (data.result && data.result.message_id) {
        await callTelegramApi(env, 'deleteMessage', { chat_id: chatId, message_id: data.result.message_id }).catch(() => {});
      }
    });
    return new Response('OK');
  }

  if (text === '/track') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_LINK', null, now, chatId).run();
    await callTelegramApi(env, 'sendMessage', {
      chat_id: chatId,
      text: "🔗 <b>Пришлите ссылку на коллекцию OpenSea</b>\n(например: <i>https://opensea.io/collection/jpeg-frens</i>)",
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: "🏠 На главную", callback_data: "home" }]] }
    });
    return new Response('OK');
  }

  if (text === '/list') {
    // Redirect logic to button click
    update.callback_query = { message: update.message, data: 'track_list', id: 'fake' };
    return handleTelegramWebhook({ method: 'POST', json: () => Promise.resolve(update) }, env);
  }

  if (user.state === 'WAITING_LINK') {
    let slug = text;
    try {
      if (text.includes('opensea.io/collection/')) {
        const url = new URL(text);
        slug = url.pathname.split('collection/')[1].split('/')[0];
      }
    } catch(e) {
      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: "❌ <b>Неверная ссылка.</b> Попробуйте еще раз или вернитесь на главную.",
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "🏠 На главную", callback_data: "home" }]] }
      });
      return new Response('OK');
    }

    try {
      const apiKey = await getOpenSeaApiKey(env);
      const data = await fetchOpenSeaJson(`/collections/${slug}`, apiKey);
      const statsData = await fetchOpenSeaJson(`/collections/${slug}/stats`, apiKey);
      
      const name = data.name || slug;
      const floor = statsData.total?.floor_price || 0;
      
      const stateData = JSON.stringify({ slug, name, floor });
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_THRESHOLD', stateData, now, chatId).run();
      
      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: `✅ Коллекция найдена: <b>${name}</b>\n\nТекущий Floor Price: <b>${floor} ETH</b>\n\n🎯 При каком изменении цены присылать уведомление?\n\nНапишите <b>процент</b> (например: 15%), если хотите отслеживать процентное изменение.\nИли напишите <b>сумму в ETH</b> (например: 0.05), если хотите отслеживать изменение на конкретную сумму.`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "🏠 На главную", callback_data: "home" }]] }
      });
    } catch (e) {
      console.error(e);
      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: `❌ Ошибка при поиске коллекции <b>${slug}</b>. Проверьте ссылку или попробуйте позже.`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "🏠 На главную", callback_data: "home" }]] }
      });
      await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', now, chatId).run();
    }
    return new Response('OK');
  }

  if (user.state === 'WAITING_THRESHOLD' || user.state === 'WAITING_EDIT_THRESHOLD') {
    const isPercent = text.includes('%');
    const val = parseFloat(text.replace('%', '').replace(/eth/i, '').replace(',', '.').trim());
    
    if (isNaN(val) || val <= 0) {
      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: "❌ Пожалуйста, введите корректное число (например: 15% или 0.05)",
        reply_markup: { inline_keyboard: [[{ text: "🏠 На главную", callback_data: "home" }]] }
      });
      return new Response('OK');
    }

    const type = isPercent ? 'percent' : 'abs';
    const percentVal = isPercent ? val : 0;
    const absVal = isPercent ? 0 : val;

    if (user.state === 'WAITING_THRESHOLD') {
      try {
        const data = JSON.parse(user.state_data);
        await env.DB.prepare(`
          INSERT OR REPLACE INTO price_alerts (chat_id, collection_slug, collection_name, baseline_price, threshold_percent, threshold_type, threshold_abs, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(chatId, data.slug, data.name, data.floor, percentVal, type, absVal, now, now).run();
        
        await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
        
        const msg = isPercent 
          ? `🚀 Отлично! Теперь я отслеживаю <b>${data.name}</b>.\nЯ пришлю уведомление, если цена (${data.floor} ETH) изменится на <b>${val}%</b> или больше.`
          : `🚀 Отлично! Теперь я отслеживаю <b>${data.name}</b>.\nЯ пришлю уведомление, если цена (${data.floor} ETH) изменится на <b>${val} ETH</b> или больше.`;
        
        await callTelegramApi(env, 'sendMessage', {
          chat_id: chatId,
          text: msg,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: "📋 Мои подписки", callback_data: "track_list" }, { text: "🏠 На главную", callback_data: "home" }]] }
        });
      } catch (e) {
        await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', now, chatId).run();
        await sendHomeMenu(env, chatId);
      }
    } else if (user.state === 'WAITING_EDIT_THRESHOLD') {
      const id = user.state_data;
      await env.DB.prepare(`
        UPDATE price_alerts SET threshold_type = ?, threshold_abs = ?, threshold_percent = ?, updated_at = ? WHERE id = ? AND chat_id = ?
      `).bind(type, absVal, percentVal, now, id, chatId).run();
      
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
      
      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: `✅ Порог успешно изменён!`,
        reply_markup: { inline_keyboard: [[{ text: "🔙 К коллекции", callback_data: `track_view:${id}` }, { text: "🏠 На главную", callback_data: "home" }]] }
      });
    }

    return new Response('OK');
  }

  // Fallback
  await sendHomeMenu(env, chatId);
  return new Response('OK');
}

export async function checkPriceAlerts(env) {
  const { results: alerts } = await env.DB.prepare('SELECT * FROM price_alerts').all();
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
    let thresholdText = '';

    if (alert.threshold_type === 'abs') {
      if (diff >= alert.threshold_abs) {
        isTriggered = true;
        thresholdText = `на ${alert.threshold_abs} ETH`;
      }
    } else {
      if (percentChange >= alert.threshold_percent) {
        isTriggered = true;
        thresholdText = `на ${percentChange.toFixed(1)}%`;
      }
    }

    if (isTriggered) {
      const direction = currentFloor > baseFloor ? '📈 Выросла' : '📉 Упала';
      const msg = `🚨 <b>Алерт: ${alert.collection_name}</b>\n\nЦена ${direction} ${thresholdText}!\n\nСтарая цена: ${baseFloor} ETH\nНовая цена: <b>${currentFloor} ETH</b>\n\n📊 Объем: ${stats.volume.toFixed(2)} ETH\n🛒 Продажи: ${stats.sales}`;
      
      await callTelegramApi(env, 'sendMessage', {
        chat_id: alert.chat_id,
        text: msg,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "⚙️ Настроить", callback_data: `track_view:${alert.id}` }]] }
      });
      
      await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?').bind(currentFloor, now, alert.id).run();
    }
  }
}
