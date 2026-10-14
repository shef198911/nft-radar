export async function sendTelegramMessage(token, chatId, text, replyMarkup = null, threadId = null, disablePreview = false) {
  if (!token || !chatId) {
    console.warn('Missing Telegram credentials');
    return { ok: false };
  }
  
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    let previewUrl = undefined;
    if (!disablePreview) {
      // 1. Check if replyMarkup contains a tweet status URL
      if (replyMarkup && replyMarkup.inline_keyboard) {
        for (const row of replyMarkup.inline_keyboard) {
          for (const btn of row) {
            if (btn && btn.url && /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s"'<>]+\/status\/\d+/i.test(btn.url)) {
              previewUrl = btn.url.replace(/x\.com|twitter\.com/i, 'vxtwitter.com');
              break;
            }
          }
          if (previewUrl) break;
        }
      }

      // 2. Check explicit anchor for tweet action in text (e.g. ПЕРЕЙТИ К ТВИТУ / OPEN TWEET / Открыть твит)
      if (!previewUrl) {
        const actionMatch = text.match(/<a\s+[^>]*href=["'](https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s"'<>]+\/status\/\d+[^"']*)["'][^>]*>(?:ПЕРЕЙТИ К ТВИТУ|OPEN TWEET|Открыть твит|Open Tweet)<\/a>/i);
        if (actionMatch) {
          previewUrl = actionMatch[1].replace(/x\.com|twitter\.com/i, 'vxtwitter.com');
        }
      }

      // 3. Fallback to any tweet status URL in text (NEVER author profile URL)
      if (!previewUrl) {
        const statusMatch = text.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s"'<>]+\/status\/\d+[^\s"'<>]*/i);
        if (statusMatch) {
          previewUrl = statusMatch[0].replace(/x\.com|twitter\.com/i, 'vxtwitter.com');
        }
      }
    }

    if (previewUrl) {
      previewUrl = previewUrl.replace('vxtwitter.com/@', 'vxtwitter.com/');
    }

    // Disable preview completely if disablePreview is requested OR if no tweet status URL exists.
    // This prevents Telegram from falling back to crawling the author's profile URL.
    const shouldDisablePreview = !!disablePreview || !previewUrl;

    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: shouldDisablePreview,
      link_preview_options: {
        is_disabled: shouldDisablePreview,
        ...(previewUrl && !shouldDisablePreview ? { url: previewUrl } : {})
      }
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    if (threadId) {
      payload.message_thread_id = parseInt(threadId, 10);
    }

    console.log(`[TG] Sending to chatId ${chatId} (length: ${text.length}, disablePreview: ${!!disablePreview})`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.ok) {
      console.log(`[TG] Sent OK to ${chatId}, message_id: ${data.result?.message_id}`);
      return { ok: true, message_id: data.result.message_id };
    } else {
      console.error('Telegram error:', data);
      return { ok: false, error: data.description || data.error_code || 'telegram_error' };
    }
  } catch (e) {
    console.error('Telegram fetch error:', e);
    return { ok: false, error: e.message };
  }
}
