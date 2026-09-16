const SEARCH_GROUPS = [
  '("Robinhood Chain" OR "RH Chain" OR "Robinhood NFT" OR "on Robinhood") (NFT OR mint OR drop OR collection OR whitelist OR allowlist OR WL OR FCFS OR GTD OR free)',
  '("ARC Chain" OR "Arc NFT" OR "on ARC" OR "ARC mint") (NFT OR mint OR drop OR collection OR whitelist OR allowlist OR WL OR FCFS OR GTD OR free)',
  '("Solana NFT" OR "SOL NFT" OR "Solana mint" OR "Solana free mint") (mint OR drop OR launch OR whitelist OR allowlist OR WL OR FCFS OR GTD OR free)',
  '("free mint" OR "free claim") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR Solana OR SOL) (NFT OR collection OR mint)',
  '("WL spots" OR "whitelist spots" OR "allowlist spots" OR "GTD WL" OR "FCFS WL") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR Solana OR SOL)',
  '("mint is live" OR "mint live" OR "mint soon" OR "mint today") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR Solana OR SOL) (NFT OR collection)',
  '("drop your wallet" OR "drop address" OR "drop your ETH" OR "drop your SOL") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR Solana OR SOL) (WL OR whitelist OR allowlist OR NFT)',
  '(GTD OR FCFS OR raffle OR giveaway) ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR Solana OR SOL) (NFT OR mint OR WL OR whitelist)'
];

if (typeof window !== 'undefined') window.SEARCH_GROUPS = SEARCH_GROUPS;
