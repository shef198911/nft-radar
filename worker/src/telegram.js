export async function sendTelegramMessage(token, chatId, text, replyMarkup = null, threadId = null) {
  if (!token || !chatId) {
    console.warn('Missing Telegram credentials');
    return { ok: false };
  }
  
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    // extract first twitter/x url to force vxtwitter preview
    let previewUrl = undefined;
    const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s"']+/i);
    if (urlMatch) {
      previewUrl = urlMatch[0].replace(/x\.com|twitter\.com/i, 'vxtwitter.com');
    }

    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      link_preview_options: {
        is_disabled: false,
        ...(previewUrl ? { url: previewUrl } : {})
      }
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    if (threadId) {
      payload.message_thread_id = parseInt(threadId, 10);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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
