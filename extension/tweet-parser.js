var WHITELIST_FORM_PATTERNS = (typeof WHITELIST_FORM_PATTERNS !== 'undefined' ? WHITELIST_FORM_PATTERNS : [
  /https?:\/\/(?:www\.)?premint\.xyz\/[^\s<>"')]+/i,
  /https?:\/\/(?:www\.)?alphabot\.app\/[^\s<>"')]+/i,
  /https?:\/\/(?:www\.)?heymint\.xyz\/[^\s<>"')]+/i,
  /https?:\/\/forms\.gle\/[^\s<>"')]+/i,
  /https?:\/\/docs\.google\.com\/forms\/[^\s<>"')]+/i,
  /\b(?:premint\.xyz|alphabot\.app|heymint\.xyz|forms\.gle)\/[^\s<>"')]+/i,
  /\bdocs\.google\.com\/forms\/[^\s<>"')]+/i
]);

function extractProfileMeta(targetUsername = null, doc = (typeof document !== 'undefined' ? document : null)) {
  try {
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

function extractTweetData(articleNode) {
  try {
    const timeEl = articleNode.querySelector('time');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : null;
    
    const links = Array.from(articleNode.querySelectorAll('a[href]'));
    const tweetLink = links.find(a => a.href.includes('/status/') && !a.href.includes('/photo/') && !a.href.includes('/video/') && !a.href.includes('/analytics'));
    
    if (!tweetLink) return null;
    
    let tweet_url = tweetLink.href.split('?')[0];
    tweet_url = tweet_url.replace('twitter.com', 'x.com').replace(/\/+$/, '');
    
    const statusMatch = tweet_url.match(/\/status\/(\d+)/);
    if (!statusMatch) return null;
    const tweet_id = statusMatch[1];
    
    const userMatch = tweet_url.match(/x\.com\/([^/]+)\/status/);
    const username = userMatch ? userMatch[1] : (tweet_url.split('/')[3] || '');
    
    const userNameEl = articleNode.querySelector('[data-testid="User-Name"]');
    const userHeaderContainer = userNameEl ? (userNameEl.parentElement || userNameEl) : null;
    const headerText = userHeaderContainer ? (userHeaderContainer.innerText || userHeaderContainer.textContent || '') : '';
    const currentPath = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    const currentStatusMatch = currentPath.match(/^\/[^/]+\/status\/(\d+)/);
    const pathParts = currentPath.split('/').filter(Boolean);
    const excludedPathSegments = ['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings'];
    const currentPathAuthor = (pathParts.length > 0 && !excludedPathSegments.includes(pathParts[0].toLowerCase())) ? pathParts[0] : null;

    const socialContext = articleNode.querySelector('[data-testid="socialContext"]');
    const is_pinned = socialContext ? /pinned|закреп/i.test(socialContext.innerText || socialContext.textContent || '') : false;

    // Scoped strictly to header context above tweet body, avoiding false drops when tweet text mentions "Replying to"
    const isReplyHeader = /(?:Replying to|В ответ|En respuesta a|Antwort an|En réponse à)/i.test(headerText);
    const is_reply = Boolean(currentStatusMatch && currentStatusMatch[1] !== tweet_id) || Boolean(isReplyHeader);

    // F9: Extract reply_to handle and identify self-reply
    let reply_to = null;
    const replyMatch = headerText.match(/(?:Replying to|В ответ|En respuesta a|Antwort an|En réponse à)\s*@?([A-Za-z0-9_]+)/i);
    if (replyMatch) {
      reply_to = replyMatch[1];
    } else if (isReplyHeader && userHeaderContainer) {
      const headerLinks = Array.from(userHeaderContainer.querySelectorAll('a'));
      for (const a of headerLinks) {
        const hText = (a.innerText || a.textContent || '').trim();
        if (hText.startsWith('@')) {
          reply_to = hText.slice(1);
          break;
        }
      }
    }

    if (!reply_to || (username && reply_to.toLowerCase() !== username.toLowerCase())) {
      if (isReplyHeader && username) {
        const selfMentionPattern = new RegExp(`(?:Replying to|В ответ|En respuesta a|Antwort an|En réponse à)[\\s\\S]*?@?${username}\\b`, 'i');
        if (selfMentionPattern.test(headerText)) {
          reply_to = username;
        }
      }
    }

    const is_self_reply = Boolean(reply_to && username && reply_to.toLowerCase() === username.toLowerCase())
      || Boolean(currentStatusMatch && currentPathAuthor && username && currentPathAuthor.toLowerCase() === username.toLowerCase());
    
    const nameEl = userNameEl || articleNode.querySelector('[data-testid="User-Name"]');
    let display_name = username;
    let is_verified = false;
    
    if (nameEl) {
       const lines = (nameEl.innerText || nameEl.textContent || '').split('\n');
       display_name = lines[0] || username;
       if (nameEl.querySelector('svg[aria-label="Verified account"]') || nameEl.querySelector('svg[data-testid="icon-verified"]')) {
           is_verified = true;
       }
    }
    
    const showMoreBtn = articleNode.querySelector('[data-testid="tweet-text-show-more-link"]');
    if (showMoreBtn) {
      try { showMoreBtn.click(); } catch (_) {}
    }

    const textEl = articleNode.querySelector('[data-testid="tweetText"]');
    const text = textEl ? (textEl.innerText || textEl.textContent || '') : '';
    
    const extractedLinks = [];
    const addLink = (url) => {
      if (url && !extractedLinks.includes(url)) extractedLinks.push(url);
    };
    links.forEach(a => {
      const href = a.href;
      if (!href || href.startsWith('https://x.com') || href.startsWith('https://twitter.com') || href.startsWith('/')) return;

      const titleAttr = a.getAttribute('title');
      if (titleAttr && /^https?:\/\/[^\s]+$/i.test(titleAttr.trim())) {
        addLink(titleAttr.trim());
        return;
      }

      const visibleText = (a.innerText || a.textContent || '').trim();
      const hasEllipsis = visibleText.includes('…') || visibleText.includes('...');
      if (!hasEllipsis && /^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(visibleText)) {
        addLink(`https://${visibleText}`);
      } else if (!hasEllipsis && /^https?:\/\//i.test(visibleText)) {
        addLink(visibleText);
      } else if (/^https?:\/\//i.test(href)) {
        addLink(href);
      }
    });

    let source_profile = null;
    if (typeof window !== 'undefined' && window.location) {
        const profileMatch = (window.location.pathname || '').match(/^\/([^/]+)/);
        const excluded = ['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings'];
        if (profileMatch && !excluded.includes(profileMatch[1].toLowerCase())) {
             source_profile = profileMatch[1];
        }
    }

    // F11: Whitelist Form Hunter
    let form_link = null;
    let form_platform = null;

    const checkFormUrl = (url) => {
      if (!url || typeof url !== 'string') return null;
      const trimmed = url.trim();
      if (/premint\.xyz/i.test(trimmed)) return { url: trimmed, platform: 'premint' };
      if (/alphabot\.app/i.test(trimmed)) return { url: trimmed, platform: 'alphabot' };
      if (/heymint\.xyz/i.test(trimmed)) return { url: trimmed, platform: 'heymint' };
      if (/forms\.gle|docs\.google\.com\/forms/i.test(trimmed)) return { url: trimmed, platform: 'google_forms' };
      return null;
    };

    const normalizeFormUrl = (raw) => {
      if (!raw) return null;
      let u = raw.trim();
      if (!/^https?:\/\//i.test(u)) {
        u = 'https://' + u;
      }
      return u;
    };

    // First inspect extractedLinks
    for (const link of extractedLinks) {
      const match = checkFormUrl(link);
      if (match) {
        form_link = normalizeFormUrl(match.url);
        form_platform = match.platform;
        break;
      }
    }

    // If not found in extractedLinks, inspect text
    if (!form_link && text) {
      for (const pattern of WHITELIST_FORM_PATTERNS) {
        const m = text.match(pattern);
        if (m) {
          const match = checkFormUrl(m[0]);
          if (match) {
            form_link = normalizeFormUrl(match.url);
            form_platform = match.platform;
            if (!extractedLinks.includes(form_link)) {
              extractedLinks.push(form_link);
            }
            break;
          }
        }
      }
    }

    const is_whitelist_form = Boolean(form_link);

    // F10: Extract profile metadata if available on profile page
    let profile_meta = null;
    try {
      if (typeof extractProfileMeta === 'function') {
        const meta = extractProfileMeta(source_profile || username);
        if (meta && meta.username) {
          profile_meta = meta;
        }
      }
    } catch (_) {}

    // Extract cashtags from text (e.g. $SOL, $BTC, $ETH)
    const cashtags = [...new Set((text.match(/\$[A-Za-z0-9_]{1,10}\b/g) || []).map(c => c.toUpperCase()))];

    // Extract EVM & Solana contract addresses
    const evmMatches = text.match(/\b(0x[a-fA-F0-9]{40})\b/g) || [];
    const solMatches = text.match(/\b([1-9A-HJ-NP-za-km-z]{32,44})\b/g) || [];
    const contracts = [...new Set([...evmMatches, ...solMatches])];

    // Extract media photos
    const mediaPhotos = Array.from(articleNode.querySelectorAll('[data-testid="tweetPhoto"] img'))
      .map(img => (img.getAttribute ? (img.getAttribute('src') || img.src) : img.src))
      .filter(Boolean);
      
    return {
      tweet_id,
      tweet_url,
      username,
      display_name,
      is_verified,
      is_reply,
      is_self_reply,
      reply_to: reply_to || null,
      is_pinned,
      text,
      timestamp,
      links: [...new Set(extractedLinks)],
      source_profile,
      cashtags,
      contracts,
      media_urls: [...new Set(mediaPhotos)],
      form_link: form_link || null,
      form_platform: form_platform || null,
      is_whitelist_form,
      profile_meta
    };
  } catch (e) {
    console.error('[RADAR] Error parsing tweet', e);
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.extractTweetData = extractTweetData;
  window.extractProfileMeta = extractProfileMeta;
  window.WHITELIST_FORM_PATTERNS = WHITELIST_FORM_PATTERNS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractTweetData,
    extractProfileMeta,
    WHITELIST_FORM_PATTERNS
  };
}

