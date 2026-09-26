export async function runAIFilter(tweetText, env) {
  const prompt = `You are an AI classifier for an exclusive "X Alpha" Crypto/Web3 Radar.
Your task is to analyze the following tweet from a curated list of top crypto influencers and return a JSON object evaluating its "Alpha" value.

Rules:
1. Is it relevant to Web3 Alpha? (Crypto narratives, token analysis, breaking crypto news, smart money moves, altcoin setups, early project discovery, DeFi strategies, NFT mints, airdrops, security alerts, on-chain activity)
2. Does it contain specific, valuable, or new information? (e.g., a specific project, token ticker, upcoming event, deep dive thread, analytical insight, contract, hidden gem)
3. Reject low-effort engagement bait and pure noise. (e.g. "what do you think?", GM/GN, empty giveaways, simple retweets without added value)

Scoring system (sum up the points, minimum 3 points needed to pass):
+5: Major breaking news, critical security alert, exploit, or highly actionable early alpha
+4: Deep dive thread, analytical insight, tokenomics breakdown, or smart money tracking
+3: Specific project launch, token listing, testnet/mainnet launch, airdrop eligibility, snapshot
+3: Specific altcoin setup, DeFi strategy, or yield farming opportunity
+3: New NFT mint, whitelist, allowlist, or claim info
+2: Mentions a specific token ticker, contract address, or specific date
+2: Funding news, partnerships, or integrations
+1: General crypto ecosystem updates or rewards

Penalties:
-10: Giveaway, referral link, affiliate code
-5: Engagement bait ("drop your wallet", "who is bullish?")
-3: Pure meme or empty opinion without facts
-3: Casual conversation, GM/GN

JSON Schema:
{
  "relevant": boolean,
  "category": "alpha" | "news" | "analysis" | "defi" | "nft" | "mint" | "airdrop" | "testnet" | "launch" | "token" | "security" | "onchain" | "other",
  "actionable": boolean,
  "new_information": boolean,
  "promotional": boolean,
  "engagement_bait": boolean,
  "score": number,
  "reason": "short explanation",
  "translated_text": "полный и точный перевод текста твита на русский язык (сохраняйте все термины, тикеры и сленг)"
}

Tweet to analyze:
"""
${tweetText}
"""
`;

  let useCloudflare = false;
  let geminiResult = null;

  if (!env.GEMINI_API_KEY) {
    console.warn("[AI] GEMINI_API_KEY is missing. Trying Cloudflare AI");
    useCloudflare = true;
  } else {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.0 }
        })
      });

      if (!res.ok) {
        if (res.status === 429) {
          console.warn("[AI] Gemini HTTP 429, trying Cloudflare AI");
        } else {
          console.warn(`[AI] Gemini failed (${res.status}), trying Cloudflare AI`);
        }
        useCloudflare = true;
      } else {
        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        geminiResult = JSON.parse(text);

        if (typeof geminiResult !== 'object' || geminiResult === null) {
          console.warn("[AI] Gemini invalid JSON, trying Cloudflare AI");
          useCloudflare = true;
          geminiResult = null;
        } else {
          geminiResult.relevant = !!geminiResult.relevant;
          geminiResult.new_information = !!geminiResult.new_information;
          geminiResult.actionable = !!geminiResult.actionable;
          geminiResult.promotional = !!geminiResult.promotional;
          geminiResult.engagement_bait = !!geminiResult.engagement_bait;
          geminiResult.score = Number(geminiResult.score) || 0;
          geminiResult.category = String(geminiResult.category || 'other');
          geminiResult.reason = String(geminiResult.reason || '');
          if (geminiResult.translated_text) geminiResult.translated_text = String(geminiResult.translated_text);

          console.log("[AI] Gemini classification success");
          return geminiResult;
        }
      }
    } catch (error) {
      console.error("[AI] Error calling Gemini classifier", error);
      console.warn("[AI] Gemini failed, trying Cloudflare AI");
      useCloudflare = true;
    }
  }

  if (useCloudflare) {
    try {
      if (!env.AI) {
        console.error("[AI] Cloudflare AI binding (env.AI) is missing.");
        console.error("[AI] Gemini + Cloudflare failed, rejecting tweet");
        return null;
      }

      const res = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: prompt }
        ]
      });

      const text = res.response;
      let jsonStr = text;
      const match = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
      if (match) {
        jsonStr = match[1];
      } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end >= start) {
          jsonStr = text.substring(start, end + 1);
        }
      }

      const cfResult = JSON.parse(jsonStr);
      
      if (typeof cfResult !== 'object' || cfResult === null) {
        console.warn("[AI] Cloudflare malformed JSON");
        console.error("[AI] Gemini + Cloudflare failed, rejecting tweet");
        return null;
      }

      cfResult.relevant = !!cfResult.relevant;
      cfResult.new_information = !!cfResult.new_information;
      cfResult.actionable = !!cfResult.actionable;
      cfResult.promotional = !!cfResult.promotional;
      cfResult.engagement_bait = !!cfResult.engagement_bait;
      cfResult.score = Number(cfResult.score) || 0;
      cfResult.category = String(cfResult.category || 'other');
      cfResult.reason = String(cfResult.reason || '');
      if (cfResult.translated_text) cfResult.translated_text = String(cfResult.translated_text);

      console.log("[AI] Cloudflare classification success");
      return cfResult;

    } catch (error) {
      console.error("[AI] Error calling Cloudflare AI classifier", error);
      console.error("[AI] Gemini + Cloudflare failed, rejecting tweet");
      return null;
    }
  }

  return null;
}
