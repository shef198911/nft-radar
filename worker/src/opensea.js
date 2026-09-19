const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
const OPENSEA_WEB_BASE = 'https://opensea.io/collection';
const DEFAULT_DROP_LIMIT = 30;
const DEFAULT_MIN_SCORE = 65;

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntSetting(value, fallback, max = 100) {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function pick(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function getSlug(drop) {
  return pick(
    drop.collectionSlug,
    drop.collection_slug,
    drop.slug,
    drop.collection?.slug,
    drop.collection?.collection_slug
  );
}

function getName(drop) {
  return pick(
    drop.collectionName,
    drop.collection_name,
    drop.name,
    drop.title,
    drop.collection?.name,
    drop.collection?.collection_name
  );
}

function getChain(drop) {
  const chain = pick(
    drop.chain,
    drop.chainName,
    drop.chain_name,
    drop.network,
    drop.blockchain,
    drop.collection?.chain,
    drop.collection?.chain_identifier
  );
  if (!chain || typeof chain !== 'object') return chain || 'Unknown';
  return pick(chain.identifier, chain.name, chain.slug, chain.chain);
}

function getImage(drop) {
  return pick(
    drop.imageUrl,
    drop.image_url,
    drop.bannerImageUrl,
    drop.banner_image_url,
    drop.collection?.image_url,
    drop.collection?.banner_image_url
  );
}

function getDescription(drop) {
  return pick(drop.description, drop.collection?.description, drop.projectDescription);
}

function getSocialLinks(drop) {
  const social = drop.socials || drop.social_links || drop.collection?.socials || {};
  const links = [
    drop.externalUrl,
    drop.external_url,
    drop.projectUrl,
    drop.project_url,
    drop.website,
    drop.collection?.external_url,
    social.website,
    social.twitter,
    social.discord,
    social.x
  ];

  return links.filter((link) => typeof link === 'string' && /^https?:\/\//i.test(link));
}

function getStages(drop) {
  return asArray(pick(drop.stages, drop.phases, drop.mintStages, drop.mint_stages, drop.saleStages, drop.sale_stages));
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatWei(str) {
  try {
    const num = BigInt(str);
    if (num === 0n) return '0';
    const ether = Number(num) / 1e18;
    return ether.toString();
  } catch (e) {
    return str;
  }
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    let amount = pick(value.amount, value.value, value.quantity, value.decimal, value.native);
    const currency = pick(value.currency, value.symbol, value.token?.symbol);
    if (amount !== null && amount !== undefined) {
      amount = String(amount);
      if (amount.length > 8 && /^\d+$/.test(amount)) {
        amount = formatWei(amount);
      }
      if (currency) return `${amount} ${currency}`.toUpperCase();
      return amount;
    }
    return null;
  }
  let text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length > 8 && /^\d+$/.test(text)) {
    text = formatWei(text);
  }
  return text ? text.toUpperCase() : null;
}

function isFreePrice(price) {
  if (!price) return false;
  const text = String(price).toLowerCase();
  return text === 'free'
    || /\bfree\b/.test(text)
    || /^0(?:\.0+)?(?:\s|$)/.test(text)
    || /\b0(?:\.0+)?\s*(eth|sol|matic|avax|bnb|usdc)\b/i.test(text);
}

function isPaidPrice(price) {
  if (!price || isFreePrice(price)) return false;
  return /(?:0?\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)\s*(eth|sol|matic|avax|bnb|usdc)?/i.test(String(price));
}

function stageLabel(stage) {
  return cleanText(pick(stage.label, stage.name, stage.stageName, stage.stage_name, stage.type, stage.kind), 36) || 'Stage';
}

function stagePrice(stage) {
  return formatPrice(pick(
    stage.price,
    stage.mintPrice,
    stage.mint_price,
    stage.pricePerToken,
    stage.price_per_token,
    stage.fee
  ));
}

function stageStart(stage) {
  return normalizeDate(pick(stage.startTime, stage.start_time, stage.startsAt, stage.starts_at, stage.start));
}

function stageEnd(stage) {
  return normalizeDate(pick(stage.endTime, stage.end_time, stage.endsAt, stage.ends_at, stage.end));
}

function stageMaxPerWallet(stage) {
  return pick(stage.maxPerWallet, stage.max_per_wallet, stage.walletLimit, stage.wallet_limit, stage.limitPerWallet);
}

function collectUrls(value, out = []) {
  if (!value || out.length >= 8) return out;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/url|link|website|mint|allow|white|discord|twitter|x/i.test(key)) collectUrls(item, out);
    }
  }
  return out;
}

