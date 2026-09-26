const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const badCodeRegex = /const handleText = async \(ctx\) => \{\n[\s\S]*?if \(state === 'WAITING_EVM_NAME'\) \{[\s\S]*?return await ctx\.reply\("✅ <b>Кошелёк добавлен!<\/b>", \{ parse_mode: 'HTML', reply_markup: new InlineKeyboard\(\)\.text\("⟠ Открыть EVM Tracker", "evm_home"\) \}\);\n    \}\n/m;

code = code.replace(badCodeRegex, 'const handleText = async (ctx) => {\n');

const correctAddition = `const now = new Date().toISOString();
    
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
`;

code = code.replace('const now = new Date().toISOString();', correctAddition);

fs.writeFileSync('worker/src/telegram-grammy.js', code);
