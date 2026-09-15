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
  if (data.is_wl_giveaway) types.push('Whitelist Giveaway');
  else if (data.is_wl_raffle) types.push('Whitelist Raffle');
  else if (data.is_whitelist || data.is_allowlist) types.push('Whitelist');
  if (data.is_fcfs) types.push('FCFS');
  if (data.is_gtd) types.push('GTD');
  
  if (types.length > 0) {
    msg += `<b>🎯 Type:</b>\n${types.join(' + ')}\n\n`;
  } else if (data.opportunity_type && data.opportunity_type !== 'UNKNOWN') {
    msg += `<b>🎯 Type:</b>\n${escapeHTML(data.opportunity_type)}\n\n`;
  }
  
  if (data.wl_spots) {
    msg += `<b>👥 WL spots:</b>\n${data.wl_spots}\n\n`;
  }
  
  if (data.price && data.price !== 'FREE') {
    msg += `<b>💰 Price:</b>\n${escapeHTML(data.price)}\n\n`;
  } else if (data.price === 'FREE') {
    msg += `<b>💰 Price:</b>\nFREE\n\n`;
  }
  
  if (data.mint_time_raw) {
    msg += `<b>📅 Mint:</b>\n${escapeHTML(data.mint_time_raw)}\n\n`;
  }
  
  if (data.supply) {
    msg += `<b>👥 Supply:</b>\n${data.supply}\n\n`;
  }
  
  if (data.moni_score !== null && data.moni_score !== undefined) {
    msg += `<b>💰 Moni Score:</b>\n${data.moni_score.toLocaleString()}\n\n`;
  }
  
  msg += `<b>⭐ Score:</b>\n${data.score}/100\n\n`;
  msg += `<a href="${data.tweet_url}">🔗 Original tweet</a>`;
  
  return msg;
}
