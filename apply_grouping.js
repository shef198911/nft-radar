const fs = require('fs');
const lines = fs.readFileSync('worker/src/index.js', 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('const { parseAlchemyWebhook }'));
const end = lines.findIndex((l, i) => i > start && l.includes("return new Response('OK')"));
const patch = fs.readFileSync('patch_grouping.js', 'utf8');

const newCode = lines.slice(0, start).join('\n') + '\n' + patch + '\n' + lines.slice(end + 1).join('\n');
fs.writeFileSync('worker/src/index.js', newCode);
