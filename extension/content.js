let observer = null;
let processedTweetIds = new Set();
const MAX_PROCESSED_IDS = 10000;
let debounceTimer = null;
let newTweetsInCurrentScroll = 0;

function updateStats(key) {
   chrome.storage.local.get(['radarStats'], (res) => {
      let stats = res.radarStats || { tweetsSeen: 0, localPassed: 0, moniChecked: 0, moniPassed: 0, rejected: 0, sent: 0 };
      stats[key] = (stats[key] || 0) + 1;
      chrome.storage.local.set({ radarStats: stats });
   });
}

function processTweets() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  
  articles.forEach(async article => {
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) return;
    
    processedTweetIds.add(data.tweet_id);
    newTweetsInCurrentScroll++; 
    
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
    
    // Fetch Moni Score asynchronously ONLY for candidates
    updateStats('moniChecked');
    const moni_score = await window.getMoniScore(data.username, article);
    data.moni_score = moni_score;
    
    // Request current settings to check moni filter
    chrome.storage.local.get(['settings'], (res) => {
       const s = res.settings || {};
       const isMoniEnabled = s.moniFilterEnabled !== false;
       const minScore = s.moniFilterMinScore || 1000;
       const ifUnavail = s.moniFilterIfUnavailable || 'reject';
       
       if (isMoniEnabled) {
          if (moni_score === null && ifUnavail === 'reject') { updateStats('rejected'); return; }
          if (moni_score !== null && moni_score < minScore) { updateStats('rejected'); return; }
       }
       
       updateStats('moniPassed');
       updateStats('sent');
       console.log(`[RADAR] Found relevant tweet: ${data.tweet_id}, Moni: ${moni_score}`);
       chrome.runtime.sendMessage({ type: 'NEW_TWEET', payload: data });
    });
  });
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
  articles.forEach(async article => {
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) return;
    
    processedTweetIds.add(data.tweet_id);
    updateStats('tweetsSeen');
    
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
    
    if (!window.passesLocalFilter(data.text)) {
       updateStats('rejected');
       return;
    }
    
    updateStats('localPassed');
    updateStats('moniChecked');
    const moni_score = await window.getMoniScore(data.username, article);
    data.moni_score = moni_score;
    
    chrome.storage.local.get(['settings'], (res) => {
       const s = res.settings || {};
       const ifUnavail = s.moniFilterIfUnavailable || 'reject';
       if (s.moniFilterEnabled !== false) {
          if (moni_score === null && ifUnavail === 'reject') { updateStats('rejected'); return; }
          if (moni_score !== null && moni_score < (s.moniFilterMinScore || 1000)) { updateStats('rejected'); return; }
       }
       updateStats('moniPassed');
       updateStats('sent');
       console.log(`[RADAR] Found relevant tweet (initial): ${data.tweet_id}, Moni: ${moni_score}`);
       chrome.runtime.sendMessage({ type: 'NEW_TWEET', payload: data });
    });
  });
  
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
