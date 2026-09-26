const fs = require('fs');

let code = fs.readFileSync('worker/src/index.js', 'utf8');

const formatCryptoStr = `
const formatCrypto = (v) => { 
  const n = parseFloat(v); 
  if(isNaN(n) || n === 0) return v; 
  if(n < 1) return Number(n.toPrecision(4)).toString(); 
  if(n < 100) return Number(n.toPrecision(5)).toString(); 
  return Number(n.toFixed(2)).toString(); 
};`;

// Insert the formatCrypto function before it's used
code = code.replace(
  "const isMultiple = myMsgs.length > 1;",
  formatCryptoStr + "\n        const isMultiple = myMsgs.length > 1;"
);

// Fix Swap message format
code = code.replace(
  "formatted += `\\n🔄 <b>Свап / Мульти-транзакция</b>\\n`;",
  "formatted += `\\n🔄 <b>Swap</b>\\n`;"
);

// Fix multiple transfer format
code = code.replace(
  "formatted += `${isReceived ? '📥 Получено:' : '📤 Отправлено:'} ${msg.value} ${msg.asset}\\n`;",
  "formatted += `${isReceived ? '📥 Получено:' : '📤 Отправлено:'} ${formatCrypto(msg.value)} ${msg.asset}\\n`;"
);

// Fix single transfer format
code = code.replace(
  "formatted += `\\n${icon} ${isReceived ? 'Получено:' : 'Отправлено:'} ${msg.value} ${msg.asset} ${isReceived ? '📥 От:' : '📤 На:'} ${counterparty}\\n`;",
  "formatted += `\\n${icon} ${isReceived ? 'Получено:' : 'Отправлено:'} ${formatCrypto(msg.value)} ${msg.asset} ${isReceived ? '📥 От:' : '📤 На:'} ${counterparty}\\n`;"
);

fs.writeFileSync('worker/src/index.js', code);
