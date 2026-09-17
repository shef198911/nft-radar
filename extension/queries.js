const SEARCH_GROUPS = [
  '("Robinhood Chain" OR "RH Chain" OR "Robinhood NFT" OR "Robinhood mint" OR "on Robinhood") (NFT OR NFTs OR mint OR minting OR drop OR launch OR collection OR whitelist OR allowlist OR "allow list" OR WL OR FCFS OR GTD OR "free mint" OR "public mint")',
  '("ARC Chain" OR "Arc NFT" OR "ARC NFT" OR "ARC mint" OR "on ARC") (NFT OR NFTs OR mint OR minting OR drop OR launch OR collection OR whitelist OR allowlist OR "allow list" OR WL OR FCFS OR GTD OR "free mint" OR "public mint")',
  '("Solana NFT" OR "SOL NFT" OR "Solana mint" OR "Solana free mint" OR "$SOL NFT" OR "$SOL mint") (mint OR minting OR drop OR launch OR claim OR whitelist OR allowlist OR "allow list" OR WL OR FCFS OR GTD OR "free mint" OR "public mint")',
  '("free mint" OR "free claim" OR "claim is live" OR "public mint") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR "Solana NFT" OR "Solana mint" OR "$SOL NFT") (NFT OR collection OR mint)',
  '("WL spots" OR "whitelist spots" OR "allowlist spots" OR "allow list spots" OR "GTD WL" OR "FCFS WL") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR "Solana NFT" OR "Solana mint" OR "$SOL NFT")',
  '("mint is live" OR "mint live" OR "mint soon" OR "mint today" OR "mint starts" OR "mint opens") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR "Solana NFT" OR "Solana mint" OR "$SOL NFT") (NFT OR collection)',
  '("drop your wallet" OR "drop address" OR "drop your ETH" OR "drop your SOL" OR "wallet below") ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR "Solana NFT" OR "Solana mint" OR "$SOL NFT") (WL OR whitelist OR allowlist OR "allow list" OR NFT)',
  '(GTD OR FCFS OR raffle OR giveaway) ("Robinhood Chain" OR "RH Chain" OR "ARC Chain" OR "Solana NFT" OR "Solana mint" OR "$SOL NFT") (NFT OR mint OR WL OR whitelist OR allowlist)'
];

if (typeof window !== 'undefined') window.SEARCH_GROUPS = SEARCH_GROUPS;
