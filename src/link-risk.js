const TRUSTED_DOMAINS = [
  'discord.gg',
  'discord.com',
  't.me',
  'telegram.me',
  'magiceden.io',
  'opensea.io',
  'tensor.trade',
  'launchmynft.io',
  'thirdweb.com',
  'manifold.xyz',
  'highlight.xyz',
  'zora.co',
  'foundation.app',
  'rarible.com',
  'drip.haus',
  'metaplex.com'
];

const SHORTENER_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  'cutt.ly',
  'shorturl.at',
  'rebrand.ly',
  'is.gd',
  't.co',
  'linktr.ee',
  'beacons.ai'
];

const SUSPICIOUS_TLDS = [
  'zip',
  'mov',
  'click',
  'top',
  'cam',
  'country',
  'stream',
  'quest',
  'rest'
];

const HIGH_RISK_WORDS = [
  'drain',
  'drainer',
  'wallet-drain',
  'seedphrase',
  'seed-phrase',
  'privatekey',
  'private-key',
  'rectification',
  'walletconnect-verify',
  'validate-wallet',
  'sync-wallet',
  'restore-wallet'
];

const MEDIUM_RISK_WORDS = [
  'airdrop',
  'claim',
  'bonus',
  'giveaway',
  'freeclaim',
  'premint',
  'presale',
  'whitelist',
  'allowlist',
  'mint',
  'connect',
  'verify'
];

const BRAND_WORDS = [
  'opensea',
  'magiceden',
  'tensor',
  'metaplex',
  'phantom',
  'solflare',
  'backpack',
  'robinhood'
];

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function getRegistrableHint(hostname) {
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

function isTrustedDomain(hostname) {
  return TRUSTED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function addRisk(risks, level, reason) {
  risks.push({ level, reason });
}

function riskValue(level) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  if (level === 'low') return 1;
  return 0;
}

function analyzeOneLink(rawLink) {
  const risks = [];
  let url;
  try {
    url = new URL(rawLink);
  } catch (e) {
    try {
      url = new URL(`https://${rawLink}`);
    } catch (_) {
      return {
        url: rawLink,
        host: '',
        risk: 'medium',
        reasons: ['Invalid or obfuscated URL']
      };
    }
  }

  const host = normalizeHostname(url.hostname);
  const registrable = getRegistrableHint(host);
  const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
  const trusted = isTrustedDomain(host);

  if (url.protocol !== 'https:') addRisk(risks, 'medium', 'Non-HTTPS link');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) addRisk(risks, 'high', 'Raw IP address');
  if (host.includes('xn--')) addRisk(risks, 'high', 'Punycode domain');
  if (SHORTENER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    addRisk(risks, 'medium', 'Shortened or opaque link');
  }

  const tld = host.split('.').pop();
  if (SUSPICIOUS_TLDS.includes(tld)) addRisk(risks, 'medium', `Suspicious .${tld} domain`);

  HIGH_RISK_WORDS.forEach((word) => {
    if (haystack.includes(word)) addRisk(risks, 'high', `High-risk keyword: ${word}`);
  });

  MEDIUM_RISK_WORDS.forEach((word) => {
    if (!trusted && haystack.includes(word)) addRisk(risks, 'low', `Mint/claim keyword on untrusted domain: ${word}`);
  });

  BRAND_WORDS.forEach((brand) => {
    if (!trusted && host.includes(brand)) {
      addRisk(risks, 'high', `Possible impersonation: ${brand}`);
    }
  });

  if (!trusted && registrable.split('.')[0].length > 22) {
    addRisk(risks, 'low', 'Long unfamiliar domain');
  }

  const maxRisk = risks.reduce((max, item) => Math.max(max, riskValue(item.level)), 0);
  const risk = maxRisk >= 3 ? 'high' : (maxRisk === 2 ? 'medium' : (maxRisk === 1 ? 'low' : 'none'));

  return {
    url: url.toString(),
    host,
    risk,
    reasons: [...new Set(risks.map((item) => item.reason))]
  };
}

export function analyzeLinkRisk(links = []) {
  const uniqueLinks = [...new Set((links || []).filter(Boolean))].slice(0, 10);
  const checked = uniqueLinks.map(analyzeOneLink);
  const riskScore = checked.reduce((max, item) => Math.max(max, riskValue(item.risk)), 0);
  const riskLevel = riskScore >= 3 ? 'HIGH' : (riskScore === 2 ? 'MEDIUM' : (riskScore === 1 ? 'LOW' : 'OK'));
  const risky = checked.filter((item) => item.risk !== 'none');

  return {
    link_risk_level: riskLevel,
    link_risk_score: riskScore,
    link_risk_reasons: [...new Set(risky.flatMap((item) => item.reasons))].slice(0, 6),
    risky_links: risky.slice(0, 4)
  };
}
