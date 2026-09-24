import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { fetchOpenSeaJson, getOpenSeaApiKey } from './opensea.js';
import { getWalletBalance, updateWebhook } from './helius.js';
import { t } from './i18n.js';

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
         currentPrices[slug] = { floor: stats.total.floor_price };
      }
    } catch (e) { }
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
    let thresholdText = alert.threshold_type === 'abs' ? `${alert.threshold_abs} ETH` : `${alert.threshold_percent}%`;

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
      const changeStr = (isUp ? '+' : '-') + percentChange.toFixed(2);
      const time = new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });

      const msg = t(lang, 'trigger_msg', {
        name: alert.collection_name, old: baseFloor, new: currentFloor, icon,
        percent: changeStr, threshold: thresholdText, change24h: '0', time
      });
      
      const kb = new InlineKeyboard().text("👀 Открыть / Monitoring", `view_coll:${alert.id}`);
      
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: alert.chat_id, text: msg, parse_mode: 'HTML', reply_markup: kb })
      });
      
      await env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?').bind(currentFloor, now, alert.id).run();
      await env.DB.prepare('INSERT INTO alert_history (alert_id, direction, percent_change, old_price, new_price, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(alert.id, isUp ? 'up' : 'down', percentChange, baseFloor, currentFloor, now).run();
    }
  }
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

