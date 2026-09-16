export function calculateScore(parsed) {
  let score = 0;
  
  if (parsed.is_free) score += 25;
  if (parsed.is_whitelist || parsed.is_allowlist) score += 15;
  if (parsed.is_free_whitelist) score += 10;
  if (parsed.is_fcfs) score += 10;
  if (parsed.is_gtd) score += 10;
  if (parsed.is_robinhood) score += 25;
  
  const lower = parsed.text.toLowerCase();
  if (lower.includes('nft')) score += 5;
  if (lower.includes('mint')) score += 5;
  if (lower.includes('upcoming')) score += 5;
  
  if (parsed.is_verified || parsed.has_official_link) score += 10;
  if (parsed.mint_time_raw && parsed.mint_time_raw !== 'soon' && parsed.mint_time_raw !== 'live' && parsed.mint_time_raw !== 'tomorrow') score += 5;
  if (parsed.has_mint_link) score += 5;

  if (!parsed.is_wl_giveaway && !parsed.is_wl_raffle) {
    if (parsed.is_giveaway) score -= 10;
    if (lower.includes('rt to win') || lower.includes('retweet to win')) score -= 10;
    if (lower.includes('follow to win')) score -= 10;
  }
  
  if (lower.includes('send eth') || lower.includes('send crypto')) score -= 30;
  if (lower.includes('dm for link') || lower.includes('dm me')) score -= 15;
  if (lower.includes('connect wallet')) score -= 10;
  if (lower.includes('drainer') || lower.includes('scam') || lower.includes('phishing')) score -= 15;
  if (parsed.is_reply || parsed.is_discussion) score -= 40;
  if (parsed.is_actionable_opportunity === 0) score -= 25;
  
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  
  let priority = 'LOW';
  if (score >= 90) priority = 'HOT';
  else if (score >= 75) priority = 'HIGH';
  else if (score >= 50) priority = 'NORMAL';

  return { ...parsed, score, priority };
}
