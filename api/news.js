// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query; // Expecting ticker like "AAPL" or "BTC"
  if (!asset) return res.status(400).json({ error: "Ticker symbol required" });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

  // 1. Detect if Asset is Crypto or Stock
  const cryptoList = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"];
  const isCrypto = cryptoList.includes(asset.toUpperCase());

  try {
    // 2. Parallel Fetch from Professional Sources
    const [finnRes, alphaRes] = await Promise.allSettled([
      // Source A: Finnhub (Ticker-specific company news)
      fetch(isCrypto 
        ? `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`
        : `https://finnhub.io/api/v1/company-news?symbol=${asset.toUpperCase()}&from=${new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}&token=${FINNHUB_KEY}`
      ).then(res => res.json()),

      // Source B: Alpha Vantage (Advanced Market Sentiment)
      fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&limit=10&apikey=${ALPHA_KEY}`).then(res => res.json())
    ]);

    let articles = [];

    // 3. Process Alpha Vantage (High Quality + Sentiment)
    if (alphaRes.status === 'fulfilled' && alphaRes.value.feed) {
      articles.push(...alphaRes.value.feed.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        date: a.time_published.replace(/^(\d{4})(\d{2})(\d{2}).*/, '$2/$3/$1'),
        summary: a.summary,
        // Map Alpha Vantage (-0.35 to 0.35) to 0-100
        score: Math.round((parseFloat(a.overall_sentiment_score) + 0.5) * 100)
      })));
    }

    // 4. Process Finnhub (Institutional Speed)
    if (finnRes.status === 'fulfilled' && Array.isArray(finnRes.value)) {
      // Filter crypto news to only match the specific coin
      const data = isCrypto 
        ? finnRes.value.filter(a => a.headline.toLowerCase().includes(asset.toLowerCase()))
        : finnRes.value;

      articles.push(...data.map(a => ({
        title: a.headline,
        url: a.url,
        source: a.source,
        date: new Date(a.datetime * 1000).toLocaleDateString(),
        summary: a.summary || "Summary available at source.",
        score: 50 // Finnhub free doesn't provide score; we'll treat as neutral
      })));
    }

    // 5. Cleanup: Remove Duplicates & Relevance Check
    const seen = new Set();
    const cleanArticles = articles
      .filter(a => {
        const isDuplicate = seen.has(a.url);
        seen.add(a.url);
        const mentionsAsset = a.title.toLowerCase().includes(asset.toLowerCase()) || 
                             a.summary.toLowerCase().includes(asset.toLowerCase());
        return !isDuplicate && mentionsAsset;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6);

    // 6. Final Market Analysis
    const avgScore = cleanArticles.length > 0 
      ? Math.round(cleanArticles.reduce((s, a) => s + a.score, 0) / cleanArticles.length) 
      : 50;
    
    let prediction = "Consolidation / Neutral";
    if (avgScore > 65) prediction = "Bullish / Potential Growth";
    if (avgScore < 35) prediction = "Bearish / Downward Pressure";

    res.status(200).json({
      asset: asset.toUpperCase(),
      sentimentScore: avgScore,
      prediction: prediction,
      summary: `Based on the latest reports from ${cleanArticles[0]?.source || "financial analysts"}, the outlook for ${asset} is ${prediction.split(' ')[0]}.`,
      articles: cleanArticles
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch professional news." });
  }
}