export async function handleTelegramWebhook(request, env) {
  if (request.method !== 'POST') return new Response('OK');
  
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return await next();
    
    let user = await env.DB.prepare('SELECT state, state_data, language FROM telegram_users WHERE chat_id = ?').bind(chatId).first();
    if (!user) {
      user = { state: 'IDLE', state_data: null, language: null };
      await env.DB.prepare('INSERT INTO telegram_users (chat_id, state, updated_at) VALUES (?, ?, ?)').bind(chatId, 'IDLE', new Date().toISOString()).run();
    }
    ctx.user = user;
    ctx.lang = user.language || 'ru';
    ctx.env = env;
    return await next();
  });

  const setState = async (ctx, state, state_data = null) => {
    await ctx.env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?')
      .bind(state, state_data ? JSON.stringify(state_data) : null, new Date().toISOString(), ctx.chat.id.toString()).run();
    ctx.user.state = state;
    ctx.user.state_data = state_data ? JSON.stringify(state_data) : null;
  };

  const sendLangMenu = async (ctx) => {
    const kb = new InlineKeyboard().text("🇷🇺 Русский", "set_lang:ru").row().text("🇬🇧 English", "set_lang:en");
    if (ctx.callbackQuery) await ctx.editMessageText("Выберите язык / Choose language:", { reply_markup: kb });
    else await ctx.reply("Выберите язык / Choose language:", { reply_markup: kb });
  };

  const sendHomeMenu = async (ctx) => {
    if (!ctx.user.language) return await sendLangMenu(ctx);
    const kb = new InlineKeyboard()
      .text("🖼 NFT Tracker", "nft_home").text("👛 Wallet Tracker", "wallet_home").row()
      .text("⚙️ Настройки", "settings").text("📖 Как это работает", "how_it_works");
    const text = `🤖 <b>Crypto Tracker</b>\n\nДобро пожаловать в мультитул.\nВыберите нужный раздел:`;
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    else await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  };

  bot.command(["start", "home", "cancel"], async (ctx) => {
    if (ctx.match === 'start' || ctx.message.text === '/start') {
      await ctx.env.DB.prepare('UPDATE telegram_users SET language = NULL WHERE chat_id = ?').bind(ctx.chat.id.toString()).run();
      ctx.user.language = null;
    }
    await setState(ctx, 'IDLE');
    await sendHomeMenu(ctx);
  });

  bot.callbackQuery(/^set_lang:(.+)/, async (ctx) => {
    const lang = ctx.match[1];
    await ctx.env.DB.prepare('UPDATE telegram_users SET language = ? WHERE chat_id = ?').bind(lang, ctx.chat.id.toString()).run();
    ctx.user.language = lang;
    ctx.lang = lang;
    await sendHomeMenu(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("home", async (ctx) => {
    await setState(ctx, 'IDLE');
    await sendHomeMenu(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("nft_home", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT id, is_active FROM price_alerts WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    const tracked = results ? results.length : 0;
    const active = results ? results.filter(r => r.is_active === 1).length : 0;
    const alert = await ctx.env.DB.prepare('SELECT updated_at FROM price_alerts ORDER BY updated_at DESC LIMIT 1').first();
    const lastCheck = alert?.updated_at ? new Date(alert.updated_at).toLocaleTimeString(ctx.lang==='ru'?'ru-RU':'en-US', { hour: '2-digit', minute: '2-digit' }) : t(ctx.lang, 'time_never');
    
    const text = `🖼 <b>NFT Tracker</b>\n\nОтслеживается коллекций: ${tracked}\nАктивных алертов: ${active}\nПоследняя проверка: ${lastCheck}`;
    const kb = new InlineKeyboard().text("📊 Мои коллекции", "my_colls").text("➕ Добавить коллекцию", "track_add").row().text("◀️ Главное меню", "home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("wallet_home", async (ctx) => {
    const text = `👛 <b>Wallet Tracker</b>\n\nВыберите блокчейн:\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;
    const kb = new InlineKeyboard().text("◎ Solana", "solana_home").text("⟠ EVM", "evm_home").row().text("◀️ Главное меню", "home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("settings", async (ctx) => {
    const kb = new InlineKeyboard().text(t(ctx.lang, 'btn_lang'), "settings_lang").row().text("◀️ Главное меню", "home");
    await ctx.editMessageText("⚙️ <b>Настройки</b>", { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery("settings_lang", async (ctx) => { await sendLangMenu(ctx); await ctx.answerCallbackQuery(); });
  
  bot.callbackQuery("how_it_works", async (ctx) => {
    const txt = ctx.lang === 'ru' ? "Бот отслеживает цены NFT на OpenSea и кошельки Solana." : "Tracks OpenSea and Solana wallets.";
    await ctx.editMessageText(txt, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(t(ctx.lang, 'btn_home'), "home") });
    await ctx.answerCallbackQuery();
  });

  
  bot.callbackQuery("evm_home", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT id FROM evm_wallets WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    const count = results ? results.length : 0;
    const text = `⟠ <b>EVM Wallet Tracker</b>\n\nОтслеживается:\n${count} кошелька(ов)\n\nАктивных уведомлений:\n${count}\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;
    const kb = new InlineKeyboard().text("👛 Мои кошельки", "evm_list").row().text("➕ Добавить кошелёк", "evm_add").row().text("◀️ Wallet Tracker", "wallet_home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("evm_add", async (ctx) => {
    await setState(ctx, 'WAITING_EVM_ADDRESS');
    await ctx.editMessageText("➕ <b>Добавление EVM-кошелька</b>\n\nОтправьте Ethereum/BSC/Polygon адрес.\n\nНапример:\n<code>0xd8dA6...D37aA</code>", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("❌ Отмена", "evm_home") });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_confirm:(.+)/, async (ctx) => {
    await setState(ctx, 'WAITING_EVM_NAME', { addr: ctx.match[1] });
    await ctx.editMessageText("🏷 <b>Название кошелька</b>\n\nВведите название.\nНапример:\nSmart Money", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("⏭ Пропустить", `evm_save_noname:${ctx.match[1]}`) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_save_noname:(.+)/, async (ctx) => {
    const addr = ctx.match[1];
    const name = `${addr.slice(0, 4)}...${addr.slice(-4)}`;
    const { meta } = await ctx.env.DB.prepare('INSERT INTO evm_wallets (chat_id, address, name, created_at) VALUES (?, ?, ?, ?)').bind(ctx.chat.id.toString(), addr, name, new Date().toISOString()).run();
    await ctx.env.DB.prepare('INSERT INTO evm_filters (wallet_id) VALUES (?)').bind(meta.last_row_id).run();
    
    // Process alchemy webhook
    const { initAlchemyWebhooks, updateAlchemyAddresses } = await import('./alchemy.js');
    await initAlchemyWebhooks(ctx.env);
    ctx.waitUntil(updateAlchemyAddresses(ctx.env, [addr]));

    await setState(ctx, 'IDLE');
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `evm_home` } });
  });

  bot.callbackQuery("evm_list", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT * FROM evm_wallets WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    let text = `⟠ <b>EVM Wallets</b>\n\nОтслеживается:\n${results ? results.length : 0} кошелька(ов)\n\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;
    const kb = new InlineKeyboard();
    if (results) results.forEach(w => kb.text(`🟢 ${w.name}`, `view_evm:${w.id}`).row());
    kb.text("➕ Добавить кошелёк", "evm_add").row().text("◀️ EVM", "evm_home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^view_evm:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const w = await ctx.env.DB.prepare('SELECT * FROM evm_wallets WHERE id = ? AND chat_id = ?').bind(id, ctx.chat.id.toString()).first();
    if (!w) return await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("🔔 События", `evm_filters:${id}`).row().url("🔗 Открыть кошелёк", `https://etherscan.io/address/${w.address}`).row().text("🗑 Удалить", `evm_del:${id}`).row().text("◀️ EVM Wallets", "evm_list");
    await ctx.editMessageText(`⟠ EVM\n\n👛 <b>${w.name}</b>\n<code>${w.address}</code>`, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_del:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.env.DB.prepare('DELETE FROM evm_filters WHERE wallet_id = ?').bind(id).run();
    await ctx.env.DB.prepare('DELETE FROM evm_wallets WHERE id = ?').bind(id).run();
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `evm_home` } });
  });

  bot.callbackQuery(/^evm_filters:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const filters = await ctx.env.DB.prepare('SELECT * FROM evm_filters WHERE wallet_id = ?').bind(id).first();
    if (!filters) return await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(`SWAP/Trade ${filters.notify_swap ? '🟢 ON' : '🔴 OFF'}`, `evm_t_f:${id}:swap`).row()
      .text(`Transfers ${filters.notify_transfer ? '🟢 ON' : '🔴 OFF'}`, `evm_t_f:${id}:transfer`).row()
      .text(`NFT ${filters.notify_nft ? '🟢 ON' : '🔴 OFF'}`, `evm_t_f:${id}:nft`).row()
      .text("◀️ Кошелёк", `view_evm:${id}`);
    await ctx.editMessageText("🔔 <b>События</b>\n\nВыберите уведомления:", { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_t_f:(.+):(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const field = ctx.match[2];
    await ctx.env.DB.prepare(`UPDATE evm_filters SET notify_${field} = CASE WHEN notify_${field} = 1 THEN 0 ELSE 1 END WHERE wallet_id = ?`).bind(id).run();
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `evm_filters:${id}` } });
  });
  

  // NFT MODULE
  bot.callbackQuery("my_colls", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT id, collection_name, is_active FROM price_alerts WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    let msgText = t(ctx.lang, 'no_collections');
    const kb = new InlineKeyboard();
    if (results && results.length > 0) {
      msgText = t(ctx.lang, 'my_collections');
      for (const r of results) kb.text(`${r.is_active ? '🟢' : '🔴'} ${r.collection_name}`, `view_coll:${r.id}`).row();
    }
    kb.text("◀️ NFT Tracker", "nft_home");
    await ctx.editMessageText(msgText, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("track_add", async (ctx) => {
    await setState(ctx, 'WAITING_LINK');
    await ctx.editMessageText(t(ctx.lang, 'send_link'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(t(ctx.lang, 'btn_cancel'), "nft_home") });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^setup_alert:(.+)/, async (ctx) => {
    const slug = ctx.match[1];
    const data = JSON.parse(ctx.user.state_data || '{}');
    await setState(ctx, 'WAITING_THRESHOLD', { ...data, slug });
    const kb = new InlineKeyboard()
      .text("5%", "set_thr:5").text("10%", "set_thr:10").text("20%", "set_thr:20").row()
      .text("0.01 ETH", "set_thr:0.01eth").text("0.05 ETH", "set_thr:0.05eth").row()
      .text(t(ctx.lang, 'btn_custom_threshold'), "set_thr_custom").row()
      .text(t(ctx.lang, 'btn_cancel'), "nft_home");
    await ctx.editMessageText(t(ctx.lang, 'ask_threshold'), { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("set_thr_custom", async (ctx) => {
    await ctx.editMessageText("Введите значение (например, 15% или 0.05)", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(t(ctx.lang, 'btn_cancel'), "nft_home") });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^set_thr:(.+)/, async (ctx) => {
    ctx.message = { text: ctx.match[1], chat: ctx.chat }; 
    await handleText(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^view_coll:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const alert = await ctx.env.DB.prepare('SELECT * FROM price_alerts WHERE id = ? AND chat_id = ?').bind(id, ctx.chat.id.toString()).first();
    if (!alert) return await ctx.answerCallbackQuery();
    
    const bounds = calculateBounds(alert.baseline_price, alert);
    const text = t(ctx.lang, 'alert_card', {
      name: alert.collection_name, floor: alert.baseline_price, threshold: alert.threshold_type==='abs'?`${alert.threshold_abs} ETH`:`${alert.threshold_percent}%`,
      upper: bounds.upper, lower: bounds.lower, status: alert.is_active ? '🟢 ACTIVE' : '🔴 PAUSED',
      updated: new Date(alert.updated_at).toLocaleTimeString(ctx.lang==='ru'?'ru-RU':'en-US', {hour:'2-digit', minute:'2-digit'})
    });
    
    const kb = new InlineKeyboard()
      .text(t(ctx.lang, 'btn_refresh_floor'), `refresh_coll:${id}`).row()
      .text(t(ctx.lang, 'btn_edit_threshold'), `edit_alert:${id}`).row()
      .text(t(ctx.lang, 'btn_history'), `hist_coll:${id}`).row()
      .text(alert.is_active ? t(ctx.lang, 'btn_pause') : t(ctx.lang, 'btn_resume'), `do_del:${id}:pause`).row()
      .text(t(ctx.lang, 'btn_delete'), `del_coll:${id}`).row()
      .text("◀️ Назад", "my_colls");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^refresh_coll:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const alert = await ctx.env.DB.prepare('SELECT collection_slug FROM price_alerts WHERE id = ?').bind(id).first();
    if (alert) {
      try {
        const apiKey = await getOpenSeaApiKey(ctx.env);
        const stats = await fetchOpenSeaJson(`/collections/${alert.collection_slug}/stats`, apiKey);
        if (stats.total?.floor_price) await ctx.env.DB.prepare('UPDATE price_alerts SET baseline_price = ?, updated_at = ? WHERE id = ?').bind(stats.total.floor_price, new Date().toISOString(), id).run();
      } catch(e) {}
    }
    ctx.match = [null, id];
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `view_coll:${id}` } });
  });

  bot.callbackQuery(/^edit_alert:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const alert = await ctx.env.DB.prepare('SELECT * FROM price_alerts WHERE id = ?').bind(id).first();
    if (!alert) return await ctx.answerCallbackQuery();
    await setState(ctx, 'WAITING_EDIT_THRESHOLD', { edit_id: id, name: alert.collection_name, floor: alert.baseline_price });
    const kb = new InlineKeyboard().text("5%", "set_thr:5").text("10%", "set_thr:10").row().text("0.01 ETH", "set_thr:0.01eth").text("0.05 ETH", "set_thr:0.05eth").row().text("◀️ Назад", `view_coll:${id}`);
    await ctx.editMessageText("Установите новый порог:", { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^hist_coll:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const { results } = await ctx.env.DB.prepare('SELECT * FROM alert_history WHERE alert_id = ? ORDER BY created_at DESC LIMIT 5').bind(id).all();
    let text = "📖 <b>История алертов</b>\n\n";
    if (!results || results.length === 0) text += "Пусто.";
    else results.forEach(r => { text += `${r.direction === 'up' ? '🟢' : '🔴'} ${new Date(r.created_at).toLocaleDateString()}: ${r.old_price} ➔ ${r.new_price} (${r.direction === 'up'?'+':'-'}${r.percent_change.toFixed(1)}%)\n`; });
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("◀️ Назад", `view_coll:${id}`) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^del_coll:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.editMessageText(t(ctx.lang, 'confirm_delete'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("Да, удалить", `do_del:${id}:del`).text("Нет", `view_coll:${id}`) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^do_del:(.+):(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const action = ctx.match[2];
    if (action === 'del') {
      await ctx.env.DB.prepare('DELETE FROM price_alerts WHERE id = ?').bind(id).run();
      return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `my_colls` } });
    } else if (action === 'pause') {
      await ctx.env.DB.prepare('UPDATE price_alerts SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(id).run();
      return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `view_coll:${id}` } });
    }
  });

  // SOLANA MODULE
  bot.callbackQuery("solana_home", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT id FROM solana_wallets WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    const count = results ? results.length : 0;
    const text = `◎ <b>Solana Wallet Tracker</b>\n\nОтслеживается:\n${count} кошелька(ов)\n\nАктивных уведомлений:\n${count}\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;
    const kb = new InlineKeyboard().text("👛 Мои кошельки", "solana_list").row().text("➕ Добавить кошелёк", "solana_add").row().text("🔔 Уведомления", "solana_filters_main").row().text("◀️ Wallet Tracker", "wallet_home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("solana_add", async (ctx) => {
    await setState(ctx, 'WAITING_SOL_ADDRESS');
    await ctx.editMessageText("➕ <b>Добавление Solana-кошелька</b>\n\nОтправьте Solana wallet address.\n\nНапример:\n<code>7xKX...AbCd</code>", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("❌ Отмена", "solana_home") });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^solana_confirm:(.+)/, async (ctx) => {
    await setState(ctx, 'WAITING_SOL_NAME', { addr: ctx.match[1] });
    await ctx.editMessageText("🏷 <b>Название кошелька</b>\n\nВведите название.\nНапример:\nWhale #1\nSmart Money", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("⏭ Пропустить", `solana_save_noname:${ctx.match[1]}`) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^solana_save_noname:(.+)/, async (ctx) => {
    const addr = ctx.match[1];
    const name = `${addr.slice(0, 4)}...${addr.slice(-4)}`;
    const { meta } = await ctx.env.DB.prepare('INSERT INTO solana_wallets (chat_id, address, name, created_at) VALUES (?, ?, ?, ?)').bind(ctx.chat.id.toString(), addr, name, new Date().toISOString()).run();
    await ctx.env.DB.prepare('INSERT INTO solana_filters (wallet_id) VALUES (?)').bind(meta.last_row_id).run();
    const { results } = await ctx.env.DB.prepare('SELECT DISTINCT address FROM solana_wallets').all();
    await updateWebhook(ctx.env, results.map(w => w.address));
    await setState(ctx, 'IDLE');
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `solana_home` } });
  });

  bot.callbackQuery("solana_list", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT * FROM solana_wallets WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    let text = `◎ <b>Solana Wallets</b>\n\nОтслеживается:\n${results ? results.length : 0} кошелька(ов)\n\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;
    const kb = new InlineKeyboard();
    if (results) results.forEach(w => kb.text(`🟢 ${w.name}`, `view_sol:${w.id}`).row());
    kb.text("➕ Добавить кошелёк", "solana_add").row().text("◀️ Solana", "solana_home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^view_sol:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const w = await ctx.env.DB.prepare('SELECT * FROM solana_wallets WHERE id = ? AND chat_id = ?').bind(id, ctx.chat.id.toString()).first();
    if (!w) return await ctx.answerCallbackQuery();
    let bal = '?';
    try { bal = await getWalletBalance(w.address, ctx.env); } catch(e){}
    const kb = new InlineKeyboard().text("🔔 События", `sol_filters:${id}`).row().url("🔗 Открыть кошелёк", `https://solscan.io/account/${w.address}`).row().text("🗑 Удалить", `sol_del:${id}`).row().text("◀️ Solana Wallets", "solana_list");
    await ctx.editMessageText(`◎ Solana\n\n👛 <b>${w.name}</b>\n<code>${w.address}</code>\n\n💰 Portfolio\n${bal} SOL`, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sol_del:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.env.DB.prepare('DELETE FROM solana_filters WHERE wallet_id = ?').bind(id).run();
    await ctx.env.DB.prepare('DELETE FROM solana_wallets WHERE id = ?').bind(id).run();
    const { results } = await ctx.env.DB.prepare('SELECT DISTINCT address FROM solana_wallets').all();
    if (results && results.length > 0) await updateWebhook(ctx.env, results.map(w => w.address));
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `solana_home` } });
  });

  bot.callbackQuery(/^sol_filters:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const filters = await ctx.env.DB.prepare('SELECT * FROM solana_filters WHERE wallet_id = ?').bind(id).first();
    if (!filters) return await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(`SWAP ${filters.notify_swap ? '🟢 ON' : '🔴 OFF'}`, `sol_t_f:${id}:swap`).row()
      .text(`Transfers ${filters.notify_transfer ? '🟢 ON' : '🔴 OFF'}`, `sol_t_f:${id}:transfer`).row()
      .text(`NFT Sales ${filters.notify_nft ? '🟢 ON' : '🔴 OFF'}`, `sol_t_f:${id}:nft`).row()
      .text(`Mints ${filters.notify_mint ? '🟢 ON' : '🔴 OFF'}`, `sol_t_f:${id}:mint`).row()
      .text("◀️ Кошелёк", `view_sol:${id}`);
    await ctx.editMessageText("🔔 <b>События</b>\n\nВыберите уведомления:", { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sol_t_f:(.+):(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const field = ctx.match[2];
    await ctx.env.DB.prepare(`UPDATE solana_filters SET notify_${field} = CASE WHEN notify_${field} = 1 THEN 0 ELSE 1 END WHERE wallet_id = ?`).bind(id).run();
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `sol_filters:${id}` } });
  });

  // TEXT HANDLER
  const handleText = async (ctx) => {

    if (state === 'WAITING_EVM_ADDRESS') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return await ctx.reply("❌ Некорректный адрес. Попробуйте еще раз.");
      const kb = new InlineKeyboard().text("✅ Добавить", `evm_confirm:${text}`).text("❌ Отмена", "evm_home");
      return await ctx.reply(`🔎 <b>Кошелёк корректен</b>\n\n⟠ EVM\n<code>${text}</code>\n\nДобавить этот кошелёк в мониторинг?`, { parse_mode: 'HTML', reply_markup: kb });
    }

    if (state === 'WAITING_EVM_NAME') {
      const data = JSON.parse(ctx.user.state_data);
      const { meta } = await ctx.env.DB.prepare('INSERT INTO evm_wallets (chat_id, address, name, created_at) VALUES (?, ?, ?, ?)').bind(chatId, data.addr, text, now).run();
      await ctx.env.DB.prepare('INSERT INTO evm_filters (wallet_id) VALUES (?)').bind(meta.last_row_id).run();
      
      const { initAlchemyWebhooks, updateAlchemyAddresses } = await import('./alchemy.js');
      await initAlchemyWebhooks(ctx.env);
      ctx.waitUntil(updateAlchemyAddresses(ctx.env, [data.addr]));

      await setState(ctx, 'IDLE');
      return await ctx.reply("✅ <b>Кошелёк добавлен!</b>", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("⟠ Открыть EVM Tracker", "evm_home") });
    }

    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id.toString();
    const state = ctx.user.state;
    const now = new Date().toISOString();

    if (state === 'WAITING_SOL_ADDRESS') {
      if (text.length < 32) return await ctx.reply("❌ Некорректный адрес. Попробуйте еще раз.");
      let bal = '?';
      try { bal = await getWalletBalance(text, ctx.env); } catch(e){}
      const kb = new InlineKeyboard().text("✅ Добавить", `solana_confirm:${text}`).text("❌ Отмена", "solana_home");
      return await ctx.reply(`🔎 <b>Кошелёк найден</b>\n\n◎ Solana\n<code>${text}</code>\n\nSOL:\n${bal} SOL\n\nДобавить этот кошелёк в мониторинг?`, { parse_mode: 'HTML', reply_markup: kb });
    }

    if (state === 'WAITING_SOL_NAME') {
      const data = JSON.parse(ctx.user.state_data);
      const { meta } = await ctx.env.DB.prepare('INSERT INTO solana_wallets (chat_id, address, name, created_at) VALUES (?, ?, ?, ?)').bind(chatId, data.addr, text, now).run();
      await ctx.env.DB.prepare('INSERT INTO solana_filters (wallet_id) VALUES (?)').bind(meta.last_row_id).run();
      const { results } = await ctx.env.DB.prepare('SELECT DISTINCT address FROM solana_wallets').all();
      await updateWebhook(ctx.env, results.map(w => w.address));
      await setState(ctx, 'IDLE');
      return await ctx.reply("✅ <b>Кошелёк добавлен!</b>", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("◎ Открыть Solana Tracker", "solana_home") });
    }

    if (state === 'WAITING_LINK') {
      try {
        let slug = text;
        if (slug.includes('opensea.io/collection/')) slug = slug.split('opensea.io/collection/')[1].split('/')[0].split('?')[0];
        const apiKey = await getOpenSeaApiKey(ctx.env);
        const collectionRes = await fetchOpenSeaJson(`/collections/${slug}`, apiKey);
        if (!collectionRes.collection) throw new Error("Not found");
        const name = collectionRes.collection.name;
        const statsRes = await fetchOpenSeaJson(`/collections/${slug}/stats`, apiKey);
        const floor = statsRes.total.floor_price;
        await setState(ctx, 'IDLE', { slug, name, floor });
        const kb = new InlineKeyboard().text(t(ctx.lang, 'btn_create_alert'), `setup_alert:${slug}`).row().text(t(ctx.lang, 'btn_cancel'), "nft_home");
        return await ctx.reply(t(ctx.lang, 'collection_found', { name, floor, change24h: '0', volume: statsRes.total.volume.toFixed(2) }), { parse_mode: 'HTML', reply_markup: kb });
      } catch (e) {
        const kb = new InlineKeyboard().text(t(ctx.lang, 'btn_try_again'), "track_add").text(t(ctx.lang, 'btn_home'), "home");
        return await ctx.reply(t(ctx.lang, 'collection_not_found'), { parse_mode: 'HTML', reply_markup: kb });
      }
    }

    if (state === 'WAITING_THRESHOLD' || state === 'WAITING_EDIT_THRESHOLD') {
      const isPercent = text.includes('%');
      const val = parseFloat(text.replace('%', '').replace(/eth/i, '').replace(',', '.').trim());
      if (isNaN(val) || val <= 0) return await ctx.reply(t(ctx.lang, 'invalid_number'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(t(ctx.lang, 'btn_home'), "home") });
      
      const type = isPercent ? 'percent' : 'abs';
      const percentVal = isPercent ? val : 0;
      const absVal = isPercent ? 0 : val;
      const data = JSON.parse(ctx.user.state_data);

      if (state === 'WAITING_THRESHOLD') {
        try {
          await ctx.env.DB.prepare(`INSERT INTO price_alerts (chat_id, collection_slug, collection_name, baseline_price, threshold_percent, threshold_type, threshold_abs, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(chatId, data.slug, data.name, data.floor, percentVal, type, absVal, now, now).run();
          await setState(ctx, 'IDLE');
          const bounds = calculateBounds(data.floor, { threshold_type: type, threshold_abs: absVal, threshold_percent: percentVal });
          const kb = new InlineKeyboard().text(t(ctx.lang, 'btn_my_collections'), "my_colls").text(t(ctx.lang, 'btn_home'), "nft_home");
          return await ctx.reply(t(ctx.lang, 'alert_created', { name: data.name, floor: data.floor, threshold: isPercent?`${val}%`:`${val} ETH`, upper: bounds.upper, lower: bounds.lower }), { parse_mode: 'HTML', reply_markup: kb });
        } catch (e) { await setState(ctx, 'IDLE'); return await sendHomeMenu(ctx); }
      } else {
        await ctx.env.DB.prepare(`UPDATE price_alerts SET threshold_type = ?, threshold_abs = ?, threshold_percent = ?, updated_at = ? WHERE id = ? AND chat_id = ?`).bind(type, absVal, percentVal, now, data.edit_id, chatId).run();
        await setState(ctx, 'IDLE');
        const bounds = calculateBounds(data.floor, { threshold_type: type, threshold_abs: absVal, threshold_percent: percentVal });
        const kb = new InlineKeyboard().text("◀️ Назад", `view_coll:${data.edit_id}`).text(t(ctx.lang, 'btn_home'), "nft_home");
        return await ctx.reply(t(ctx.lang, 'alert_changed', { name: data.name, floor: data.floor, threshold: isPercent?`${val}%`:`${val} ETH`, upper: bounds.upper, lower: bounds.lower }), { parse_mode: 'HTML', reply_markup: kb });
      }
    }
  };

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    await handleText(ctx);
  });

  const cb = webhookCallback(bot, "cloudflare-mod");
  return await cb(request);
}
