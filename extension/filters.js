function passesLocalFilter(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  const isNFT = /\bnfts?\b/i.test(text);
  const isRobinhood = /\brobinhood\b/i.test(text);
  
  const hasWhitelist = lowerText.includes('whitelist') || /\bwl\b/i.test(text) || lowerText.includes('allowlist') || lowerText.includes('allow list');
  const hasFcfs = /\bfcfs\b/i.test(text) || /\bgtd\b/i.test(text) || lowerText.includes('guaranteed');
  const hasFree = lowerText.includes('free') || lowerText.includes('0 eth');
  
  const isOpportunity = /\b(mint|drop|launch|upcoming|collection)\b/i.test(text) || hasWhitelist || hasFcfs;
  
  const hasFreeMintContext = hasFree && (isNFT || isOpportunity || isRobinhood);
  const isValidSignal = isOpportunity || hasFreeMintContext;
  
  if (!isValidSignal) return false;
  
  return isRobinhood || isNFT;
}
if (typeof window !== 'undefined') window.passesLocalFilter = passesLocalFilter;
