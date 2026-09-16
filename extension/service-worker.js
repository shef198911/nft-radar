try {
  importScripts('config.js');
} catch (e) {
  console.warn('[RADAR] config.js not found, using saved/manual settings.');
}
importScripts('queries.js');

const ALARM_PROCESS_QUEUE = 'radar-process-queue';
const ALARM_NEXT_QUERY = 'radar-next-query';
const ALARM_SCROLL_WATCHDOG = 'radar-scroll-watchdog';
const MIN_ALARM_DELAY_MS = 30000;
const SOURCE_REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_DYNAMIC_SOURCE_ACCOUNTS = 12;

let state = {
  isRunning: false,
  currentQueryIndex: 0,
  activeTabId: null,
  scannerGeneration: 0,
  nextRunAt: null,
  activeScrollGeneration: null,
  sourceAccounts: [],
  sourcesUpdatedAt: 0
};

let settings = {
  workerUrl: (typeof CONFIG !== 'undefined' ? CONFIG.workerUrl : ''),
  clientKey: (typeof CONFIG !== 'undefined' ? CONFIG.clientKey : ''),
  scanInterval: 10,
  maxScrolls: 15,
  moniFilterEnabled: (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterEnabled : true),
  moniFilterMinScore: (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterMinScore : 1000),
  moniFilterIfUnavailable: (typeof CONFIG !== 'undefined' ? CONFIG.moniFilterIfUnavailable : 'reject'),
  minFollowers: (typeof CONFIG !== 'undefined' ? (CONFIG.minFollowers || 0) : 0)
};

let tweetQueue = [];
let sending = false;
let queriesList = [];
let tasksList = [];
let dynamicSourceAccounts = [];

