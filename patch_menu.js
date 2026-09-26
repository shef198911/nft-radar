const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const menuCmd = `
  bot.command('setadminmenu', async (ctx) => {
    if (ctx.from.id !== 332680373) return;
    
    try {
      // 1. Обычное меню для всех пользователей (только /start)
      await ctx.api.setMyCommands([
        { command: "start", description: "🏠 Главное меню" }
      ]);
      
      // 2. Расширенное меню только для вашего чата
      await ctx.api.setMyCommands([
        { command: "start", description: "🏠 Главное меню" },
        { command: "stats", description: "📊 Статистика (Admin)" },
        { command: "broadcast", description: "📣 Рассылка (Admin)" }
      ], { scope: { type: "chat", chat_id: 332680373 } });
      
      await ctx.reply("✅ Меню команд успешно обновлено!\\n\\nОбычные юзеры видят только /start. Вы видите админские команды.\\n\\n❗️ *Чтобы меню обновилось визуально в приложении, смахните Telegram (закройте и откройте заново).*");
    } catch (e) {
      await ctx.reply("Ошибка: " + e.message);
    }
  });

  bot.command('stats'`;

code = code.replace("bot.command('stats'", menuCmd);

fs.writeFileSync('worker/src/telegram-grammy.js', code);
