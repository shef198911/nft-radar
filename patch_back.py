import os

path = 'worker/src/telegram-solana.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('callback_data: "home"', 'callback_data: "wallet_home"')
content = content.replace('??', '🟢')
content = content.replace('?"?', '🔴')
content = content.replace('', '')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
