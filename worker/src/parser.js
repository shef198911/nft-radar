import { analyzeLinkRisk } from './link-risk.js';

export function parseTweet(payload) {
  const text = payload.text || '';
  const lower = text.toLowerCase();
  
  let is_free = 0, is_whitelist = 0, is_allowlist = 0, is_fcfs = 0, is_gtd = 0, is_robinhood = 0;
  
  if (/\bwl\b/i.test(text) || lower.includes('whitelist') || lower.includes('white list')) is_whitelist = 1;
  if (lower.includes('allowlist') || lower.includes('allow list')) is_allowlist = 1;
  
  if (lower.includes('free mint') || lower.includes('0 eth') || lower.includes('zero eth') || lower.includes('no cost') || lower.includes('free to mint') || lower.includes('free whitelist') || lower.includes('free wl')) is_free = 1;
  if (/\bfcfs\b/i.test(text) || lower.includes('first come')) is_fcfs = 1;
  if (/\bgtd\b/i.test(text) || lower.includes('guaranteed')) is_gtd = 1;

  let is_giveaway = lower.includes('giveaway') || lower.includes('give away') ? 1 : 0;
  let is_raffle = lower.includes('raffle') ? 1 : 0;
  
  let is_wl_giveaway = (is_whitelist || is_allowlist) && is_giveaway ? 1 : 0;
  let is_wl_raffle = (is_whitelist || is_allowlist) && is_raffle ? 1 : 0;
  
  let wl_spots = null;
  const spotsMatch = lower.match(/(\d+)\s*(?:x\s*)?(?:wl|whitelist|allowlist|gtd wl|fcfs wl)\s*(?:spots?|winners?)/i) ||
                     lower.match(/giving\s*away\s*(\d+)\s*(?:wl|whitelist|allowlist)/i) ||
                     lower.match(/raffle\s*for\s*(\d+)\s*(?:wl|whitelist|allowlist)/i) ||
                     lower.match(/(\d+)\s*(?:gtd|fcfs)\s*wl/i);
  if (spotsMatch) {
    wl_spots = parseInt(spotsMatch[1], 10);
    if (isNaN(wl_spots)) wl_spots = null;
  }
  
  let chain = 'Unknown';
  if (lower.includes('robinhood chain') || lower.includes('rh chain') || lower.includes('robinhoodchain')) {
    chain = 'Robinhood Chain';
    is_robinhood = 1;
  } else if (/\barc\b/i.test(text) || lower.includes('arc chain')) { chain = 'ARC'; }
    else if (lower.includes('base')) { chain = 'Base'; }
    else if (lower.includes('arbitrum')) { chain = 'Arbitrum'; }
    else if (lower.includes('solana') || /\bsol\b/i.test(text)) { chain = 'Solana'; }
    else if (lower.includes('polygon')) { chain = 'Polygon'; }
    else if (lower.includes('optimism')) { chain = 'Optimism'; }
    else if (lower.includes('unichain')) { chain = 'Unichain'; }
    else if (lower.includes('bnb') || lower.includes('bsc')) { chain = 'BNB Chain'; }
    else if (lower.includes('avalanche') || lower.includes('avax')) { chain = 'Avalanche'; }
    else if (lower.includes('ethereum') || /\beth\b/i.test(text)) { chain = 'Ethereum'; }
  
  if (!is_robinhood && /\brobinhood\b/i.test(text)) {
    if (lower.includes('nft') || lower.includes('mint') || lower.includes('collection') || lower.includes('drop') || is_whitelist || is_allowlist || is_fcfs || is_gtd || is_free) {
      is_robinhood = 1;
      chain = 'Robinhood Chain';
    }
  }

  let mint_type = is_free ? 'FREE_MINT' : (lower.includes('mint') ? 'PAID_MINT' : 'UNKNOWN');
  
  let opportunity_type = 'UNKNOWN';
  if (is_wl_giveaway || is_wl_raffle) opportunity_type = 'WL_GIVEAWAY';
  else if (is_free) opportunity_type = 'FREE_MINT';
  else if (is_whitelist) opportunity_type = 'WHITELIST';
  else if (is_allowlist) opportunity_type = 'ALLOWLIST';
  else if (is_fcfs) opportunity_type = 'FCFS';
  else if (is_gtd) opportunity_type = 'GTD';
  else if (is_robinhood) opportunity_type = 'ROBINHOOD_NFT';
  else if (lower.includes('mint')) opportunity_type = 'MINT';

  let supply = null;
  const supplyMatch = lower.match(/(?:supply|collection|items|nfts?)\s*(?:[:=-]\s*)?([\d,]+k?)/i) || 
                      lower.match(/([\d,]+k?)\s*(?:supply|nfts?)/i);
  if (supplyMatch) {
    let s = supplyMatch[1].replace(/,/g, '');
    if (s.endsWith('k') || s.endsWith('K')) s = parseFloat(s) * 1000;
    supply = parseInt(s, 10);
    if (isNaN(supply)) supply = null;
  }

  let price = null;
  if (is_free) price = 'FREE';
  else {
    const priceMatch = lower.match(/([0-9]*\.?[0-9]+)\s*(eth|sol|avax|bnb)/i);
    if (priceMatch) price = priceMatch[0].toUpperCase();
  }

  let mint_date = null;
  let mint_time = null;
  let mint_time_raw = null;
  
  // Stricter date matching
  const dateRawMatch = text.match(/\b([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\b/i) || 
                       text.match(/\b(\d{1,2}\s+[A-Za-z]{3,9}(?:,?\s+\d{4})?)\b/i) ||
                       text.match(/\b(\d{1,2}[\/\.]\d{1,2}[\/\.]\d{4})\b/i);
                       
  const timeRawMatch = text.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM|UTC|EST|PST|CET)?)\b/i) || 
                       text.match(/\b(\d{1,2}\s*(?:AM|PM)\s*(?:UTC|EST|PST|CET)?)\b/i);

  if (dateRawMatch) {
     mint_time_raw = dateRawMatch[1].trim();
     if (timeRawMatch) {
       mint_time_raw += ' at ' + timeRawMatch[1].trim();
     }
     const d = new Date(mint_time_raw);
     if (!isNaN(d.getTime()) && mint_time_raw.match(/\d{4}/)) {
        mint_date = d.toISOString().split('T')[0];
     }
  } else if (lower.includes('tomorrow')) {
     mint_time_raw = 'tomorrow';
  } else if (lower.includes('soon')) {
     mint_time_raw = 'soon';
  } else if (lower.includes('live')) {
     mint_time_raw = 'live';
  }

  let project_name = null;
  const nameMatch = text.match(/([A-Z][a-zA-Z0-9-]+\s*){1,3}(NFT|Collection|Mint)/);
  if (nameMatch) {
     project_name = nameMatch[0].replace(/\b(NFT|Collection|Mint)\b/i, '').trim();
  } else if (payload.display_name && /\b(nft|collection|studio|labs)\b/i.test(payload.display_name)) {
     // Only use display name if it EXPLICITLY contains NFT/Labs/Studio. Being verified is NOT enough.
     project_name = payload.display_name;
  }

  let official_link = false;
  let mint_link = false;
  const links = payload.links || [];
  links.forEach(l => {
     const lowerUrl = l.toLowerCase();
     if (lowerUrl.includes('discord.gg') || lowerUrl.includes('t.me')) return;
     
     // Stricter mint link
     if (lowerUrl.match(/\b(mint|claim)\b/i) && !lowerUrl.includes('status')) mint_link = true;
     
     if (payload.username && lowerUrl.includes(payload.username.toLowerCase()) && !lowerUrl.includes('x.com')) official_link = true;
  });

  const linkRisk = analyzeLinkRisk(payload.links || []);

  return {
    ...payload,
    moni_score: payload.moni_score !== undefined ? payload.moni_score : null,
    chain,
    mint_type,
    opportunity_type,
    project_name,
    mint_date,
    mint_time,
    mint_time_raw,
    supply,
    price,
    wl_spots,
    is_free,
    is_whitelist,
    is_allowlist,
    is_fcfs,
    is_gtd,
    is_giveaway,
    is_raffle,
    is_wl_giveaway,
    is_wl_raffle,
    is_robinhood,
    is_verified: payload.is_verified || false,
    has_mint_link: mint_link,
    has_official_link: official_link,
    ...linkRisk
  };
}
