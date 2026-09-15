export function parseTweet(payload) {
  const text = payload.text;
  const lower = text.toLowerCase();
  
  let is_free = 0, is_whitelist = 0, is_allowlist = 0, is_fcfs = 0, is_gtd = 0, is_robinhood = 0;
  
  // Mint Type & Opportunity Type
  if (lower.includes('free mint') || lower.includes('0 eth') || lower.includes('zero eth') || lower.includes('no cost') || lower.includes('free to mint')) {
    is_free = 1;
  }
  if (lower.includes('whitelist') || lower.includes('wl')) is_whitelist = 1;
  if (lower.includes('allowlist') || lower.includes('allow list')) is_allowlist = 1;
  if (lower.includes('fcfs') || lower.includes('first come')) is_fcfs = 1;
  if (lower.includes('gtd') || lower.includes('guaranteed')) is_gtd = 1;
  
  // Chain detection
  let chain = 'Unknown';
  if (lower.includes('robinhood chain') || lower.includes('rh chain') || lower.includes('robinhoodchain')) {
    chain = 'Robinhood Chain';
    is_robinhood = 1;
  } else if (lower.includes('base')) {
    chain = 'Base';
  } else if (lower.includes('ethereum') || lower.includes('eth')) {
    chain = 'Ethereum';
  } else if (lower.includes('solana') || lower.includes(' sol ')) {
    chain = 'Solana';
  } else if (lower.includes('arbitrum')) {
    chain = 'Arbitrum';
  }
  
  // Special Robinhood Chain rule
  if (!is_robinhood && lower.includes('robinhood')) {
    if (lower.includes('nft') || lower.includes('mint') || lower.includes('collection') || lower.includes('drop') || is_whitelist || is_allowlist || is_fcfs || is_gtd || is_free) {
      is_robinhood = 1;
      chain = 'Robinhood Chain';
    }
  }

  let mint_type = is_free ? 'FREE_MINT' : (lower.includes('mint') ? 'PAID_MINT' : 'UNKNOWN');
  
  let opportunity_type = 'UNKNOWN';
  if (is_free) opportunity_type = 'FREE_MINT';
  else if (is_whitelist) opportunity_type = 'WHITELIST';
  else if (is_allowlist) opportunity_type = 'ALLOWLIST';
  else if (is_fcfs) opportunity_type = 'FCFS';
  else if (is_gtd) opportunity_type = 'GTD';
  else if (is_robinhood) opportunity_type = 'ROBINHOOD_NFT';
  else if (lower.includes('mint')) opportunity_type = 'MINT';

  // Supply
  let supply = null;
  const supplyMatch = lower.match(/(?:supply|collection|items|nfts?)\s*(?:[:=-]\s*)?([\d,]+k?)/i) || 
                      lower.match(/([\d,]+k?)\s*(?:supply|nfts?)/i);
  if (supplyMatch) {
    let s = supplyMatch[1].replace(/,/g, '');
    if (s.endsWith('k') || s.endsWith('K')) s = parseFloat(s) * 1000;
    supply = parseInt(s, 10);
    if (isNaN(supply)) supply = null;
  }

  // Mint date/time
  let mint_date = null;
  let mint_time_raw = null;
  const dateMatch = text.match(/(?:mint|minting|starts?|live|opening)\s*(?:on|at|:|=>)?\s*([a-zA-Z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\s*(?:at\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[a-zA-Z]{0,4})?)/i) ||
                    text.match(/([a-zA-Z]{3,9}\s+\d{1,2}.*?(?:UTC|EST|PST|AM|PM))/i);
  if (dateMatch) {
    mint_time_raw = dateMatch[1].trim();
  } else if (lower.includes('mint tomorrow')) {
    mint_time_raw = 'tomorrow';
  } else if (lower.includes('soon')) {
    mint_time_raw = 'soon';
  } else if (lower.includes('now live') || lower.includes('is live')) {
    mint_time_raw = 'live';
  }

  return {
    ...payload,
    chain,
    mint_type,
    opportunity_type,
    project_name: null, // Hard to parse without LLM, keeping NULL as per MVP docs
    mint_date,
    mint_time_raw,
    supply,
    price: is_free ? 'FREE' : 'UNKNOWN',
    is_free,
    is_whitelist,
    is_allowlist,
    is_fcfs,
    is_gtd,
    is_robinhood
  };
}
