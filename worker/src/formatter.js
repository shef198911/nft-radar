function escapeHTML(str) {
  if (!str) return '';
  return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

function formatAuthor(data) {
  if (!data.username) return null;

  const username = String(data.username).replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return null;

  const displayName = data.display_name && data.display_name !== username
    ? `${data.display_name} (@${username})`
    : `@${username}`;

  return {
    label: displayName,
    url: `https://x.com/${username}`
  };
}

export function formatTelegramMessage(data) {
  let emoji = '🟢';
  if (data.priority === 'HOT') emoji = '🔥';
  else if (data.priority === 'HIGH') emoji = '🟡';
  else if (data.priority === 'NORMAL') emoji = '⚪';
  
  let header = `<b>${emoji} NFT OPPORTUNITY</b>`;
  if (data.is_robinhood) {
    header += ` | <b>🦊 ROBINHOOD CHAIN</b>`;
  } else if (data.chain && data.chain !== 'Unknown') {
    header += ` | <b>⛓️ ${escapeHTML(data.chain.toUpperCase())}</b>`;
  }
  
  let msg = `${header}\n\n`;
  
  if (data.project_name) {
    msg += `📦 <b>Project:</b> ${escapeHTML(data.project_name)}\n`;
  } else if (data.display_name) {
    msg += `📦 <b>Source:</b> ${escapeHTML(data.display_name)}\n`;
  }

  const author = formatAuthor(data);
  if (author) {
    msg += `👤 <b>Author:</b> <a href="${escapeHTML(author.url)}">${escapeHTML(author.label)}</a>\n`;
  }
  
  const types = [];
  if (data.is_free) types.push('Free Mint');
  if (data.is_wl_giveaway) types.push('WL Giveaway');
  else if (data.is_wl_raffle) types.push('WL Raffle');
  else if (data.is_whitelist || data.is_allowlist) types.push('Whitelist');
  if (data.is_fcfs) types.push('FCFS');
  if (data.is_gtd) types.push('GTD');
  
  if (types.length > 0) {
    msg += `🎯 <b>Type:</b> ${types.join(' + ')}\n`;
  } else if (data.opportunity_type && data.opportunity_type !== 'UNKNOWN') {
    msg += `🎯 <b>Type:</b> ${escapeHTML(data.opportunity_type)}\n`;
  }
  
  if (data.wl_spots) {
    msg += `🎫 <b>WL spots:</b> ${data.wl_spots}\n`;
  }
  
  if (data.price && data.price !== 'FREE') {
    msg += `💰 <b>Price:</b> ${escapeHTML(data.price)}\n`;
  } else if (data.price === 'FREE') {
    msg += `💰 <b>Price:</b> FREE\n`;
  }
  
  if (data.mint_time_raw) {
    msg += `📅 <b>Mint:</b> ${escapeHTML(data.mint_time_raw)}\n`;
  }
  
  if (data.supply) {
    msg += `📊 <b>Supply:</b> ${data.supply}\n`;
  }
  
  if (data.moni_score !== null && data.moni_score !== undefined) {
    msg += `💎 <b>Moni Score:</b> ${data.moni_score.toLocaleString()}\n`;
  }
  
  msg += `⭐ <b>Radar Score:</b> ${data.score}/100\n\n`;

  if (data.translated_text) {
    msg += `<blockquote expandable>${escapeHTML(data.translated_text)}</blockquote>\n\n`;
  } else if (data.text) {
    msg += `<blockquote expandable>${escapeHTML(data.text)}</blockquote>\n\n`;
  }
  
  // Link preview triggers automatically from inline button or we leave it empty since preview Url is appended in telegram.js 
  // Wait, if we completely remove the URL from the text body, Telegram won't generate a link preview automatically unless we specify `url` in `link_preview_options`. But `telegram.js` extracts it using a regex!
  // If we remove the original tweet link, the regex `text.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s"']+/i)` will FAIL unless `data.text` has a url in it.
  // Oh, wait! `telegram.js` uses `text.match(...)` on the HTML body. If I remove the URL, preview won't work.
  // So I should hide the URL as a zero-width link or something, or pass the previewUrl directly.
  msg += `<a href="${escapeHTML(data.tweet_url)}">&#8203;</a>`;
  
  return msg;
}
