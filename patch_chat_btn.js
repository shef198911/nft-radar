const fs = require('fs');

let code = fs.readFileSync('worker/src/profiles.js', 'utf8');

const oldFunc = `export async function handleCoinChat(ctx, collectionId) {
  await setState(ctx, 'WAITING_COIN_CHAT', JSON.stringify({ collectionId }));
  return await ctx.reply(\`🔗 <b>Привязка Telegram группы</b>\\n\\n1. Добавьте этого бота в вашу группу и дайте ему права администратора.\\n2. Перешлите сюда любое сообщение из этой группы ИЛИ введите ID группы вручную.\\n3. Чтобы отвязать группу, отправьте "0" (ноль).\\n\\nЖду сообщение...\`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text("❌ Отмена", "coin_home") });
}`;

const newFunc = `export async function handleCoinChat(ctx, collectionId) {
  await setState(ctx, 'WAITING_COIN_CHAT', JSON.stringify({ collectionId }));
  
  const botInfo = await ctx.api.getMe();
  const botUsername = botInfo.username;
  const link = \`https://t.me/\${botUsername}?startgroup=col_\${collectionId}&admin=post_messages+edit_messages+delete_messages\`;
  
  const kb = new InlineKeyboard()
    .url("➕ Добавить бота в чат", link).row()
    .text("❌ Отмена", "coin_home");

  return await ctx.reply(\`🔗 <b>Привязка Telegram группы</b>\\n\\nВы можете нажать кнопку ниже, чтобы автоматически добавить бота в вашу группу с правами администратора.\\n\\nАльтернативно (вручную):\\n1. Добавьте бота в группу.\\n2. Перешлите сюда сообщение оттуда ИЛИ введите ID группы.\\n3. Чтобы отвязать группу, отправьте "0".\`, { parse_mode: 'HTML', reply_markup: kb });
}`;

code = code.replace(oldFunc, newFunc);
fs.writeFileSync('worker/src/profiles.js', code);
