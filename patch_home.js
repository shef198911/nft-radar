const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const start = code.indexOf('const sendHomeMenu =');
const end = code.indexOf('bot.command(["start"');

const newHomeMenu = `const sendHomeMenu = async (ctx) => {
    if (!ctx.user.language) return await sendLangMenu(ctx);
    
    const isRu = ctx.lang === 'ru';
    
    const kb = new InlineKeyboard()
      .text(isRu ? "🖼 NFT Tracker" : "🖼 NFT Tracker", "nft_home").text(isRu ? "👛 Wallet Tracker" : "👛 Wallet Tracker", "wallet_home").row()
      .text(isRu ? "⚙️ Настройки" : "⚙️ Settings", "settings").text(isRu ? "📖 Как это работает" : "📖 How it works", "how_it_works");
    
    const bannerUrl = 'https://files.catbox.moe/5pou02.jpg';
    
    const text = (isRu ? 
      "Салют! 🤙\\nЯ бот, который следит за кошельками вместо тебя.\\n\\nПросто добавь адреса, за которыми хочешь наблюдать, и я сразу пришлю уведомление, как только там произойдет любое движение средств.\\n\\nВыбирай нужный трекер в меню ниже и погнали!" :
      "Cheers! 🤙\\nI am a bot that monitors crypto wallets for you.\\n\\nJust add the addresses you want to track, and I will instantly send a notification as soon as any funds move.\\n\\nChoose a tracker in the menu below and let's go!") + \`<a href="\${bannerUrl}">&#8205;</a>\`;

    const opts = { 
      parse_mode: 'HTML', 
      reply_markup: kb,
      link_preview_options: { url: bannerUrl, show_above_text: true, is_disabled: false }
    };

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, opts).catch(e => console.log(e));
    } else {
      await ctx.reply(text, opts);
    }
  };

  `;

code = code.substring(0, start) + newHomeMenu + code.substring(end);

fs.writeFileSync('worker/src/telegram-grammy.js', code);
