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

export function formatTelegramMessage(data, lang = 'ru') {
  let emoji = '🚨';
  if (data.priority === 'HOT') emoji = '🔥';
  else if (data.priority === 'HIGH') emoji = '🚨';
  else if (data.priority === 'NORMAL') emoji = '👀';
  
  let header = `<b>${emoji} ${data.is_x_list ? '🤖 X-LIST AI OPPORTUNITY' : 'NFT OPPORTUNITY'}</b>`;
  if (data.chain && data.chain !== 'Unknown') {
    let chainEmoji = '🔗';
    if (data.chain === 'Robinhood Chain') chainEmoji = '🦊';
    else if (data.chain === 'Solana') chainEmoji = '🟣';
    else if (data.chain === 'Ethereum') chainEmoji = '🔷';
    else if (data.chain === 'Base') chainEmoji = '🔵';
    else if (data.chain === 'Arbitrum') chainEmoji = '💙';
    else if (data.chain === 'Polygon') chainEmoji = '💜';
    else if (data.chain === 'BNB Chain') chainEmoji = '🟡';
    else if (data.chain === 'Avalanche') chainEmoji = '🔺';
    header += ` | <b>${chainEmoji} ${escapeHTML(data.chain.toUpperCase())}</b>`;
  }
  
  let msg = `${header}\n\n`;
  
  if (data.project_name) {
    msg += `🚀 <b>Project:</b> ${escapeHTML(data.project_name)}\n`;
  } else if (data.display_name) {
    msg += `🚀 <b>Source:</b> ${escapeHTML(data.display_name)}\n`;
  }

  const author = formatAuthor(data);
  if (author) {
    msg += `👤 <b>Author:</b> <a href="${escapeHTML(author.url)}">${escapeHTML(author.label)}</a>\n`;
  }
  
  if (data.is_x_list && data.opportunity_type && data.opportunity_type !== 'UNKNOWN') {
    msg += `🧠 <b>AI Category:</b> ${escapeHTML(data.opportunity_type.toUpperCase())}\n`;
  }
  
  const types = [];
  if (data.is_free) types.push('Free Mint');
  if (data.is_free_whitelist) types.push('Whitelist Free');
  if (data.is_wl_giveaway) types.push('WL Giveaway');
  else if (data.is_wl_raffle) types.push('WL Raffle');
  else if ((data.is_whitelist || data.is_allowlist) && !data.is_free_whitelist) types.push('Whitelist');
  if (data.is_fcfs) types.push('FCFS');
  if (data.is_gtd) types.push('GTD');
  
  if (types.length > 0) {
    msg += `🎯 <b>Tags:</b> ${types.join(' + ')}\n`;
  } else if (!data.is_x_list && data.opportunity_type && data.opportunity_type !== 'UNKNOWN') {
    msg += `🎯 <b>Type:</b> ${escapeHTML(data.opportunity_type)}\n`;
  }
  
  if (data.wl_spots) {
    msg += `🎁 <b>WL spots:</b> ${data.wl_spots}\n`;
  }
  
  if (data.price && data.price !== 'FREE') {
    msg += `💰 <b>Price:</b> ${escapeHTML(data.price)}\n`;
  } else if (data.price === 'FREE') {
    msg += `💰 <b>Price:</b> FREE\n`;
  }
  
  if (data.mint_time_raw) {
    msg += `⏰ <b>Mint:</b> ${escapeHTML(data.mint_time_raw)}\n`;
  }
  
  if (data.supply) {
    msg += `📦 <b>Supply:</b> ${data.supply}\n`;
  }
  
  if (data.moni_score !== null && data.moni_score !== undefined) {
    msg += `🌟 <b>Moni Score:</b> ${data.moni_score.toLocaleString()}\n`;
  }

  if (data.link_risk_level && data.link_risk_level !== 'OK') {
    const icon = data.link_risk_level === 'HIGH' ? '🚫' : (data.link_risk_level === 'MEDIUM' ? '⚠️' : '🛡️');
    msg += `${icon} <b>Link Risk:</b> ${escapeHTML(data.link_risk_level)}`;
    if (data.link_risk_reasons && data.link_risk_reasons.length > 0) {
      msg += ` - ${escapeHTML(data.link_risk_reasons.slice(0, 3).join('; '))}`;
    }
    msg += '\n';
  }
  
  if (data.is_x_list) {
    msg += `🤖 <b>AI Score:</b> ${data.score}/100\n\n`;
  } else {
    msg += `📈 <b>Radar Score:</b> ${data.score}/100\n\n`;
  }

  if (lang === 'ru' && data.translated_text) {
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
