const fs = require('fs');
let code = fs.readFileSync('worker/src/profiles.js', 'utf8');

code = code.replace(
  "await ctx.env.DB.prepare('UPDATE user_settings SET state = ?, state_data = ? WHERE user_id = ?').bind(state, data, userId).run();",
  "await ctx.env.DB.prepare('UPDATE telegram_users SET state = ?, state_data = ?, updated_at = ? WHERE chat_id = ?').bind(state, data, new Date().toISOString(), ctx.from.id.toString()).run();"
);

fs.writeFileSync('worker/src/profiles.js', code);
