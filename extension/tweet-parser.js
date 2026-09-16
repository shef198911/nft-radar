function extractTweetData(articleNode) {
  try {
    const timeEl = articleNode.querySelector('time');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : null;
    
    const links = Array.from(articleNode.querySelectorAll('a[href]'));
    const tweetLink = links.find(a => a.href.includes('/status/') && !a.href.includes('/photo/') && !a.href.includes('/video/') && !a.href.includes('/analytics'));
    
    if (!tweetLink) return null;
    
    let tweet_url = tweetLink.href.split('?')[0];
    tweet_url = tweet_url.replace('twitter.com', 'x.com');
    
    const urlParts = tweet_url.split('/');
    const tweet_id = urlParts[urlParts.length - 1];
    const username = urlParts[3];
    
    const nameEl = articleNode.querySelector('[data-testid="User-Name"]');
    let display_name = username;
    let is_verified = false;
    
    if (nameEl) {
       const lines = nameEl.innerText.split('\n');
       display_name = lines[0] || username;
       if (nameEl.querySelector('svg[aria-label="Verified account"]') || nameEl.querySelector('svg[data-testid="icon-verified"]')) {
           is_verified = true;
       }
    }
    
    const textEl = articleNode.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText : '';
    
    const extractedLinks = [];
    const addLink = (url) => {
      if (!extractedLinks.includes(url)) extractedLinks.push(url);
    };
    links.forEach(a => {
      const href = a.href;
      if (!href || href.startsWith('https://x.com') || href.startsWith('https://twitter.com') || href.startsWith('/')) return;

      const visibleText = (a.innerText || a.textContent || '').trim();
      if (/^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(visibleText)) {
        addLink(`https://${visibleText}`);
      } else if (/^https?:\/\//i.test(visibleText)) {
        addLink(visibleText);
      } else {
        addLink(href);
      }
    });
      
    return {
      tweet_id,
      tweet_url,
      username,
      display_name,
      is_verified,
      text,
      timestamp,
      links: [...new Set(extractedLinks)]
    };
  } catch (e) {
    console.error('[RADAR] Error parsing tweet', e);
    return null;
  }
}
if (typeof window !== 'undefined') window.extractTweetData = extractTweetData;
