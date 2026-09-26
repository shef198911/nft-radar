const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');
const start = code.indexOf('const sendHomeMenu =');
const end = code.indexOf('bot.command(["start"');
console.log(code.substring(start, end));
