const PAID_PRICE_RE = /\b(?:0?\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)\s*(eth|sol|avax|bnb|matic|usdc)\b/i;

const DISCUSSION_PATTERNS = [
  /\?/,
  /\bhow strict\b/i,
  /\bprobably\b/i,
  /\bnice[, ]+but\b/i,
  /\ballocation math\b/i,
  /\beligibility\b/i,
  /\bthoughts\b/i,
  /\banyone know\b/i,
  /\bdoes anyone\b/i,
  /\bwhat do you think\b/i,
  /\bis it worth\b/i
];

const ACTION_PATTERNS = [
  /\bmint is live\b/i,
  /\bmint live\b/i,
  /\bminting now\b/i,
  /\bclaim now\b/i,
  /\bfree mint\b/i,
  /\bfree claim\b/i,
  /\bwl spots?\b/i,
  /\bwhitelist raffle\b/i,
  /\ballowlist raffle\b/i,
  /\bfcfs\b/i,
  /\bgtd\b/i,
  /\bpublic mint\b/i,
  /\bpresale\b/i,
  /\bmint starts?\b/i,
  /\bdrop is live\b/i,
  /\bjoin (?:the )?(?:wl|whitelist|allowlist)\b/i
];

export function normalizeOpportunity(parsed) {
  const text = parsed.text || '';
  const priceMatch = text.match(PAID_PRICE_RE);
  const hasPaidPrice = Boolean(priceMatch);
  const isDiscussion = DISCUSSION_PATTERNS.some((pattern) => pattern.test(text));
  const hasActionIntent = ACTION_PATTERNS.some((pattern) => pattern.test(text))
    || parsed.has_mint_link
    || parsed.wl_spots
    || parsed.mint_time_raw === 'live';

  return {
    ...parsed,
    has_paid_price: hasPaidPrice,
    price: hasPaidPrice ? priceMatch[0].toUpperCase() : parsed.price,
    is_free: hasPaidPrice ? 0 : parsed.is_free,
    mint_type: hasPaidPrice && parsed.mint_type === 'FREE_MINT' ? 'PAID_MINT' : parsed.mint_type,
    is_discussion: isDiscussion ? 1 : 0,
    is_actionable_opportunity: (!parsed.is_reply && !isDiscussion && hasActionIntent) ? 1 : 0
  };
}

export function canSendOpportunity(data) {
  return data.is_reply !== true
    && data.is_reply !== 1
    && data.is_discussion !== 1
    && data.is_actionable_opportunity !== 0;
}
