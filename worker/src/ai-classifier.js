export async function runAIFilter(tweetText, env) {
  const prompt = `You are an AI classifier for a Crypto/NFT Twitter Radar.
Your task is to analyze the following tweet and return a JSON object evaluating its content based on strict rules.

Rules:
1. Is it relevant? (Crypto, NFT, airdrop, testnet, mainnet, mint, whitelist, security, on-chain activity)
2. Does it contain specific NEW and ACTIONABLE information? (e.g. specific project, event, date, action)
3. Is it promotional or engagement bait? (e.g. referral links, "use my code", giveaway, "what do you think?", pure opinion without facts)

Scoring system (sum up the points):
+3: NFT / mint / whitelist / allowlist / claim
+3: airdrop / eligibility / snapshot
+3: testnet / mainnet / launch
+3: specific actionable step for user
+3: new project information
+2: specific date
+2: specific contract / on-chain information
+2: funding
+2: partnership / integration
+2: specific NFT collection
+1: points / rewards

Penalties:
-5: giveaway
-5: referral / affiliate
-4: clear advertisement
-3: engagement bait
-3: meme
-3: pure opinion
-3: GM/GN
-2: casual conversation

JSON Schema:
{
  "relevant": boolean,
  "category": "nft" | "mint" | "whitelist" | "airdrop" | "eligibility" | "claim" | "testnet" | "mainnet" | "launch" | "token" | "listing" | "funding" | "partnership" | "integration" | "security" | "onchain" | "other",
  "actionable": boolean,
  "new_information": boolean,
  "promotional": boolean,
  "engagement_bait": boolean,
  "score": number,
  "reason": "short explanation"
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

        // Basic validation
        if (typeof geminiResult !== 'object' || 
            typeof geminiResult.relevant !== 'boolean' ||
            typeof geminiResult.new_information !== 'boolean' ||
            typeof geminiResult.actionable !== 'boolean' ||
            typeof geminiResult.promotional !== 'boolean' ||
            typeof geminiResult.engagement_bait !== 'boolean' ||
            typeof geminiResult.score !== 'number' ||
            typeof geminiResult.category !== 'string' ||
            typeof geminiResult.reason !== 'string') {
          console.warn("[AI] Gemini invalid JSON, trying Cloudflare AI");
          useCloudflare = true;
          geminiResult = null;
        } else {
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

      // Check if glm is available or use llama
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
      }

      const cfResult = JSON.parse(jsonStr);
      
      if (typeof cfResult !== 'object' || 
          typeof cfResult.relevant !== 'boolean' ||
          typeof cfResult.new_information !== 'boolean' ||
          typeof cfResult.actionable !== 'boolean' ||
          typeof cfResult.promotional !== 'boolean' ||
          typeof cfResult.engagement_bait !== 'boolean' ||
          typeof cfResult.score !== 'number' ||
          typeof cfResult.category !== 'string' ||
          typeof cfResult.reason !== 'string') {
        console.warn("[AI] Cloudflare malformed JSON");
        console.error("[AI] Gemini + Cloudflare failed, rejecting tweet");
        return null;
      }

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
