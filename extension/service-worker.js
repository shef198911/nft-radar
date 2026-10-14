try {
  importScripts('config.js');
} catch (e) {
  console.warn('[RADAR] config.js not found, using saved/manual settings.');
}
importScripts('queries.js');

const ALARM_PROCESS_QUEUE = 'radar-process-queue';
const ALARM_NEXT_QUERY = 'radar-next-query';
const ALARM_SCROLL_WATCHDOG = 'radar-scroll-watchdog';
const ALARM_HEALTH_CHECK = 'radar-health-check';
const MIN_ALARM_DELAY_MS = 30000;
const SOURCE_REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_DYNAMIC_SOURCE_ACCOUNTS = 12;
const DEFAULT_PAGE_REFRESH_INTERVAL = 15;

let state = {
  isRunning: false,
  currentQueryIndex: 0,
  activeTabId: null,
  scannerTabId: null,
  scannerGeneration: 0,
  nextRunAt: null,
  activeScrollGeneration: null,
  scrollStartedAt: 0,
  scrollTimeoutMs: 0,
  pendingScrollTask: null,
  lastQueryStartedAt: 0,
  sourceAccounts: [],
  sourcesUpdatedAt: 0,
  eodScanActive: false,
  eodTargets: [],
  eodTargetIndex: 0,
  nextEodScanAt: 0,
  lastPageReloadAt: 0
};

function dispatchStartScroll(tabId, scrollTask, retriesLeft = 6) {
  if (!state.isRunning || !scrollTask || scrollTask.generation !== state.scannerGeneration) return;
  if (!tabId || typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.sendMessage) return;

  chrome.tabs.sendMessage(tabId, {
    type: 'START_SCROLL',
    maxScrolls: scrollTask.maxScrolls,
    generation: scrollTask.generation,
    isXList: scrollTask.isXList,
    isParserTarget: scrollTask.isParserTarget
  }, (resp) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      if (retriesLeft > 0 && state.isRunning && scrollTask.generation === state.scannerGeneration) {
        setTimeout(() => dispatchStartScroll(tabId, scrollTask, retriesLeft - 1), 1500);
      }
    }
  });
}

let keepAlivePorts = new Set();
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'radar-keepalive') {
      keepAlivePorts.add(port);
      port.onMessage.addListener((msg) => {
        if (msg && msg.type === 'ping') {
          try {
            port.postMessage({ type: 'pong', timestamp: Date.now() });
          } catch (e) {}
        }
      });
      port.onDisconnect.addListener(() => {
        keepAlivePorts.delete(port);
      });
    }
  });
}

let settings = {
  workerUrl: (typeof CONFIG !== 'undefined' ? CONFIG.workerUrl : ''),
  clientKey: (typeof CONFIG !== 'undefined' ? CONFIG.clientKey : ''),
  scanInterval: 10,
  maxScrolls: 15,
  pageRefreshInterval: (typeof CONFIG !== 'undefined' ? (CONFIG.pageRefreshInterval ?? DEFAULT_PAGE_REFRESH_INTERVAL) : DEFAULT_PAGE_REFRESH_INTERVAL),
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
  const opportunityTerms = [
    'NFT',
    'NFTs',
    'mint',
    'minting',
    'drop',
    'launch',
    'collection',
    'whitelist',
    'allowlist',
    '"allow list"',
    'WL',
    'FCFS',
    'GTD',
    'raffle',
    'giveaway',
    'claim',
    '"free mint"',
    '"free claim"',
    '"public mint"'
  ].join(' OR ');

  const chainTerms = [
    '"Robinhood Chain"',
    '"RH Chain"',
    '"Robinhood NFT"',
    '"Robinhood mint"',
    '"ARC Chain"',
    '"Arc NFT"',
    '"ARC mint"',
    '"Solana NFT"',
    '"Solana mint"',
    '"Solana free mint"',
    '"$SOL"'
  ].join(' OR ');

  return `from:${username} -filter:replies (${opportunityTerms} OR ${chainTerms})`;
}

function calibrateSearchQuery(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return trimmed;
  if (/\b-?filter:replies\b/i.test(trimmed)) return trimmed;
  return `-filter:replies ${trimmed}`;
}

