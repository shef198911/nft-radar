const fs = require('fs');
let code = fs.readFileSync('worker/src/index.js', 'utf8');
code = code.replace(
  'const messages = parseAlchemyWebhook(body);', 
  "const messages = parseAlchemyWebhook(body);\n    console.log('Webhook activity length:', body?.event?.activity?.length, 'Hash:', messages.length > 0 ? messages[0].hash : 'none');"
);
fs.writeFileSync('worker/src/index.js', code);
