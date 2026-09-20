let observer = null;
let processedTweetIds = new Set();
const MAX_PROCESSED_IDS = 10000;
let debounceTimer = null;
let newTweetsInCurrentScroll = 0;

function parseTwitterNumber(str) {
    if (!str) return null;
    let s = str.toUpperCase().replace(/,/g, '').trim();
    let mult = 1;
    if (s.endsWith('K')) { mult = 1000; s = s.slice(0, -1); }
    if (s.endsWith('M')) { mult = 1000000; s = s.slice(0, -1); }
    const val = parseFloat(s);
    return isNaN(val) ? null : Math.floor(val * mult);
}

window.getFollowerCountViaHover = async function(username, articleNode) {
    const trigger = articleNode.querySelector(`a[href^="/${username}"]`);
    if (!trigger) return null;

    trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 20; 
        
        const check = () => {
            const followerLink = document.querySelector(`#layers a[href="/${username}/followers"]`);
            if (followerLink) {
                const text = followerLink.innerText || "";
                const match = text.match(/[\d,.]+[KMkm]?/);
                let count = null;
                if (match) count = parseTwitterNumber(match[0]);
                
                trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                
                setTimeout(() => resolve(count), 200);
                return;
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
                trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                resolve(null);
            } else {
                setTimeout(check, 100);
            }
        };
        setTimeout(check, 100);
    });
};

function updateStats(key) {
   chrome.storage.local.get(['radarStats'], (res) => {
      let stats = res.radarStats || { tweetsSeen: 0, localPassed: 0, moniChecked: 0, moniPassed: 0, rejected: 0, sent: 0 };
      stats[key] = (stats[key] || 0) + 1;
      chrome.storage.local.set({ radarStats: stats });
   });
}

function toSettingNumber(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getQualitySettings(settings = {}) {
    return {
        moniFilterEnabled: settings.moniFilterEnabled !== false,
        moniFilterMinScore: toSettingNumber(settings.moniFilterMinScore, 1000),
        moniFilterIfUnavailable: settings.moniFilterIfUnavailable || 'reject',
        minFollowers: toSettingNumber(settings.minFollowers, 0)
    };
}

function passesQualityGate(data, settings = {}) {
    const s = getQualitySettings(settings);
    const moniScore = data.moni_score;
    const followerCount = data.follower_count;

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

let hoverQueue = [];
let isProcessingHoverQueue = false;

async function pumpHoverQueue() {
    if (isProcessingHoverQueue) return;
    isProcessingHoverQueue = true;
    
    while (hoverQueue.length > 0) {
        const item = hoverQueue.shift();
        try {
            await item();
        } catch (e) {
            console.error('[RADAR] Hover error', e);
        }
    }
    
    isProcessingHoverQueue = false;
}

function processArticles(articles, isInitial = false) {
  articles.forEach(article => {
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) return;
    
    processedTweetIds.add(data.tweet_id);
    if (!isInitial) newTweetsInCurrentScroll++; 
    
    if (processedTweetIds.size >= MAX_PROCESSED_IDS) {
       const arr = Array.from(processedTweetIds);
       processedTweetIds = new Set(arr.slice(arr.length - 5000));
    }
    
    updateStats('tweetsSeen');

    if (data.is_reply) {
        updateStats('rejected');
        console.log(`[RADAR] Reply/comment rejected: ${data.tweet_id}`);
        return;
    }
    
    // Check age (Max 2 days)
    if (data.timestamp) {
        const tweetDate = new Date(data.timestamp);
        if (!isNaN(tweetDate.getTime())) {
            const ageDays = (Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays > 2) {
                updateStats('rejected');
                return;
            }
        }
    }
    
    // IMPORTANT: Check Local Filter FIRST!
    let passLocal = false;
    if (currentTaskIsXList) {
        passLocal = window.passesXListLocalFilter(data.text);
        data.is_x_list = true;
    } else {
        passLocal = window.passesLocalFilter(data.text);
        data.is_x_list = false;
    }
    
    if (!passLocal) {
       updateStats('rejected');
       return;
    }
    
    updateStats('localPassed');
    
    // Enqueue async processing
    hoverQueue.push(async () => {
        updateStats('moniChecked');
        const moni_score = await window.getMoniScore(data.username, article);
        data.moni_score = moni_score;
        
        const followerCount = await window.getFollowerCountViaHover(data.username, article);
        data.follower_count = followerCount;
        
        return new Promise((resolve) => {
            chrome.storage.local.get(['settings'], (res) => {
               const s = res.settings || {};
               const qualitySettings = getQualitySettings(s);
               data.quality_filter = qualitySettings;

               if (!data.is_x_list && !passesQualityGate(data, qualitySettings)) {
                   updateStats('rejected');
                   console.log(`[RADAR] Quality rejected: ${data.tweet_id}, Moni: ${moni_score}, Followers: ${followerCount}`);
                   resolve();
                   return;
               }
               
               updateStats('moniPassed');
               updateStats('sent');
               console.log(`[RADAR] Found relevant tweet: ${data.tweet_id}, Moni: ${moni_score}, Followers: ${followerCount}`);
               chrome.runtime.sendMessage({ type: 'TRANSLATE_AND_ENQUEUE', payload: data });
               resolve();
            });
        });
    });
  });
  
  pumpHoverQueue();
}

let currentTaskIsXList = false;

function processTweets() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  processArticles(articles, false);
}

function startObserver(isXList = false) {
  currentTaskIsXList = isXList;
  if (!observer) {
      console.log('[RADAR] Starting Observer (isXList: ' + isXList + ')');
      observer = new MutationObserver((mutations) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processTweets, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
  }
  
  // Process initial snapshot
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  processArticles(articles, true);
  
  newTweetsInCurrentScroll = 0;
}

function stopObserver() {
  if (observer) {
    console.log('[RADAR] Stopping Observer');
    observer.disconnect();
    observer = null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_OBSERVER') startObserver(msg.isXList);
  if (msg.type === 'STOP_OBSERVER') stopObserver();
  if (msg.type === 'CHECK_NEW_TWEETS') {
     sendResponse({ newCount: newTweetsInCurrentScroll });
     newTweetsInCurrentScroll = 0; 
  }
  if (msg.type === 'NAVIGATE_IN_PAGE') {
     console.log('[RADAR] Navigating in page to:', msg.url);
     let a = document.createElement('a');
     a.href = msg.url;
     document.body.appendChild(a);
     a.click();
     a.remove();
     sendResponse({ success: true });
  }
});
