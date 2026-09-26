const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const statsCmd = `
  bot.command('stats', async (ctx) => {
    // Only allow your Telegram ID
    if (ctx.from.id !== 332680373) return;
    
    try {
      const users = await ctx.env.DB.prepare('SELECT COUNT(*) as count FROM telegram_users').first();
      const sol = await ctx.env.DB.prepare('SELECT COUNT(*) as count FROM solana_wallets').first();
      const evm = await ctx.env.DB.prepare('SELECT COUNT(*) as count FROM evm_wallets').first();
      const alerts = await ctx.env.DB.prepare('SELECT COUNT(*) as count FROM price_alerts WHERE is_active = 1').first();
      
      const text = '📊 <b>Статистика бота</b>\\n\\n' +
        '👤 Пользователей: <b>' + users.count + '</b>\\n' +
        '◎ Solana кошельков: <b>' + sol.count + '</b>\\n' +
        '⟠ EVM кошельков: <b>' + evm.count + '</b>\\n' +
        '🖼 NFT алертов: <b>' + alerts.count + '</b>';
        
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply('Ошибка: ' + e.message);
    }
  });

  bot.command(["start", "home", "cancel"]`;

code = code.replace('bot.command(["start", "home", "cancel"]', statsCmd);

fs.writeFileSync('worker/src/telegram-grammy.js', code);
