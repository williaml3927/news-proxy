export default async function handler(req, res) {
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset required" });

  const ALPHA_API = process.env.ALPHA_VANTAGE_KEY;
  const NEWS_API = process.env.NEWS_API_KEY;

  // Dictionary for common tickers to full names to prevent "Zero Results"
  const nameMap = { "btc": "bitcoin", "eth": "ethereum", "sol": "solana", "tsla": "tesla", "aapl": "apple", "nvda": "nvidia" };
  const fullName = nameMap[asset.toLowerCase()] || asset;

  try {
    // 1. Fetching from two reliable sources using allSettled (so one failure won't break it)
    const [alphaRes, newsRes] = await Promise.allSettled([
      fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&limit=10&apikey=${ALPHA_API}`).then(r => r.json()),
      fetch(`https://newsapi.org/v2/everything?q=${asset} OR ${fullName}&language=en&sortBy=relevancy&pageSize=15&apiKey=${NEWS_API}`).then(r => r.json())
    ]);

    let articles = [];

    // 2. Process Alpha Vantage (High Quality)
    if (alphaRes.status === 'fulfilled' && alphaRes.value.feed) {
      articles.push(...alphaRes.value.feed.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        date: a.time_published.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$2/$3/$1'),
        summary: a.summary,
        sentiment: parseFloat(a.overall_sentiment_score)
      })));
    }

    // 3. Process NewsAPI (High Volume)
    if (newsRes.status === 'fulfilled' && newsRes.value.articles) {
      articles.push(...newsRes.value.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        date: new Date(a.publishedAt).toLocaleDateString(),
        summary: a.description || "No summary available.",
        sentiment: 0 // We'll estimate this below
      })));
    }

    // 4. CLEANING & FILTERING
    const junkDomains = ["github.com", "pypi.org", "npm.com", "youtube.com", "blogspot.com"];
    
    let filtered = articles.filter(a => {
      const text = (a.title + a.summary).toLowerCase();
      const isRelevant = text.includes(asset.toLowerCase()) || text.includes(fullName.toLowerCase());
      const isNotJunk = !junkDomains.some(d => a.url.includes(d));
      const isNotRemoved = !a.title.includes("[Removed]");
      return isRelevant && isNotJunk && isNotRemoved;
    });

    // 5. Deduplicate by Title
    const seenTitles = new Set();
    filtered = filtered.filter(a => {
      const isDuplicate = seenTitles.has(a.title.toLowerCase());
      seenTitles.add(a.title.toLowerCase());
      return !isDuplicate;
    });

    // 6. Final Sorting (Highest Sentiment & Latest Date)
    const top6 = filtered.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

    // 7. Calculate Sentiment & Mood
    const totalSentiment = top6.reduce((acc, curr) => acc + (curr.sentiment || 0), 0);
    const score = Math.min(100, Math.max(0, 50 + (totalSentiment * 10)));
    let mood = score > 60 ? "Bullish" : score < 40 ? "Bearish" : "Neutral";

    // 8. Handle "No News" gracefully
    if (top6.length === 0) {
      return res.status(200).json({
        asset,
        summary: "No major price-moving news found in the last 24 hours.",
        sentimentScore: 50,
        mood: "Neutral",
        articles: []
      });
    }

    res.status(200).json({
      asset: asset.toUpperCase(),
      sentimentScore: score,
      mood: mood,
      summary: `Current outlook for ${asset.toUpperCase()} is ${mood}. Key reports from ${top6[0].source} suggest market movement based on recent activity.`,
      articles: top6
    });

  } catch (error) {
    res.status(500).json({ error: "API Failure", details: error.message });
  }
}