function classifyStage(stage) {
  const label = stageLabel(stage);
  const lower = label.toLowerCase();
  const price = stagePrice(stage);
  const urls = [...new Set(collectUrls(stage))];

  const isWhitelist = /\b(wl|white\s*list|whitelist|allow\s*list|allowlist|presale|pre-sale|fcfs|gtd|guaranteed)\b/i.test(lower)
    || Boolean(stage.allowlist || stage.allow_list || stage.merkleRoot || stage.merkle_root || stage.eligibility);

  const isPublic = /\bpublic\b/i.test(lower) || (!isWhitelist && !/\bteam|reserve|owner\b/i.test(lower));

  return {
    label,
    price,
    start_at: stageStart(stage),
    end_at: stageEnd(stage),
    max_per_wallet: stageMaxPerWallet(stage),
    is_free: isFreePrice(price),
    is_paid: isPaidPrice(price),
    is_whitelist: isWhitelist,
    is_public: isPublic,
    links: urls
  };
}

function dateDistanceHours(dateIso, nowMs) {
  if (!dateIso) return null;
  const ms = new Date(dateIso).getTime();
  if (!Number.isFinite(ms)) return null;
  return (ms - nowMs) / (1000 * 60 * 60);
}

function currentStatus(phases, sourceType, nowMs) {
  const live = phases.some((phase) => {
    const start = phase.start_at ? new Date(phase.start_at).getTime() : null;
    const end = phase.end_at ? new Date(phase.end_at).getTime() : null;
    return (!start || start <= nowMs) && (!end || end >= nowMs);
  });
  if (live) return 'live';

  const futureStarts = phases
    .map((phase) => phase.start_at)
    .filter(Boolean)
    .map((date) => new Date(date).getTime())
    .filter((ms) => Number.isFinite(ms) && ms > nowMs);

  if (futureStarts.length) return 'upcoming';
  if (sourceType === 'recently_minted') return 'recently_minted';
  return sourceType || 'unknown';
}

function isTargetChain(drop) {
  const haystack = `${drop.chain || ''} ${drop.name || ''} ${drop.description || ''}`.toLowerCase();
  return haystack.includes('solana')
    || /\bsol\b/.test(haystack)
    || haystack.includes('robinhood')
    || haystack.includes('rh chain')
    || /\barc\b/.test(haystack)
    || haystack.includes('arc chain');
}

function hasBlockedText(drop) {
  const haystack = `${drop.name || ''} ${drop.description || ''}`.toLowerCase();
  return /\b(test|testing|demo|mint bot|free mint bot|holder gated|holders only|casino|gamble|gambling|betting|poker|slots|roulette|blackjack|lottery|jackpot|казино|ставки|рулетка)\b/i.test(haystack);
}

