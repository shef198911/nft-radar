export async function checkDuplicate(db, tweet_id) {
  return await db.prepare('SELECT id, sent_to_telegram FROM tweets WHERE tweet_id = ?').bind(tweet_id).first();
}

export async function saveTweet(db, data) {
  const detected_at = new Date().toISOString();
  await db.prepare(`
    INSERT INTO tweets (
      tweet_id, tweet_url, username, display_name, text,
      detected_at, score, priority, project_key, chain,
      mint_type, opportunity_type, mint_date, mint_time, mint_time_raw, project_name, supply, price, follower_count,
      link_risk_level, link_risk_score, link_risk_reasons,
      is_free, is_whitelist, is_allowlist, is_fcfs, is_gtd, is_robinhood,
      moni_score, wl_spots, is_giveaway, is_raffle, is_wl_giveaway, is_wl_raffle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.tweet_id, data.tweet_url, data.username, data.display_name, data.text,
    detected_at, data.score, data.priority, data.username, data.chain,
    data.mint_type, data.opportunity_type, data.mint_date, data.mint_time, data.mint_time_raw, data.project_name, data.supply, data.price, data.follower_count || null,
    data.link_risk_level || 'OK', data.link_risk_score || 0, JSON.stringify(data.link_risk_reasons || []),
    data.is_free, data.is_whitelist, data.is_allowlist, data.is_fcfs, data.is_gtd, data.is_robinhood,
    data.moni_score, data.wl_spots, data.is_giveaway, data.is_raffle, data.is_wl_giveaway, data.is_wl_raffle
  ).run();
}

export async function markSent(db, tweet_id, message_id) {
  await db.prepare('UPDATE tweets SET sent_to_telegram = 1, telegram_message_id = ? WHERE tweet_id = ?')
    .bind(String(message_id), tweet_id)
    .run();
}
