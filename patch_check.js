const fs = require('fs');

let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const s = code.indexOf('bot.callbackQuery("home"');
if (s > -1) {
    console.log("home callback: " + code.substring(s, s + 150));
}
