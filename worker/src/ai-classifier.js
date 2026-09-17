export async function runAIFilter(tweetText, env) {
  if (!env.GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY is missing. Skipping AI classification and allowing by default for testing.");
    // Fallback if no key is configured: allow with default score.
    return {
      relevant: true,
      category: "other",
      actionable: true,
      new_information: true,
      promotional: false,
      engagement_bait: false,
      score: 5,
      reason: "No API key configured. Bypassed."
    };
  }

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

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.0
        }
      })
    });

    if (!res.ok) {
      console.error("Gemini API error", await res.text());
      return null;
    }

    const data = await res.json();
    const text = data.candidates[0].content.parts[0].text;
    const result = JSON.parse(text);
    return result;
  } catch (error) {
    console.error("Error calling AI classifier", error);
    return null;
  }
}
