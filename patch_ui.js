const fs = require('fs');

function patch(path) {
  let content = fs.readFileSync(path, 'utf8');

  // Replace circles with text icons and pad the text width
  content = content.replace(
    'const text = `👛 <b>Wallet Tracker</b>\\n\\nВыберите блокчейн:`;',
    'const text = `👛 <b>Wallet Tracker</b>\\n\\nВыберите блокчейн:\\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;' // Using Hangul filler U+3164
  );

  content = content.replace(
    '[{ text: "🟣 Solana", callback_data: "solana_home" }, { text: "🔷 EVM", callback_data: "evm_home" }],',
    '[{ text: "◎ Solana", callback_data: "solana_home" }, { text: "⟠ EVM", callback_data: "evm_home" }],'
  );

  fs.writeFileSync(path, content);
}

patch('worker/src/telegram-bot.js');

function patchSol(path) {
  let content = fs.readFileSync(path, 'utf8');
  // Pad solana home
  content = content.replace(
    'const text = `🟣 <b>Solana Wallet Tracker</b>\\n\\nОтслеживается:\\n${count} кошелька(ов)\\n\\nАктивных уведомлений:\\n${count}`;',
    'const text = `◎ <b>Solana Wallet Tracker</b>\\n\\nОтслеживается:\\n${count} кошелька(ов)\\n\\nАктивных уведомлений:\\n${count}\\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;'
  );
  // Pad solana list
  content = content.replace(
    'let text = `🟣 <b>Solana Wallets</b>\\n\\nОтслеживается:\\n${results ? results.length : 0} кошелька(ов)\\n`;',
    'let text = `◎ <b>Solana Wallets</b>\\n\\nОтслеживается:\\n${results ? results.length : 0} кошелька(ов)\\n\\nㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ`;'
  );
  content = content.replace(/🟣/g, '◎');
  fs.writeFileSync(path, content);
}
patchSol('worker/src/telegram-solana.js');
