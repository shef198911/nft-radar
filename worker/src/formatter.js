function escapeHTML(str) {
  if (!str) return '';
  return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

async function translateToRussian(text) {
  if (!text) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json && json[0]) {
       return json[0].map(segment => segment[0]).join('');
    }
    return text;
  } catch (e) {
    console.error('Translation error:', e);
    return text;
  }
}

export async function formatTelegramMessage(data) {
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

  if (data.text) {
    let snippet = data.text.length > 150 ? data.text.substring(0, 150) + '...' : data.text;
    const translatedSnippet = await translateToRussian(snippet);
    msg += `📝 <i>"${escapeHTML(translatedSnippet)}"</i>\n\n`;
  }
  
  msg += `🔗 <a href="${data.tweet_url}"><b>Original Tweet</b></a>`;
  
  return msg;
}
