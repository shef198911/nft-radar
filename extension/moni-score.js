const MONI_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
if (typeof window !== 'undefined' && !window.moniScoreCache) {
  window.moniScoreCache = {};
}

async function getMoniScore(username, tweetNode) {
  if (!username) return null;
  const now = Date.now();
  
  if (window.moniScoreCache[username]) {
    const cached = window.moniScoreCache[username];
    if (now - cached.checkedAt < MONI_CACHE_TTL_MS) {
      return cached.score;
    }
  }

  // Helper to extract Moni score globally for a specific username
  function extractScoreGlobally() {
    const allElements = document.querySelectorAll('*');
    for (let el of allElements) {
      const text = el.innerText || '';
      
      // Look for Moni logo/class
      if (el.className && typeof el.className === 'string' && el.className.toLowerCase().includes('moni')) {
         if (text.trim().match(/^[0-9,]+$/)) {
             const score = parseInt(text.replace(/,/g, ''), 10);
             // Verify it belongs to the user
             let parent = el.parentElement;
             let foundUser = false;
             for (let i = 0; i < 6 && parent; i++) {
                if (parent.innerText && parent.innerText.toLowerCase().includes(username.toLowerCase())) {
                   foundUser = true; break;
                }
                parent = parent.parentElement;
             }
             if (foundUser || tweetNode.contains(el)) return score;
         }
      }
      
      const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
      if (title.toLowerCase().includes('moni score')) {
         let match = title.match(/(\d[\d,]*)/);
         let score = null;
         if (match) score = parseInt(match[1].replace(/,/g, ''), 10);
         else {
           match = text.match(/(\d[\d,]*)/);
           if (match) score = parseInt(match[1].replace(/,/g, ''), 10);
         }
         if (score !== null) {
             let parent = el.parentElement;
             let foundUser = false;
             for (let i = 0; i < 8 && parent; i++) {
                if (parent.innerText && parent.innerText.toLowerCase().includes(username.toLowerCase())) {
                   foundUser = true; break;
                }
                parent = parent.parentElement;
             }
             if (foundUser || tweetNode.contains(el)) return score;
         }
      }
    }
    return null;
  }

  // Wait for Moni to inject its DOM elements. 
  // We'll use a short polling mechanism (up to 1.5 seconds) since MutationObserver setup might miss it if already injected.
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 15; // 15 * 100ms = 1.5s
    
    const tryExtract = () => {
      let score = extractScoreGlobally();
      if (score !== null) {
        window.moniScoreCache[username] = { score, checkedAt: Date.now() };
        resolve(score);
        return;
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        // Cache as null to avoid re-polling constantly for users without a score
        window.moniScoreCache[username] = { score: null, checkedAt: Date.now() };
        resolve(null);
      } else {
        setTimeout(tryExtract, 100);
      }
    };
    
    tryExtract();
  });
}

if (typeof window !== 'undefined') window.getMoniScore = getMoniScore;
