export async function sendTelegramMessage(token, chatId, text) {
  if (!token || !chatId) {
    console.warn('Missing Telegram credentials');
    return { ok: false };
  }
  
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    
    const data = await res.json();
    if (data.ok) {
      return { ok: true, message_id: data.result.message_id };
    } else {
      console.error('Telegram error:', data);
      return { ok: false };
    }
  } catch (e) {
    console.error('Telegram fetch error:', e);
    return { ok: false };
  }
}
