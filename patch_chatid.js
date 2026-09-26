const fs = require('fs');

let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const injection = `
  bot.command("chatid", async (ctx) => {
    return await ctx.reply(\`ID этой группы: <code>\${ctx.chat.id}</code>\`, { parse_mode: 'HTML' });
  });
`;

if (!code.includes('bot.command("chatid"')) {
   const pos = code.indexOf('bot.command(["start", "home", "cancel"]');
   code = code.substring(0, pos) + injection + code.substring(pos);
   fs.writeFileSync('worker/src/telegram-grammy.js', code);
}
