const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

// The newHomeMenu string we just inserted has `opts`. We don't want to replace that one.
// We want to replace `{ parse_mode: 'HTML', reply_markup: kb }` with `{ parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } }`
// but ONLY if it's not already using link_preview_options.

code = code.replace(/\{ parse_mode: 'HTML', reply_markup: kb \}/g, "{ parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } }");

fs.writeFileSync('worker/src/telegram-grammy.js', code);
