const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanUsername(username) {
  return String(username || '').replace(/^@/, '').trim();
}

function formatDateLabel(date) {
  return date.toISOString().slice(0, 10);
}

function trimText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function getMskDayRange(now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const mskNow = new Date(nowMs + MSK_OFFSET_MS);
  const startUtcMs = Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate()) - MSK_OFFSET_MS;

  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(nowMs).toISOString(),
    summaryDate: formatDateLabel(mskNow)
  };
}

function normalizeRows(results) {
  return (results || []).map((row) => ({
    tweet_id: row.tweet_id,
    tweet_url: row.tweet_url,
    username: row.username,
    display_name: row.display_name,
    project_name: row.project_name,
    chain: row.chain,
    score: row.score || 0,
    price: row.price,
    detected_at: row.detected_at
  }));
}

async function queryTop(db, whereClause, startIso, endIso, limit = 10) {
  const { results } = await db.prepare(`
    SELECT
      tweet_id, tweet_url, username, display_name, project_name, chain,
      score, COALESCE(price, paid_price, public_price, whitelist_price) AS price, detected_at
    FROM tweets
    WHERE sent_to_telegram = 1
      AND datetime(detected_at) >= datetime(?)
      AND datetime(detected_at) < datetime(?)
      AND ${whereClause}
    ORDER BY score DESC, datetime(detected_at) DESC
    LIMIT ?
  `).bind(startIso, endIso, limit).all();

  return normalizeRows(results);
}

export async function buildDailySummary(db, now = new Date()) {
  const range = getMskDayRange(now);

  const [free, whitelist, paid] = await Promise.all([
    queryTop(db, 'COALESCE(is_free, 0) = 1', range.startIso, range.endIso),
    queryTop(db, `(COALESCE(is_free, 0) = 0 AND (
      COALESCE(is_free_whitelist, 0) = 1
      OR COALESCE(is_whitelist, 0) = 1
      OR COALESCE(is_allowlist, 0) = 1
    ))`, range.startIso, range.endIso),
    queryTop(db, `(COALESCE(is_free, 0) = 0
      AND COALESCE(is_free_whitelist, 0) = 0
      AND COALESCE(is_whitelist, 0) = 0
      AND COALESCE(is_allowlist, 0) = 0
      AND (
        paid_price IS NOT NULL
        OR (price IS NOT NULL AND upper(price) != 'FREE')
      ))`, range.startIso, range.endIso)
  ]);

  return {
    ...range,
    categories: { free, whitelist, paid },
    totalItems: free.length + whitelist.length + paid.length
  };
}

function itemLabel(item) {
  const project = trimText(item.project_name || item.display_name || item.username || 'Tweet', 42);
  const username = cleanUsername(item.username);
  const price = trimText(item.price, 38);
  const parts = [
    `<a href="${escapeHTML(item.tweet_url)}">${escapeHTML(project)}</a>`,
    `⭐ ${item.score}/100`
  ];

  if (username) parts.push(`@${escapeHTML(username)}`);
  if (item.chain && item.chain !== 'Unknown') parts.push(escapeHTML(item.chain));
  if (price && price !== 'FREE') parts.push(escapeHTML(price));

  return parts.join(' | ');
}

function formatCategory(title, items) {
  if (!items.length) return `${title}\nНет за сегодня\n`;

  const lines = items.map((item, index) => `${index + 1}. ${itemLabel(item)}`);
  return `${title}\n${lines.join('\n')}\n`;
}

export function formatDailySummaryMessage(summary) {
  const { summaryDate, categories } = summary;

  let msg = `<b>NFT Radar Daily Summary</b>\n`;
  msg += `<b>${escapeHTML(summaryDate)} MSK</b>\n`;
  msg += `Топ по Radar Score, только отправленные алерты.\n\n`;
  msg += formatCategory('🟢 <b>FREE</b>', categories.free);
  msg += '\n';
  msg += formatCategory('🎯 <b>WHITELIST</b>', categories.whitelist);
  msg += '\n';
  msg += formatCategory('💰 <b>PAID</b>', categories.paid);

  return msg.trim();
}

export async function ensureDailySummaryTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS daily_summaries (
      summary_date TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL,
      telegram_message_id TEXT
    )
  `).run();
}

export async function getDailySummaryRecord(db, summaryDate) {
  await ensureDailySummaryTable(db);
  return await db.prepare('SELECT summary_date, sent_at, telegram_message_id FROM daily_summaries WHERE summary_date = ?')
    .bind(summaryDate)
    .first();
}

export async function recordDailySummarySent(db, summaryDate, telegramMessageId) {
  await ensureDailySummaryTable(db);
  await db.prepare(`
    INSERT OR REPLACE INTO daily_summaries (summary_date, sent_at, telegram_message_id)
    VALUES (?, ?, ?)
  `).bind(summaryDate, new Date().toISOString(), telegramMessageId || null).run();
}
