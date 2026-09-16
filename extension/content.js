let observer = null;
let processedTweetIds = new Set();
const MAX_PROCESSED_IDS = 10000;
let debounceTimer = null;
let newTweetsInCurrentScroll = 0;

function parseTwitterNumber(str) {
    if (!str) return null;
    let s = str.toUpperCase().replace(/,/g, '').trim();
    let mult = 1;
    if (s.endsWith('K')) { mult = 1000; s = s.slice(0, -1); }
    if (s.endsWith('M')) { mult = 1000000; s = s.slice(0, -1); }
    const val = parseFloat(s);
    return isNaN(val) ? null : Math.floor(val * mult);
}

window.getFollowerCountViaHover = async function(username, articleNode) {
    const trigger = articleNode.querySelector(`a[href^="/${username}"]`);
    if (!trigger) return null;

    trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 20; 
        
        const check = () => {
            const followerLink = document.querySelector(`#layers a[href="/${username}/followers"]`);
            if (followerLink) {
                const text = followerLink.innerText || "";
                const match = text.match(/[\d,.]+[KMkm]?/);
                let count = null;
                if (match) count = parseTwitterNumber(match[0]);
                
                trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                
                setTimeout(() => resolve(count), 200);
                return;
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
                trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                resolve(null);
            } else {
                setTimeout(check, 100);
            }
        };
        setTimeout(check, 100);
    });
};

function updateStats(key) {
   chrome.storage.local.get(['radarStats'], (res) => {
      let stats = res.radarStats || { tweetsSeen: 0, localPassed: 0, moniChecked: 0, moniPassed: 0, rejected: 0, sent: 0 };
      stats[key] = (stats[key] || 0) + 1;
      chrome.storage.local.set({ radarStats: stats });
   });
}

let hoverQueue = [];
let isProcessingHoverQueue = false;

async function pumpHoverQueue() {
    if (isProcessingHoverQueue) return;
    isProcessingHoverQueue = true;
    
    while (hoverQueue.length > 0) {
        const item = hoverQueue.shift();
        try {
            await item();
        } catch (e) {
            console.error('[RADAR] Hover error', e);
        }
    }
    
    isProcessingHoverQueue = false;
}

function processArticles(articles, isInitial = false) {
  articles.forEach(article => {
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) return;
    
    processedTweetIds.add(data.tweet_id);
    if (!isInitial) newTweetsInCurrentScroll++; 
    
    if (processedTweetIds.size >= MAX_PROCESSED_IDS) {
       const arr = Array.from(processedTweetIds);
       processedTweetIds = new Set(arr.slice(arr.length - 5000));
    }
    
    updateStats('tweetsSeen');
    
    // Check age (Max 5 days)
    if (data.timestamp) {
        const tweetDate = new Date(data.timestamp);
        if (!isNaN(tweetDate.getTime())) {
            const ageDays = (Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays > 5) {
                updateStats('rejected');
                return;
            }
        }
    }
    
    // IMPORTANT: Check Local Filter FIRST!
    if (!window.passesLocalFilter(data.text)) {
       updateStats('rejected');
       return;
    }
    
    updateStats('localPassed');
    
    // Enqueue async processing
    hoverQueue.push(async () => {
        updateStats('moniChecked');
        const moni_score = await window.getMoniScore(data.username, article);
        data.moni_score = moni_score;
        
        const followerCount = await window.getFollowerCountViaHover(data.username, article);
        data.follower_count = followerCount;
        
        return new Promise((resolve) => {
            chrome.storage.local.get(['settings'], (res) => {
               const s = res.settings || {};
               const isMoniEnabled = s.moniFilterEnabled !== false;
               const minScore = s.moniFilterMinScore || 1000;
               const ifUnavail = s.moniFilterIfUnavailable || 'reject';
               const minFollowers = s.minFollowers || 0;
               
               let passFollowers = false;
               if (minFollowers > 0 && followerCount !== null && followerCount >= minFollowers) {
                   passFollowers = true;
               }
               
               let passMoni = false;
               if (isMoniEnabled) {
                   if (moni_score !== null && moni_score >= minScore) passMoni = true;
                   if (moni_score === null && ifUnavail === 'pass') passMoni = true;
               }
               
               const bothDisabled = (!isMoniEnabled && minFollowers === 0);
               
               if (!bothDisabled && !passFollowers && !passMoni) {
                   updateStats('rejected');
                   resolve();
                   return;
               }
               
               updateStats('moniPassed');
               updateStats('sent');
               console.log(`[RADAR] Found relevant tweet: ${data.tweet_id}, Moni: ${moni_score}, Followers: ${followerCount}`);
               chrome.runtime.sendMessage({ type: 'TRANSLATE_AND_ENQUEUE', payload: data });
               resolve();
            });
        });
    });
  });
  
  pumpHoverQueue();
}

function processTweets() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  processArticles(articles, false);
}

function startObserver() {
  if (!observer) {
      console.log('[RADAR] Starting Observer');
      observer = new MutationObserver((mutations) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processTweets, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
  }
  
  // Process initial snapshot
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  processArticles(articles, true);
  
  newTweetsInCurrentScroll = 0;
}

function stopObserver() {
  if (observer) {
    console.log('[RADAR] Stopping Observer');
    observer.disconnect();
    observer = null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_OBSERVER') startObserver();
  if (msg.type === 'STOP_OBSERVER') stopObserver();
  if (msg.type === 'CHECK_NEW_TWEETS') {
     sendResponse({ newCount: newTweetsInCurrentScroll });
     newTweetsInCurrentScroll = 0; 
  }
  if (msg.type === 'NAVIGATE_IN_PAGE') {
     console.log('[RADAR] Navigating in page to:', msg.url);
     let a = document.createElement('a');
     a.href = msg.url;
     document.body.appendChild(a);
     a.click();
     a.remove();
     sendResponse({ success: true });
  }
});
