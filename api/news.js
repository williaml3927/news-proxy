export default async function handler(req, res) {
  // 1. SETUP & SAFETY CHECKS
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset symbol is required." });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

  // Helper to identify if it's crypto (for API routing)
  const cryptoMap = {
    "btc": "bitcoin", "eth": "ethereum", "sol": "solana", 
    "xrp": "ripple", "ada": "cardano", "doge": "dogecoin",
    "dot": "polkadot", "link": "chainlink", "ltc": "litecoin"
  };
  
  const cleanAsset = asset.toLowerCase();
  const isCrypto = Object.keys(cryptoMap).includes(cleanAsset);
  const cryptoName = cryptoMap[cleanAsset];

  try {
    // 2. PREPARE REQUESTS (The "Scattershot" Strategy)
    const requests = [];

    // --- Source A: Alpha Vantage (Best for Sentiment) ---
    // Works for both stocks (AAPL) and crypto (CRYPTO:BTC)
    const avSymbol = isCrypto ? `CRYPTO:${asset.toUpperCase()}` : asset.toUpperCase();
    requests.push(
      fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${avSymbol}&limit=8&apikey=${ALPHA_KEY}`)
        .then(r => r.json())
        .then(data => ({ source: 'alpha', data }))
    );

    // --- Source B: Finnhub (Best for Reliability) ---
    // Logic: If crypto, get general crypto news & filter. If stock, get specific company news.
    const today = new Date().toISOString().split('T')[0];
    const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    
    let finnUrl = "";
    if (isCrypto) {
      finnUrl = `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`;
    } else {
      finnUrl = `https://finnhub.io/api/v1/company-news?symbol=${asset.toUpperCase()}&from=${lastWeek}&to=${today}&token=${FINNHUB_KEY}`;
    }

    requests.push(
      fetch(finnUrl)
        .then(r => r.json())
        .then(data => ({ source: 'finnhub', data }))
    );

    // 3. EXECUTE REQUESTS (Fail-Safe Mode)
    // We wait for both, but if one fails, we don't crash.
    const results = await Promise.allSettled(requests);
    
    let allArticles = [];

    // 4. PARSE RESULTS
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        const { source, data } = result.value;

        // --- Handle Alpha Vantage ---
        if (source === 'alpha' && data.feed) {
          allArticles.push(...data.feed.map(item => ({
            title: item.title,
            url: item.url,
            source: item.source,
            summary: item.summary,
            // Format: 20240315T120000 -> 2024-03-15
            date: item.time_published.replace(/^(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3'),
            // Normalize Score: -0.35 -> ~35, 0.35 -> ~65
            score: Math.round((parseFloat(item.overall_sentiment_score) + 1) * 50)
          })));
        }

        // --- Handle Finnhub ---
        if (source === 'finnhub' && Array.isArray(data)) {
          // If Crypto: We must manually filter the general feed for our coin
          const relevant = isCrypto 
            ? data.filter(item => {
                const text = (item.headline + item.summary).toLowerCase();
                return text.includes(cleanAsset) || text.includes(cryptoName);
              })
            : data;

          allArticles.push(...relevant.map(item => ({
            title: item.headline,
            url: item.url,
            source: item.source,
            summary: item.summary,
            date: new Date(item.datetime * 1000).toISOString().split('T')[0],
            score: 50 // Finnhub has no score, defaults to Neutral (50)
          })));
        }
      }
    });

    // 5. FINAL FILTERING (The "Quality Control" Layer)
    // Remove duplicates by URL
    const seen = new Set();
    const uniqueArticles = allArticles.filter(a => {
      const isDup = seen.has(a.url);
      seen.add(a.url);
      return !isDup;
    });

    // 6. SORT & LIMIT
    // Prioritize articles with sentiment scores != 50 (Alpha Vantage), then by date
    uniqueArticles.sort((a, b) => {
      const aIsAnalysed = a.score !== 50 ? 1 : 0;
      const bIsAnalysed = b.score !== 50 ? 1 : 0;
      return (bIsAnalysed - aIsAnalysed) || (new Date(b.date) - new Date(a.date));
    });

    const top6 = uniqueArticles.slice(0, 6);

    // 7. SUMMARY & SENTIMENT CALCULATION
    const avgScore = top6.length 
      ? Math.round(top6.reduce((sum, a) => sum + a.score, 0) / top6.length) 
      : 50;

    let mood = "Neutral";
    if (avgScore >= 60) mood = "Bullish";
    if (avgScore <= 40) mood = "Bearish";

    const summary = top6.length > 0
      ? `Market sentiment for ${asset.toUpperCase()} is ${mood} (${avgScore}/100). Top stories from ${top6[0].source} and others highlight: ${top6[0].title}.`
      : "No significant news found in the last 7 days.";

    // 8. SEND RESPONSE
    res.setHeader('Access-Control-Allow-Origin', '*'); // CORS Support
    res.status(200).json({
      asset: asset.toUpperCase(),
      sentimentScore: avgScore,
      mood,
      summary,
      articles: top6
    });

  } catch (error) {
    console.error("News Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch news." });
  }
}
