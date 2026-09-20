let isRunning = false;
let maxScrolls = 5;
let scrolls = 0;
let noNewTweetAttempts = 0;
let currentGeneration = 0;
const MAX_NO_NEW_TWEETS_ATTEMPTS = 3;

async function doScroll() {
  if (!isRunning || scrolls >= maxScrolls) return false;
  
  // Human-like smooth scroll instead of instant jump to the bottom
  const startY = window.scrollY;
  let currentY = startY;
  // Scroll roughly 1 to 2 screens down per cycle
  const targetScrollDelta = window.innerHeight * (1.0 + Math.random()); 
  
  while (currentY - startY < targetScrollDelta) {
      if (!isRunning) return false;
      const step = 150 + Math.random() * 250;
      currentY += step;
      window.scrollTo({ top: currentY, behavior: 'smooth' });
      // Small pause between wheel ticks
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
      
      if (currentY >= document.body.scrollHeight - window.innerHeight) {
          break; // Reached absolute bottom of current DOM
      }
  }
  
  scrolls++;
  
  // Pause to 'read' the tweets and wait for network (5 to 8 seconds)
  const scrollDelay = 5000 + Math.floor(Math.random() * 3000); 
  await new Promise(resolve => setTimeout(resolve, scrollDelay));
  
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
    
    console.log('[RADAR] Started scroll loop (isXList: ' + msg.isXList + ')');
    
    chrome.runtime.sendMessage({ type: 'START_OBSERVER_PROXY', isXList: msg.isXList });
    
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
