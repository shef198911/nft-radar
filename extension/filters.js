function passesLocalFilter(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  // Anti-scam fast reject
  if (lowerText.includes('send eth') || lowerText.includes('send crypto') || lowerText.includes('drainer') || lowerText.includes('phishing')) {
     return false;
  }
  
  const isNFT = /\bnfts?\b/i.test(text);
  const isTargetChain = /\brobinhood\b/i.test(text) || lowerText.includes('rh chain') || /\barc\b/i.test(text) || lowerText.includes('arc chain') || /\bsolana\b/i.test(text) || /\bsol\b/i.test(text);
  
  const hasWL = lowerText.includes('whitelist') || /\bwl\b/i.test(text) || lowerText.includes('allowlist') || lowerText.includes('allow list');
  const hasFCFS = /\bfcfs\b/i.test(text) || /\bgtd\b/i.test(text) || lowerText.includes('guaranteed');
  const hasMint = /\b(mint|drop|launch|upcoming|collection)\b/i.test(text);
  const hasFree = lowerText.includes('free') || lowerText.includes('0 eth') || lowerText.includes('0 sol');
  const isGiveaway = lowerText.includes('giveaway') || lowerText.includes('raffle');
  
  let isOpportunity = false;
  
  // Giveaways must be specifically WL-related or explicitly tied to NFT/Target Chains
  if (isGiveaway && (hasWL || isNFT || isTargetChain)) isOpportunity = true;
  
  // Spots are explicitly opportunities
  if (/spots?|winners?|spots/i.test(text) && hasWL) isOpportunity = true;
  if (/\b\d+\s*(?:x\s*)?(?:wl|whitelist|allowlist|gtd|fcfs)\b/i.test(text)) isOpportunity = true;
  
  // Mints/Drops must have additional context
  if (hasMint && (hasFree || hasWL || hasFCFS || isNFT || isTargetChain)) isOpportunity = true;
  
  // Standalone strong signals
  if (isTargetChain && (hasMint || hasWL || hasFree)) isOpportunity = true;
  
  return isOpportunity;
}
if (typeof window !== 'undefined') window.passesLocalFilter = passesLocalFilter;