function sanitizeUsername(username) {
  if (!username || typeof username !== 'string') return null;
  const cleaned = username.replace(/^@/, '').trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

function buildSourceQuery(username) {
  return `(from:${username}) (NFT OR mint OR drop OR collection OR whitelist OR allowlist OR WL OR FCFS OR GTD OR "free mint" OR "Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR Solana OR SOL)`;
}

function rebuildTasks() {
  queriesList = typeof SEARCH_GROUPS !== 'undefined' ? [...SEARCH_GROUPS] : [];
  tasksList = [];

  for (let q of queriesList) {
    tasksList.push({ query: q, tab: 'top', scrollRatio: 1.0 });
    tasksList.push({ query: q, tab: 'latest', scrollRatio: 0.35 });
  }

  const uniqueAccounts = [...new Set(dynamicSourceAccounts.map(sanitizeUsername).filter(Boolean))]
    .slice(0, MAX_DYNAMIC_SOURCE_ACCOUNTS);

  for (let username of uniqueAccounts) {
    tasksList.push({ query: buildSourceQuery(username), tab: 'latest', scrollRatio: 0.6 });
  }

  if (state.currentQueryIndex >= tasksList.length) {
    state.currentQueryIndex = 0;
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

function toSettingNumber(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getQualitySettings(settingsSource = {}) {
  return {
    moniFilterEnabled: settingsSource.moniFilterEnabled !== false,
    moniFilterMinScore: toSettingNumber(settingsSource.moniFilterMinScore, 1000),
    moniFilterIfUnavailable: settingsSource.moniFilterIfUnavailable || 'reject',
    minFollowers: toSettingNumber(settingsSource.minFollowers, 0)
  };
}

function passesQualityGate(tweet, settingsSource = {}) {
  const s = getQualitySettings(settingsSource);
  const moniScore = tweet.moni_score;
  const followerCount = tweet.follower_count;

  const passFollowers = s.minFollowers > 0
    && followerCount !== null
    && followerCount !== undefined
    && Number(followerCount) >= s.minFollowers;

  let passMoni = false;
  if (s.moniFilterEnabled) {
    passMoni = (moniScore !== null && moniScore !== undefined && Number(moniScore) >= s.moniFilterMinScore)
      || (moniScore === null && s.moniFilterIfUnavailable === 'allow');
  }

  const bothDisabled = !s.moniFilterEnabled && s.minFollowers === 0;
  return bothDisabled || passFollowers || passMoni;
}

function removeQueueItem(item) {
  const idx = tweetQueue.indexOf(item);
  if (idx !== -1) tweetQueue.splice(idx, 1);
}

chrome.storage.local.get(['state', 'settings', 'queue'], (res) => {
  if (res.settings) settings = { ...settings, ...res.settings };
  if (res.queue) tweetQueue = res.queue;
  if (res.state) {
    state = { ...state, ...res.state };
  }
  dynamicSourceAccounts = Array.isArray(state.sourceAccounts) ? state.sourceAccounts : [];
  rebuildTasks();
  if (state.isRunning) {
     logInfo('Restored running state');
     refreshDynamicSources().finally(() => resumeScannerAfterWake());
  } else {
     refreshDynamicSources();
  }
  scheduleQueue(2000);
});

async function saveState() {
  await chrome.storage.local.set({ state, queue: tweetQueue });
}

async function refreshDynamicSources(force = false) {
  if (!settings.workerUrl || !settings.clientKey) return;
  if (!force && state.sourcesUpdatedAt && Date.now() - state.sourcesUpdatedAt < SOURCE_REFRESH_MS) return;

  try {
    const baseUrl = settings.workerUrl.endsWith('/') ? settings.workerUrl + 'sources' : settings.workerUrl + '/sources';
    const response = await fetch(`${baseUrl}?limit=${MAX_DYNAMIC_SOURCE_ACCOUNTS}`, {
      headers: { 'x-client-key': settings.clientKey }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    dynamicSourceAccounts = (data.accounts || [])
      .map((account) => sanitizeUsername(account.username || account))
      .filter(Boolean);

    state.sourceAccounts = dynamicSourceAccounts;
    state.sourcesUpdatedAt = Date.now();
    rebuildTasks();
    await saveState();
    logInfo(`Loaded ${dynamicSourceAccounts.length} dynamic source accounts`);
  } catch (error) {
    logError(`Source refresh failed: ${error.message}`);
  }
}

function scheduleAlarm(name, delayMs) {
  const safeDelay = Math.max(1000, delayMs);
  chrome.alarms.create(name, { when: Date.now() + safeDelay });
  if (safeDelay < MIN_ALARM_DELAY_MS) {
    setTimeout(() => {
      if (name === ALARM_PROCESS_QUEUE) processQueue();
      if (name === ALARM_NEXT_QUERY) runScheduledQuery();
    }, safeDelay);
  }
}

function scheduleQueue(delayMs = 2000) {
  scheduleAlarm(ALARM_PROCESS_QUEUE, delayMs);
}

function scheduleNextQuery(gen, delayMs) {
  state.nextRunAt = Date.now() + delayMs;
  saveState();
  scheduleAlarm(ALARM_NEXT_QUERY, delayMs);
  logInfo(`Next query scheduled in ${Math.round(delayMs / 1000)} seconds`);
}

function runScheduledQuery() {
  if (!state.isRunning) return;
  state.nextRunAt = null;
  saveState();
  executeNextQuery(state.scannerGeneration);
}

function resumeScannerAfterWake() {
  if (!state.isRunning) return;
  if (state.nextRunAt && Date.now() < state.nextRunAt) {
    scheduleAlarm(ALARM_NEXT_QUERY, state.nextRunAt - Date.now());
    return;
  }
  if (state.activeScrollGeneration) {
    scheduleAlarm(ALARM_SCROLL_WATCHDOG, 30000);
    return;
  }
  state.nextRunAt = null;
  saveState();
  checkTabAndResume();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_PROCESS_QUEUE) processQueue();
  if (alarm.name === ALARM_NEXT_QUERY) runScheduledQuery();
  if (alarm.name === ALARM_SCROLL_WATCHDOG) handleScrollWatchdog();
});

function finishCurrentQuery(gen, reason = 'complete') {
  if (gen !== state.scannerGeneration || !state.isRunning) return;
  if (state.activeScrollGeneration !== gen) return;

  chrome.alarms.clear(ALARM_SCROLL_WATCHDOG);
  state.activeScrollGeneration = null;

  if (reason === 'timeout') {
    logError('Scroll timed out, moving to next query');
    if (state.scannerTabId) {
      chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_SCROLL' }).catch(()=>null);
    }
  } else {
    logInfo('Query complete');
  }

  state.currentQueryIndex++;
  state.nextRunAt = null;
  saveState();

  if (state.currentQueryIndex >= tasksList.length) {
    state.currentQueryIndex = 0;
    saveState();
    logInfo(`Cycle complete. Waiting ${settings.scanInterval} minutes...`);
    refreshDynamicSources();
    scheduleNextQuery(gen, settings.scanInterval * 60 * 1000);
  } else {
    const delay = 60000 + Math.floor(Math.random() * 60000);
    scheduleNextQuery(gen, delay);
  }
}

function handleScrollWatchdog() {
  if (!state.isRunning || !state.activeScrollGeneration) return;
  finishCurrentQuery(state.activeScrollGeneration, 'timeout');
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
     scheduleQueue(Math.max(1000, item.nextRetry - Date.now()));
     return;
  }

  const tweet = item.payload;
  if (!passesQualityGate(tweet, settings)) {
    logInfo(`Dropping queued tweet ${tweet.tweet_id}: Moni ${tweet.moni_score ?? 'n/a'}, Followers ${tweet.follower_count ?? 'n/a'} below current filters`);
    removeQueueItem(item);
    await saveState();
    sending = false;
    scheduleQueue(2000);
    return;
  }

    try {
      logInfo(`Sending tweet ${tweet.tweet_id}...`);
      const baseUrl = settings.workerUrl.endsWith('/') ? settings.workerUrl + 'ingest' : settings.workerUrl + '/ingest';
      const url = baseUrl;
      
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
      
      removeQueueItem(item);
      await saveState();
    } else if (response.status === 400) {
      logError(`Worker rejected payload 400 for ${tweet.tweet_id}`);
      removeQueueItem(item);
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
  scheduleQueue(2000);
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
    finishCurrentQuery(gen);
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
  if (state.currentQueryIndex >= tasksList.length) state.currentQueryIndex = 0;
  state.nextRunAt = null;
  saveState();
  
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
           const scrollCount = Math.max(2, Math.floor(settings.maxScrolls * task.scrollRatio));
           state.activeScrollGeneration = gen;
           saveState();
           scheduleAlarm(ALARM_SCROLL_WATCHDOG, 6000 + (scrollCount * 25000) + 60000);
           chrome.tabs.sendMessage(state.scannerTabId, {
               type: 'START_SCROLL',
               maxScrolls: scrollCount,
               generation: gen
            }).catch(()=>null);
        }
     }, 6000); // 6 seconds wait for SPA transition
  });
}

async function startScanner() {
  if (state.isRunning) {
     logInfo('Restarting loop strictly.');
  }
  logInfo('Starting RADAR');
  state.isRunning = true;
  state.scannerGeneration = Date.now();
  state.nextRunAt = null;
  state.activeScrollGeneration = null;
  chrome.alarms.clear(ALARM_NEXT_QUERY);
  chrome.alarms.clear(ALARM_SCROLL_WATCHDOG);
  saveState();
  await refreshDynamicSources(true);
  executeNextQuery(state.scannerGeneration);
}

function stopScanner() {
  logInfo('Stopping RADAR');
  state.isRunning = false;
  state.scannerGeneration = 0; 
  state.nextRunAt = null;
  state.activeScrollGeneration = null;
  chrome.alarms.clear(ALARM_NEXT_QUERY);
  chrome.alarms.clear(ALARM_SCROLL_WATCHDOG);
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
    refreshDynamicSources(true);
    processQueue();
  }
  if (msg.type === 'GET_STATE') {
    sendResponse({ state, queue: tweetQueue, queriesLength: tasksList.length, sourceAccounts: dynamicSourceAccounts });
  }
});
