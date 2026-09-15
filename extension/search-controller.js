let isRunning = false;
let maxScrolls = 5;
let scrolls = 0;

async function doScroll() {
  if (!isRunning || scrolls >= maxScrolls) return false;
  window.scrollTo(0, document.body.scrollHeight);
  scrolls++;
  return new Promise(resolve => setTimeout(() => resolve(true), 2000));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCROLL') {
    isRunning = true;
    scrolls = 0;
    maxScrolls = msg.maxScrolls || 5;
    
    // Make sure observer is running
    chrome.runtime.sendMessage({ type: 'START_OBSERVER_PROXY' });
    
    (async function loop() {
      const canScroll = await doScroll();
      if (canScroll && isRunning) {
        loop();
      } else {
        if (isRunning) {
          chrome.runtime.sendMessage({ type: 'SCROLL_DONE' });
        }
      }
    })();
  }
  if (msg.type === 'STOP_SCROLL') {
    isRunning = false;
  }
});
