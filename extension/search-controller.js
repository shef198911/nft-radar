let isRunning = false;
let maxScrolls = 5;
let scrolls = 0;
let noNewTweetAttempts = 0;
let currentGeneration = 0;
const MAX_NO_NEW_TWEETS_ATTEMPTS = 3;

// Keep-Alive Mechanism for MV3 Service Worker
let keepAlivePort = null;
let keepAliveTimer = null;
let keepAliveActive = false;

function startKeepAlive() {
  if (keepAliveActive && keepAlivePort) return;
  keepAliveActive = true;
  connectKeepAlivePort();
}

function connectKeepAlivePort() {
  if (!keepAliveActive) return;
  try {
    if (keepAlivePort) {
      try { keepAlivePort.disconnect(); } catch (e) {}
      keepAlivePort = null;
    }
    clearInterval(keepAliveTimer);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connect) {
      keepAlivePort = chrome.runtime.connect({ name: 'radar-keepalive' });

      keepAlivePort.onMessage.addListener((msg) => {
        // Pong received from service worker
      });

      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        clearInterval(keepAliveTimer);
        // Automatically reconnect if still active
        if (keepAliveActive) {
          setTimeout(() => {
            if (keepAliveActive) connectKeepAlivePort();
          }, 1500);
        }
      });

      // Send heartbeat ping every 20 seconds to keep service worker alive
      keepAliveTimer = setInterval(() => {
        if (keepAlivePort && keepAliveActive) {
          try {
            keepAlivePort.postMessage({ type: 'ping', timestamp: Date.now() });
          } catch (e) {
            connectKeepAlivePort();
          }
        }
      }, 20000);

      try {
        keepAlivePort.postMessage({ type: 'ping', timestamp: Date.now() });
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[RADAR] Keepalive connect failed:', err);
    if (keepAliveActive) {
      setTimeout(() => {
        if (keepAliveActive) connectKeepAlivePort();
      }, 2000);
    }
  }
}

function stopKeepAlive() {
  keepAliveActive = false;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
  if (keepAlivePort) {
    try {
      keepAlivePort.disconnect();
    } catch (e) {}
    keepAlivePort = null;
  }
}

if (typeof window !== 'undefined') {
  window.startRadarKeepAlive = startKeepAlive;
  window.stopRadarKeepAlive = stopKeepAlive;
}

// On script initialization, verify if this tab is the scanner tab and should keep worker alive
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
  try {
    chrome.runtime.sendMessage({ type: 'IS_SCANNER_TAB' }, (resp) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      if (resp && resp.isScannerTab && resp.isRunning) {
        startKeepAlive();
        if (resp.activeScrollTask && resp.activeScrollTask.generation) {
          triggerScroll(resp.activeScrollTask);
        }
      }
    });
  } catch (e) {}
}

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
      await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
      
      if (currentY >= document.body.scrollHeight - window.innerHeight) {
          break; // Reached absolute bottom of current DOM
      }
  }
  
  scrolls++;
  
  // Pause to 'read' the tweets and wait for network (8 to 12 seconds)
  const scrollDelay = 8000 + Math.floor(Math.random() * 4000); 
  await new Promise(resolve => setTimeout(resolve, scrollDelay));
  
  return new Promise(resolve => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(true); // Don't block scroll loop on message timeout
      }
    }, 5000);

    try {
      chrome.runtime.sendMessage({ type: 'CHECK_NEW_TWEETS_PROXY' }, (response) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(false);
          return;
        }
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
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    }
  });
}

function triggerScroll(task) {
  if (!task || !task.generation) return;
  if (isRunning && currentGeneration === task.generation) {
    return;
  }
  isRunning = true;
  startKeepAlive();
  scrolls = 0;
  noNewTweetAttempts = 0;
  maxScrolls = task.maxScrolls || 5;
  currentGeneration = task.generation;

  console.log('[RADAR] Started scroll loop (isXList: ' + task.isXList + ')');

  chrome.runtime.sendMessage({
    type: 'START_OBSERVER_PROXY',
    isXList: task.isXList,
    isParserTarget: task.isParserTarget
  }).catch(() => null);

  (async function loop() {
    try {
      const keepScrolling = await doScroll();
      if (keepScrolling && isRunning) {
        loop();
        return;
      }
    } catch (err) {
      console.error('[RADAR] Error during doScroll:', err);
    }

    if (isRunning) {
      // Wait for hover queue to drain before signaling completion (up to 20s safety limit)
      let waitCount = 0;
      while (typeof window !== 'undefined' && window.isHoverQueueBusy && window.isHoverQueueBusy() && waitCount < 40) {
        await new Promise(r => setTimeout(r, 500));
        waitCount++;
      }
      console.log('[RADAR] Scroll done for current query');
      chrome.runtime.sendMessage({ type: 'SCROLL_DONE', generation: currentGeneration }).catch(() => null);
      isRunning = false;
    }
  })();
}

if (typeof window !== 'undefined') {
  window.triggerRadarScroll = triggerScroll;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCROLL') {
    if (isRunning && currentGeneration === msg.generation) {
      if (typeof sendResponse === 'function') {
        sendResponse({ started: true, generation: currentGeneration, alreadyRunning: true });
      }
      return true;
    }
    triggerScroll(msg);
    if (typeof sendResponse === 'function') {
      sendResponse({ started: true, generation: currentGeneration });
    }
    return true;
  }

  if (msg.type === 'STOP_SCROLL') {
    isRunning = false;
    stopKeepAlive();
    console.log('[RADAR] Stopped scroll loop');
    if (typeof sendResponse === 'function') {
      sendResponse({ stopped: true });
    }
    return true;
  }

  if (msg.type === 'START_KEEPALIVE') {
    startKeepAlive();
    if (typeof sendResponse === 'function') {
      sendResponse({ keepAlive: true });
    }
    return true;
  }

  if (msg.type === 'STOP_KEEPALIVE') {
    stopKeepAlive();
    if (typeof sendResponse === 'function') {
      sendResponse({ keepAlive: false });
    }
    return true;
  }

  if (msg.type === 'PING_SCROLL') {
    if (typeof sendResponse === 'function') {
      sendResponse({ isRunning, scrolls, maxScrolls, currentGeneration });
    }
    return true;
  }
});
