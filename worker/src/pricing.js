const PRICE_RE = /(?:0?\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)\s*(?:eth|sol|avax|bnb|matic|usdc)\b/i;
const FREE_RE = /\b(?:free|0\s*(?:eth|sol|avax|bnb|matic|usdc)|zero\s*(?:eth|sol|avax|bnb|matic|usdc)|no cost)\b/i;

function normalizePrice(value) {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim().toUpperCase();
}

function hasPaidPrice(text) {
  return PRICE_RE.test(text || '');
}

function firstPrice(text) {
  const match = String(text || '').match(PRICE_RE);
  return match ? normalizePrice(match[0]) : null;
}

function lineIncludes(line, patterns) {
  return patterns.some((pattern) => pattern.test(line));
}

export function parsePricing(text) {
  const value = String(text || '');
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const publicLine = lines.find((line) => lineIncludes(line, [/\bpublic\b/i]) && (hasPaidPrice(line) || FREE_RE.test(line)));
  const whitelistLine = lines.find((line) => lineIncludes(line, [/\bwhitelist\b/i, /\ballowlist\b/i, /\bwl\b/i]) && (hasPaidPrice(line) || FREE_RE.test(line)));
  const subscriberLine = lines.find((line) => /\bsubscriber/i.test(line) && FREE_RE.test(line));

  const publicPrice = firstPrice(publicLine);
  const whitelistPrice = firstPrice(whitelistLine);
  const paidPrice = firstPrice(value);

  const whitelistIsFree = Boolean(whitelistLine && FREE_RE.test(whitelistLine) && !whitelistPrice);
  const subscriberIsFree = Boolean(subscriberLine);
  const publicIsFree = Boolean(publicLine && FREE_RE.test(publicLine) && !publicPrice);
  const genericFree = /\bfree\s+(?:mint|claim|wl|whitelist)\b/i.test(value)
    || /\b(?:mint|claim)\s+is\s+free\b/i.test(value)
    || /\bfree\s+to\s+mint\b/i.test(value);

  let freeScope = 'none';
  if (publicIsFree || (genericFree && !paidPrice && !publicPrice)) {
    freeScope = 'all';
  } else if (whitelistIsFree) {
    freeScope = 'whitelist';
  } else if (subscriberIsFree) {
    freeScope = 'subscriber';
  }

  let price = paidPrice;
  if (freeScope === 'all') {
    price = 'FREE';
  } else if (freeScope === 'whitelist' && publicPrice) {
    price = `WL FREE / Public ${publicPrice}`;
  } else if (freeScope === 'subscriber' && publicPrice) {
    price = `Subscribers FREE / Public ${publicPrice}`;
  } else if ((freeScope === 'whitelist' || freeScope === 'subscriber') && paidPrice) {
    price = `${freeScope === 'whitelist' ? 'WL' : 'Subscribers'} FREE / Paid ${paidPrice}`;
  }

  return {
    price,
    paid_price: paidPrice,
    public_price: publicPrice,
    whitelist_price: whitelistPrice,
    free_scope: freeScope,
    is_free: freeScope === 'all' ? 1 : 0,
    is_free_whitelist: freeScope === 'whitelist' ? 1 : 0
  };
}
