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

  function extractMoniFromText(text) {
     if (!text) return null;
     // Look for explicit Moni patterns: [954] 🟢, (954) 🟡, 954 🔴, etc.
     const match = text.match(/(?:\[|\()?(\d{2,6})(?:\]|\))?\s*[🟢🟡🔴🟣💎]/);
     if (match) return parseInt(match[1], 10);
     return null;
  }

  function extractMoniFromDOM(rootNode) {
     if (!rootNode) return null;
     
     // 1. Text-based detection (most robust if emojis are used)
     const textScore = extractMoniFromText(rootNode.innerText);
     if (textScore !== null) return textScore;

     // 2. Class/Title based detection
     const moniNodes = rootNode.querySelectorAll('[class*="moni" i], [title*="moni" i], [aria-label*="moni" i]');
     for (let node of moniNodes) {
         const match = node.innerText.match(/\b(\d{1,6})\b/);
         if (match) return parseInt(match[1], 10);
     }
     
     // 3. Structural detection for third-party badges (e.g. purple pill with "58")
     // Third-party extensions inject elements without native X 'css-...' auto-generated classes.
     // We look for any leaf node that contains purely a number and lacks X classes.
     let possibleScores = [];
     const allElements = rootNode.querySelectorAll('*');
     for (let el of allElements) {
         if (el.children.length === 0) {
             const txt = (el.innerText || el.textContent || '').trim();
             if (/^\d{1,6}$/.test(txt)) {
                 const hasTwitterClass = Array.from(el.classList).some(c => c.startsWith('css-'));
                 if (!hasTwitterClass) {
                     possibleScores.push(parseInt(txt, 10));
                 }
             }
         }
     }
     if (possibleScores.length > 0) return possibleScores[possibleScores.length - 1];
     
     return null;
  }

  function resolveScore() {
    let score = null;
    
    // Strategy 1: Open Tweet or Feed Tweet (tweetNode provided)
    if (tweetNode) {
       const authorBlock = tweetNode.querySelector('[data-testid="User-Name"]');
       if (authorBlock) {
           score = extractMoniFromDOM(authorBlock);
       }
    }
    
    // Strategy 2: Profile Page Header
    if (score === null && window.location.pathname.toLowerCase() === `/${username.toLowerCase()}`) {
       const profileHeader = document.querySelector('[data-testid="UserProfileHeader_Items"]')?.parentElement;
       if (profileHeader) {
           score = extractMoniFromDOM(profileHeader);
       }
    }
    
    // Strategy 3: Any Author Cell Globally (fallback)
    if (score === null) {
        const userLinks = document.querySelectorAll(`a[href="/${username}" i]`);
        for (let link of userLinks) {
           let container = link.closest('[data-testid="User-Name"], [data-testid="UserCell"]');
           if (container) {
               score = extractMoniFromDOM(container);
               if (score !== null) break;
           }
        }
    }
    
    return score;
  }

  // Wait for Moni to inject its DOM elements. 
  // We'll use a short polling mechanism (up to 1.5 seconds) since MutationObserver setup might miss it if already injected.
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 15; // 15 * 100ms = 1.5s
    
    const tryExtract = () => {
      let score = resolveScore();
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
