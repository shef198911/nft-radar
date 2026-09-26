const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const newImports = `
import { searchDexScreener, getDexScreenerTokensByAddress } from './dexscreener.js';
import { 
  setState, handleProfilesHome, handleWalletHub, handleCoinHome, 
  handleCoinAdd, processCoinQuery, handleCoinSelect, saveCoinTracker, 
  handleCoinEdit, handleCoinChat 
} from './profiles.js';
`;

code = code.replace("import { initAlchemyWebhooks, updateAlchemyAddresses } from './alchemy.js';", "import { initAlchemyWebhooks, updateAlchemyAddresses } from './alchemy.js';\n" + newImports);

// Replace /start and /home commands
const startCommandRegex = /bot\.command\(\["start", "home", "cancel"\], async \(ctx\) => \{[\s\S]*?\}\);/;
const newStartCommand = `bot.command(["start", "home", "cancel"], async (ctx) => {
  const kb = new InlineKeyboard()
    .text("👤 Мои профили", "profiles_home").row()
    .text("⚙️ Настройки", "settings").text("ℹ️ Как это работает", "how_it_works");
  return await ctx.reply("🏠 <b>Главное меню</b>", { parse_mode: 'HTML', reply_markup: kb });
});`;

if (code.match(startCommandRegex)) {
  code = code.replace(startCommandRegex, newStartCommand);
} else {
  console.log("Could not find start command regex!");
}

// Replace the handleText function to inject new state handlers
const handleTextStart = code.indexOf('const handleText = async (ctx) => {');
if (handleTextStart > -1) {
  const injectionPoint = code.indexOf('if (state === \'WAITING_EVM_ADDRESS\') {', handleTextStart);
  if (injectionPoint > -1) {
    const newStates = `
    if (state === 'WAITING_PROFILE_NAME') {
      const now = new Date().toISOString();
      await ctx.env.DB.prepare('INSERT INTO profiles (chat_id, name, created_at) VALUES (?, ?, ?)').bind(chatId, text, now).run();
      await setState(ctx, 'IDLE');
      return await handleProfilesHome(ctx);
    }
    
    if (state === 'WAITING_COIN_COLLECTION_NAME') {
      const data = JSON.parse(ctx.user.state_data);
      const now = new Date().toISOString();
      await ctx.env.DB.prepare('INSERT INTO coin_collections (profile_id, name, created_at) VALUES (?, ?, ?)').bind(data.profileId, text, now).run();
      await setState(ctx, 'IDLE');
      return await handleCoinHome(ctx);
    }

    if (state === 'WAITING_COIN_QUERY') {
      return await processCoinQuery(ctx, text);
    }

    if (state === 'WAITING_COIN_PERCENT') {
      return await saveCoinTracker(ctx, text);
    }

    if (state === 'WAITING_COIN_CHAT') {
      const data = JSON.parse(ctx.user.state_data);
      let targetChatId = text;
      
      if (text === '0') {
         targetChatId = null;
         await ctx.reply("✅ Привязка к группе удалена.");
      } else if (ctx.message.forward_from_chat) {
         targetChatId = ctx.message.forward_from_chat.id.toString();
      } else if (!text.startsWith('-')) {
         return await ctx.reply("❌ Некорректный ID группы. Должен начинаться с минуса (например, -100123456789). Перешлите сообщение из группы или введите корректный ID.");
      }
      
      await ctx.env.DB.prepare('UPDATE coin_collections SET target_chat_id = ? WHERE id = ?').bind(targetChatId, data.collectionId).run();
      await setState(ctx, 'IDLE');
      if (targetChatId) await ctx.reply(\`✅ Коллекция успешно привязана к чату <code>\${targetChatId}</code>\`, { parse_mode: 'HTML' });
      return await handleCoinHome(ctx);
    }
    `;
    code = code.substring(0, injectionPoint) + newStates + code.substring(injectionPoint);
  }
}

// Add callbacks for the new UI
const callbacks = `
  bot.callbackQuery("profiles_home", async (ctx) => { await handleProfilesHome(ctx); await ctx.answerCallbackQuery(); });
  bot.callbackQuery("wallet_hub", async (ctx) => { await handleWalletHub(ctx); await ctx.answerCallbackQuery(); });
  bot.callbackQuery("coin_home", async (ctx) => { await handleCoinHome(ctx); await ctx.answerCallbackQuery(); });
  
  bot.callbackQuery(/^coin_add:(.+)/, async (ctx) => { 
    await handleCoinAdd(ctx, ctx.match[1]); 
    await ctx.answerCallbackQuery(); 
  });
  
  bot.callbackQuery(/^coin_sel:(.+):(.+)/, async (ctx) => { 
    await handleCoinSelect(ctx, ctx.match[1], ctx.match[2]); 
    await ctx.answerCallbackQuery(); 
  });
  
  bot.callbackQuery(/^coin_pct:(.+)/, async (ctx) => { 
    await saveCoinTracker(ctx, ctx.match[1]); 
    await ctx.answerCallbackQuery(); 
  });
  
  bot.callbackQuery("coin_pct_manual", async (ctx) => { 
    await ctx.reply("✍️ Введите желаемый процент изменения (например, 15.5):");
    await ctx.answerCallbackQuery(); 
  });
  
  bot.callbackQuery(/^coin_edit:(.+)/, async (ctx) => { 
    await handleCoinEdit(ctx, ctx.match[1]); 
    await ctx.answerCallbackQuery(); 
  });
  
  bot.callbackQuery(/^coin_del:(.+)/, async (ctx) => { 
    await ctx.env.DB.prepare('DELETE FROM coin_trackers WHERE id = ?').bind(ctx.match[1]).run();
    await ctx.reply("🗑 Токен удален.");
    await handleCoinHome(ctx);
    await ctx.answerCallbackQuery(); 
  });
  
  bot.callbackQuery(/^coin_edit_pct:(.+)/, async (ctx) => { 
    // Just delete and ask to re-add for simplicity in edit, or add a specific state. Let's do simple state.
    const t = await ctx.env.DB.prepare('SELECT * FROM coin_trackers WHERE id = ?').bind(ctx.match[1]).first();
    if (t) {
       await setState(ctx, 'WAITING_COIN_PERCENT', JSON.stringify({ collectionId: t.collection_id, contract: t.contract_address, network: t.network, ticker: t.ticker, price: t.baseline_price }));
       await ctx.env.DB.prepare('DELETE FROM coin_trackers WHERE id = ?').bind(ctx.match[1]).run(); // delete old
       await ctx.reply(\`🪙 <b>\${t.ticker}</b>\\nВведите новый процент для триггера (старый был \${t.trigger_percent}%):\`, { parse_mode: 'HTML' });
    }
    await ctx.answerCallbackQuery(); 
  });
  
  bot.callbackQuery(/^coin_chat:(.+)/, async (ctx) => { 
    await handleCoinChat(ctx, ctx.match[1]); 
    await ctx.answerCallbackQuery(); 
  });
`;

code = code.replace('bot.callbackQuery("home", async (ctx) => {', callbacks + '\n  bot.callbackQuery("home", async (ctx) => {');

fs.writeFileSync('worker/src/telegram-grammy.js', code);
