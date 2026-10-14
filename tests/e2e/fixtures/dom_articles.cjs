/**
 * Synthetic DOM Article Fixtures for Twitter/X Timeline Ingestion
 */

function makeArticleHtml(options = {}) {
  const {
    tweetId = '1842000000000000001',
    username = 'project_alpha',
    displayName = 'Project Alpha Official',
    statusUrl = `https://x.com/${username}/status/${tweetId}`,
    text = 'FREE MINT IS LIVE NOW! 500 spots available on Ethereum. Mint at https://mint.xyz/launch',
    timestamp = '2026-10-08T10:00:00.000Z',
    isVerified = true,
    extraLinks = [
      { href: 'https://mint.xyz/launch', text: 'mint.xyz/launch' }
    ]
  } = options;

  const linksHtml = [
    `<a href="${statusUrl}">${new Date(timestamp).toLocaleDateString()}</a>`,
    ...extraLinks.map(l => `<a href="${l.href}">${l.text}</a>`)
  ].join('\n');

  const verifiedSvg = isVerified
    ? `<svg data-testid="icon-verified" aria-label="Verified account"><g></g></svg>`
    : '';

  return `
    <article data-testid="tweet">
      <div data-testid="User-Name">${displayName}\n@${username}${verifiedSvg}</div>
      <time datetime="${timestamp}"></time>
      <div data-testid="tweetText">
        <span>${text}</span>
      </div>
      <div class="links-container">
        ${linksHtml}
      </div>
    </article>
  `;
}

module.exports = {
  makeArticleHtml,

  // Specific fixture generators
  articles: {
    standardFreeMint: makeArticleHtml({
      tweetId: '1842000000000000001',
      username: 'cyber_kongs',
      displayName: 'CyberKongs Live',
      text: '🚨 FREE MINT IS LIVE NOW! 1000 items on Solana. FCFS claim at https://cyberkongs.io/mint 0 SOL',
      extraLinks: [{ href: 'https://cyberkongs.io/mint', text: 'cyberkongs.io/mint' }]
    }),

    trailingSlashUrl: makeArticleHtml({
      tweetId: '1842000000000000002',
      statusUrl: 'https://x.com/degens_alpha/status/1842000000000000002/',
      username: 'degens_alpha',
      displayName: 'Degen Alpha',
      text: 'Exclusive WL giveaway for our community! 50 WL spots on Ethereum.',
      extraLinks: [{ href: 'https://degens.xyz', text: 'degens.xyz' }]
    }),

    unicodeEllipsisUrl: makeArticleHtml({
      tweetId: '1842000000000000003',
      username: 'ellipsis_drop',
      displayName: 'Ellipsis Drop',
      text: 'Drop details here: check our link below',
      extraLinks: [{ href: 'https://t.co/xyz123', text: 'mint.xyz/free-cl…' }]
    }),

    replyBodyText: makeArticleHtml({
      tweetId: '1842000000000000004',
      username: 'rhetorical_reply',
      displayName: 'Rhetorical Project',
      text: 'Replying to all community members: Public mint is officially live at https://mint.xyz/go',
      extraLinks: [{ href: 'https://mint.xyz/go', text: 'mint.xyz/go' }]
    }),

    europeanDecimalText: makeArticleHtml({
      tweetId: '1842000000000000005',
      username: 'euro_metrics',
      displayName: 'Euro Metrics',
      text: 'Major milestone! Over 1,5M views and 0,5 ETH floor price reached on Ethereum.',
      extraLinks: [{ href: 'https://euromint.io', text: 'euromint.io' }]
    })
  }
};
