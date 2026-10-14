let observer = null;
let processedTweetIds = new Set();
const MAX_PROCESSED_IDS = 10000;
let debounceTimer = null;
let newTweetsInCurrentScroll = 0;

function parseTwitterNumber(str) {
    if (!str) return null;
    let s = str.toUpperCase().trim();
    if (/^\d+,\d{1,2}$/.test(s) || /^\d+,\d+[KM]$/.test(s)) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    let mult = 1;
    if (s.endsWith('K')) { mult = 1000; s = s.slice(0, -1); }
    if (s.endsWith('M')) { mult = 1000000; s = s.slice(0, -1); }
    const val = parseFloat(s);
    return isNaN(val) ? null : Math.floor(val * mult);
}
if (typeof window !== 'undefined') window.parseTwitterNumber = parseTwitterNumber;

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
            // Case-insensitive query selector for the followers link
            let followerLink = null;
            const links = document.querySelectorAll('#layers a[href*="/followers" i]');
            for (let a of links) {
                if (a.getAttribute('href').toLowerCase().includes(`/${username.toLowerCase()}/followers`)) {
                    followerLink = a;
                    break;
                }
            }
            if (!followerLink) {
               // Fallback: sometimes the hover card is directly inside #layers, sometimes not. Let's look anywhere in #layers.
               const anyLinks = document.querySelectorAll('#layers a');
               for (let a of anyLinks) {
                   const href = a.getAttribute('href');
                   if (href && href.toLowerCase().includes(`/${username.toLowerCase()}/followers`)) {
                       followerLink = a;
                       break;
                   }
               }
            }

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
   chrome.runtime.sendMessage({ type: 'UPDATE_STATS', key: key }).catch(()=>null);
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
      if (data.is_parser_target) return true; // ALWAYS PASS ADMIN TARGETS
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
    if (bothDisabled) return true;
    
    // Explicit requested logic: if Moni is not found, look at followers
    if (s.moniFilterEnabled && moniScore === null) {
        if (s.minFollowers > 0) return passFollowers;
        if (s.moniFilterIfUnavailable === 'reject') return false;
        return true; // allow if unavailable
    }
    
    return passFollowers || passMoni;
}

let hoverQueue = [];
let isProcessingHoverQueue = false;
if (typeof window !== 'undefined') {
    window.isHoverQueueBusy = () => isProcessingHoverQueue || hoverQueue.length > 0;
}

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

function extractProfileMeta(targetUsername = null) {
  if (typeof window !== 'undefined' && typeof window.extractProfileMeta === 'function' && window.extractProfileMeta !== extractProfileMeta) {
    return window.extractProfileMeta(targetUsername);
  }
  try {
    const doc = (typeof document !== 'undefined') ? document : null;
    if (!doc) return null;
    let username = targetUsername;
    if (!username && typeof window !== 'undefined' && window.location) {
      const pathname = window.location.pathname || '';
      const m = pathname.match(/^\/([^/]+)/);
      const excluded = ['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings'];
      if (m && !excluded.includes(m[1].toLowerCase())) {
        username = m[1];
      }
    }
    if (!username && doc.querySelector) {
      const handleEl = doc.querySelector('[data-testid="UserName"]');
      if (handleEl) {
        const text = handleEl.innerText || handleEl.textContent || '';
        const m = text.match(/@([A-Za-z0-9_]+)/);
        if (m) username = m[1];
      }
    }

    let bio = null;
    const bioEl = doc.querySelector ? doc.querySelector('[data-testid="UserDescription"]') : null;
    if (bioEl) {
      const rawBio = (bioEl.innerText || bioEl.textContent || '').trim();
      bio = rawBio.length > 0 ? rawBio : null;
    }

    let website_url = null;
    const urlEl = doc.querySelector ? doc.querySelector('[data-testid="UserUrl"]') : null;
    if (urlEl) {
      const a = (urlEl.querySelector ? urlEl.querySelector('a') : null) || (urlEl.tagName === 'A' ? urlEl : null);
      if (a) {
        const title = a.getAttribute ? a.getAttribute('title') : a.title;
        const href = a.getAttribute ? a.getAttribute('href') : a.href;
        const text = (a.innerText || a.textContent || '').trim();
        if (title && /^https?:\/\/[^\s]+$/i.test(title.trim())) {
          website_url = title.trim();
        } else if (href && !href.startsWith('/') && !href.includes('twitter.com') && !href.includes('x.com')) {
          website_url = href.trim();
        } else if (text && !text.includes('…') && !text.includes('...')) {
          website_url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
        } else if (href) {
          website_url = href.trim();
        }
      } else {
        const text = (urlEl.innerText || urlEl.textContent || '').trim();
        if (text) {
          website_url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
        }
      }
    }

    if (!username && !bio && !website_url) return null;

    return {
      username: username ? username.replace(/^@/, '').trim() : null,
      bio: bio || null,
      website_url: website_url || null
    };
  } catch (e) {
    console.error('[RADAR] Error extracting profile meta', e);
    return null;
  }
}
if (typeof window !== 'undefined') {
  window.extractProfileMeta = window.extractProfileMeta || extractProfileMeta;
}

