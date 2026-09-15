function passesLocalFilter(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  // Since we are inside a specific NFT search query, we can be more permissive locally.
  // The backend scoring will still filter out weak signals.
  
  const isNFT = /\bnfts?\b/i.test(text);
  const isRobinhood = /\brobinhood\b/i.test(text) || lowerText.includes('rh chain');
  
  const hasWL = lowerText.includes('whitelist') || /\bwl\b/i.test(text) || lowerText.includes('allowlist') || lowerText.includes('allow list');
  const hasFCFS = /\bfcfs\b/i.test(text) || /\bgtd\b/i.test(text) || lowerText.includes('guaranteed');
  const hasMint = /\b(mint|drop|launch|upcoming|collection)\b/i.test(text);
  const hasFree = lowerText.includes('free') || lowerText.includes('0 eth');
  const isGiveaway = lowerText.includes('giveaway') || lowerText.includes('raffle');
  
  if (isNFT) return true;
  if (isRobinhood) return true;
  
  // WL / Spots / Giveaways
  if (hasWL && isGiveaway) return true; // WL giveaway, whitelist raffle
  if (hasWL && (hasFCFS || hasMint || hasFree)) return true; // FCFS WL, free WL, WL mint
  if (/spots?|winners?|spots/i.test(text) && hasWL) return true; // 100 WL spots
  if (/\b\d+\s*(?:x\s*)?(?:wl|whitelist|allowlist|gtd|fcfs)\b/i.test(text)) return true; // 10 GTD WL
  
  // Mints
  if (hasFree && hasMint) return true; // free mint, free drop
  if (hasMint && hasFCFS) return true; // FCFS mint
  
  return false;
}
if (typeof window !== 'undefined') window.passesLocalFilter = passesLocalFilter;
if (typeof window !== 'undefined') window.passesLocalFilter = passesLocalFilter;
