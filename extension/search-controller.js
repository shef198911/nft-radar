let isRunning = false;
let maxScrolls = 5;
let scrolls = 0;
let noNewTweetAttempts = 0;
let currentGeneration = 0;
const MAX_NO_NEW_TWEETS_ATTEMPTS = 3;

async function doScroll() {
  if (!isRunning || scrolls >= maxScrolls) return false;
  
  window.scrollTo(0, document.body.scrollHeight);
  scrolls++;
  
  await new Promise(resolve => setTimeout(resolve, 2500));
  
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'CHECK_NEW_TWEETS_PROXY' }, (response) => {
       if (response && response.newCount > 0) {
           noNewTweetAttempts = 0;
           resolve(true);
       } else {
           noNewTweetAttempts++;
           if (noNewTweetAttempts >= MAX_NO_NEW_TWEETS_ATTEMPTS) {
               console.log('[RADAR] No new tweets after multiple attempts, ending scroll.');
               resolve(false);
           } else {
               resolve(true);
           }
       }
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCROLL') {
    isRunning = true;
    scrolls = 0;
    noNewTweetAttempts = 0;
    maxScrolls = msg.maxScrolls || 5;
    currentGeneration = msg.generation;
    
    console.log('[RADAR] Started scroll loop');
    
    chrome.runtime.sendMessage({ type: 'START_OBSERVER_PROXY' });
    
    (async function loop() {
      const keepScrolling = await doScroll();
      if (keepScrolling && isRunning) {
        loop();
      } else {
        if (isRunning) {
          console.log('[RADAR] Scroll done for current query');
          chrome.runtime.sendMessage({ type: 'SCROLL_DONE', generation: currentGeneration });
          isRunning = false;
        }
      }
    })();
  }
  if (msg.type === 'STOP_SCROLL') {
    isRunning = false;
    console.log('[RADAR] Stopped scroll loop');
  }
});
