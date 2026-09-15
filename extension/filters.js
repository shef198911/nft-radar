function passesLocalFilter(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  // Basic checks (NFT + mint, NFT + whitelist, etc.)
  const hasNFT = lowerText.includes('nft');
  const hasRobinhood = lowerText.includes('robinhood');
  const hasMint = lowerText.includes('mint');
  const hasFree = lowerText.includes('free') || lowerText.includes('0 eth');
  const hasWhitelist = lowerText.includes('whitelist') || lowerText.includes('wl') || lowerText.includes('allowlist');
  const hasFcfs = lowerText.includes('fcfs') || lowerText.includes('gtd');
  const hasCollection = lowerText.includes('collection');
  
  const isRobinhoodOpportunity = hasRobinhood && (hasNFT || hasMint || hasCollection || lowerText.includes('drop') || hasWhitelist || hasFcfs || hasFree);
  const isGeneralOpportunity = hasNFT && (hasMint || hasWhitelist || hasFree || hasFcfs);
  
  return isRobinhoodOpportunity || isGeneralOpportunity;
}
if (typeof window !== 'undefined') window.passesLocalFilter = passesLocalFilter;
