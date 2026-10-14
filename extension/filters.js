var WHITELIST_FORM_PATTERNS = (typeof WHITELIST_FORM_PATTERNS !== 'undefined' ? WHITELIST_FORM_PATTERNS : [
  /https?:\/\/(?:www\.)?premint\.xyz\/[^\s<>"')]+/i,
  /https?:\/\/(?:www\.)?alphabot\.app\/[^\s<>"')]+/i,
  /https?:\/\/(?:www\.)?heymint\.xyz\/[^\s<>"')]+/i,
  /https?:\/\/forms\.gle\/[^\s<>"')]+/i,
  /https?:\/\/docs\.google\.com\/forms\/[^\s<>"')]+/i,
  /\b(?:premint\.xyz|alphabot\.app|heymint\.xyz|forms\.gle)\/[^\s<>"')]+/i,
  /\bdocs\.google\.com\/forms\/[^\s<>"')]+/i
]);

function hasWhitelistFormUrl(text, links = []) {
  if (text && WHITELIST_FORM_PATTERNS.some(p => p.test(text))) return true;
  if (Array.isArray(links)) {
    for (const l of links) {
      if (l && WHITELIST_FORM_PATTERNS.some(p => p.test(l))) return true;
    }
  }
  return false;
}

function passesLocalFilter(text, links = []) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  // Anti-scam fast reject
  if (lowerText.includes('send eth') || lowerText.includes('send crypto') || lowerText.includes('drainer') || lowerText.includes('phishing')) {
     return false;
  }
  
  // Gambling/Casino reject
  if (/\b(casino|gamble|gambling|betting|poker|slots|roulette|blackjack|lottery|jackpot|казино|ставки|рулетка)\b/i.test(lowerText)) {
     return false;
  }

  // F11: Whitelist Form Hunter bypass:
  // Presence of whitelist form URL in tweet text/links bypasses local reject filters & keyword requirements
  if (hasWhitelistFormUrl(text, links)) {
     return true;
  }

  const utilityOrHolderGatePatterns = [
    /\bfree\s+mint\s+bot\b/i,
    /\bmint\s+bot\b/i,
    /\bbot\s+is\s+ready\b/i,
    /\btest\s+mint\s+only\b/i,
    /\bcurrently\s+testing\s+mint\b/i,
    /\btestnet\s+mint\b/i,
    /\byou\s+must\s+hold\b/i,
    /\bholders?\s+only\b/i,
    /\bholders?\s+(?:will|get|can|receive|have)\b[\s\S]{0,80}\baccess\b/i,
    /\bholder\s+gated\b/i
  ];

  if (utilityOrHolderGatePatterns.some((pattern) => pattern.test(text))) {
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

function passesXListLocalFilter(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  if (text.trim().length < 10) return false;

  const garbageExact = ['gm', 'gn', 'lfg', 'bullish', 'bearish'];
  if (garbageExact.includes(lowerText.trim())) return false;

  const obviousGarbage = [
    /\bgm ct\b/i,
    /\bgood morning\b/i,
    /\bgood night\b/i,
    /\bwhat do you think\b/i,
    /\bwho is bullish\b/i,
    /\bwe are so back\b/i,
    /\buse my link\b/i,
    /\buse my code\b/i,
    /\bsign up with my link\b/i,
    /\bdeposit now\b/i,
    /\btrade now\b/i,
    /\bbuy now\b/i
  ];
  if (obviousGarbage.some(p => p.test(lowerText))) return false;

  return true;
}

if (typeof window !== 'undefined') {
  window.passesLocalFilter = passesLocalFilter;
  window.passesXListLocalFilter = passesXListLocalFilter;
  window.hasWhitelistFormUrl = hasWhitelistFormUrl;
  window.WHITELIST_FORM_PATTERNS = WHITELIST_FORM_PATTERNS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    passesLocalFilter,
    passesXListLocalFilter,
    hasWhitelistFormUrl,
    WHITELIST_FORM_PATTERNS
  };
}
