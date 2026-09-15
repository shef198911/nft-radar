function escapeHTML(str) {
  if (!str) return '';
  return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

export function formatTelegramMessage(data) {
  let emoji = '🟢';
  if (data.priority === 'HOT') emoji = '🔥';
  else if (data.priority === 'HIGH') emoji = '🟠';
  else if (data.priority === 'NORMAL') emoji = '🟡';
  
  let msg = `<b>${emoji} NFT OPPORTUNITY</b>\n`;
  
  if (data.is_robinhood) {
    msg += `<b>🟥 ROBINHOOD CHAIN</b>\n\n`;
  } else if (data.chain && data.chain !== 'Unknown') {
    msg += `<b>⛓️ ${escapeHTML(data.chain.toUpperCase())}</b>\n\n`;
  } else {
    msg += `\n`;
  }
  
  if (data.project_name) {
    msg += `<b>📦 Project:</b> ${escapeHTML(data.project_name)}\n\n`;
  } else if (data.display_name) {
    msg += `<b>📦 Source:</b> ${escapeHTML(data.display_name)}\n\n`;
  }
  
  const types = [];
  if (data.is_free) types.push('Free Mint');
  if (data.is_whitelist || data.is_allowlist) types.push('Whitelist');
  if (data.is_fcfs) types.push('FCFS');
  if (data.is_gtd) types.push('GTD');
  
  if (types.length > 0) {
    msg += `<b>🎯 Type:</b>\n${types.join(' + ')}\n\n`;
  } else if (data.opportunity_type && data.opportunity_type !== 'UNKNOWN') {
    msg += `<b>🎯 Type:</b>\n${escapeHTML(data.opportunity_type)}\n\n`;
  }
  
  if (data.price) {
    msg += `<b>💰 Price:</b>\n${escapeHTML(data.price)}\n\n`;
  }
  
  if (data.mint_time_raw) {
    msg += `<b>📅 Mint:</b>\n${escapeHTML(data.mint_time_raw)}\n\n`;
  }
  
  if (data.supply) {
    msg += `<b>👥 Supply:</b>\n${data.supply}\n\n`;
  }
  
  msg += `<b>⭐ Score:</b>\n${data.score}/100\n\n`;
  
  let snippet = data.text.substring(0, 150).replace(/\n/g, ' ');
  if (data.text.length > 150) snippet += '...';
  msg += `<b>📝 Details:</b>\n<i>${escapeHTML(snippet)}</i>\n\n`;
  
  msg += `<a href="${data.tweet_url}">🔗 Original tweet</a>`;
  
  return msg;
}