function summarizePhases(phases) {
  if (!phases.length) return null;
  return phases.slice(0, 4).map((phase) => {
    const bits = [phase.label];
    if (phase.price) bits.push(phase.price);
    if (phase.max_per_wallet) bits.push(`max ${phase.max_per_wallet}/wallet`);
    if (phase.start_at) bits.push(new Date(phase.start_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
    return '- ' + bits.join(' · ');
  }).join('\n');
}

function firstPhaseLink(phases, matcher) {
  for (const phase of phases) {
    if (!matcher(phase)) continue;
    const link = phase.links.find((url) => !/opensea\.io/i.test(url));
    if (link) return link;
  }
  return null;
}

function calculateOpenSeaScore(drop) {
  let score = 15;
  const nowMs = Date.now();
  const nextStart = drop.starts_at;
  const hoursToStart = dateDistanceHours(nextStart, nowMs);

  if (drop.source_type === 'featured') score += 20;
  if (drop.status === 'live') score += 20;
  else if (hoursToStart !== null && hoursToStart >= 0 && hoursToStart <= 24) score += 15;
  else if (hoursToStart !== null && hoursToStart > 24 && hoursToStart <= 72) score += 10;

  if (drop.is_target_chain) score += 15;
  if (drop.category === 'free') score += 18;
  if (drop.category === 'whitelist') score += 12;
  if (drop.has_public_phase) score += 5;
  if (drop.has_phase_details) score += 8;
  if (drop.social_count > 0) score += 6;
  if (drop.image_url) score += 4;
  if (drop.description) score += 4;

  if (drop.max_supply && drop.max_supply > 0 && drop.max_supply <= 10000) score += 5;
  if (drop.total_supply && drop.max_supply && drop.max_supply > 0) {
    const mintedRatio = drop.total_supply / drop.max_supply;
    if (mintedRatio > 0.05 && mintedRatio < 0.95) score += 8;
  }

  if (drop.category === 'paid' && !drop.is_target_chain && drop.source_type !== 'featured') score -= 15;
  if (drop.is_blocked_text) score -= 40;
  if (!drop.is_target_chain && String(drop.target_only) !== '0') score -= 35;

  return Math.max(0, Math.min(100, score));
}

export async function ensureOpenSeaDropsTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS opensea_drops (
      slug TEXT PRIMARY KEY,
      name TEXT,
      opensea_url TEXT,
      chain TEXT,
      source_type TEXT,
      status TEXT,
      category TEXT,
      score INTEGER DEFAULT 0,
      price TEXT,
      phase_summary TEXT,
      whitelist_url TEXT,
      public_url TEXT,
      starts_at TEXT,
      ends_at TEXT,
      total_supply INTEGER,
      max_supply INTEGER,
      minted_count INTEGER,
      image_url TEXT,
      raw_json TEXT,
      sent_to_telegram INTEGER DEFAULT 0,
      telegram_message_id TEXT,
      detected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_opensea_drops_score ON opensea_drops(score)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_opensea_drops_detected ON opensea_drops(detected_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_opensea_drops_sent ON opensea_drops(sent_to_telegram)').run();
}

async function ensureOpenSeaAuthTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS opensea_api_keys (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
}

export async function ensureOpenSeaStatusTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS opensea_scan_status (
      id TEXT PRIMARY KEY,
      ok INTEGER DEFAULT 0,
      status TEXT,
      reason TEXT,
      error TEXT,
      drops_count INTEGER DEFAULT 0,
      sendable_count INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      last_scan_at TEXT NOT NULL
    )
  `).run();
}

export async function recordOpenSeaScanStatus(db, result, sentCount = 0) {
  await ensureOpenSeaStatusTable(db);
  const ok = result?.ok ? 1 : 0;
  const status = result?.ok ? 'ok' : (result?.skipped ? 'skipped' : 'error');

  await db.prepare(`
    INSERT OR REPLACE INTO opensea_scan_status (
      id, ok, status, reason, error, drops_count, sendable_count, sent_count, last_scan_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    'latest',
    ok,
    status,
    result?.reason || null,
    result?.error || null,
    result?.count || 0,
    result?.sendable_count || 0,
    sentCount || result?.sent_count || 0,
    new Date().toISOString()
  ).run();
}

export async function getOpenSeaScanStatus(db) {
  await ensureOpenSeaStatusTable(db);
  await ensureOpenSeaDropsTable(db);
  await ensureOpenSeaAuthTable(db);

  const status = await db.prepare('SELECT * FROM opensea_scan_status WHERE id = ?')
    .bind('latest')
    .first();
  const key = await db.prepare('SELECT expires_at FROM opensea_api_keys WHERE id = ?')
    .bind('instant')
    .first();
  const latestDrop = await db.prepare('SELECT MAX(updated_at) AS latest_drop_at, COUNT(*) AS drops_total FROM opensea_drops')
    .first();

  if (!status) {
    return {
      ok: false,
      status: 'unknown',
      reason: 'no_scan_yet',
      error: null,
      last_scan_at: null,
      drops_count: 0,
      sendable_count: 0,
      sent_count: 0,
      drops_total: latestDrop?.drops_total || 0,
      latest_drop_at: latestDrop?.latest_drop_at || null,
      key_expires_at: key?.expires_at || null
    };
  }

  return {
    ok: status.ok === 1,
    status: status.status,
    reason: status.reason,
    error: status.error,
    last_scan_at: status.last_scan_at,
    drops_count: status.drops_count || 0,
    sendable_count: status.sendable_count || 0,
    sent_count: status.sent_count || 0,
    drops_total: latestDrop?.drops_total || 0,
    latest_drop_at: latestDrop?.latest_drop_at || null,
    key_expires_at: key?.expires_at || null
  };
}

async function getOpenSeaApiKey(env) {
  if (env.OPENSEA_API_KEY) return env.OPENSEA_API_KEY;

  await ensureOpenSeaAuthTable(env.DB);
  const existing = await env.DB.prepare('SELECT api_key, expires_at FROM opensea_api_keys WHERE id = ?')
    .bind('instant')
    .first();

  const minValidUntil = Date.now() + (6 * 60 * 60 * 1000);
  if (existing?.api_key && existing?.expires_at && new Date(existing.expires_at).getTime() > minValidUntil) {
    return existing.api_key;
  }

  const response = await fetch(`${OPENSEA_API_BASE}/auth/keys`, {
    method: 'POST',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenSea auth ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const apiKey = data.api_key || data.apiKey || data.key;
  const expiresAt = data.expires_at || data.expiresAt;

  if (!apiKey || !expiresAt) {
    throw new Error('OpenSea auth response did not include api_key/expires_at');
  }

  await env.DB.prepare(`
    INSERT OR REPLACE INTO opensea_api_keys (id, api_key, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).bind('instant', apiKey, normalizeDate(expiresAt), new Date().toISOString()).run();

  return apiKey;
}

async function fetchOpenSeaJson(path, apiKey) {
  const response = await fetch(`${OPENSEA_API_BASE}${path}`, {
    headers: {
      'Accept': 'application/json',
      'X-API-KEY': apiKey
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenSea ${response.status}: ${body.slice(0, 200)}`);
  }

  return await response.json();
}

function extractDrops(data) {
  return asArray(data?.drops || data?.results || data?.data || data);
}

function normalizeDrop(listDrop, detailDrop, sourceType, options = {}) {
  const detail = detailDrop?.drop || detailDrop?.result || detailDrop?.data || detailDrop || {};
  const merged = { ...(listDrop || {}), ...detail };
  const slug = getSlug(merged);
  if (!slug) return null;

  const phases = getStages(merged).map(classifyStage);
  const starts = phases.map((phase) => phase.start_at).filter(Boolean).sort();
  const ends = phases.map((phase) => phase.end_at).filter(Boolean).sort();
  const hasWhitelistPhase = phases.some((phase) => phase.is_whitelist);
  const hasFreePublicPhase = phases.some((phase) => phase.is_public && phase.is_free);
  const hasPaidPhase = phases.some((phase) => phase.is_paid);
  const price = pick(
    phases.find((phase) => phase.is_public)?.price,
    phases.find((phase) => phase.price)?.price,
    formatPrice(pick(merged.price, merged.mintPrice, merged.mint_price))
  );

  let category = 'paid';
  if (hasWhitelistPhase) category = 'whitelist';
  else if (hasFreePublicPhase || isFreePrice(price)) category = 'free';
  else if (!hasPaidPhase && !price) category = 'unknown';

  const totalSupply = toNumber(pick(merged.totalSupply, merged.total_supply, merged.mintedSupply, merged.minted_supply, merged.minted));
  const maxSupply = toNumber(pick(merged.maxSupply, merged.max_supply, merged.supply, merged.totalItems, merged.total_items));
  const name = cleanText(getName(merged) || slug, 80);
  const chain = cleanText(getChain(merged) || 'Unknown', 40);
  const description = cleanText(getDescription(merged) || '', 260);
  const socialLinks = getSocialLinks(merged);
  const openseaUrl = pick(merged.openseaUrl, merged.opensea_url, merged.url, `${OPENSEA_WEB_BASE}/${slug}`);

  const normalized = {
    slug,
    name,
    opensea_url: openseaUrl,
    chain,
    source_type: sourceType,
    status: currentStatus(phases, sourceType, Date.now()),
    category,
    price: price || (category === 'free' ? 'FREE' : null),
    phase_summary: summarizePhases(phases),
    whitelist_url: firstPhaseLink(phases, (phase) => phase.is_whitelist),
    public_url: firstPhaseLink(phases, (phase) => phase.is_public),
    starts_at: starts[0] || null,
    ends_at: ends[ends.length - 1] || null,
    total_supply: totalSupply,
    max_supply: maxSupply,
    minted_count: totalSupply,
    image_url: getImage(merged) || null,
    description,
    has_phase_details: phases.length > 0,
    has_public_phase: phases.some((phase) => phase.is_public),
    social_count: socialLinks.length,
    is_target_chain: false,
    is_blocked_text: false,
    target_only: options.targetOnly ? '1' : '0',
    raw_json: JSON.stringify({ list: listDrop, detail: detailDrop }).slice(0, 12000)
  };

  normalized.is_target_chain = isTargetChain(normalized);
  normalized.is_blocked_text = hasBlockedText(normalized);
  normalized.score = calculateOpenSeaScore(normalized);

  return normalized;
}

export async function saveOpenSeaDrop(db, drop) {
  await ensureOpenSeaDropsTable(db);
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT sent_to_telegram, telegram_message_id, detected_at FROM opensea_drops WHERE slug = ?')
    .bind(drop.slug)
    .first();

  await db.prepare(`
    INSERT OR REPLACE INTO opensea_drops (
      slug, name, opensea_url, chain, source_type, status, category, score,
      price, phase_summary, whitelist_url, public_url, starts_at, ends_at,
      total_supply, max_supply, minted_count, image_url, raw_json,
      sent_to_telegram, telegram_message_id, detected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    drop.slug,
    drop.name,
    drop.opensea_url,
    drop.chain,
    drop.source_type,
    drop.status,
    drop.category,
    drop.score,
    drop.price,
    drop.phase_summary,
    drop.whitelist_url,
    drop.public_url,
    drop.starts_at,
    drop.ends_at,
    drop.total_supply,
    drop.max_supply,
    drop.minted_count,
    drop.image_url,
    drop.raw_json,
    existing?.sent_to_telegram || 0,
    existing?.telegram_message_id || null,
    existing?.detected_at || now,
    now
  ).run();

  return {
    ...drop,
    sent_to_telegram: existing?.sent_to_telegram || 0,
    telegram_message_id: existing?.telegram_message_id || null,
    detected_at: existing?.detected_at || now
  };
}

export async function markOpenSeaDropSent(db, slug, telegramMessageId) {
  await ensureOpenSeaDropsTable(db);
  await db.prepare(`
    UPDATE opensea_drops
    SET sent_to_telegram = 1, telegram_message_id = ?, updated_at = ?
    WHERE slug = ?
  `).bind(telegramMessageId || null, new Date().toISOString(), slug).run();
}

export async function scanOpenSeaDrops(env, options = {}) {
  let apiKey;
  try {
    apiKey = await getOpenSeaApiKey(env);
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      reason: 'opensea_auth_failed',
      error: error.message,
      drops: [],
      sendable: []
    };
  }

  const limit = parseIntSetting(env.OPENSEA_DROP_LIMIT, DEFAULT_DROP_LIMIT);
  const minScore = parseIntSetting(env.OPENSEA_MIN_SCORE, DEFAULT_MIN_SCORE, 100);
  const targetOnly = env.OPENSEA_TARGET_ONLY !== '0';
  const types = String(env.OPENSEA_DROP_TYPES || 'featured,upcoming')
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean);

  await ensureOpenSeaDropsTable(env.DB);

  const bySlug = new Map();
  for (const type of types) {
    const data = await fetchOpenSeaJson(`/drops?type=${encodeURIComponent(type)}&limit=${limit}`, apiKey);
    for (const drop of extractDrops(data)) {
      const slug = getSlug(drop);
      if (!slug || bySlug.has(slug)) continue;
      bySlug.set(slug, { drop, type });
    }
  }

  const saved = [];
  const errors = [];
  for (const { drop, type } of bySlug.values()) {
    const slug = getSlug(drop);
    let detail = null;
    try {
      detail = await fetchOpenSeaJson(`/drops/${encodeURIComponent(slug)}`, apiKey);
    } catch (error) {
      errors.push({ slug, error: error.message });
    }

    const normalized = normalizeDrop(drop, detail, type, { targetOnly });
    if (!normalized) continue;
    const stored = options.dryRun ? normalized : await saveOpenSeaDrop(env.DB, normalized);
    saved.push(stored);
  }

  const sendable = saved.filter((drop) => {
    if (drop.sent_to_telegram) return false;
    if (drop.score < minScore) return false;
    if (drop.is_blocked_text) return false;
    
    // Ignore ended/sold out drops
    if (drop.max_supply > 0 && drop.total_supply >= drop.max_supply) return false;
    if (drop.ends_at && new Date(drop.ends_at).getTime() < Date.now()) return false;
    if (drop.status === 'past') return false;

    return ['free', 'whitelist', 'paid'].includes(drop.category);
  }).sort((a, b) => b.score - a.score).slice(0, parseIntSetting(env.OPENSEA_MAX_ALERTS_PER_SCAN, 5, 20));

  return {
    ok: true,
    dry_run: Boolean(options.dryRun),
    count: saved.length,
    sendable_count: sendable.length,
    drops: saved,
    sendable,
    errors
  };
}

export function formatOpenSeaDropMessage(drop) {
  const categoryLabel = drop.category === 'free' ? 'FREE' : (drop.category === 'whitelist' ? 'WHITELIST' : 'PAID');
  let msg = `<b>🌊 OpenSea Drop</b> | <b>${escapeHTML(categoryLabel)}</b>\n\n`;
  msg += `📦 <b>Project:</b> ${escapeHTML(drop.name)}\n`;
  if (drop.chain && drop.chain !== 'Unknown') msg += `⛓️ <b>Chain:</b> ${escapeHTML(drop.chain)}\n`;
  if (drop.status) msg += `📍 <b>Status:</b> ${escapeHTML(drop.status)}\n`;
  if (drop.price) msg += `💰 <b>Price:</b> ${escapeHTML(drop.price)}\n`;
  if (drop.starts_at) msg += `📅 <b>Start:</b> ${escapeHTML(drop.starts_at.replace('T', ' ').slice(0, 16))} UTC\n`;
  if (drop.max_supply) msg += `📊 <b>Supply:</b> ${drop.total_supply || 0}/${drop.max_supply}\n`;
  if (drop.phase_summary) msg += `🎯 <b>Mint phases:</b>\n${escapeHTML(drop.phase_summary)}\n`;
  if (drop.whitelist_url) msg += `🔗 <b>Whitelist:</b> <a href="${escapeHTML(drop.whitelist_url)}">link</a>\n`;
  if (drop.public_url) msg += `🔗 <b>Public:</b> <a href="${escapeHTML(drop.public_url)}">link</a>\n`;
  msg += `⭐ <b>OpenSea Score:</b> ${drop.score}/100\n\n`;
  msg += `<a href="${escapeHTML(drop.opensea_url)}">&#8203;</a>`;
  return msg;
}

export async function queryOpenSeaSummary(db, startIso, endIso, limit = 10) {
  await ensureOpenSeaDropsTable(db);

  async function queryCategory(category) {
    const { results } = await db.prepare(`
      SELECT slug, name, opensea_url, chain, category, score, price, phase_summary,
             whitelist_url, public_url, starts_at, status, detected_at
      FROM opensea_drops
      WHERE sent_to_telegram = 1
        AND datetime(detected_at) >= datetime(?)
        AND datetime(detected_at) < datetime(?)
        AND category = ?
      ORDER BY score DESC, datetime(detected_at) DESC
      LIMIT ?
    `).bind(startIso, endIso, category, limit).all();

    return results || [];
  }

  const [free, whitelist, paid] = await Promise.all([
    queryCategory('free'),
    queryCategory('whitelist'),
    queryCategory('paid')
  ]);

  return { free, whitelist, paid };
}
