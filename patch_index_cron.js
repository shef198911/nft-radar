const fs = require('fs');
let code = fs.readFileSync('worker/src/index.js', 'utf8');

code = code.replace("checkPriceAlerts } from './telegram-grammy.js';", "checkPriceAlerts, checkCoinAlerts } from './telegram-grammy.js';");
code = code.split("checkPriceAlerts(env)").join("checkPriceAlerts(env),\n        checkCoinAlerts(env)");

fs.writeFileSync('worker/src/index.js', code);