function rebuildTasks() {
  queriesList = typeof SEARCH_GROUPS !== 'undefined' ? [...SEARCH_GROUPS] : [];
  tasksList = [];

  const xListTask = {
    query: 'list:2100655965091606668',
    isXList: true,
    tab: 'latest',
    scrollRatio: 1.0
  };

  const uniqueAccounts = [...new Set(dynamicSourceAccounts.map(sanitizeUsername).filter(Boolean))]
    .slice(0, MAX_DYNAMIC_SOURCE_ACCOUNTS);

  let tempTasks = [];

  for (let q of queriesList) {
    const query = calibrateSearchQuery(q);
    tempTasks.push({ query, tab: 'top', scrollRatio: 1.0 });
    tempTasks.push({ query, tab: 'latest', scrollRatio: 0.35 });
  }

  for (let username of uniqueAccounts) {
    tempTasks.push({ query: buildSourceQuery(username), tab: 'latest', scrollRatio: 0.6 });
  }

  // Interleave X List between every 2 tasks so it runs much more frequently
  for (let i = 0; i < tempTasks.length; i++) {
    if (i % 2 === 0) {
      tasksList.push(xListTask);
    }
    tasksList.push(tempTasks[i]);
  }
  
  if (tasksList.length === 0) {
    tasksList.push(xListTask);
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

function getPageRefreshIntervalMs() {
  const minutes = toSettingNumber(settings.pageRefreshInterval, DEFAULT_PAGE_REFRESH_INTERVAL);
  if (minutes <= 0) return 0;
  return Math.max(1, minutes) * 60 * 1000;
}

function shouldForcePageReload() {
  const intervalMs = getPageRefreshIntervalMs();
  if (!intervalMs) return false;
  return !state.lastPageReloadAt || Date.now() - state.lastPageReloadAt >= intervalMs;
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
  if (tweet && tweet.is_parser_target) return true;
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

let storageReady = new Promise(resolve => {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    resolve();
    return;
  }
  chrome.storage.local.get(['state', 'settings', 'queue', 'radarStats'], (res) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      console.warn('[RADAR] storage get error:', chrome.runtime.lastError);
    }
    res = res || {};
    if (res.settings) settings = { ...settings, ...res.settings };
    if (res.queue) tweetQueue = res.queue;
    if (res.radarStats) radarStats = { ...radarStats, ...res.radarStats };
    if (tweetQueue.length > 200) tweetQueue = tweetQueue.slice(tweetQueue.length - 200);
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
    resolve();
  });
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
      headers: { 'x-client-key': settings.clientKey },
      signal: AbortSignal.timeout(15000)
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
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear(name);
    chrome.alarms.create(name, { when: Date.now() + safeDelay });
  }
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
  if (state.activeScrollGeneration) return;
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear(ALARM_NEXT_QUERY);
  }
  state.nextRunAt = null;
  saveState();
  executeNextQuery(state.scannerGeneration);
}

function resumeScannerAfterWake() {
  if (!state.isRunning) return;

  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.create(ALARM_HEALTH_CHECK, { periodInMinutes: 1 });
  }

  const now = Date.now();

  if (state.nextRunAt && now < state.nextRunAt) {
    scheduleAlarm(ALARM_NEXT_QUERY, state.nextRunAt - now);
    return;
  }
  if (state.nextRunAt && now >= state.nextRunAt) {
    runScheduledQuery();
    return;
  }

  if (state.activeScrollGeneration) {
    const elapsed = state.scrollStartedAt ? (now - state.scrollStartedAt) : 0;
    const timeoutMs = state.scrollTimeoutMs || (5 * 60 * 1000);
    if (elapsed >= timeoutMs) {
      logError('Scroll expired while service worker was sleeping; finishing with timeout');
      finishCurrentQuery(state.activeScrollGeneration, 'timeout');
      return;
    }
    const remaining = Math.max(5000, timeoutMs - elapsed);
    scheduleAlarm(ALARM_SCROLL_WATCHDOG, remaining);
    return;
  }

  if (state.lastQueryStartedAt && (now - state.lastQueryStartedAt < 30000)) {
    return;
  }

  state.nextRunAt = null;
  saveState();
  checkTabAndResume();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await storageReady;
  if (alarm.name === ALARM_PROCESS_QUEUE) processQueue();
  if (alarm.name === ALARM_NEXT_QUERY) runScheduledQuery();
  if (alarm.name === ALARM_SCROLL_WATCHDOG) handleScrollWatchdog();
  if (alarm.name === ALARM_HEALTH_CHECK) runHealthCheck();
});

