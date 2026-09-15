function extractTweetData(articleNode) {
  try {
    const timeEl = articleNode.querySelector('time');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : null;
    
    const links = Array.from(articleNode.querySelectorAll('a[href]'));
    const tweetLink = links.find(a => a.href.includes('/status/') && !a.href.includes('/photo/') && !a.href.includes('/video/'));
    
    if (!tweetLink) return null;
    
    // Normalize URL
    let tweet_url = tweetLink.href.split('?')[0];
    tweet_url = tweet_url.replace('twitter.com', 'x.com');
    
    const urlParts = tweet_url.split('/');
    const tweet_id = urlParts[urlParts.length - 1];
    const username = urlParts[3];
    
    const nameEl = articleNode.querySelector('[data-testid="User-Name"]');
    const display_name = nameEl ? nameEl.innerText.split('\n')[0] : username;
    
    const textEl = articleNode.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText : '';
    
    const extractedLinks = links
      .map(a => a.href)
      .filter(href => !href.startsWith('https://x.com') && !href.startsWith('https://twitter.com') && !href.startsWith('/'));
      
    return {
      tweet_id,
      tweet_url,
      username,
      display_name,
      text,
      timestamp: timestamp || new Date().toISOString(),
      links: [...new Set(extractedLinks)]
    };
  } catch (e) {
    console.error('Error parsing tweet', e);
    return null;
  }
}
if (typeof window !== 'undefined') window.extractTweetData = extractTweetData;
