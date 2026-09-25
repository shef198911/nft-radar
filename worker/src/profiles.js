import { InlineKeyboard } from "grammy";
import { searchGeckoTerminal } from './geckoterminal.js';

export async function setState(ctx, state, data = '{}') {
  const userId = ctx.from.id.toString();
  await ctx.env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind(state, data, new Date().toISOString(), ctx.from.id.toString()).run();
}

export async function handleProfilesHome(ctx) {
  const userId = ctx.from.id.toString();
  const profile = await ctx.env.DB.prepare('SELECT * FROM profiles WHERE chat_id = ?').bind(userId).first();
  
  if (!profile) {
    await setState(ctx, 'WAITING_PROFILE_NAME');
    return await ctx.reply("👋 У вас еще нет профиля. Отправьте мне имя для вашего первого профиля (например, 'Основной'):", { reply_markup: new InlineKeyboard().text("❌ Отмена", "home") });
  }

  const kb = new InlineKeyboard()
    .text("🖼 NFT Tracker", "nft_home").row()
    .text("👛 Wallet Tracker", "wallet_hub").row()
    .text("🪙 Coin Tracker", "coin_home").row()
    .text("🔙 Назад", "home");
    
  return await ctx.reply(`👤 <b>Ваш профиль:</b> ${profile.name}\n\nВыберите инструмент для мониторинга:`, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleWalletHub(ctx) {
  const kb = new InlineKeyboard()
    .text("⟠ EVM (Ethereum, Base, Arbitrum...)", "evm_home").row()
    .text("◎ Solana", "solana_home").row()
    .text("🔙 К профилю", "profiles_home");
  return await ctx.reply("👛 <b>Wallet Tracker</b>\n\nВыберите экосистему:", { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleCoinHome(ctx) {
  const userId = ctx.from.id.toString();
  const profile = await ctx.env.DB.prepare('SELECT id FROM profiles WHERE chat_id = ?').bind(userId).first();
  if (!profile) return await handleProfilesHome(ctx);
  
  const coll = await ctx.env.DB.prepare('SELECT * FROM coin_collections WHERE profile_id = ?').bind(profile.id).first();
  if (!coll) {
    await setState(ctx, 'WAITING_COIN_COLLECTION_NAME', JSON.stringify({ profileId: profile.id }));
    return await ctx.reply("🪙 У вас еще нет коллекции токенов. Отправьте мне название для коллекции (например, 'Мемкоины'):", { reply_markup: new InlineKeyboard().text("❌ Отмена", "profiles_home") });
  }

  // Count tokens
  const countRes = await ctx.env.DB.prepare('SELECT COUNT(*) as c FROM coin_trackers WHERE collection_id = ?').bind(coll.id).first();
  const tokenCount = countRes ? countRes.c : 0;
  
  let kb = new InlineKeyboard()
    .text("➕ Добавить токен", `coin_add:${coll.id}`).row();
    
  if (tokenCount > 0) {
    kb.text("✏️ Редактировать", `coin_edit:${coll.id}`).row();
  }
  
  kb.text("🔗 Привязать Telegram Чат", `coin_chat:${coll.id}`).row()
    .text("🔙 К профилю", "profiles_home");

  return await ctx.reply(`🪙 <b>Коллекция:</b> ${coll.name}\nОтслеживается токенов: ${tokenCount}/10\nЧат для уведомлений: ${coll.target_chat_id ? 'Привязан ✅' : 'Только сюда 💬'}\n\nЧто делаем?`, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleCoinAdd(ctx, collectionId) {
  // Check limits
  const isAdmin = ctx.from.id.toString() === '332680373';
  if (!isAdmin) {
    const countRes = await ctx.env.DB.prepare('SELECT COUNT(*) as c FROM coin_trackers WHERE collection_id = ?').bind(collectionId).first();
    if (countRes && countRes.c >= 10) {
      return await ctx.reply("❌ Вы достигли лимита в 10 токенов для одной коллекции.\n\nУдалите старые токены, чтобы добавить новые.", { reply_markup: new InlineKeyboard().text("🔙 Назад", "coin_home") });
    }
  }

  await setState(ctx, 'WAITING_COIN_QUERY', JSON.stringify({ collectionId }));
  return await ctx.reply("🔎 Отправьте мне <b>смарт-контракт</b> токена (рекомендуется) или его <b>тикер</b> (например, NVDA или ETH):", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("❌ Отмена", "coin_home") });
}

export async function processCoinQuery(ctx, query) {
  const data = JSON.parse(ctx.user.state_data);
  const msg = await ctx.reply("⏳ Ищу токен на GeckoTerminal...");
  
  const tokens = await searchGeckoTerminal(query);
  await ctx.api.deleteMessage(ctx.chat.id, msg.message_id);

  if (!tokens || tokens.length === 0) {
    return await ctx.reply("❌ Токен не найден. Проверьте адрес или тикер и попробуйте еще раз.", { reply_markup: new InlineKeyboard().text("❌ Отмена", "coin_home") });
  }

  let text = "🔎 <b>Найдены токены:</b>\n\nВыберите нужный:\n\n";
  const kb = new InlineKeyboard();
  
  tokens.forEach((t, index) => {
    const p = t.priceUsd ? (t.priceUsd < 0.001 ? t.priceUsd.toFixed(8) : t.priceUsd.toFixed(4)) : '0';
    text += `${index + 1}. <b>$${t.ticker}</b> (${t.name}) на сети <b>${t.network.toUpperCase()}</b> - Цена: $${p}\n`;
    kb.text(`${index + 1}`, `coin_sel:${data.collectionId}:${t.contract_address}`).text("🔗 GeckoTerminal", `url_https://geckoterminal.com/${t.network}/${t.contract_address}`).row();
  });
  
  kb.text("❌ Отмена", "coin_home");
  return await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleCoinSelect(ctx, collectionId, contract) {
  // Fetch specific token
  const tokens = await searchGeckoTerminal(contract);
  if (!tokens || tokens.length === 0) return await ctx.reply("❌ Ошибка получения цены токена.");
  const token = tokens[0];

  await setState(ctx, 'WAITING_COIN_PERCENT', JSON.stringify({ collectionId, contract, network: token.network, ticker: token.ticker, price: token.priceUsd }));
  
  const p = token.priceUsd < 0.001 ? token.priceUsd.toFixed(8) : token.priceUsd.toFixed(4);
  
  const kb = new InlineKeyboard()
    .text("5%", "coin_pct:5").text("10%", "coin_pct:10").text("15%", "coin_pct:15").text("20%", "coin_pct:20").row()
    .text("✍️ Ввести вручную", "coin_pct_manual").row()
    .text("❌ Отмена", "coin_home");
    
  return await ctx.reply(`🪙 <b>$${token.ticker}</b> на <b>${token.network.toUpperCase()}</b>\nТекущая цена: $${p}\n\nНа какое изменение цены (в %) установить триггер? Выберите из списка или введите вручную:`, { parse_mode: 'HTML', reply_markup: kb });
}

export async function saveCoinTracker(ctx, percentStr) {
  const data = JSON.parse(ctx.user.state_data);
  const pct = parseFloat(percentStr);
  if (isNaN(pct) || pct <= 0) return await ctx.reply("❌ Некорректный процент.");
  
  const now = new Date().toISOString();
  await ctx.env.DB.prepare('INSERT INTO coin_trackers (collection_id, contract_address, network, ticker, baseline_price, trigger_percent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(data.collectionId, data.contract, data.network, data.ticker, data.price, pct, now).run();
    
  await setState(ctx, 'IDLE');
  return await ctx.reply(`✅ <b>Токен $${data.ticker} добавлен!</b>\n\nТриггер: ${pct}%\nБазовая цена: $${data.price}`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("🔙 В меню коллекции", "coin_home") });
}

export async function handleCoinEdit(ctx, collectionId) {
  const { results: trackers } = await ctx.env.DB.prepare('SELECT * FROM coin_trackers WHERE collection_id = ?').bind(collectionId).all();
  if (!trackers || trackers.length === 0) return await ctx.reply("❌ В коллекции нет токенов.", { reply_markup: new InlineKeyboard().text("🔙 Назад", "coin_home") });
  
  for (const t of trackers) {
    const kb = new InlineKeyboard()
      .text("✏️ Изменить %", `coin_edit_pct:${t.id}`)
      .text("🗑 Удалить", `coin_del:${t.id}`);
    
    await ctx.reply(`🪙 <b>$${t.ticker}</b> (${t.network.toUpperCase()})\nБаза: $${t.baseline_price} | Триггер: ${t.trigger_percent}%`, { parse_mode: 'HTML', reply_markup: kb });
  }
  
  return await ctx.reply("Выберите действие с токенами выше 👆", { reply_markup: new InlineKeyboard().text("🔙 Назад", "coin_home") });
}

export async function handleCoinChat(ctx, collectionId) {
  await setState(ctx, 'WAITING_COIN_CHAT', JSON.stringify({ collectionId }));
  
  const botInfo = await ctx.api.getMe();
  const botUsername = botInfo.username;
  const link = `https://t.me/${botUsername}?startgroup=col_${collectionId}&admin=post_messages+edit_messages+delete_messages`;
  
  const kb = new InlineKeyboard()
    .url("➕ Добавить бота в чат", link).row()
    .text("❌ Отмена", "coin_home");

  return await ctx.reply(`🔗 <b>Привязка Telegram группы</b>\n\nВы можете нажать кнопку ниже, чтобы автоматически добавить бота в вашу группу с правами администратора.\n\nАльтернативно (вручную):\n1. Добавьте бота в группу.\n2. Перешлите сюда сообщение оттуда ИЛИ введите ID группы.\n3. Чтобы отвязать группу, отправьте "0".`, { parse_mode: 'HTML', reply_markup: kb });
}
