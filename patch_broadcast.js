const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const broadcastCmd = `
  bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== 332680373) return;
    await setState(ctx, 'WAITING_BROADCAST');
    return await ctx.reply("📣 <b>Режим рассылки</b>\\n\\nОтправьте мне сообщение (текст, фото, видео), которое нужно разослать ВСЕМ пользователям.\\n\\nДля отмены нажмите /cancel", { parse_mode: 'HTML' });
  });

  bot.command('stats'`;

code = code.replace("bot.command('stats'", broadcastCmd);

const messageHandlerOld = `  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    await handleText(ctx);
  });`;

const messageHandlerNew = `  bot.on("message", async (ctx) => {
    if (ctx.message.text && ctx.message.text.startsWith('/')) return;
    
    if (ctx.user.state === 'WAITING_BROADCAST' && ctx.from.id === 332680373) {
      await setState(ctx, 'IDLE');
      const startMsg = await ctx.reply("⏳ Начинаю рассылку... Пожалуйста, подождите.");
      
      const { results } = await ctx.env.DB.prepare('SELECT chat_id FROM telegram_users').all();
      let sent = 0;
      let failed = 0;
      
      // Batch processing to not hit Telegram limits (30 msg/sec)
      for (let i = 0; i < results.length; i += 20) {
         const batch = results.slice(i, i + 20);
         await Promise.all(batch.map(async (user) => {
            try {
               await ctx.api.copyMessage(user.chat_id, ctx.chat.id, ctx.message.message_id);
               sent++;
            } catch (e) {
               failed++;
            }
         }));
         await new Promise(r => setTimeout(r, 1000));
      }
      
      return await ctx.api.editMessageText(ctx.chat.id, startMsg.message_id, \`✅ Рассылка завершена!\\n\\nУспешно доставлено: \${sent}\\nНе доставлено (заблокировали): \${failed}\`);
    }
    
    if (ctx.message.text) {
      await handleText(ctx);
    }
  });`;

code = code.replace(messageHandlerOld, messageHandlerNew);

fs.writeFileSync('worker/src/telegram-grammy.js', code);
