// queue.js - Local queue logic and helper utilities for NFT Radar extension
// Most queue scheduling is driven by service-worker.js

function findNextReadyItem(queue, now = Date.now()) {
  if (!Array.isArray(queue)) return null;
  const pending = queue.filter(item => item && item.status !== 'failed');
  return pending.find(item => now >= (item.nextRetry || 0)) || null;
}

function calculateBackoffDelay(retryCount) {
  const delays = [2000, 5000, 15000, 30000, 60000];
  const count = typeof retryCount === 'number' && retryCount > 0 ? retryCount : 1;
  return delays[count - 1] || 60000;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findNextReadyItem, calculateBackoffDelay };
}
