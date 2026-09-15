importScripts('queries.js');

let state = {
  isRunning: false,
  currentQueryIndex: 0,
  activeTabId: null
};

let settings = {
  workerUrl: '',
  clientKey: '',
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
       checkTabAndResume();
    }
  }
});

async function saveState() {
  await chrome.storage.local.set({ state, queue: tweetQueue });
}

function checkTabAndResume() {
   if (state.activeTabId) {
      chrome.tabs.get(state.activeTabId, (tab) => {
         if (chrome.runtime.lastError || !tab) {
            state.activeTabId = null;
            saveState();
         }
      });
   }
}

async function processQueue() {
  if (sending || tweetQueue.length === 0 || !settings.workerUrl || !settings.clientKey) return;
  
  sending = true;
  const item = tweetQueue[0];
  
  if (item.retryCount === undefined) {
     item.retryCount = 0;
     item.nextRetry = Date.now();
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
    
    if (response.ok) {
      logInfo(`Worker response 200 for ${tweet.tweet_id}`);
      tweetQueue.shift();
      await saveState();
    } else if (response.status === 409) {
      logInfo(`Duplicate ${tweet.tweet_id}, dropping`);
      tweetQueue.shift();
      await saveState();
    } else if (response.status === 400 || response.status === 401 || response.status === 403) {
      logError(`Worker rejected payload (${response.status})`);
      tweetQueue.shift();
      await saveState();
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    logError(`Worker connection error: ${error.message}`);
    item.retryCount++;
    if (item.retryCount >= 5) {
       logError(`Max retries reached for ${tweet.tweet_id}, dropping.`);
       tweetQueue.shift();
    } else {
       const delays = [2000, 5000, 15000, 30000, 60000];
       const waitTime = delays[item.retryCount - 1] || 60000;
       item.nextRetry = Date.now() + waitTime;
    }
    await saveState();
  }
  
  sending = false;
  if (tweetQueue.length > 0) {
    setTimeout(processQueue, 2000);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NEW_TWEET') {
    const tweetId = msg.payload.tweet_id;
    chrome.storage.local.get(['processed_' + tweetId], (res) => {
      if (!res['processed_' + tweetId]) {
        chrome.storage.local.set({ ['processed_' + tweetId]: true });
        tweetQueue.push({ payload: msg.payload, retryCount: 0, nextRetry: Date.now() });
        saveState();
        processQueue();
      }
    });
  }
  
  if (msg.type === 'START_OBSERVER_PROXY') {
    if (state.activeTabId) chrome.tabs.sendMessage(state.activeTabId, { type: 'START_OBSERVER' });
  }

  if (msg.type === 'CHECK_NEW_TWEETS_PROXY') {
    if (state.activeTabId) {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'CHECK_NEW_TWEETS' }, (resp) => {
            sendResponse(resp);
        });
        return true;
    } else {
        sendResponse({ newCount: 0 });
    }
  }

  if (msg.type === 'SCROLL_DONE') {
    logInfo('Query complete');
    state.currentQueryIndex++;
    saveState();

    if (state.currentQueryIndex >= queriesList.length) {
       state.currentQueryIndex = 0;
       saveState();
       logInfo(`Cycle complete. Waiting ${settings.scanInterval} minutes...`);
       setTimeout(() => {
         if (state.isRunning) executeNextQuery();
       }, settings.scanInterval * 60 * 1000);
    } else {
       setTimeout(() => {
         if (state.isRunning) executeNextQuery();
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

function executeNextQuery() {
  if (!state.isRunning || queriesList.length === 0) return;
  
  const query = queriesList[state.currentQueryIndex];
  logInfo(`Query ${state.currentQueryIndex + 1}/${queriesList.length}: ${query}`);
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;
  
  navigateTab(searchUrl, (tab) => {
     setTimeout(() => {
        if (state.isRunning) {
           chrome.tabs.sendMessage(state.activeTabId, { type: 'START_SCROLL', maxScrolls: settings.maxScrolls });
        }
     }, 5000);
  });
}

function startScanner() {
  if (state.isRunning) {
     logInfo('Already running');
     return;
  }
  logInfo('Starting RADAR');
  state.isRunning = true;
  saveState();
  executeNextQuery();
}

function stopScanner() {
  logInfo('Stopping RADAR');
  state.isRunning = false;
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
