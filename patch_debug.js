const fs = require('fs');
let code = fs.readFileSync('worker/src/index.js', 'utf8');

const debugRoute = `
router.get('/debug', (req, env) => {
  return new Response(JSON.stringify({
    hasToken: !!env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    targets: env.TELEGRAM_TARGETS_PRIVATE,
    targetsOld: env.TELEGRAM_TARGETS
  }));
});

router.all('*', () => new Response('Not Found', { status: 404 }));`;

code = code.replace("router.all('*', () => new Response('Not Found', { status: 404 }));", debugRoute);
fs.writeFileSync('worker/src/index.js', code);