function runHealthCheck() {
  if (!state.isRunning) return;

  const now = Date.now();

  if (state.activeScrollGeneration) {
    const elapsed = state.scrollStartedAt ? (now - state.scrollStartedAt) : 0;
    const maxAllowed = state.scrollTimeoutMs || (5 * 60 * 1000);

    if (elapsed > maxAllowed) {
      logError(`Health check: active scroll hung (${Math.round(elapsed / 1000)}s > ${Math.round(maxAllowed / 1000)}s), triggering timeout recovery`);
      finishCurrentQuery(state.activeScrollGeneration, 'timeout');
      return;
    }

    if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.get) {
      chrome.tabs.get(state.scannerTabId, (tab) => {
        if ((chrome.runtime && chrome.runtime.lastError) || !tab) {
          logError('Health check: scanner tab no longer exists during active scroll, recovering');
          finishCurrentQuery(state.activeScrollGeneration, 'timeout');
        } else if (elapsed > 30000 && typeof chrome.tabs.sendMessage === 'function') {
          // Probe whether tab is actively scrolling
          chrome.tabs.sendMessage(state.scannerTabId, { type: 'PING_SCROLL' }, (resp) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              logError('Health check: scanner tab unresponsive to PING_SCROLL during active scroll, recovering');
              finishCurrentQuery(state.activeScrollGeneration, 'timeout');
            } else if (resp && !resp.isRunning && resp.currentGeneration === state.activeScrollGeneration) {
              logInfo('Health check: tab finished scroll but SCROLL_DONE was missed, advancing');
              finishCurrentQuery(state.activeScrollGeneration, 'complete');
            } else if (resp && !resp.isRunning && elapsed > 45000) {
              logError('Health check: tab idle after 45s of active generation, recovering');
              finishCurrentQuery(state.activeScrollGeneration, 'timeout');
            }
          });
        }
      });
    }
    return;
  }

  if (state.nextRunAt) {
    if (now > state.nextRunAt + 30000) {
      logInfo('Health check: scheduled next run time was missed, executing query now');
      runScheduledQuery();
    }
    return;
  }

  const lastNav = state.lastQueryStartedAt || 0;
  if (!lastNav || (now - lastNav > 45000)) {
    logInfo('Health check: scanner idle with no active scroll or schedule, advancing');
    executeNextQuery(state.scannerGeneration);
  }
}

function finishCurrentQuery(gen, reason = 'complete') {
  if (!state.isRunning) return;
  if (gen && gen !== state.scannerGeneration && reason !== 'forced') {
    logInfo(`Ignored finishCurrentQuery with mismatched gen ${gen} (current: ${state.scannerGeneration})`);
    return;
  }
  if (!state.activeScrollGeneration && reason !== 'forced' && reason !== 'timeout') {
    return;
  }

  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear(ALARM_SCROLL_WATCHDOG);
  }
  state.activeScrollGeneration = null;
  state.scrollStartedAt = 0;
  state.scrollTimeoutMs = 0;
  state.pendingScrollTask = null;

  if (reason === 'timeout') {
    logError('Scroll timed out, moving to next query');
    if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
      chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_SCROLL' }).catch(()=>null);
    }
  } else {
    logInfo('Query complete');
  }

  const activeGen = state.scannerGeneration;

  if (state.eodScanActive) {
    state.eodTargetIndex++;
    state.nextRunAt = null;
    saveState();
    const delay = 5000 + Math.floor(Math.random() * 3000);
    scheduleNextQuery(activeGen, delay);
    return;
  }

  state.currentQueryIndex++;
  state.nextRunAt = null;
  saveState();

  const scanIntervalMinutes = toSettingNumber(settings.scanInterval, 10);
  if (state.currentQueryIndex >= tasksList.length) {
    state.currentQueryIndex = 0;
    saveState();
    logInfo(`Cycle complete. Waiting ${scanIntervalMinutes} minutes...`);
    refreshDynamicSources();
    scheduleNextQuery(activeGen, scanIntervalMinutes * 60 * 1000);
  } else {
    const delay = 60000 + Math.floor(Math.random() * 60000);
    scheduleNextQuery(activeGen, delay);
  }
}

