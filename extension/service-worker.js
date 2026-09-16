importScripts('config.js');
importScripts('queries.js');

let state = {
  isRunning: false,
  currentQueryIndex: 0,
  activeTabId: null,
  scannerGeneration: 0
};

let settings = {
  workerUrl: (typeof CONFIG !== 'undefined' ? CONFIG.workerUrl : ''),
  clientKey: (typeof CONFIG !== 'undefined' ? CONFIG.clientKey : ''),
  scanInterval: 10,
  maxScrolls: 15,
  moniFilterEnabled: (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterEnabled : true),
  moniFilterMinScore: (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterMinScore : 1000),
  moniFilterIfUnavailable: (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterIfUnavailable : 'reject')
};

let tweetQueue = [];
let sending = false;
let queriesList = [];
let tasksList = [];

if (typeof SEARCH_GROUPS !== 'undefined') {
  queriesList = [...SEARCH_GROUPS]; // SEARCH_GROUPS is now an array of large OR queries
  // Build task list alternating TOP (main) and LATEST (secondary, fewer scrolls)
  for (let q of queriesList) {
    tasksList.push({ query: q, tab: 'top', scrollRatio: 1.0 });
    tasksList.push({ query: q, tab: 'latest', scrollRatio: 0.3 });
  }
}

function logInfo(msg) {
   console.log(`[RADAR] ${msg}`);
   chrome.runtime.sendMessage({ type: 'LOG', message: msg }).catch(()=>null);
}
function logError(msg) {
   console.error(`[ERROR][RADAR] ${msg}`);
   chrome.runtime.sendMessage({ type: 'LOG_ERROR', message: msg }).catch(()=>null);
}

chrome.storage.local.get(['state', 'settings', 'queue'], (res) => {
  if (res.settings) settings = { ...settings, ...res.settings };
  if (res.queue) tweetQueue = res.queue;
  if (res.state) {
    state = res.state;
    if (state.isRunning) {
       logInfo('Restored running state');
       state.scannerGeneration = Date.now();
       saveState();
       checkTabAndResume();
    }
  }
});

async function saveState() {
  await chrome.storage.local.set({ state, queue: tweetQueue });
}

function checkTabAndResume() {
   const gen = state.scannerGeneration;
   if (state.scannerTabId) {
      chrome.tabs.get(state.scannerTabId, (tab) => {
         if (chrome.runtime.lastError || !tab) {
            state.scannerTabId = null;
            executeNextQuery(gen);
         } else {
            executeNextQuery(gen, true); 
         }
      });
   } else {
      executeNextQuery(gen);
   }
}

async function processQueue() {
  if (sending || tweetQueue.length === 0 || !settings.workerUrl || !settings.clientKey) return;
  
  const pendingItems = tweetQueue.filter(i => i.status !== 'failed');
  if (pendingItems.length === 0) return;
  
  sending = true;
  const item = pendingItems[0];
  
  if (item.retryCount === undefined) {
     item.retryCount = 0;
     item.nextRetry = Date.now();
     item.status = 'pending';
  }

  if (Date.now() < item.nextRetry) {
     sending = false;
     setTimeout(processQueue, 5000);
     return;
  }

  const tweet = item.payload;
    try {
      logInfo(`Sending tweet ${tweet.tweet_id}...`);
      const baseUrl = settings.workerUrl.endsWith('/') ? settings.workerUrl + 'ingest' : settings.workerUrl + '/ingest';
      // Append key to URL to avoid custom headers, which avoids CORS preflight (OPTIONS)
      const url = `${baseUrl}?key=${encodeURIComponent(settings.clientKey)}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          // text/plain avoids CORS preflight requests in Chrome
          'Content-Type': 'text/plain'
        },
        body: JSON.stringify(tweet)
      });
    
    if (response.ok || response.status === 409) {
      if (response.ok) logInfo(`Worker response 200 for ${tweet.tweet_id}`);
      else logInfo(`Duplicate ${tweet.tweet_id}, dropping from queue`);
      
      const idx = tweetQueue.indexOf(item);
      if (idx !== -1) tweetQueue.splice(idx, 1);
      await saveState();
    } else if (response.status === 400) {
      logError(`Worker rejected payload 400 for ${tweet.tweet_id}`);
      const idx = tweetQueue.indexOf(item);
      if (idx !== -1) tweetQueue.splice(idx, 1);
      await saveState();
    } else if (response.status === 401 || response.status === 403) {
      logError(`Worker auth error ${response.status}. Check client key.`);
      item.nextRetry = Date.now() + 60000;
      await saveState();
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    logError(`Worker connection error: ${error.message}`);
    item.retryCount++;
    if (item.retryCount >= 5) {
       logError(`Max retries reached for ${tweet.tweet_id}, marking failed.`);
       item.status = 'failed';
    } else {
       const delays = [2000, 5000, 15000, 30000, 60000];
       const waitTime = delays[item.retryCount - 1] || 60000;
       item.nextRetry = Date.now() + waitTime;
    }
    await saveState();
  }
  
  sending = false;
  setTimeout(processQueue, 2000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NEW_TWEET') {
    // legacy fallback
  }
  
  if (msg.type === 'TRANSLATE_AND_ENQUEUE') {
    const tweetId = msg.payload.tweet_id;
    chrome.storage.local.get(['processed_' + tweetId], async (res) => {
      if (!res['processed_' + tweetId]) {
        chrome.storage.local.set({ ['processed_' + tweetId]: true });
        
        // Translate full text client-side (no CF block)
        if (msg.payload.text) {
           let snippet = msg.payload.text.length > 4000 ? msg.payload.text.substring(0, 4000) + '...' : msg.payload.text;
           try {
             const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(snippet)}`;
             const tres = await fetch(url);
             const json = await tres.json();
             if (json && json[0]) {
                msg.payload.translated_text = json[0].map(segment => segment[0]).join('');
             }
           } catch(e) {
             console.error("Translation fail", e);
           }
        }
        
        tweetQueue.push({ payload: msg.payload, retryCount: 0, nextRetry: Date.now(), status: 'pending' });
        saveState();
        processQueue();
      }
    });
  }
  
  if (msg.type === 'START_OBSERVER_PROXY') {
    if (state.scannerTabId) chrome.tabs.sendMessage(state.scannerTabId, { type: 'START_OBSERVER' }).catch(()=>null);
  }

  if (msg.type === 'CHECK_NEW_TWEETS_PROXY') {
      if (state.scannerTabId) {
          chrome.tabs.sendMessage(state.scannerTabId, { type: 'CHECK_NEW_TWEETS' }, (resp) => {
              if (chrome.runtime.lastError) {
                  console.error('[RADAR] Tab error:', chrome.runtime.lastError);
                  sendResponse({ newCount: 0 });
              } else {
                  sendResponse(resp || { newCount: 0 });
              }
          });
          return true;
      } else {
          sendResponse({ newCount: 0 });
      }
    }

  if (msg.type === 'SCROLL_DONE') {
    const gen = msg.generation;
    if (gen !== state.scannerGeneration || !state.isRunning) return;
    
    logInfo('Query complete');
    state.currentQueryIndex++;
    saveState();

    if (state.currentQueryIndex >= tasksList.length) {
       state.currentQueryIndex = 0;
       saveState();
       logInfo(`Cycle complete. Waiting ${settings.scanInterval} minutes...`);
       setTimeout(() => {
         if (state.isRunning && gen === state.scannerGeneration) executeNextQuery(gen);
       }, settings.scanInterval * 60 * 1000);
    } else {
         // Delay between queries (60-120 seconds) as requested by user
         const delay = 60000 + Math.floor(Math.random() * 60000);
         logInfo(`Waiting ${Math.round(delay/1000)} seconds before next query...`);
         setTimeout(() => {
           if (state.isRunning && gen === state.scannerGeneration) executeNextQuery(gen);
         }, delay);
    }
  }
});

