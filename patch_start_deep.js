const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const oldStart = 'bot.command(["start", "home", "cancel"], async (ctx) => { await setState(ctx, "IDLE"); await sendHomeMenu(ctx); });';

const newStart = `bot.command(["start", "home", "cancel"], async (ctx) => {
  const payload = ctx.match; // Grammy automatically parses payload from /start <payload>
  
  if (payload && payload.startsWith('col_')) {
     const colId = payload.replace('col_', '');
     const chatId = ctx.chat.id.toString();
     const userId = ctx.from.id.toString();
     
     // Verify ownership
     const col = await ctx.env.DB.prepare(\`
       SELECT c.id FROM coin_collections c 
       JOIN profiles p ON c.profile_id = p.id 
       WHERE c.id = ? AND p.chat_id = ?
     \`).bind(colId, userId).first();
     
     if (col) {
        await ctx.env.DB.prepare('UPDATE coin_collections SET target_chat_id = ? WHERE id = ?').bind(chatId, colId).run();
        return await ctx.reply(\`✅ Бот успешно добавлен! Коллекция токенов привязана к этому чату (ID: <code>\${chatId}</code>).\`, { parse_mode: 'HTML' });
     } else {
        return await ctx.reply('❌ Ошибка привязки: Вы не являетесь владельцем этой коллекции.');
     }
  }

  // Fallback to normal start
  if (ctx.chat.type === 'private') {
    await setState(ctx, "IDLE"); 
    await sendHomeMenu(ctx); 
  }
});`;

code = code.replace(oldStart, newStart);
fs.writeFileSync('worker/src/telegram-grammy.js', code);
