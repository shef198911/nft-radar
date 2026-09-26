import re

with open('worker/src/telegram-grammy.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace dynamic imports
code = code.replace("import { t } from './i18n.js';", "import { t } from './i18n.js';\nimport { initAlchemyWebhooks, updateAlchemyAddresses } from './alchemy.js';")
code = code.replace("const { initAlchemyWebhooks, updateAlchemyAddresses } = await import('./alchemy.js');\n", "")
code = code.replace("ctx.waitUntil(updateAlchemyAddresses(ctx.env, [data.addr]));", "await updateAlchemyAddresses(ctx.env, [data.addr]);")

# Wait, the save_noname callback also has the same code! I need to fix it there too.
code = code.replace("const { initAlchemyWebhooks, updateAlchemyAddresses } = await import('./alchemy.js');", "")
code = code.replace("ctx.waitUntil(updateAlchemyAddresses(ctx.env, [addr]));", "await updateAlchemyAddresses(ctx.env, [addr]);")

with open('worker/src/telegram-grammy.js', 'w', encoding='utf-8') as f:
    f.write(code)
