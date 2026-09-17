export async function getProjectAlertStatus(db, projectKey, tweetId, username, hours = 48, maxAuthors = 3, isXList = false, opportunityType = null) {
  if (!projectKey) return null;

  const safeHours = Number.isFinite(Number(hours)) ? Math.max(1, Math.min(168, Number(hours))) : 48;
  const authorKey = String(username || '').trim().toLowerCase() || '__unknown__';
  
  const eventFilter = isXList && opportunityType ? ` AND opportunity_type = '${opportunityType}'` : '';

  const sameAuthor = await db.prepare(`
      SELECT tweet_id, tweet_url, username, display_name, score, detected_at
      FROM tweets
      WHERE project_key = ?
        AND tweet_id != ?
        AND COALESCE(NULLIF(lower(username), ''), '__unknown__') = ?
        AND sent_to_telegram = 1
        AND datetime(detected_at) >= datetime('now', ?)
        ${eventFilter}
      ORDER BY score DESC, detected_at DESC
      LIMIT 1
    `).bind(projectKey, tweetId, authorKey, `-${safeHours} hours`).first()
  ;

  if (sameAuthor) {
    return { ok: false, reason: 'same_author_project_duplicate', duplicate: sameAuthor };
  }

  const authorRows = await db.prepare(`
    SELECT COALESCE(NULLIF(lower(username), ''), '__unknown__') AS author_key, MAX(score) AS max_score, MAX(detected_at) AS latest_detected
    FROM tweets
    WHERE project_key = ?
      AND tweet_id != ?
      AND sent_to_telegram = 1
      AND datetime(detected_at) >= datetime('now', ?)
      ${eventFilter}
    GROUP BY COALESCE(NULLIF(lower(username), ''), '__unknown__')
    ORDER BY latest_detected DESC
  `).bind(projectKey, tweetId, `-${safeHours} hours`).first();

  const distinctAuthors = authorRows?.author_key ? await db.prepare(`
    SELECT COUNT(*) AS count
    FROM (
      SELECT COALESCE(NULLIF(lower(username), ''), '__unknown__') AS author_key
      FROM tweets
      WHERE project_key = ?
        AND tweet_id != ?
        AND sent_to_telegram = 1
        AND datetime(detected_at) >= datetime('now', ?)
        ${eventFilter}
      GROUP BY COALESCE(NULLIF(lower(username), ''), '__unknown__')
    )
  `).bind(projectKey, tweetId, `-${safeHours} hours`).first() : { count: 0 };

  const count = distinctAuthors?.count || 0;
  if (count >= maxAuthors) {
    return { ok: false, reason: 'project_author_limit', author_count: count, duplicate: authorRows };
  }

  return { ok: true, author_count: count };
}
