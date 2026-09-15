let observer = null;
let processedTweetIds = new Set();
let debounceTimer = null;

function processTweets() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  
  articles.forEach(article => {
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) return;
    
    processedTweetIds.add(data.tweet_id);
    
    if (window.passesLocalFilter(data.text)) {
      chrome.runtime.sendMessage({ type: 'NEW_TWEET', payload: data });
    }
  });
}

function startObserver() {
  if (observer) return;
  // process existing first
  processTweets();
  
  observer = new MutationObserver((mutations) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processTweets, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_OBSERVER') startObserver();
  if (msg.type === 'STOP_OBSERVER') stopObserver();
});
