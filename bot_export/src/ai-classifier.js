function applyHeuristicSafetyNet(cfResult, text) {
  if (!cfResult) cfResult = { relevant: false, score: 0, category: 'other' };
  
  const lower = (text || '').toLowerCase();
  
  // 1. Checkers & Airdrops
  if (/(?<![a-zа-я0-9_])(?:checker|чекер[а-я]*|airdrop[а-я]*|аирдроп[а-я]*|claim|snapshot|снимок|eligible|eligibility)(?![a-zа-я0-9_])/iu.test(lower)) {
    if (!cfResult.relevant || cfResult.score < 7) {
      cfResult.relevant = true;
      cfResult.category = 'checker';
      cfResult.score = Math.max(cfResult.score, 9);
      cfResult.reason = cfResult.reason || 'Heuristic: Airdrop/Checker detected';
    }
  }
  // 2. Mints & Mint Countdowns (including Russian cases: минт, минта, минты, минтить)
  else if (/(?<![a-zа-я0-9_])(?:mint(?:ing|ed|s)?|минт(?:ить|а|ы|у|ом|е)?|opensea|magic\s*eden)(?![a-zа-я0-9_])/iu.test(lower)) {
    if (!cfResult.relevant || cfResult.score < 7) {
      cfResult.relevant = true;
      cfResult.category = 'mint';
      cfResult.score = Math.max(cfResult.score, 8);
      cfResult.reason = cfResult.reason || 'Heuristic: Mint announcement/countdown detected';
    }
  }
  // 3. Whitelist / Allowlist (Strict boundaries so 'вл' never triggers on 'добавлял', 'владелец', etc.)
  else if (/(?<![a-zа-я0-9_])(?:whitelist|allowlist|вайтлист(?:а|ы|у|ом|е)?|вл|premint|guaranteed)(?![a-zа-я0-9_])/iu.test(lower)) {
    if (!cfResult.relevant || cfResult.score < 7) {
      cfResult.relevant = true;
      cfResult.category = 'whitelist';
      cfResult.score = Math.max(cfResult.score, 8);
      cfResult.reason = cfResult.reason || 'Heuristic: Whitelist detected';
    }
  }
  // 4. TGE & Tokenomics
  else if (/(?<![a-zа-я0-9_])(?:tge|tokenomics|токеномик(?:а|и|у|ой|е)?|token\s*generation)(?![a-zа-я0-9_])/iu.test(lower)) {
    if (!cfResult.relevant || cfResult.score < 7) {
      cfResult.relevant = true;
      cfResult.category = 'tokenomics';
      cfResult.score = Math.max(cfResult.score, 8);
      cfResult.reason = cfResult.reason || 'Heuristic: Tokenomics/TGE detected';
    }
  }
  
  return cfResult;
}

export async function runAIFilter(tweetText, env) {
  const prompt = `You are an AI classifier for an exclusive "X Alpha" Crypto/Web3/NFT Radar.
Your task is to analyze the following tweet and return a JSON object evaluating its importance.

IMPORTANT CATEGORIES:
- "mint": Any NFT or token mint announcement, mint date, mint countdown ("48 hours until mint", "October 14", "coming to opensea"), supply info, mint phase, leaderboard lock for mint.
- "airdrop": Airdrop announcement, airdrop claim, distribution date, snapshot date, eligibility criteria.
- "checker": Eligibility/airdrop checker link or announcement.
- "whitelist": Whitelist/allowlist spots, registration, raffle, premint, form.
- "tge": Token Generation Event, token launch date, listing.
- "tokenomics": Tokenomics details, token distribution breakdown.
- "testnet" / "mainnet": Testnet or mainnet launch, incentivized testnet.
- "security": Exploit, hack, contract compromise, emergency warning.

SCORING (0 to 10):
10: Official mint date, mint countdown, airdrop checker, airdrop claim, TGE date, critical security warning.
8-9: Whitelist open, testnet/mainnet launch, tokenomics release, snapshot announcement.
7: Upcoming mint details, supply/price details, leaderboard closing for mint access.
0-4: Casual chatter, memes, greetings (gm/gn), trading advice ("don't fomo"), generic opinions without dates or actions.

CRITICAL RULES:
- If a tweet announces an upcoming MINT, MINT DATE, or MINT COUNTDOWN (e.g. "48 hours until the mint", "coming to OpenSea October 14"), it is ALWAYS relevant=true, category="mint", and score=8 to 10!
- Even if the tone is promotional or exciting, DO NOT reject official mint announcements, dates, or countdowns!

JSON Schema:
{
  "relevant": boolean,
  "category": "mint" | "airdrop" | "checker" | "whitelist" | "tge" | "tokenomics" | "testnet" | "mainnet" | "security" | "other",
  "actionable": boolean,
  "new_information": boolean,
  "promotional": boolean,
  "engagement_bait": boolean,
  "score": number,
  "reason": "short explanation",
  "translated_text": "ignore this field, leave empty"
}

Tweet to analyze:
"""
${tweetText}
"""
`;

  try {
    const res = await fetch("https://cloudflare-ai-proxy.icoshef.workers.dev/?key=radar_secret_key_123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt, model: "@cf/meta/llama-3.2-3b-instruct" })
    });

    if (!res.ok) {
      console.warn("[AI] Cloudflare Proxy failed with status", res.status);
      return applyHeuristicSafetyNet(null, tweetText);
    }

    const aiRes = await res.json();
    let textResult = '';
    if (aiRes.response) {
      textResult = typeof aiRes.response === 'string' ? aiRes.response : JSON.stringify(aiRes.response);
    } else if (aiRes.choices && aiRes.choices[0] && aiRes.choices[0].message) {
      textResult = String(aiRes.choices[0].message.content);
    }
    
    // Parse the JSON blocks
    let jsonStr = textResult;
    const match = textResult.match(/```(?:json)?\n([\s\S]*?)\n```/);
    if (match) {
      jsonStr = match[1];
    } else {
      const start = textResult.indexOf('{');
      const end = textResult.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end >= start) {
        jsonStr = textResult.substring(start, end + 1);
      }
    }

    try {
      const cfResult = JSON.parse(jsonStr);
      if (typeof cfResult === 'object' && cfResult !== null) {
        cfResult.relevant = !!cfResult.relevant;
        cfResult.new_information = !!cfResult.new_information;
        cfResult.actionable = !!cfResult.actionable;
        cfResult.promotional = !!cfResult.promotional;
        cfResult.engagement_bait = !!cfResult.engagement_bait;
        cfResult.score = Number(cfResult.score) || 0;
        cfResult.category = String(cfResult.category || 'other');
        cfResult.reason = String(cfResult.reason || '');
        if (cfResult.translated_text) cfResult.translated_text = String(cfResult.translated_text);

        // Apply heuristic safety net to prevent false negative drops
        applyHeuristicSafetyNet(cfResult, tweetText);

        console.log("[AI] Cloudflare classification success. Result:", cfResult.category, "score:", cfResult.score);
        return cfResult;
      }
    } catch(e) {
      console.error("[AI] Failed to parse Cloudflare JSON:", textResult);
    }
    return applyHeuristicSafetyNet(null, tweetText);
  } catch (e) {
    console.error("[AI] Cloudflare Proxy error:", e.message);
    return applyHeuristicSafetyNet(null, tweetText);
  }
}
