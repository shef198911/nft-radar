let observer = null;
let processedTweetIds = new Set();
const MAX_PROCESSED_IDS = 10000;
let debounceTimer = null;
let newTweetsInCurrentScroll = 0;

function processTweets() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  
  articles.forEach(async article => {
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) return;
    
    processedTweetIds.add(data.tweet_id);
    newTweetsInCurrentScroll++; // Increment ONLY on actually new IDs to DOM
    
    if (processedTweetIds.size >= MAX_PROCESSED_IDS) {
       const arr = Array.from(processedTweetIds);
       processedTweetIds = new Set(arr.slice(arr.length - 5000));
    }
    
    // Fetch Moni Score asynchronously
    const moni_score = await window.getMoniScore(data.username, article);
    data.moni_score = moni_score;
    
    // Request current settings to check moni filter
    chrome.storage.local.get(['settings'], (res) => {
       const s = res.settings || {};
       const isMoniEnabled = s.moniFilterEnabled !== false;
       const minScore = s.moniFilterMinScore || 1000;
       const ifUnavail = s.moniFilterIfUnavailable || 'allow';
       
       if (isMoniEnabled) {
          if (moni_score === null && ifUnavail === 'ignore') return; // Reject if score is missing and set to ignore
          if (moni_score !== null && moni_score < minScore) return; // Reject if score is too low
       }

       if (window.passesLocalFilter(data.text)) {
         console.log(`[RADAR] Found relevant tweet: ${data.tweet_id}, Moni: ${moni_score}`);
         chrome.runtime.sendMessage({ type: 'NEW_TWEET', payload: data });
       }
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
    // DO NOT increment newTweetsInCurrentScroll here, this is just the initial snapshot.
    // The scroll logic will only count tweets that appear AFTER scrolling.
    
    // Fetch Moni Score asynchronously
    const moni_score = await window.getMoniScore(data.username, article);
    data.moni_score = moni_score;
    
    chrome.storage.local.get(['settings'], (res) => {
       const s = res.settings || {};
       if (s.moniFilterEnabled !== false) {
          if (moni_score === null && s.moniFilterIfUnavailable === 'ignore') return;
          if (moni_score !== null && moni_score < (s.moniFilterMinScore || 1000)) return;
       }
       if (window.passesLocalFilter(data.text)) {
         console.log(`[RADAR] Found relevant tweet (initial): ${data.tweet_id}, Moni: ${moni_score}`);
         chrome.runtime.sendMessage({ type: 'NEW_TWEET', payload: data });
       }
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
});
