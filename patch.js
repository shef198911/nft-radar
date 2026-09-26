const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-bot.js', 'utf8');

code = code.replace(`import { t } from './i18n.js';`, `import { t } from './i18n.js';\nimport { getWalletBalance, updateWebhook } from './helius.js';`);

// Define sendSolanaHome
const sendSolanaHome = `
async function sendSolanaHome(env, chatId, user, messageId) {
  const { results } = await env.DB.prepare('SELECT id FROM solana_wallets WHERE chat_id = ?').bind(chatId).all();
  const count = results ? results.length : 0;
  const text = "🟣 <b>Solana Wallet Tracker</b>\\n\\nОтслеживается:\\n" + count + " кошелька(ов)\\n\\nАктивных уведомлений:\\n" + count;
  const kb = [
    [{ text: "👛 Мои кошельки", callback_data: "solana_list" }],
    [{ text: "➕ Добавить кошелёк", callback_data: "solana_add" }],
    [{ text: "🔔 Уведомления", callback_data: "solana_filters_main" }],
    [{ text: "◀️ Главное меню", callback_data: "home" }]
  ];
  await callTelegramApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}
`;

code = code.replace(`export async function handleTelegramWebhook(request, env) {`, sendSolanaHome + `\nexport async function handleTelegramWebhook(request, env) {`);

fs.writeFileSync('worker/src/telegram-bot.js', code);
