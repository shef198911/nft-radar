import os

path = 'worker/src/telegram-bot.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
content = content.replace("import { t } from './i18n.js';", "import { t } from './i18n.js';\nimport { handleSolanaCallback, handleSolanaText } from './telegram-solana.js';")

# 2. Main menu 
old_menu = """
  const text = t(lang, 'main_menu', { tracked, active, time: lastCheck });
  const reply_markup = {
    inline_keyboard: [
      [{ text: t(lang, 'btn_add_collection'), callback_data: "track_add" }],
      [{ text: t(lang, 'btn_my_collections'), callback_data: "my_colls" }],
      [{ text: t(lang, 'btn_active_alerts'), callback_data: "active_alerts" }],
      [{ text: t(lang, 'btn_settings'), callback_data: "settings" }],
      [{ text: t(lang, 'btn_how_it_works'), callback_data: "how_it_works" }]
    ]
  };
"""

new_menu = """
  const { results: solRes } = await env.DB.prepare('SELECT id FROM solana_wallets WHERE chat_id = ?').bind(chatId).all();
  const solTracked = solRes ? solRes.length : 0;

  const text = `🤖 <b>Crypto Tracker</b>\\n\\nNFT-коллекции: ${tracked}\\nSolana-кошельки: ${solTracked}\\n\\nАктивных NFT-алертов: ${active}\\n\\n────────────────\\n\\n🖼 <b>NFT</b>`;
  const reply_markup = {
    inline_keyboard: [
      [{ text: "📊 NFT коллекции", callback_data: "my_colls" }, { text: "➕ Добавить NFT", callback_data: "track_add" }],
      [{ text: "────────────────", callback_data: "none" }],
      [{ text: "👛 Wallet Tracker", callback_data: "none" }],
      [{ text: "🟣 Solana", callback_data: "solana_home" }, { text: "⟨ EVM — SOON ⟩", callback_data: "none" }],
      [{ text: "────────────────", callback_data: "none" }],
      [{ text: "⚙️ Настройки", callback_data: "settings" }, { text: "📖 Как это работает", callback_data: "how_it_works" }]
    ]
  };
"""
content = content.replace(old_menu.strip(), new_menu.strip())

# 3. Callback hook
hook1 = """
    const lang = user.language || 'ru';

    const handled = await handleSolanaCallback(data, chatId, messageId, env, update);
    if (handled) return new Response('OK');
    if (!handled && (data === 'solana_home' || data.startsWith('sol_del:') || data.startsWith('sol_t_f:'))) {
        return handleTelegramWebhook({ method: 'POST', json: () => Promise.resolve(update) }, env);
    }
"""
content = content.replace("    const lang = user.language || 'ru';", hook1.strip())

# 4. Text hook
hook2 = """
  const lang = user.language || 'ru';

  const handledText = await handleSolanaText(text, chatId, user, env);
  if (handledText) return new Response('OK');
"""
content = content.replace("  const lang = user.language || 'ru';", hook2.strip())

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
