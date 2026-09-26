const fs = require('fs');

let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

// Replace the placeholder evm_home
code = code.replace(
  'bot.callbackQuery("evm_home", async (ctx) => { await ctx.answerCallbackQuery({ text: "В разработке / Soon", show_alert: true }); });',
  `
  bot.callbackQuery("evm_home", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT id FROM evm_wallets WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    const count = results ? results.length : 0;
    const text = \`⟠ <b>EVM Wallet Tracker</b>\\n\\nОтслеживается:\\n\${count} кошелька(ов)\\n\\nАктивных уведомлений:\\n\${count}\\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ\`;
    const kb = new InlineKeyboard().text("👛 Мои кошельки", "evm_list").row().text("➕ Добавить кошелёк", "evm_add").row().text("◀️ Wallet Tracker", "wallet_home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("evm_add", async (ctx) => {
    await setState(ctx, 'WAITING_EVM_ADDRESS');
    await ctx.editMessageText("➕ <b>Добавление EVM-кошелька</b>\\n\\nОтправьте Ethereum/BSC/Polygon адрес.\\n\\nНапример:\\n<code>0xd8dA6...D37aA</code>", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("❌ Отмена", "evm_home") });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_confirm:(.+)/, async (ctx) => {
    await setState(ctx, 'WAITING_EVM_NAME', { addr: ctx.match[1] });
    await ctx.editMessageText("🏷 <b>Название кошелька</b>\\n\\nВведите название.\\nНапример:\\nSmart Money", { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("⏭ Пропустить", \`evm_save_noname:\${ctx.match[1]}\`) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_save_noname:(.+)/, async (ctx) => {
    const addr = ctx.match[1];
    const name = \`\${addr.slice(0, 4)}...\${addr.slice(-4)}\`;
    const { meta } = await ctx.env.DB.prepare('INSERT INTO evm_wallets (chat_id, address, name, created_at) VALUES (?, ?, ?, ?)').bind(ctx.chat.id.toString(), addr, name, new Date().toISOString()).run();
    await ctx.env.DB.prepare('INSERT INTO evm_filters (wallet_id) VALUES (?)').bind(meta.last_row_id).run();
    
    // Process alchemy webhook
    const { initAlchemyWebhooks, updateAlchemyAddresses } = await import('./alchemy.js');
    await initAlchemyWebhooks(ctx.env);
    ctx.waitUntil(updateAlchemyAddresses(ctx.env, [addr]));

    await setState(ctx, 'IDLE');
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: \`evm_home\` } });
  });

  bot.callbackQuery("evm_list", async (ctx) => {
    const { results } = await ctx.env.DB.prepare('SELECT * FROM evm_wallets WHERE chat_id = ?').bind(ctx.chat.id.toString()).all();
    let text = \`⟠ <b>EVM Wallets</b>\\n\\nОтслеживается:\\n\${results ? results.length : 0} кошелька(ов)\\n\\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ\`;
    const kb = new InlineKeyboard();
    if (results) results.forEach(w => kb.text(\`🟢 \${w.name}\`, \`view_evm:\${w.id}\`).row());
    kb.text("➕ Добавить кошелёк", "evm_add").row().text("◀️ EVM", "evm_home");
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^view_evm:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const w = await ctx.env.DB.prepare('SELECT * FROM evm_wallets WHERE id = ? AND chat_id = ?').bind(id, ctx.chat.id.toString()).first();
    if (!w) return await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("🔔 События", \`evm_filters:\${id}\`).row().url("🔗 Открыть кошелёк", \`https://etherscan.io/address/\${w.address}\`).row().text("🗑 Удалить", \`evm_del:\${id}\`).row().text("◀️ EVM Wallets", "evm_list");
    await ctx.editMessageText(\`⟠ EVM\\n\\n👛 <b>\${w.name}</b>\\n<code>\${w.address}</code>\`, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_del:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.env.DB.prepare('DELETE FROM evm_filters WHERE wallet_id = ?').bind(id).run();
    await ctx.env.DB.prepare('DELETE FROM evm_wallets WHERE id = ?').bind(id).run();
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: \`evm_home\` } });
  });

  bot.callbackQuery(/^evm_filters:(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const filters = await ctx.env.DB.prepare('SELECT * FROM evm_filters WHERE wallet_id = ?').bind(id).first();
    if (!filters) return await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(\`SWAP/Trade \${filters.notify_swap ? '🟢 ON' : '🔴 OFF'}\`, \`evm_t_f:\${id}:swap\`).row()
      .text(\`Transfers \${filters.notify_transfer ? '🟢 ON' : '🔴 OFF'}\`, \`evm_t_f:\${id}:transfer\`).row()
      .text(\`NFT \${filters.notify_nft ? '🟢 ON' : '🔴 OFF'}\`, \`evm_t_f:\${id}:nft\`).row()
      .text("◀️ Кошелёк", \`view_evm:\${id}\`);
    await ctx.editMessageText("🔔 <b>События</b>\\n\\nВыберите уведомления:", { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^evm_t_f:(.+):(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const field = ctx.match[2];
    await ctx.env.DB.prepare(\`UPDATE evm_filters SET notify_\${field} = CASE WHEN notify_\${field} = 1 THEN 0 ELSE 1 END WHERE wallet_id = ?\`).bind(id).run();
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: \`evm_filters:\${id}\` } });
  });
  `
);

// Add WAITING_EVM text handlers
const txtHandlerAddition = `
    if (state === 'WAITING_EVM_ADDRESS') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return await ctx.reply("❌ Некорректный адрес. Попробуйте еще раз.");
      const kb = new InlineKeyboard().text("✅ Добавить", \`evm_confirm:\${text}\`).text("❌ Отмена", "evm_home");
      return await ctx.reply(\`🔎 <b>Кошелёк корректен</b>\\n\\n⟠ EVM\\n<code>\${text}</code>\\n\\nДобавить этот кошелёк в мониторинг?\`, { parse_mode: 'HTML', reply_markup: kb });
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
`;

code = code.replace('const handleText = async (ctx) => {', 'const handleText = async (ctx) => {\n' + txtHandlerAddition);

fs.writeFileSync('worker/src/telegram-grammy.js', code);
