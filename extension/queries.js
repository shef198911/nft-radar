const SEARCH_GROUPS = [
  '("free mint" OR "free claim" OR "claim is live" OR "public mint") (NFT OR collection OR mint)',
  '("WL spots" OR "whitelist spots" OR "allowlist spots" OR "allow list spots" OR "GTD WL" OR "FCFS WL") (NFT OR mint OR collection)',
  '("mint is live" OR "mint live" OR "mint soon" OR "mint today" OR "mint starts" OR "mint opens") (NFT OR collection OR WL)',
  '("drop your wallet" OR "drop address" OR "drop your ETH" OR "drop your SOL" OR "wallet below") (WL OR whitelist OR allowlist OR "allow list" OR NFT)',
  '("WL giveaway" OR "NFT giveaway" OR "FCFS" OR "GTD") (NFT OR mint OR WL OR whitelist OR allowlist)',
  '(Testnet OR Mainnet OR Airdrop) (points OR claim OR token OR eligibility OR "checker is live")',
  '("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR "Monad" OR "Bera" OR "Berachain" OR "Base" OR "Solana") (NFT OR mint OR WL OR drop OR whitelist)',
  '(Ethereum OR Arbitrum OR Optimism OR Polygon OR Zksync OR Linea OR "BNB Chain" OR Avalanche OR Aptos OR Sui) ("free mint" OR "whitelist spots" OR "mint is live")'
];

if (typeof window !== 'undefined') window.SEARCH_GROUPS = SEARCH_GROUPS;
