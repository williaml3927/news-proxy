// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query; 
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

  if (!asset) return res.status(400).json({ error: "Ticker required" });

  const symbol = asset.toUpperCase();
  const today = new Date().toISOString().split('T')[0];
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const cryptoTickers = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "UNI", "LINK"];
  const isCrypto = cryptoTickers.includes(symbol);

  const finnUrl = isCrypto 
    ? `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`
    : `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${lastWeek}&to=${today}&token=${FINNHUB_KEY}`;

  const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${isCrypto ? 'CRYPTO:' + symbol : symbol}&limit=10&apikey=${ALPHA_KEY}`;

  // Helper function to guess sentiment for Finnhub articles
  const calculateQuickSentiment = (text) => {
    const positive = ["surge", "rally", "growth", "bull", "gain", "profit", "buy", "upbeat"];
    const negative = ["drop", "crash", "fall", "bear", "loss", "plunge", "sell", "risk"];
    let score = 50; 
    const lowerText = text.toLowerCase();
    positive.forEach(word => { if (lowerText.includes(word)) score += 10; });
    negative.forEach(word => { if (lowerText.includes(word)) score -= 10; });
    return Math.min(100, Math.max(0, score));
  };

  try {
    const [finnRes, alphaRes] = await Promise.allSettled([
      fetch(finnUrl).then(r => r.json()),
      fetch(alphaUrl).then(r => r.json())
    ]);

    let combinedArticles = [];

    // Process Alpha Vantage (Professional Sentiment)
    if (alphaRes.status === 'fulfilled' && alphaRes.value.feed) {
      combinedArticles.push(...alphaRes.value.feed.map(art => {
        const rawScore = parseFloat(art.overall_sentiment_score);
        // Convert -1.0 to 1.0 range into 0 to 100
        const normalizedScore = Math.round((rawScore + 1) * 50);
        return {
          title: art.title,
          source: art.source,
          publishedAt: art.time_published.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z'),
          url: art.url,
          sentimentScore: normalizedScore,
          sentimentLabel: art.overall_sentiment_label
        };
      }));
    }

    // Process Finnhub (Manual Sentiment Calculation)
    if (finnRes.status === 'fulfilled' && Array.isArray(finnRes.value)) {
      let finnData = finnRes.value;
      if (isCrypto) {
        finnData = finnData.filter(art => 
          art.headline.toUpperCase().includes(symbol) || art.summary.toUpperCase().includes(symbol)
        );
      }
      combinedArticles.push(...finnData.map(art => {
        const score = calculateQuickSentiment(art.headline + " " + art.summary);
        let label = "Neutral";
        if (score > 55) label = "Bullish";
        if (score < 45) label = "Bearish";
        return {
          title: art.headline,
          source: art.source,
          publishedAt: new Date(art.datetime * 1000).toISOString(),
          url: art.url,
          sentimentScore: score,
          sentimentLabel: label
        };
      }));
    }

    const seenUrls = new Set();
    const uniqueArticles = combinedArticles
      .filter(art => {
        if (seenUrls.has(art.url)) return false;
        seenUrls.add(art.url);
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 8);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ articles: uniqueArticles });

  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