let lastDispatchedProfileMetaKey = null;

function checkAndScrapeProfileMeta() {
  try {
    const metaExtractor = window.extractProfileMeta || extractProfileMeta;
    if (!metaExtractor) return null;

    const meta = metaExtractor();
    if (!meta || !meta.username) return null;

    const key = `${meta.username}:${meta.bio || ''}:${meta.website_url || ''}`;
    if (key !== lastDispatchedProfileMetaKey) {
      lastDispatchedProfileMetaKey = key;
      console.log('[RADAR] Scraped profile metadata for @' + meta.username, meta);
      chrome.runtime.sendMessage({
        type: 'PROFILE_META_SCRAPED',
        payload: meta
      }).catch((e) => console.warn('[RADAR] PROFILE_META_SCRAPED dispatch error:', e));
    }
    return meta;
  } catch (err) {
    console.warn('[RADAR] Error in checkAndScrapeProfileMeta:', err);
    return null;
  }
}

function processArticles(articles, isInitial = false) {
  const profileMeta = checkAndScrapeProfileMeta();
  const articlesList = Array.from(articles || []);

  for (let i = 0; i < articlesList.length; i++) {
    const article = articlesList[i];
    const data = window.extractTweetData(article);
    if (!data || processedTweetIds.has(data.tweet_id)) continue;
    
    processedTweetIds.add(data.tweet_id);
    if (!isInitial) newTweetsInCurrentScroll++; 
    
    if (processedTweetIds.size >= MAX_PROCESSED_IDS) {
       const arr = Array.from(processedTweetIds);
       processedTweetIds = new Set(arr.slice(arr.length - 5000));
    }
    
    updateStats('tweetsSeen');

    // F9: Only reject if it is a reply AND NOT a self-reply
    if (data.is_reply && !data.is_self_reply) {
        updateStats('rejected');
        console.log(`[RADAR] Reply/comment rejected: ${data.tweet_id}`);
        continue;
    }

    // F9: Thread reader / Self-reply concatenation (look ahead up to 3 consecutive author tweets)
    data.thread_count = 1;
    data.thread_ids = [data.tweet_id];
    for (let j = i + 1; j < Math.min(articlesList.length, i + 4); j++) {
      const nextArticle = articlesList[j];
      if (!nextArticle) break;
      const nextData = window.extractTweetData(nextArticle);
      if (!nextData) break;
      const isSameAuthor = Boolean(nextData.username && data.username && nextData.username.toLowerCase() === data.username.toLowerCase());
      if (!isSameAuthor) break;
      const isContinuation = Boolean(
        nextData.is_self_reply ||
        (nextData.reply_to && data.username && nextData.reply_to.toLowerCase() === data.username.toLowerCase()) ||
        nextData.is_reply
      );
      if (!isContinuation) break;

      data.text = (data.text || '') + `\n\n--- [Thread Continuation] ---\n${nextData.text || ''}`;
      data.links = [...new Set([...(data.links || []), ...(nextData.links || [])])];
      data.cashtags = [...new Set([...(data.cashtags || []), ...(nextData.cashtags || [])])];
      data.contracts = [...new Set([...(data.contracts || []), ...(nextData.contracts || [])])];
      data.media_urls = [...new Set([...(data.media_urls || []), ...(nextData.media_urls || [])])];

      if (!data.form_link && nextData.form_link) {
        data.form_link = nextData.form_link;
        data.form_platform = nextData.form_platform;
        data.is_whitelist_form = nextData.is_whitelist_form;
      }

      processedTweetIds.add(nextData.tweet_id);
      data.thread_ids.push(nextData.tweet_id);
      data.thread_count = data.thread_ids.length;
    }

    // Attach profile_meta if available
    if (profileMeta && profileMeta.username && (!data.profile_meta || !data.profile_meta.bio || !data.profile_meta.website_url)) {
      data.profile_meta = profileMeta;
    }

    // Check age
    if (data.timestamp) {
          const tweetDate = new Date(data.timestamp);
          if (!isNaN(tweetDate.getTime())) {
             const ageDays = (Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24);
             
             if (currentTaskIsParserTarget) {
                 const isPinnedOrImportant = Boolean(data.is_pinned || /(mint|минт|airdrop|аирдроп|whitelist|вайтлист|tge|tokenomics|checker|чекер)/i.test(data.text || '') || data.is_whitelist_form);
                 const maxAge = isPinnedOrImportant ? 7.0 : 1.5; // Allow up to 7 days for pinned / key mint announcements
                 if (ageDays > maxAge) {
                     updateStats('rejected');
                     continue;
                 }
             } else {
                 if (ageDays > 2) {
                     updateStats('rejected');
                     continue;
                 }
             }
          } else {
             if (currentTaskIsParserTarget && !data.is_pinned) continue;
          }
      } else {
          if (currentTaskIsParserTarget && !data.is_pinned) continue;
      }
    
    // IMPORTANT: Check Local Filter FIRST!
    let passLocal = false;
    if (currentTaskIsXList) {
        passLocal = window.passesXListLocalFilter(data.text);
        data.is_x_list = true;
    } else if (currentTaskIsParserTarget) {
        passLocal = true; // DO NOT filter admin targets locally
        data.is_parser_target = true;
    } else {
        passLocal = window.passesLocalFilter(data.text, data.links);
        data.is_x_list = false;
    }
    
    if (!passLocal) {
       updateStats('rejected');
       continue;
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
               chrome.runtime.sendMessage({ type: 'TRANSLATE_AND_ENQUEUE', payload: data })
                 .catch((err) => {
                   console.warn('[RADAR] Dispatch failed; evicting tweet_id for retry:', err);
                   processedTweetIds.delete(data.tweet_id);
                 });
               resolve();
            });
        });
    });
  }
  
  pumpHoverQueue();
}

let currentTaskIsXList = false;
let currentTaskIsParserTarget = false;

function processTweets() {
  checkAndScrapeProfileMeta();
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  processArticles(articles, false);
}

function startObserver(isXList = false, isParserTarget = false) {
  currentTaskIsXList = Boolean(isXList);
  currentTaskIsParserTarget = Boolean(isParserTarget);
  checkAndScrapeProfileMeta();
  if (!observer) {
      console.log('[RADAR] Starting Observer (isXList: ' + currentTaskIsXList + ', isParserTarget: ' + currentTaskIsParserTarget + ')');
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
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (observer) {
    console.log('[RADAR] Stopping Observer');
    observer.disconnect();
    observer = null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_OBSERVER') startObserver(Boolean(msg.isXList), Boolean(msg.isParserTarget));
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

if (typeof window !== 'undefined') {
  window.processArticles = processArticles;
  window.checkAndScrapeProfileMeta = checkAndScrapeProfileMeta;
  window.extractProfileMeta = extractProfileMeta;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processArticles,
    extractProfileMeta,
    checkAndScrapeProfileMeta,
    passesQualityGate,
    parseTwitterNumber
  };
}
