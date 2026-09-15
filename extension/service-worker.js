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
  maxScrolls: 5
};

let tweetQueue = [];
let sending = false;
let queriesList = [];

if (typeof SEARCH_GROUPS !== 'undefined') {
  Object.values(SEARCH_GROUPS).forEach(group => {
    queriesList.push(...group);
  });
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
   if (state.activeTabId) {
      chrome.tabs.get(state.activeTabId, (tab) => {
         if (chrome.runtime.lastError || !tab) {
            state.activeTabId = null;
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
    const url = settings.workerUrl.endsWith('/') ? settings.workerUrl + 'ingest' : settings.workerUrl + '/ingest';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': settings.clientKey
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
    const tweetId = msg.payload.tweet_id;
    chrome.storage.local.get(['processed_' + tweetId], (res) => {
      if (!res['processed_' + tweetId]) {
        chrome.storage.local.set({ ['processed_' + tweetId]: true });
        tweetQueue.push({ payload: msg.payload, retryCount: 0, nextRetry: Date.now(), status: 'pending' });
        saveState();
        processQueue();
      }
    });
  }
  
  if (msg.type === 'START_OBSERVER_PROXY') {
    if (state.activeTabId) chrome.tabs.sendMessage(state.activeTabId, { type: 'START_OBSERVER' }).catch(()=>null);
  }

  if (msg.type === 'CHECK_NEW_TWEETS_PROXY') {
    if (state.activeTabId) {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'CHECK_NEW_TWEETS' }, (resp) => {
            sendResponse(resp || { newCount: 0 });
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

    if (state.currentQueryIndex >= queriesList.length) {
       state.currentQueryIndex = 0;
       saveState();
       logInfo(`Cycle complete. Waiting ${settings.scanInterval} minutes...`);
       setTimeout(() => {
         if (state.isRunning && gen === state.scannerGeneration) executeNextQuery(gen);
       }, settings.scanInterval * 60 * 1000);
    } else {
       setTimeout(() => {
         if (state.isRunning && gen === state.scannerGeneration) executeNextQuery(gen);
       }, 2000);
    }
  }
});

function navigateTab(url, cb) {
  if (state.activeTabId) {
    chrome.tabs.get(state.activeTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
         createTab(url, cb);
      } else {
         chrome.tabs.update(state.activeTabId, { url: url }, cb);
      }
    });
  } else {
    createTab(url, cb);
  }
}

function createTab(url, cb) {
  chrome.tabs.create({ url: url, active: false }, (tab) => {
     state.activeTabId = tab.id;
     saveState();
     cb(tab);
  });
}

function executeNextQuery(gen, resume = false) {
  if (!state.isRunning || queriesList.length === 0 || gen !== state.scannerGeneration) return;
  
  const query = queriesList[state.currentQueryIndex];
  logInfo(`Query ${state.currentQueryIndex + 1}/${queriesList.length}: ${query}`);
  
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;
  
  navigateTab(searchUrl, (tab) => {
     setTimeout(() => {
        if (state.isRunning && gen === state.scannerGeneration) {
           chrome.tabs.sendMessage(state.activeTabId, { 
              type: 'START_SCROLL', 
              maxScrolls: settings.maxScrolls,
              generation: gen
           }).catch(()=>null);
        }
     }, 6000);
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
  if (state.activeTabId) {
     chrome.tabs.sendMessage(state.activeTabId, { type: 'STOP_SCROLL' }).catch(()=>null);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCANNER') startScanner();
  if (msg.type === 'STOP_SCANNER') stopScanner();
  if (msg.type === 'UPDATE_SETTINGS') {
    settings = { ...settings, ...msg.settings };
    chrome.storage.local.set({ settings });
    processQueue();
  }
  if (msg.type === 'GET_STATE') {
    sendResponse({ state, queue: tweetQueue, queriesLength: queriesList.length });
  }
});
