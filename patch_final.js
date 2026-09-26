const fs = require('fs');

let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const startIdx = code.indexOf('const handleText = async (ctx) => {');
const endIdx = code.indexOf('  bot.on("message:text", async (ctx) => {');

const newHandleText = `  const handleText = async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id.toString();
    const state = ctx.user.state;
    const now = new Date().toISOString();

    if (state === 'WAITING_EVM_ADDRESS') {
      if (!/^0x[a-fA-F0-9]{40}$/i.test(text)) return await ctx.reply("❌ Некорректный адрес. Попробуйте еще раз.");
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

    if (state === 'WAITING_SOL_ADDRESS') {
      if (text.length < 32) return await ctx.reply("❌ Некорректный адрес. Попробуйте еще раз.");
      let bal = '?';
      try { bal = await getWalletBalance(text, ctx.env); } catch(e){}
      const kb = new InlineKeyboard().text("✅ Добавить", \`solana_confirm:\${text}\`).text("❌ Отмена", "solana_home");
      return await ctx.reply(\`🔎 <b>Кошелёк найден</b>\\n\\n◎ Solana\\n<code>\${text}</code>\\n\\nSOL:\\n\${bal} SOL\\n\\nДобавить этот кошелёк в мониторинг?\`, { parse_mode: 'HTML', reply_markup: kb });
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
        const collectionRes = await fetchOpenSeaJson(\`/collections/\${slug}\`, apiKey);
        if (!collectionRes.collection) throw new Error("Not found");
        const name = collectionRes.collection.name;
        const statsRes = await fetchOpenSeaJson(\`/collections/\${slug}/stats\`, apiKey);
        const floor = statsRes.total.floor_price;
        await setState(ctx, 'IDLE', { slug, name, floor });
        const kb = new InlineKeyboard().text(t(ctx.lang, 'btn_create_alert'), \`setup_alert:\${slug}\`).row().text(t(ctx.lang, 'btn_cancel'), "nft_home");
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
          await ctx.env.DB.prepare(\`INSERT INTO price_alerts (chat_id, collection_slug, collection_name, baseline_price, threshold_percent, threshold_type, threshold_abs, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)\`).bind(chatId, data.slug, data.name, data.floor, percentVal, type, absVal, now, now).run();
          await setState(ctx, 'IDLE');
          const bounds = calculateBounds(data.floor, { threshold_type: type, threshold_abs: absVal, threshold_percent: percentVal });
          const kb = new InlineKeyboard().text(t(ctx.lang, 'btn_my_collections'), "my_colls").text(t(ctx.lang, 'btn_home'), "nft_home");
          return await ctx.reply(t(ctx.lang, 'alert_created', { name: data.name, floor: data.floor, threshold: isPercent?\`\${val}%\`:\`\${val} ETH\`, upper: bounds.upper, lower: bounds.lower }), { parse_mode: 'HTML', reply_markup: kb });
        } catch (e) { await setState(ctx, 'IDLE'); return await sendHomeMenu(ctx); }
      } else {
        await ctx.env.DB.prepare(\`UPDATE price_alerts SET threshold_type = ?, threshold_abs = ?, threshold_percent = ?, updated_at = ? WHERE id = ? AND chat_id = ?\`).bind(type, absVal, percentVal, now, data.edit_id, chatId).run();
        await setState(ctx, 'IDLE');
        const bounds = calculateBounds(data.floor, { threshold_type: type, threshold_abs: absVal, threshold_percent: percentVal });
        const kb = new InlineKeyboard().text("👀 К алерту", \`view_coll:\${data.edit_id}\`).text(t(ctx.lang, 'btn_home'), "nft_home");
        return await ctx.reply(t(ctx.lang, 'alert_changed', { name: data.name, floor: data.floor, threshold: isPercent?\`\${val}%\`:\`\${val} ETH\`, upper: bounds.upper, lower: bounds.lower }), { parse_mode: 'HTML', reply_markup: kb });
      }
    }
  };

`;

code = code.substring(0, startIdx) + newHandleText + code.substring(endIdx);
fs.writeFileSync('worker/src/telegram-grammy.js', code);
