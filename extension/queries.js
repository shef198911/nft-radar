const SEARCH_GROUPS = {
  nftMint: [
    '"NFT mint"', '"NFT minting"', '"NFT drop"', '"NFT launch"',
    '"NFT collection" mint', '"mint is live" NFT', '"mint is now live" NFT',
    '"mint soon" NFT', '"minting soon" NFT', '"upcoming NFT"', '"upcoming mint"'
  ],
  freeMint: [
    '"free mint" NFT', '"free mint" NFTs', '"free minting" NFT',
    '"free mint" crypto', '"free mint" web3', '"free NFT" mint',
    '"free NFT" collection', '"0 ETH" NFT mint', '"0 ETH mint"',
    '"no cost mint" NFT', '"free claim" NFT'
  ],
  whitelist: [
    '"whitelist" NFT', '"NFT whitelist"', '"allowlist" NFT', '"NFT allowlist"',
    '"WL open" NFT', '"WL is open" NFT', '"WL spots" NFT', '"whitelist spots" NFT',
    '"allowlist spots" NFT', '"WL mint" NFT'
  ],
  fcfsGtd: [
    '"FCFS" NFT', '"FCFS mint"', '"FCFS whitelist"', '"GTD" NFT',
    '"GTD whitelist"', '"guaranteed whitelist" NFT', '"guaranteed spot" NFT'
  ],
  robinhood: [
    '"Robinhood Chain" NFT', '"Robinhood Chain" mint', '"Robinhood Chain" "free mint"',
    '"Robinhood Chain" whitelist', '"Robinhood Chain" allowlist', '"Robinhood Chain" NFT drop',
    '"Robinhood Chain" NFT mint', '"Robinhood Chain" collection', '"Robinhood Chain" "mint soon"',
    '"Robinhood Chain" "upcoming"', '"free mint" "Robinhood Chain"', '"whitelist" "Robinhood Chain"',
    '"mint" "Robinhood Chain"', '"allowlist" "Robinhood Chain"', '"FCFS" "Robinhood Chain"'
  ]
};

if (typeof window !== 'undefined') window.SEARCH_GROUPS = SEARCH_GROUPS;