function navigateTab(url, cb) {
  if (state.scannerTabId) {
    chrome.tabs.get(state.scannerTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
         createTab(url, cb);
      } else {
         // Try in-page SPA navigation first to avoid full reload
         chrome.tabs.sendMessage(state.scannerTabId, { type: 'NAVIGATE_IN_PAGE', url: url }, (response) => {
             if (chrome.runtime.lastError) {
                 // Fallback to update if content script is not injected
                 chrome.tabs.update(state.scannerTabId, { url: url }, cb);
             } else {
                 cb(tab);
             }
         });
      }
    });
  } else {
    createTab(url, cb);
  }
}

function createTab(url, cb) {
  // Ensure we create a separate scanner tab that doesn't hijack user's active tab
  chrome.tabs.create({ url: url, active: false }, (tab) => {
     state.scannerTabId = tab.id;
     saveState();
     cb(tab);
  });
}

function executeNextQuery(gen, resume = false) {
  if (!state.isRunning || tasksList.length === 0 || gen !== state.scannerGeneration) return;
  
  const task = tasksList[state.currentQueryIndex];
  logInfo(`Task ${state.currentQueryIndex + 1}/${tasksList.length} (${task.tab.toUpperCase()}): ${task.query}`);
  
  const encodedQuery = encodeURIComponent(task.query);
  const searchUrl = task.tab === 'latest' 
    ? `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`
    : `https://x.com/search?q=${encodedQuery}&src=typed_query`;
  
  if (state.scannerTabId) {
     chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_OBSERVER' }).catch(()=>null);
  }
  
  navigateTab(searchUrl, (tab) => {
     setTimeout(() => {
        if (state.isRunning && gen === state.scannerGeneration) {
           chrome.tabs.sendMessage(state.scannerTabId, { 
              type: 'START_SCROLL', 
              maxScrolls: Math.max(2, Math.floor(settings.maxScrolls * task.scrollRatio)),
              generation: gen
           }).catch(()=>null);
        }
     }, 6000); // 6 seconds wait for SPA transition
  });
}

function startScanner() {
  if (state.isRunning) {
     logInfo('Restarting loop strictly.');
  }
  logInfo('Starting RADAR');
  state.isRunning = true;
  state.scannerGeneration = Date.now();
  saveState();
  executeNextQuery(state.scannerGeneration);
}

function stopScanner() {
  logInfo('Stopping RADAR');
  state.isRunning = false;
  state.scannerGeneration = 0; 
  saveState();
  if (state.scannerTabId) {
     chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_SCROLL' }).catch(()=>null);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCANNER') startScanner();
  if (msg.type === 'STOP_SCANNER') stopScanner();
  if (msg.type === 'CLEAR_QUEUE') {
    tweetQueue = [];
    chrome.storage.local.set({ queue: [] });
  }
  if (msg.type === 'UPDATE_SETTINGS') {
    settings = { ...settings, ...msg.settings };
    chrome.storage.local.set({ settings });
    processQueue();
  }
  if (msg.type === 'GET_STATE') {
    sendResponse({ state, queue: tweetQueue, queriesLength: tasksList.length });
  }
});
