export default async function handler(req, res) {
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset symbol required" });

  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

  // 1. Strict Domain Whitelist (Only High-Quality Financial News)
  const trustedDomains = [
    "reuters.com", "bloomberg.com", "cnbc.com", "wsj.com", "forbes.com",
    "marketwatch.com", "benzinga.com", "finance.yahoo.com", "investing.com",
    "coindesk.com", "cointelegraph.com", "barrons.com", "ft.com"
  ].join(",");

  // 2. Exclusion List (Blocks Code Repos and Spam)
  const excludeDomains = "github.com,pypi.org,npm.com,medium.com,reddit.com,youtube.com,substack.com";

  try {
    // Parallel Fetching from 3 Top-Tier Sources
    const [alphaRes, newsApiRes, finnhubRes] = await Promise.all([
      // Alpha Vantage (Includes Benzinga & Sentiment Scores)
      fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&limit=10&apikey=${ALPHA_VANTAGE_KEY}`).then(r => r.json()),
      
      // NewsAPI (Restricted to Trusted Domains + English)
      fetch(`https://newsapi.org/v2/everything?q=${asset}&domains=${trustedDomains}&excludeDomains=${excludeDomains}&language=en&sortBy=relevancy&pageSize=15&apiKey=${NEWS_API_KEY}`).then(r => r.json()),

      // Finnhub (Direct Ticker News)
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${asset.toUpperCase()}&from=${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}&token=${FINNHUB_API_KEY}`).then(r => r.json())
    ]);

    let rawArticles = [];

    // Parse Alpha Vantage
    if (alphaRes.feed) {
      rawArticles.push(...alphaRes.feed.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        date: new Date(a.time_published.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6')).toLocaleDateString(),
        summary: a.summary,
        sentiment: parseFloat(a.overall_sentiment_score || 0)
      })));
    }

    // Parse NewsAPI
    if (newsApiRes.articles) {
      rawArticles.push(...newsApiRes.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        date: new Date(a.publishedAt).toLocaleDateString(),
        summary: a.description,
        sentiment: 0 // Will calculate manually below
      })));
    }

    // Parse Finnhub
    if (Array.isArray(finnhubRes)) {
      rawArticles.push(...finnhubRes.map(a => ({
        title: a.headline,
        url: a.url,
        source: a.source,
        date: new Date(a.datetime * 1000).toLocaleDateString(),
        summary: a.summary,
        sentiment: 0
      })));
    }

    // --- RELEVANCE & QUALITY FILTERING ---
    const cleanArticles = [];
    const seenUrls = new Set();

    for (const art of rawArticles) {
      const lowerTitle = art.title?.toLowerCase() || "";
      const lowerSummary = art.summary?.toLowerCase() || "";
      const search = asset.toLowerCase();

      // Check if Asset is actually mentioned in Title or Summary
      if (!lowerTitle.includes(search) && !lowerSummary.includes(search)) continue;
      
      // Remove Duplicates
      if (seenUrls.has(art.url)) continue;
      seenUrls.add(art.url);

      // Simple keyword sentiment if Alpha Vantage didn't provide one
      if (art.sentiment === 0) {
        const bull = ["surge", "rally", "growth", "buy", "upgraded", "profit", "bullish"];
        const bear = ["plunge", "fall", "crash", "sell", "downgraded", "loss", "bearish"];
        bull.forEach(w => lowerTitle.includes(w) && (art.sentiment += 0.2));
        bear.forEach(w => lowerTitle.includes(w) && (art.sentiment -= 0.2));
      }

      cleanArticles.push(art);
    }

    // Sort by Date & Quality, then pick Top 6
    const top6 = cleanArticles
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6);

    // Calculate Overall 0-100 Score
    const avgSentiment = top6.reduce((acc, a) => acc + a.sentiment, 0) / (top6.length || 1);
    const normalizedScore = Math.round((avgSentiment + 1) * 50); // Convert -1 to 1 range to 0-100

    // Final "Market Pulse" Summary
    const mood = normalizedScore > 60 ? "Bullish" : normalizedScore < 40 ? "Bearish" : "Neutral";
    const overview = `Currently ${mood} sentiment for ${asset.toUpperCase()}. Top stories from ${top6[0]?.source || 'major sources'} highlight key market drivers. Average sentiment score is ${normalizedScore}/100.`;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset: asset.toUpperCase(),
      overallSentiment: normalizedScore,
      mood: mood,
      summary: overview,
      articles: top6
    });

  } catch (err) {
    res.status(500).json({ error: "Service Error", details: err.message });
  }
}
