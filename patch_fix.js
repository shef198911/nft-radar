const fs = require('fs');
let code = fs.readFileSync('worker/src/telegram-grammy.js', 'utf8');

const injectionRegex = /const handleText = async \(ctx\) => \{\n\n    if \(state === 'WAITING_EVM_ADDRESS'\)/;
code = code.replace(injectionRegex, `const handleText = async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id.toString();
    const state = ctx.user.state;
    const now = new Date().toISOString();

    if (state === 'WAITING_EVM_ADDRESS')`);

const oldVarsRegex = /const text = ctx\.message\.text\.trim\(\);\n      const chatId = ctx\.chat\.id\.toString\(\);\n      const state = ctx\.user\.state;\n      const now = new Date\(\)\.toISOString\(\);\n/m;

code = code.replace(oldVarsRegex, '');

fs.writeFileSync('worker/src/telegram-grammy.js', code);
