import { fetchOpenSeaJson, getOpenSeaApiKey } from './opensea.js';
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

async function sendHomeMenu(env, chatId, user, messageIdToEdit = null) {
  if (!user.language) {
    const text = "Выберите язык / Choose language:";
    const reply_markup = {
      inline_keyboard: [
        [{ text: "🇷🇺 Русский", callback_data: "set_lang:ru" }],
        [{ text: "🇬🇧 English", callback_data: "set_lang:en" }]
      ]
    };
    if (messageIdToEdit) {
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageIdToEdit, text, reply_markup });
    } else {
      await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text, reply_markup });
    }
    return;
  }

  const lang = user.language;
  const { results } = await env.DB.prepare('SELECT id, is_active FROM price_alerts WHERE chat_id = ?').bind(chatId).all();
  const tracked = results ? results.length : 0;
  const active = results ? results.filter(r => r.is_active === 1).length : 0;
  
  // Get last check time from the first alert's updated_at (approximate)
  let lastCheck = t(lang, 'time_never');
  const alert = await env.DB.prepare('SELECT updated_at FROM price_alerts ORDER BY updated_at DESC LIMIT 1').first();
  if (alert && alert.updated_at) {
    lastCheck = new Date(alert.updated_at).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }

  const text = t(lang, 'main_menu', { tracked, active, time: lastCheck });
  const reply_markup = {
    inline_keyboard: [
      [{ text: t(lang, 'btn_add_collection'), callback_data: "track_add" }],
      [{ text: t(lang, 'btn_my_collections'), callback_data: "my_colls" }],
      [{ text: t(lang, 'btn_active_alerts'), callback_data: "active_alerts" }],
      [{ text: t(lang, 'btn_settings'), callback_data: "settings" }],
      [{ text: t(lang, 'btn_how_it_works'), callback_data: "how_it_works" }]
    ]
  };

  if (messageIdToEdit) {
    await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageIdToEdit, text, parse_mode: 'HTML', reply_markup });
  } else {
    // Send persistent bottom keyboard if needed
    await callTelegramApi(env, 'sendMessage', {
      chat_id: chatId,
      text: "...",
      reply_markup: { keyboard: [[{ text: lang === 'ru' ? "🏠 Главное меню" : "🏠 Main Menu" }]], resize_keyboard: true, is_persistent: true }
    }).then(async (res) => {
      const data = await res.json();
      await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup });
      if (data.result && data.result.message_id) {
        await callTelegramApi(env, 'deleteMessage', { chat_id: chatId, message_id: data.result.message_id }).catch(() => {});
      }
    });
  }
}

