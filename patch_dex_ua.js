const fs = require('fs');

let code = fs.readFileSync('worker/src/dexscreener.js', 'utf8');

code = code.replace(
  "const res = await fetch(url);",
  "const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' } });"
);

// We have two fetch calls, replace both globally
code = code.split("const res = await fetch(url);").join("const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' } });");

fs.writeFileSync('worker/src/dexscreener.js', code);