function handleScrollWatchdog() {
  if (!state.isRunning || !state.activeScrollGeneration) return;
  finishCurrentQuery(state.activeScrollGeneration, 'timeout');
}

function checkTabAndResume() {
   const gen = state.scannerGeneration;
   if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.get) {
      chrome.tabs.get(state.scannerTabId, (tab) => {
         if ((chrome.runtime && chrome.runtime.lastError) || !tab) {
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

  const now = Date.now();
  for (const it of pendingItems) {
    if (it.retryCount === undefined) it.retryCount = 0;
    if (it.nextRetry === undefined) it.nextRetry = now;
    if (it.status === undefined) it.status = 'pending';
  }

  const readyItem = pendingItems.find(i => now >= (i.nextRetry || 0));
  if (!readyItem) {
    const earliest = Math.min(...pendingItems.map(i => i.nextRetry || now));
    sending = false;
    scheduleQueue(Math.max(1000, earliest - now));
    return;
  }

  sending = true;
  const item = readyItem;

  const tweet = item.payload;
  if (!tweet.is_x_list && !tweet.is_parser_target && !passesQualityGate(tweet, settings)) {
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
      body: JSON.stringify(tweet),
      signal: AbortSignal.timeout(15000)
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
      item.retryCount = (item.retryCount || 0) + 1;
      if (item.retryCount >= 3) {
        logError(`Auth error repeated 3 times for ${tweet.tweet_id}, marking failed.`);
        item.status = 'failed';
      } else {
        item.nextRetry = Date.now() + 60000;
      }
      await saveState();
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    logError(`Worker connection error: ${error.message}`);
    item.retryCount = (item.retryCount || 0) + 1;
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
  const hasMoreReady = tweetQueue.some(i => i.status !== 'failed' && Date.now() >= (i.nextRetry || 0));
  scheduleQueue(hasMoreReady ? 500 : 2000);
}

let radarStats = { tweetsSeen: 0, localPassed: 0, moniChecked: 0, moniPassed: 0, rejected: 0, sent: 0 };
let statsTimeout = null;
function saveStats() {
    clearTimeout(statsTimeout);
    statsTimeout = setTimeout(() => {
        chrome.storage.local.set({ radarStats });
    }, 1000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'START_SCANNER') {
    storageReady.then(startScanner);
    return;
  }
  if (msg.type === 'STOP_SCANNER') {
    storageReady.then(stopScanner);
    return;
  }
  if (msg.type === 'CLEAR_QUEUE') {
    storageReady.then(() => {
      tweetQueue = [];
      saveState();
    });
    return;
  }
  if (msg.type === 'UPDATE_SETTINGS') {
    storageReady.then(async () => {
      settings = { ...settings, ...msg.settings };
      await chrome.storage.local.set({ settings });
      refreshDynamicSources(true);
      processQueue();
    });
    return;
  }
  if (msg.type === 'UPDATE_STATS') {
    storageReady.then(() => {
      radarStats[msg.key] = (radarStats[msg.key] || 0) + 1;
      saveStats();
    });
    return;
  }
  if (msg.type === 'GET_STATE') {
    storageReady.then(() => {
      sendResponse({ state, queue: tweetQueue, queriesLength: tasksList.length, sourceAccounts: dynamicSourceAccounts });
    });
    return true;
  }
  
  if (msg.type === 'TRANSLATE_AND_ENQUEUE') {
    storageReady.then(async () => {
      const tweetId = msg.payload && msg.payload.tweet_id;
      if (!tweetId) return;

      const res = await chrome.storage.local.get(['processed_' + tweetId, 'processedTweetIds']);
      const processedList = Array.isArray(res.processedTweetIds) ? res.processedTweetIds : [];
      if (!res['processed_' + tweetId] && !processedList.includes(tweetId)) {
        processedList.push(tweetId);
        const boundedList = processedList.length > 5000 ? processedList.slice(processedList.length - 5000) : processedList;
        await chrome.storage.local.set({
          ['processed_' + tweetId]: true,
          processedTweetIds: boundedList
        });

        // Translate full text client-side (no CF block)
        if (msg.payload.text) {
          let snippet = msg.payload.text.length > 4000 ? msg.payload.text.substring(0, 4000) + '...' : msg.payload.text;
          try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(snippet)}`;
            const tres = await fetch(url, { signal: AbortSignal.timeout(15000) });
            const json = await tres.json();
            if (json && json[0]) {
              msg.payload.translated_text = json[0].map(segment => segment[0]).join('');
            }
          } catch(e) {
            console.error("Translation fail", e);
          }
        }

        tweetQueue.push({ payload: msg.payload, retryCount: 0, nextRetry: Date.now(), status: 'pending' });
        await saveState();
        processQueue();
      }
    });
    return;
  }
  
  if (msg.type === 'PROFILE_META_SCRAPED') {
    storageReady.then(async () => {
      const meta = msg.payload;
      if (!meta || !meta.username) return;
      if (!settings.workerUrl || !settings.clientKey) return;
      const baseUrl = settings.workerUrl.replace(/\/+$/, '');
      try {
        logInfo(`Posting scraped profile_meta for @${meta.username} to ${baseUrl}/api/miniapp/profile_meta`);
        const res = await fetch(`${baseUrl}/api/miniapp/profile_meta`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-key': settings.clientKey
          },
          body: JSON.stringify(meta),
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) {
          logError(`profile_meta POST failed with HTTP ${res.status}`);
        } else {
          const json = await res.json().catch(() => ({}));
          logInfo(`profile_meta posted successfully for @${meta.username}: ${JSON.stringify(json)}`);
        }
      } catch (err) {
        logError(`Error dispatching profile_meta for @${meta.username}: ${err.message}`);
      }
    });
    return;
  }
  
  if (msg.type === 'START_OBSERVER_PROXY') {
    storageReady.then(() => {
      const tabId = state.scannerTabId || sender?.tab?.id;
      if (tabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
        chrome.tabs.sendMessage(tabId, {
          type: 'START_OBSERVER',
          isXList: msg.isXList,
          isParserTarget: msg.isParserTarget
        }).catch(() => null);
      }
    });
    return;
  }

  if (msg.type === 'CHECK_NEW_TWEETS_PROXY') {
    storageReady.then(() => {
      const tabId = state.scannerTabId || sender?.tab?.id;
      if (tabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
        chrome.tabs.sendMessage(tabId, { type: 'CHECK_NEW_TWEETS' }, (resp) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.error('[RADAR] Tab error:', chrome.runtime.lastError);
            sendResponse({ newCount: 0 });
          } else {
            sendResponse(resp || { newCount: 0 });
          }
        });
      } else {
        sendResponse({ newCount: 0 });
      }
    });
    return true;
  }

  if (msg.type === 'IS_SCANNER_TAB') {
    storageReady.then(() => {
      const isScanner = Boolean(state.isRunning && sender?.tab && sender.tab.id === state.scannerTabId);
      const activeTask = (isScanner && state.pendingScrollTask && state.pendingScrollTask.generation === state.scannerGeneration)
        ? state.pendingScrollTask
        : null;
      sendResponse({ isScannerTab: isScanner, isRunning: state.isRunning, activeScrollTask: activeTask });
    });
    return true;
  }

  if (msg.type === 'SCROLL_DONE') {
    storageReady.then(() => {
      const gen = msg.generation || state.activeScrollGeneration || state.scannerGeneration;
      finishCurrentQuery(gen);
    });
    return;
  }
});

function navigateTab(url, cb, options = {}) {
  if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.get) {
    chrome.tabs.get(state.scannerTabId, (tab) => {
      if ((chrome.runtime && chrome.runtime.lastError) || !tab) {
         createTab(url, cb);
      } else if (options.forceReload) {
         state.lastPageReloadAt = Date.now();
         saveState();
         logInfo('Refreshing scanner tab before search');
         if (typeof chrome.tabs.update === 'function') {
           chrome.tabs.update(state.scannerTabId, { url: url }, (updatedTab) => {
             cb(updatedTab || tab);
           });
         } else {
           cb(tab);
         }
      } else {
         // Try in-page SPA navigation first to avoid full reload
         chrome.tabs.sendMessage(state.scannerTabId, { type: 'NAVIGATE_IN_PAGE', url: url }, (response) => {
             if ((chrome.runtime && chrome.runtime.lastError) || !response || !response.success) {
                 // Fallback to update if content script is not injected
                 if (typeof chrome.tabs.update === 'function') {
                   chrome.tabs.update(state.scannerTabId, { url: url }, (updatedTab) => {
                     cb(updatedTab || tab);
                   });
                 } else {
                   cb(tab);
                 }
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
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: url, active: false }, (tab) => {
       state.scannerTabId = tab ? tab.id : null;
       saveState();
       cb(tab);
    });
  } else {
    cb(null);
  }
}


function executeNextQuery(gen, resume = false) {
  if (!state.isRunning || tasksList.length === 0 || gen !== state.scannerGeneration) return;
  if (state.activeScrollGeneration && !resume) return;

  if (state.eodScanActive) {
      if (state.eodTargetIndex >= state.eodTargets.length) {
          state.eodScanActive = false;
          state.eodTargets = [];
          const baseUrl = settings.workerUrl.replace(/\/+$/, '');
          const adminChatId = settings.adminChatId || (typeof CONFIG !== 'undefined' && CONFIG.adminChatId ? CONFIG.adminChatId : '332680373');
          fetch(`${baseUrl}/api/miniapp/admin/targets/summary_done?chat_id=${encodeURIComponent(adminChatId)}`, {
              method: 'POST',
              headers: { 'x-client-key': settings.clientKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
              signal: AbortSignal.timeout(15000)
          }).catch(console.error);
          state.nextEodScanAt = Date.now() + 2 * 60 * 60 * 1000;
          saveState();
          logInfo('Finished EOD scan. Returning to normal scanner.');
          setTimeout(() => executeNextQuery(gen, resume), 1000);
          return;
      }
      
      const rawTarget = state.eodTargets[state.eodTargetIndex];
      const username = typeof rawTarget === 'string' ? rawTarget : (rawTarget?.username || '');
      logInfo(`EOD Scan Profile ${state.eodTargetIndex + 1}/${state.eodTargets.length}: ${username}`);
      
      const searchUrl = `https://x.com/${username}`;
      if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_OBSERVER' }).catch(()=>null);
      }

      const waitTime = 8000 + Math.floor(Math.random() * 4000);
      const scrollTimeout = waitTime + (3 * 25000) + 60000;
      const scrollTask = {
        generation: gen,
        maxScrolls: 3,
        isXList: false,
        isParserTarget: true
      };

      state.nextRunAt = null;
      state.lastQueryStartedAt = Date.now();
      state.activeScrollGeneration = gen;
      state.scrollStartedAt = Date.now();
      state.scrollTimeoutMs = scrollTimeout;
      state.pendingScrollTask = scrollTask;
      saveState();
      scheduleAlarm(ALARM_SCROLL_WATCHDOG, scrollTimeout);

      navigateTab(searchUrl, (tab) => {
          if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
            chrome.tabs.sendMessage(state.scannerTabId, { type: 'START_KEEPALIVE' }).catch(()=>null);
          }
          setTimeout(() => {
              if (state.isRunning && gen === state.scannerGeneration && state.activeScrollGeneration === gen) {
                  dispatchStartScroll(state.scannerTabId, scrollTask);
              }
          }, waitTime);
      }, { forceReload: shouldForcePageReload() });
      return;
  }
  
  // Normal mode: Check if it's time for EOD scan
  if (Date.now() >= (state.nextEodScanAt || 0) && !state.eodScanActive) {
      logInfo('Starting scheduled EOD targets scan...');
      const baseUrl = settings.workerUrl.replace(/\/+$/, '');
      const adminChatId = settings.adminChatId || (typeof CONFIG !== 'undefined' && CONFIG.adminChatId ? CONFIG.adminChatId : '332680373');
      fetch(`${baseUrl}/api/miniapp/admin/targets?chat_id=${encodeURIComponent(adminChatId)}`, {
          headers: { 'x-client-key': settings.clientKey },
          signal: AbortSignal.timeout(15000)
      }).then(r => r.json()).then(res => {
          if (res.targets && res.targets.length > 0) {
              state.eodScanActive = true;
              state.eodTargets = (res.targets || []).map(t => typeof t === 'string' ? t : (t.username || t));
              state.eodTargetIndex = 0;
              saveState();
              executeNextQuery(gen, resume);
          } else {
              state.nextEodScanAt = Date.now() + 2 * 60 * 60 * 1000;
              saveState();
              // No targets, just continue normally
              executeNextQueryOriginal(gen, resume);
          }
      }).catch(e => {
          logError('Failed to fetch EOD targets: ' + e.message);
          state.nextEodScanAt = Date.now() + 5 * 60 * 1000;
          saveState();
          executeNextQueryOriginal(gen, resume);
      });
      return;
  }
  
  executeNextQueryOriginal(gen, resume);
}

function executeNextQueryOriginal(gen, resume = false) {
  if (!state.isRunning || tasksList.length === 0 || gen !== state.scannerGeneration) return;
  if (state.activeScrollGeneration && !resume) return;
  if (state.currentQueryIndex >= tasksList.length) state.currentQueryIndex = 0;
  
  const task = tasksList[state.currentQueryIndex];
  logInfo(`Task ${state.currentQueryIndex + 1}/${tasksList.length} (${task.tab.toUpperCase()}): ${task.query}`);
  
  const encodedQuery = encodeURIComponent(task.query);
  let searchUrl;
  if (task.isXList) {
    searchUrl = `https://x.com/i/lists/2100655965091606668`;
  } else {
    searchUrl = task.tab === 'latest' 
      ? `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`
      : `https://x.com/search?q=${encodedQuery}&src=typed_query`;
  }
  
  if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
     chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_OBSERVER' }).catch(()=>null);
  }

  const maxScrollsVal = toSettingNumber(settings.maxScrolls, 15);
  const scrollCount = Math.max(2, Math.floor(maxScrollsVal * task.scrollRatio));
  const scrollTimeout = 6000 + (scrollCount * 25000) + 60000;
  const scrollTask = {
    generation: gen,
    maxScrolls: scrollCount,
    isXList: Boolean(task.isXList),
    isParserTarget: false
  };

  state.nextRunAt = null;
  state.lastQueryStartedAt = Date.now();
  state.activeScrollGeneration = gen;
  state.scrollStartedAt = Date.now();
  state.scrollTimeoutMs = scrollTimeout;
  state.pendingScrollTask = scrollTask;
  saveState();
  scheduleAlarm(ALARM_SCROLL_WATCHDOG, scrollTimeout);

  navigateTab(searchUrl, (tab) => {
     if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
       chrome.tabs.sendMessage(state.scannerTabId, { type: 'START_KEEPALIVE' }).catch(()=>null);
     }
     setTimeout(() => {
        if (state.isRunning && gen === state.scannerGeneration && state.activeScrollGeneration === gen) {
           dispatchStartScroll(state.scannerTabId, scrollTask);
        }
     }, 6000); // 6 seconds wait for SPA transition
  }, { forceReload: shouldForcePageReload() });
}

async function cleanupStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  const res = await chrome.storage.local.get(null);
  const keys = Object.keys(res).filter(k => k.startsWith('processed_'));
  if (keys.length > 500) {
     const toRemove = keys.slice(0, keys.length - 200);
     await chrome.storage.local.remove(toRemove);
     logInfo(`Cleaned up ${toRemove.length} processed tweet keys from storage.`);
  }
  if (Array.isArray(res.processedTweetIds) && res.processedTweetIds.length > 5000) {
     const trimmed = res.processedTweetIds.slice(res.processedTweetIds.length - 5000);
     await chrome.storage.local.set({ processedTweetIds: trimmed });
  }
}

async function startScanner() {
  await cleanupStorage();
  if (state.isRunning) {
     logInfo('Restarting loop strictly.');
  }
  logInfo('Starting RADAR');
  state.isRunning = true;
  state.scannerGeneration = Date.now();
  state.nextRunAt = null;
  state.activeScrollGeneration = null;
  state.scrollStartedAt = 0;
  state.scrollTimeoutMs = 0;
  state.pendingScrollTask = null;
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear(ALARM_NEXT_QUERY);
    chrome.alarms.clear(ALARM_SCROLL_WATCHDOG);
    chrome.alarms.create(ALARM_HEALTH_CHECK, { periodInMinutes: 1 });
  }
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
  state.scrollStartedAt = 0;
  state.scrollTimeoutMs = 0;
  state.pendingScrollTask = null;
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear(ALARM_NEXT_QUERY);
    chrome.alarms.clear(ALARM_SCROLL_WATCHDOG);
    chrome.alarms.clear(ALARM_HEALTH_CHECK);
  }
  saveState();
  if (state.scannerTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
     chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_SCROLL' }).catch(()=>null);
     chrome.tabs.sendMessage(state.scannerTabId, { type: 'STOP_KEEPALIVE' }).catch(()=>null);
  }
}