export async function handleTelegramWebhook(request, env) {
  if (request.method !== 'POST') return new Response('OK');
  let update;
  try { update = await request.json(); } catch (e) { return new Response('OK'); }

  const now = new Date().toISOString();

  // Handle Callback Queries
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

    if (data.startsWith('set_lang:')) {
      const lang = data.split(':')[1];
      await env.DB.prepare('UPDATE telegram_users SET language = ?, updated_at = ? WHERE chat_id = ?').bind(lang, now, chatId).run();
      user.language = lang;
      await sendHomeMenu(env, chatId, user, messageId);
      return new Response('OK');
    }

    const lang = user.language || 'ru';

    if (data === 'home') {
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
      await sendHomeMenu(env, chatId, user, messageId);
      return new Response('OK');
    }

    if (data === 'how_it_works') {
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId, message_id: messageId,
        text: t(lang, 'how_it_works'), parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_home'), callback_data: "home" }]] }
      });
      return new Response('OK');
    }

    if (data === 'settings') {
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId, message_id: messageId,
        text: t(lang, 'settings_title'), parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: t(lang, 'btn_lang'), callback_data: "settings_lang" }],
          [{ text: t(lang, 'btn_home'), callback_data: "home" }]
        ]}
      });
      return new Response('OK');
    }

    if (data === 'settings_lang') {
      await env.DB.prepare('UPDATE telegram_users SET language = NULL, updated_at = ? WHERE chat_id = ?').bind(now, chatId).run();
      user.language = null;
      await sendHomeMenu(env, chatId, user, messageId);
      return new Response('OK');
    }

    if (data === 'track_add') {
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_LINK', null, now, chatId).run();
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId, message_id: messageId,
        text: t(lang, 'add_prompt'), parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_home'), callback_data: "home" }]] }
      });
      return new Response('OK');
    }

    if (data.startsWith('setup_alert:') || data.startsWith('edit_alert:')) {
      const isEdit = data.startsWith('edit_alert:');
      const payloadId = data.split(':')[1];
      
      let stateDataStr, name, floor, thresholdText = '';
      if (isEdit) {
        const alert = await env.DB.prepare('SELECT * FROM price_alerts WHERE id = ?').bind(payloadId).first();
        if (!alert) return new Response('OK');
        name = alert.collection_name;
        floor = alert.baseline_price;
        thresholdText = getThresholdText(alert);
        stateDataStr = JSON.stringify({ edit_id: payloadId, slug: alert.collection_slug, name, floor });
        await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_EDIT_THRESHOLD', stateDataStr, now, chatId).run();
      } else {
        // It's setup_alert:slug
        stateDataStr = user.state_data;
        if (!stateDataStr) return new Response('OK');
        const parsed = JSON.parse(stateDataStr);
        name = parsed.name;
        floor = parsed.floor;
        await env.DB.prepare('UPDATE telegram_users SET state = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_THRESHOLD', now, chatId).run();
      }

      const text = isEdit 
        ? t(lang, 'edit_alert_prompt', { name, threshold: thresholdText })
        : t(lang, 'setup_alert', { name, floor });
      
      const kb = [
        [{ text: "±1%", callback_data: "set_thr:1%" }, { text: "±2%", callback_data: "set_thr:2%" }, { text: "±5%", callback_data: "set_thr:5%" }],
        [{ text: "±10%", callback_data: "set_thr:10%" }, { text: "±15%", callback_data: "set_thr:15%" }, { text: "±20%", callback_data: "set_thr:20%" }],
        [{ text: t(lang, 'btn_custom_percent'), callback_data: "set_thr_custom" }],
        [{ text: isEdit ? t(lang, 'btn_back') : t(lang, 'btn_cancel'), callback_data: isEdit ? `view_coll:${payloadId}` : "home" }]
      ];
      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
      return new Response('OK');
    }

    if (data === 'set_thr_custom') {
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId, message_id: messageId,
        text: t(lang, 'custom_percent_prompt'), parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_cancel'), callback_data: "home" }]] }
      });
      return new Response('OK');
    }

    if (data.startsWith('set_thr:')) {
      const valStr = data.split(':')[1];
      // Reuse the text handling logic by simulating a message
      update.message = { chat: { id: parseInt(chatId), type: 'private' }, text: valStr };
      update.callback_query = null;
      // Let it fall through to text handling below
    }

    if (data === 'my_colls' || data === 'active_alerts') {
      const onlyActive = data === 'active_alerts';
      let q = 'SELECT id, collection_name, threshold_type, threshold_abs, threshold_percent, baseline_price, is_active FROM price_alerts WHERE chat_id = ?';
      if (onlyActive) q += ' AND is_active = 1';
      const { results } = await env.DB.prepare(q).bind(chatId).all();
      
      const text = t(lang, onlyActive ? 'active_alerts_title' : 'my_collections', { total: results ? results.length : 0 });
      let kb = [];
      if (results) {
        for (const row of results) {
          const thrText = row.threshold_type === 'abs' ? `${row.threshold_abs} ETH` : `${row.threshold_percent}%`;
          const icon = row.is_active ? '🟢' : '🔴';
          kb.push([{ text: `${icon} ${row.collection_name} — ${row.baseline_price || 0} ETH · ±${thrText}`, callback_data: `view_coll:${row.id}` }]);
        }
      }
      if (!onlyActive) {
        kb.push([{ text: t(lang, 'btn_add_collection'), callback_data: "track_add" }]);
        kb.push([{ text: t(lang, 'btn_active_alerts'), callback_data: "active_alerts" }]);
      } else {
        kb.push([{ text: t(lang, 'btn_my_collections'), callback_data: "my_colls" }]);
      }
      kb.push([{ text: t(lang, 'btn_home'), callback_data: "home" }]);

      await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
      return new Response('OK');
    }

    if (data.startsWith('view_coll:') || data.startsWith('refresh_coll:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT * FROM price_alerts WHERE id = ? AND chat_id = ?').bind(id, chatId).first();
      if (!alert) return new Response('OK');
      
      let floor = alert.baseline_price;
      let change24h = '0';
      let volume = '0';
      
      if (data.startsWith('refresh_coll:')) {
        try {
          const apiKey = await getOpenSeaApiKey(env);
          const stats = await fetchOpenSeaJson(`/collections/${alert.collection_slug}/stats`, apiKey);
          floor = stats.total?.floor_price || floor;
          volume = (stats.total?.volume || 0).toFixed(2);
          if (stats.intervals && stats.intervals[0]) {
            // approximating 24h change if available in API
            // Note: OpenSea doesn't always provide floor_price change directly in stats, we might calculate volume change or ignore.
            // Let's just use what we have or 0
          }
        } catch(e) {}
      }

      const thrText = getThresholdText(alert);
      const bounds = calculateBounds(floor, alert);
      const statusText = alert.is_active ? t(lang, 'status_active') : t(lang, 'status_inactive');

      let text = t(lang, 'card_collection', {
        name: alert.collection_name, floor, change24h, volume,
        status: statusText, threshold: thrText, base: alert.baseline_price, upper: bounds.upper, lower: bounds.lower
      });

      if (data.startsWith('refresh_coll:')) {
        const time = new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
        text = t(lang, 'refreshed', { name: alert.collection_name, floor, change24h, volume, time });
      }

      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: t(lang, 'btn_edit_alert'), callback_data: `edit_alert:${id}` }, { text: t(lang, 'btn_refresh'), callback_data: `refresh_coll:${id}` }],
          [{ text: t(lang, 'btn_history'), callback_data: `hist_coll:${id}` }, { text: t(lang, 'btn_delete'), callback_data: `del_coll:${id}` }],
          [{ text: t(lang, 'btn_back'), callback_data: "my_colls" }]
        ]}
      });
      return new Response('OK');
    }

    if (data.startsWith('hist_coll:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT collection_name FROM price_alerts WHERE id = ?').bind(id).first();
      if (!alert) return new Response('OK');
      
      const { results } = await env.DB.prepare('SELECT * FROM alert_history WHERE alert_id = ? ORDER BY id DESC LIMIT 5').bind(id).all();
      let text = t(lang, 'history_title', { name: alert.collection_name });
      if (!results || results.length === 0) {
        text += t(lang, 'history_empty');
      } else {
        for (const r of results) {
          const time = new Date(r.created_at).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
          const dirIcon = r.direction === 'up' ? '↑' : '↓';
          text += t(lang, 'history_item', { time, direction: dirIcon, percent: r.percent_change.toFixed(2), old: r.old_price, new: r.new_price });
        }
      }
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_back'), callback_data: `view_coll:${id}` }]] }
      });
      return new Response('OK');
    }

    if (data.startsWith('del_coll:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT * FROM price_alerts WHERE id = ?').bind(id).first();
      if (!alert) return new Response('OK');
      const text = t(lang, 'confirm_delete', { name: alert.collection_name, floor: alert.baseline_price, threshold: getThresholdText(alert) });
      await callTelegramApi(env, 'editMessageText', {
        chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_yes_delete'), callback_data: `do_del:${id}` }], [{ text: t(lang, 'btn_cancel'), callback_data: `view_coll:${id}` }]] }
      });
      return new Response('OK');
    }

    if (data.startsWith('do_del:')) {
      const id = data.split(':')[1];
      const alert = await env.DB.prepare('SELECT collection_name FROM price_alerts WHERE id = ?').bind(id).first();
      if (alert) {
        await env.DB.prepare('DELETE FROM price_alerts WHERE id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM alert_history WHERE alert_id = ?').bind(id).run();
        await callTelegramApi(env, 'editMessageText', {
          chat_id: chatId, message_id: messageId,
          text: t(lang, 'deleted', { name: alert.collection_name }), parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_my_collections'), callback_data: "my_colls" }], [{ text: t(lang, 'btn_home'), callback_data: "home" }]] }
        });
      }
      return new Response('OK');
    }

    if (!update.message) return new Response('OK'); // If it didn't fall through to text processing
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

  const lang = user.language || 'ru';

  if (text === '/start' || text === '/home' || text === '/cancel' || text === '🏠 Главное меню' || text === '🏠 Main Menu') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', null, now, chatId).run();
    await sendHomeMenu(env, chatId, user);
    return new Response('OK');
  }

  if (text === '/track') {
    await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('WAITING_LINK', null, now, chatId).run();
    await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text: t(lang, 'add_prompt'), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_home'), callback_data: "home" }]] } });
    return new Response('OK');
  }

  if (text === '/list') {
    update.callback_query = { message: update.message, data: 'my_colls', id: 'fake' };
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
      await callTelegramApi(env, 'sendMessage', { chat_id: chatId, text: t(lang, 'collection_not_found'), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_try_again'), callback_data: "track_add" }, { text: t(lang, 'btn_home'), callback_data: "home" }]] } });
      return new Response('OK');
    }

    try {
      const apiKey = await getOpenSeaApiKey(env);
      const data = await fetchOpenSeaJson(`/collections/${slug}`, apiKey);
      const statsData = await fetchOpenSeaJson(`/collections/${slug}/stats`, apiKey);
      
      const name = data.name || slug;
      const floor = statsData.total?.floor_price || 0;
      const volume = (statsData.total?.volume || 0).toFixed(2);
      
      const stateData = JSON.stringify({ slug, name, floor });
      await env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind('IDLE', stateData, now, chatId).run(); // Change to IDLE because next step is button click
      
      await callTelegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: t(lang, 'collection_found', { name, floor, change24h: '0', volume }),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_create_alert'), callback_data: `setup_alert:${slug}` }], [{ text: t(lang, 'btn_cancel'), callback_data: "home" }]] }
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
      let mId = update.callback_query ? update.callback_query.message.message_id : null;
      let method = mId ? 'editMessageText' : 'sendMessage';
      await callTelegramApi(env, method, {
        chat_id: chatId, message_id: mId,
        text: t(lang, 'invalid_number'), parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_home'), callback_data: "home" }]] }
      });
      return new Response('OK');
    }

    const type = isPercent ? 'percent' : 'abs';
    const percentVal = isPercent ? val : 0;
    const absVal = isPercent ? 0 : val;
    let mId = update.callback_query ? update.callback_query.message.message_id : null;
    let method = mId ? 'editMessageText' : 'sendMessage';

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
        
        await callTelegramApi(env, method, {
          chat_id: chatId, message_id: mId,
          text: t(lang, 'alert_created', { name: data.name, floor: data.floor, threshold: thrText, upper: bounds.upper, lower: bounds.lower }),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_my_collections'), callback_data: "my_colls" }, { text: t(lang, 'btn_home'), callback_data: "home" }]] }
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

      await callTelegramApi(env, method, {
        chat_id: chatId, message_id: mId,
        text: t(lang, 'alert_changed', { name: data.name, floor: data.floor, threshold: thrText, upper: bounds.upper, lower: bounds.lower }),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_back'), callback_data: `view_coll:${id}` }, { text: t(lang, 'btn_home'), callback_data: "home" }]] }
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
        reply_markup: { inline_keyboard: [[{ text: "📊 Мониторинг / Monitoring", callback_data: `view_coll:${alert.id}` }]] }
      });
      
      await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?').bind(currentFloor, now, alert.id).run();
      await env.DB.prepare('INSERT INTO alert_history (alert_id, direction, percent_change, old_price, new_price, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(alert.id, direction, percentChange, baseFloor, currentFloor, now).run();
    }
  }
}
