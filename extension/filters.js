function passesLocalFilter(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  const hasNFT = lowerText.includes('nft');
  const hasRobinhood = lowerText.includes('robinhood');
  const hasMint = lowerText.includes('mint') || lowerText.includes('drop') || lowerText.includes('launch') || lowerText.includes('upcoming');
  const hasFree = lowerText.includes('free') || lowerText.includes('0 eth');
  
  const hasWhitelist = lowerText.includes('whitelist') || /\bwl\b/i.test(text) || lowerText.includes('allowlist') || lowerText.includes('allow list');
  const hasFcfs = lowerText.includes('fcfs') || lowerText.includes('gtd') || lowerText.includes('guaranteed');
  const hasCollection = lowerText.includes('collection');
  
  const isOpportunity = hasMint || hasWhitelist || hasFree || hasFcfs || hasCollection;
  
  const isRobinhoodOpportunity = hasRobinhood && isOpportunity;
  const isGeneralOpportunity = hasNFT && isOpportunity;
  
  return isRobinhoodOpportunity || isGeneralOpportunity;
}
if (typeof window !== 'undefined') window.passesLocalFilter = passesLocalFilter;
