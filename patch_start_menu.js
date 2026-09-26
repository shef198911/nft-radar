const fs = require('fs');

let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

// Replace sendHomeMenu logic
const oldSendHomeMenuRegex = /const sendHomeMenu = async \(ctx\) => \{[\s\S]*?\}\s*;\s*\}\s*;\s*\n\s*\n/;
const newSendHomeMenu = `const sendHomeMenu = async (ctx) => {
    if (!ctx.user.language) return await sendLangMenu(ctx);
    
    const isRu = ctx.lang === 'ru';
    
    const kb = new InlineKeyboard()
      .text(isRu ? "👤 Мои профили" : "👤 My Profiles", "profiles_home").row()
      .text(isRu ? "⚙️ Настройки" : "⚙️ Settings", "settings").text(isRu ? "📖 Как это работает" : "📖 How it works", "how_it_works");
    
    const bannerUrl = 'https://files.catbox.moe/nq6nwb.jpg';
    
    const text = (isRu ? 
      "Салют! 🤙\\nЯ мультитул-бот, который следит за рынком вместо тебя.\\n\\nЯ умею отслеживать любые изменения на криптокошельках, движение цен на NFT коллекции, а также взлеты и падения цены любых смарт-контрактов (Coin Tracker).\\n\\nВыбирай свой профиль в меню ниже и погнали!" :
      "Cheers! 🤙\\nI am a multitool bot that monitors the market for you.\\n\\nI can track any changes on crypto wallets, price movements on NFT collections, and price surges/drops of any smart contracts (Coin Tracker).\\n\\nChoose your profile in the menu below and let's go!") + \`<a href="\${bannerUrl}">&#8205;</a>\`;

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

if (code.match(oldSendHomeMenuRegex)) {
   code = code.replace(oldSendHomeMenuRegex, newSendHomeMenu);
} else {
   console.log("Regex for sendHomeMenu didn't match perfectly, doing manual replace.");
   const s1 = code.indexOf('const sendHomeMenu = async (ctx) => {');
   const s2 = code.indexOf('};', code.indexOf('await ctx.reply(text, opts);')) + 2;
   code = code.substring(0, s1) + newSendHomeMenu + code.substring(s2);
}

// Restore /start to use sendHomeMenu and remove the broken override
const badStartOverride = /bot\.command\(\["start", "home", "cancel"\], async \(ctx\) => \{[\s\S]*?\}\);/;
code = code.replace(badStartOverride, 'bot.command(["start", "home", "cancel"], async (ctx) => { await setState(ctx, "IDLE"); await sendHomeMenu(ctx); });');

fs.writeFileSync('worker/src/telegram-grammy.js', code);
