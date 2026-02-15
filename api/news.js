export default async function handler(req, res) {
  const { asset, priceChange } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset required" });

  const NEWS_API = process.env.NEWS_API_KEY;
  const FINNHUB_API = process.env.FINNHUB_API_KEY;

  // 1. Better Query Logic
  const cryptoTickers = ["btc", "eth", "sol", "xrp", "bnb", "doge"];
  const isCrypto = cryptoTickers.includes(asset.toLowerCase());
  const searchTerm = isCrypto ? `${asset} crypto` : `${asset} stock market`;

  try {
    // 2. Parallel Fetching (Faster)
    const [newsApiRes, finnhubRes] = await Promise.all([
      fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(searchTerm)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${NEWS_API}`),
      fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API}`)
    ]);

    const newsData = await newsApiRes.json();
    const finnData = await finnhubRes.json();

    let articles = [];

    // Process NewsAPI
    if (newsData.articles) {
      articles.push(...newsData.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        time: a.publishedAt,
        description: a.description || ""
      })));
    }

    // Process Finnhub (Only if relevant to asset)
    if (Array.isArray(finnData)) {
      articles.push(...finnData
        .filter(a => a.headline.toLowerCase().includes(asset.toLowerCase()))
        .map(a => ({
          title: a.headline,
          url: a.url,
          source: a.source,
          time: new Date(a.datetime * 1000).toISOString(),
          description: a.summary || ""
        })));
    }

    // 3. Robust Filtering (Blacklist instead of Whitelist)
    const spamDomains = ["github.com", "reddit.com", "youtube.com", "nfts", "substack"];
    articles = articles.filter(a => 
      a.title && 
      !spamDomains.some(d => a.url.includes(d)) &&
      !a.title.includes("Removed")
    );

    // Deduplicate
    const seen = new Set();
    articles = articles.filter(a => {
      const isDuplicate = seen.has(a.url);
      seen.add(a.url);
      return !isDuplicate;
    });

    // 4. Sentiment & Scoring
    const weights = {
      bullish: ["surge", "bullish", "growth", "profit", "rally", "buy", "breakout", "upgrade", "partnership"],
      bearish: ["crash", "bearish", "drop", "lawsuit", "weak", "sell", "plunge", "downgrade", "scam", "inflation"]
    };

    articles = articles.map(a => {
      let score = 0;
      const text = (a.title + " " + a.description).toLowerCase();
      weights.bullish.forEach(w => text.includes(w) && (score += 2));
      weights.bearish.forEach(w => text.includes(w) && (score -= 2));
      return { ...a, sentiment: score };
    });

    const avgSentiment = articles.length > 0 
      ? articles.reduce((sum, a) => sum + a.sentiment, 0) / articles.length 
      : 0;

    // 5. Prediction Logic
    const sentimentScore = Math.min(100, Math.max(0, 50 + (avgSentiment * 10)));
    let mood = "Neutral";
    let prediction = "Stable / Consolidation";

    if (sentimentScore > 60) {
      mood = "Bullish";
      prediction = "Potential Short-term Uptrend";
    } else if (sentimentScore < 40) {
      mood = "Bearish";
      prediction = "Potential Downward Pressure";
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset,
      mood,
      sentimentScore: Math.round(sentimentScore),
      prediction,
      totalArticles: articles.length,
      articles: articles.slice(0, 10) // Return top 10 cleanest
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to process news", details: err.message });
  }
}
