let observer = null;
let processedTweetIds = new Set();
const MAX_PROCESSED_IDS = 10000;
let debounceTimer = null;
let newTweetsInCurrentScroll = 0;

function processTweets() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  
  articles.forEach(article => {
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) return;
    
    if (processedTweetIds.size >= MAX_PROCESSED_IDS) {
       const arr = Array.from(processedTweetIds);
       processedTweetIds = new Set(arr.slice(arr.length - 5000));
    }
    
    processedTweetIds.add(data.tweet_id);
    newTweetsInCurrentScroll++; // Increment ONLY on actually new IDs to DOM
    
    if (window.passesLocalFilter(data.text)) {
      console.log(`[RADAR] Found relevant tweet: ${data.tweet_id}`);
      chrome.runtime.sendMessage({ type: 'NEW_TWEET', payload: data });
    }
  });
}

function startObserver() {
  newTweetsInCurrentScroll = 0;
  
  if (!observer) {
      console.log('[RADAR] Starting Observer');
      observer = new MutationObserver((mutations) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processTweets, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
  }
  
  processTweets();
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
