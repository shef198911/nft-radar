const SOCIAL_OR_OPAQUE_HOSTS = new Set([
  'x.com',
  'twitter.com',
  't.co',
  'discord.gg',
  'discord.com',
  't.me',
  'telegram.me',
  'linktr.ee',
  'beacons.ai',
  'bit.ly',
  'tinyurl.com',
  'cutt.ly',
  'shorturl.at',
  'rebrand.ly',
  'is.gd'
]);

const MARKETPLACE_PATH_RULES = {
  'magiceden.io': ['marketplace', 'launchpad', 'mint-terminal'],
  'tensor.trade': ['trade'],
  'opensea.io': ['collection'],
  'launchmynft.io': ['collections', 'mint'],
  'zora.co': ['collect'],
  'foundation.app': ['collection'],
  'rarible.com': ['collection']
};

function cleanHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function normalizeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function getPathSegments(url) {
  return url.pathname
    .split('/')
    .map((part) => normalizeSlug(part))
    .filter(Boolean);
}

function marketplaceKey(host, segments) {
  const rule = MARKETPLACE_PATH_RULES[host];
  if (!rule) return null;

  for (const marker of rule) {
    const index = segments.indexOf(marker);
    if (index !== -1 && segments[index + 1]) {
      return `market:${host}/${segments[index + 1]}`;
    }
  }

  if (segments.length >= 2) {
    return `market:${host}/${segments.slice(0, 2).join('/')}`;
  }

  return null;
}

function linkProjectKey(rawLink) {
  try {
    const url = new URL(rawLink);
    const host = cleanHost(url.hostname);
    if (!host || SOCIAL_OR_OPAQUE_HOSTS.has(host)) return null;

    const segments = getPathSegments(url);
    const marketKey = marketplaceKey(host, segments);
    if (marketKey) return marketKey;

    return `domain:${host}`;
  } catch (e) {
    return null;
  }
}

export function buildProjectKey(data) {
  const links = Array.isArray(data.links) ? data.links : [];
  for (const link of links) {
    const key = linkProjectKey(link);
    if (key) return key;
  }

  const projectName = normalizeSlug(data.project_name);
  if (projectName && projectName.length >= 3) {
    return `name:${projectName}:${normalizeSlug(data.chain || 'unknown')}`;
  }

  const username = normalizeSlug(data.username);
  if (username) {
    return `author:${username}:${normalizeSlug(data.chain || 'unknown')}`;
  }

  return `tweet:${data.tweet_id}`;
}
