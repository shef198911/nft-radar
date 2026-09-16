function passesLocalFilter(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  const isNFT = /\bnfts?\b/i.test(text);
  const isRobinhood = /\brobinhood\b/i.test(text) || lowerText.includes('rh chain');
  
  const hasWL = lowerText.includes('whitelist') || /\bwl\b/i.test(text) || lowerText.includes('allowlist') || lowerText.includes('allow list');
  const hasFCFS = /\bfcfs\b/i.test(text) || /\bgtd\b/i.test(text) || lowerText.includes('guaranteed');
  const hasMint = /\b(mint|drop|launch|upcoming|collection)\b/i.test(text);
  const hasFree = lowerText.includes('free') || lowerText.includes('0 eth');
  const isGiveaway = lowerText.includes('giveaway') || lowerText.includes('raffle');
  
  let isOpportunity = false;
  
  // Giveaways must be specifically WL-related or explicitly tied to NFT/Robinhood
  if (isGiveaway && (hasWL || isNFT || isRobinhood)) isOpportunity = true;
  
  // Spots are explicitly opportunities
  if (/spots?|winners?|spots/i.test(text) && hasWL) isOpportunity = true;
  if (/\b\d+\s*(?:x\s*)?(?:wl|whitelist|allowlist|gtd|fcfs)\b/i.test(text)) isOpportunity = true;
  
  // Mints/Drops must have additional context (Free, WL, FCFS, or explicit NFT/Robinhood)
  if (hasMint && (hasFree || hasWL || hasFCFS || isNFT || isRobinhood)) isOpportunity = true;
  
  // Standalone strong signals
  if (isRobinhood && (hasMint || hasWL || hasFree)) isOpportunity = true;
  
  return isOpportunity;
}
if (typeof window !== 'undefined') window.passesLocalFilter = passesLocalFilter;
