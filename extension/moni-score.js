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

  // Helper to extract Moni score from a node
  function extractScoreFromNode(node) {
    if (!node) return null;
    // Look for elements that might contain the Moni Score
    // Moni extension typically injects elements with 'moni' in class or id
    const allElements = node.querySelectorAll('*');
    for (let el of allElements) {
      const text = el.innerText || '';
      const html = el.innerHTML || '';
      
      // Heuristic: check if this specific element looks like the Moni Score badge
      // Often it's a number right next to a Moni logo or has a tooltip "Moni Score"
      if (el.className && typeof el.className === 'string' && el.className.toLowerCase().includes('moni')) {
         // check if it's the score element
         if (text.trim().match(/^[0-9,]+$/)) {
             return parseInt(text.replace(/,/g, ''), 10);
         }
      }
      
      // Also look for specific aria-labels or titles
      const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
      if (title.toLowerCase().includes('moni score')) {
         let match = title.match(/(\d[\d,]*)/);
         if (match) return parseInt(match[1].replace(/,/g, ''), 10);
         
         match = text.match(/(\d[\d,]*)/);
         if (match) return parseInt(match[1].replace(/,/g, ''), 10);
      }
    }
    
    // Fallback: look for text "Moni Score" or "Moni" nearby
    for (let el of allElements) {
       const text = el.innerText || '';
       if (text.includes('Moni Score')) {
          const match = text.match(/Moni\s*Score[\s:]*([0-9,]+)/i);
          if (match) return parseInt(match[1].replace(/,/g, ''), 10);
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
      let score = extractScoreFromNode(tweetNode);
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
