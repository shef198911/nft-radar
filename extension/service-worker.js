importScripts('queries.js');

let isRunning = false;
let currentQueryIndex = 0;
let queriesList = [];
let settings = {
  workerUrl: '',
  clientKey: '',
  scanInterval: 10,
  maxScrolls: 5
};
let tweetQueue = [];
let sending = false;

// Initialize queries
if (typeof SEARCH_GROUPS !== 'undefined') {
  Object.values(SEARCH_GROUPS).forEach(group => {
    queriesList.push(...group);
  });
}

chrome.storage.local.get(['settings', 'queue'], (res) => {
  if (res.settings) settings = { ...settings, ...res.settings };
  if (res.queue) tweetQueue = res.queue;
});

async function processQueue() {
  if (sending || tweetQueue.length === 0 || !settings.workerUrl || !settings.clientKey) return;
  
  sending = true;
  const tweet = tweetQueue[0];
  
  try {
    const url = settings.workerUrl.endsWith('/') ? settings.workerUrl + 'ingest' : settings.workerUrl + '/ingest';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': settings.clientKey
      },
      body: JSON.stringify(tweet)
    });
    
    if (response.ok || response.status === 409 || response.status === 400) {
      tweetQueue.shift(); // Remove on success, duplicate, or bad request
      chrome.storage.local.set({ queue: tweetQueue });
    }
  } catch (error) {
    console.error('Error sending tweet', error);
  }
  
  sending = false;
  
  if (tweetQueue.length > 0) {
    setTimeout(processQueue, 2000); // Backoff
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NEW_TWEET') {
    const tweetId = msg.payload.tweet_id;
    chrome.storage.local.get(['processed_' + tweetId], (res) => {
      if (!res['processed_' + tweetId]) {
        chrome.storage.local.set({ ['processed_' + tweetId]: true });
        tweetQueue.push(msg.payload);
        chrome.storage.local.set({ queue: tweetQueue });
        processQueue();
      }
    });
  }
  
  if (msg.type === 'START_OBSERVER_PROXY') {
    if (sender && sender.tab) {
      chrome.tabs.sendMessage(sender.tab.id, { type: 'START_OBSERVER' });
    }
  }

  if (msg.type === 'SCROLL_DONE') {
    currentQueryIndex = (currentQueryIndex + 1) % queriesList.length;
    // Delay before next query based on scanInterval if we wrapped around, 
    // or just 2 seconds if moving to next query.
    let delay = 2000;
    if (currentQueryIndex === 0) {
      delay = (settings.scanInterval || 10) * 60 * 1000; 
    }
    setTimeout(() => {
      if (isRunning) executeNextQuery();
    }, delay);
  }
});

function executeNextQuery() {
  if (!isRunning || queriesList.length === 0) return;
  
  const query = queriesList[currentQueryIndex];
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.update(tabs[0].id, { url: searchUrl }, (tab) => {
        // Wait for page to load, then start scroll
        setTimeout(() => {
          if (isRunning) {
             chrome.tabs.sendMessage(tab.id, { type: 'START_SCROLL', maxScrolls: settings.maxScrolls });
          }
        }, 5000);
      });
    } else {
      // If no active tab, create one
      chrome.tabs.create({ url: searchUrl }, (tab) => {
         setTimeout(() => {
          if (isRunning) {
             chrome.tabs.sendMessage(tab.id, { type: 'START_SCROLL', maxScrolls: settings.maxScrolls });
          }
        }, 5000);
      });
    }
  });
}

function startScanner() {
  isRunning = true;
  chrome.storage.local.set({ isRunning: true });
  executeNextQuery();
}

function stopScanner() {
  isRunning = false;
  chrome.storage.local.set({ isRunning: false });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_SCROLL' });
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_SCANNER') startScanner();
  if (msg.type === 'STOP_SCANNER') stopScanner();
  if (msg.type === 'UPDATE_SETTINGS') {
    settings = { ...settings, ...msg.settings };
    chrome.storage.local.set({ settings });
    processQueue(); // try processing queue if url/key updated
  }
});
