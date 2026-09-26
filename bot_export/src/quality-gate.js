function toNumber(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function passesQualityGate(data) {
  const filter = data.quality_filter;
  if (!filter || typeof filter !== 'object') return true;

  const moniFilterEnabled = filter.moniFilterEnabled !== false;
  const moniFilterMinScore = toNumber(filter.moniFilterMinScore, 1000);
  const moniFilterIfUnavailable = filter.moniFilterIfUnavailable || 'reject';
  const minFollowers = toNumber(filter.minFollowers, 0);

  const moniScore = data.moni_score;
  const followerCount = data.follower_count;

  const passFollowers = minFollowers > 0
    && followerCount !== null
    && followerCount !== undefined
    && Number(followerCount) >= minFollowers;

  let passMoni = false;
  if (moniFilterEnabled) {
    passMoni = (moniScore !== null && moniScore !== undefined && Number(moniScore) >= moniFilterMinScore)
      || (moniScore === null && moniFilterIfUnavailable === 'allow');
  }

  const bothDisabled = !moniFilterEnabled && minFollowers === 0;
  return bothDisabled || passFollowers || passMoni;
}
