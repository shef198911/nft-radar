const fs = require('fs');
let code = fs.readFileSync('worker/src/helius.js', 'utf8');

const formatCryptoStr = `
const formatCrypto = (v) => { 
  const n = parseFloat(v); 
  if(isNaN(n) || n === 0) return v; 
  if(n < 1) return Number(n.toPrecision(4)).toString(); 
  if(n < 100) return Number(n.toPrecision(5)).toString(); 
  return Number(n.toFixed(2)).toString(); 
};
const getTokenLink = (mint) => \`<a href="https://solscan.io/token/\${mint}">\${mint.slice(0,4)}..</a>\`;
`;

// Insert after shorten function
code = code.replace(
  "const shorten = (addr) => addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : 'Unknown';",
  "const shorten = (addr) => addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : 'Unknown';\n" + formatCryptoStr
);

// Fix SWAP output
code = code.replace(
  "for (const t of solSent) outStrs.push(`🔴 ${(t.amount / 1e9).toFixed(4)} SOL`);",
  "for (const t of solSent) outStrs.push(`🔴 ${formatCrypto(t.amount / 1e9)} SOL`);"
);
code = code.replace(
  "for (const t of userSent) outStrs.push(`🔴 ${t.tokenAmount} ${t.mint.slice(0,4)}`); // Ideally fetch symbol",
  "for (const t of userSent) outStrs.push(`🔴 ${formatCrypto(t.tokenAmount)} ${getTokenLink(t.mint)}`);"
);
code = code.replace(
  "for (const t of solRecv) inStrs.push(`🟢 ${(t.amount / 1e9).toFixed(4)} SOL`);",
  "for (const t of solRecv) inStrs.push(`🟢 ${formatCrypto(t.amount / 1e9)} SOL`);"
);
code = code.replace(
  "for (const t of userRecv) inStrs.push(`🟢 ${t.tokenAmount} ${t.mint.slice(0,4)}`);",
  "for (const t of userRecv) inStrs.push(`🟢 ${formatCrypto(t.tokenAmount)} ${getTokenLink(t.mint)}`);"
);

// Fix TRANSFER output
code = code.replace(
  "isSol = true; isReceived = true; amountStr = `◎ ${(nativeIn.amount / 1e9).toFixed(4)} SOL`; party = nativeIn.fromUserAccount;",
  "isSol = true; isReceived = true; amountStr = `◎ ${formatCrypto(nativeIn.amount / 1e9)} SOL`; party = nativeIn.fromUserAccount;"
);
code = code.replace(
  "isSol = true; isReceived = false; amountStr = `◎ ${(nativeOut.amount / 1e9).toFixed(4)} SOL`; party = nativeOut.toUserAccount;",
  "isSol = true; isReceived = false; amountStr = `◎ ${formatCrypto(nativeOut.amount / 1e9)} SOL`; party = nativeOut.toUserAccount;"
);
code = code.replace(
  "isReceived = true; amountStr = `🪙 ${tokenIn.tokenAmount} ${tokenIn.mint.slice(0,4)}`; party = tokenIn.fromUserAccount;",
  "isReceived = true; amountStr = `🪙 ${formatCrypto(tokenIn.tokenAmount)} ${getTokenLink(tokenIn.mint)}`; party = tokenIn.fromUserAccount;"
);
code = code.replace(
  "isReceived = false; amountStr = `🪙 ${tokenOut.tokenAmount} ${tokenOut.mint.slice(0,4)}`; party = tokenOut.fromUserAccount;",
  "isReceived = false; amountStr = `🪙 ${formatCrypto(tokenOut.tokenAmount)} ${getTokenLink(tokenOut.mint)}`; party = tokenOut.fromUserAccount;"
);

fs.writeFileSync('worker/src/helius.js', code);
