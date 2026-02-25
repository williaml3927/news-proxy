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

  const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${isCrypto ? 'CRYPTO:' + symbol : symbol}&limit=15&apikey=${ALPHA_KEY}`;

  try {
    const [finnRes, alphaRes] = await Promise.allSettled([
      fetch(finnUrl).then(r => r.json()),
      fetch(alphaUrl).then(r => r.json())
    ]);

    let combinedArticles = [];

    // 1. Process Alpha Vantage (Using their relevance score)
    if (alphaRes.status === 'fulfilled' && alphaRes.value.feed) {
      alphaRes.value.feed.forEach(art => {
        // Find the relevance score for THIS specific asset in the article
        const assetData = art.ticker_sentiment.find(t => t.ticker === (isCrypto ? `CRYPTO:${symbol}` : symbol));
        const relevance = assetData ? parseFloat(assetData.relevance_score) : 0;

        // ONLY keep it if the article is at least 40% about this asset
        if (relevance > 0.4) {
          const rawScore = parseFloat(art.overall_sentiment_score);
          combinedArticles.push({
            title: art.title,
            source: art.source,
            publishedAt: art.time_published.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z'),
            url: art.url,
            sentimentLabel: art.overall_sentiment_label,
            relevance: relevance
          });
        }
      });
    }

    // 2. Process Finnhub (Using String Matching)
    if (finnRes.status === 'fulfilled' && Array.isArray(finnRes.value)) {
      finnRes.value.forEach(art => {
        const headline = art.headline.toUpperCase();
        const summary = (art.summary || "").toUpperCase();
        
        // Strict Check: Ticker must be in the Headline or prominent in Summary
        const isRelevant = headline.includes(symbol) || headline.includes(asset.toUpperCase());

        if (isRelevant) {
          combinedArticles.push({
            title: art.headline,
            source: art.source,
            publishedAt: new Date(art.datetime * 1000).toISOString(),
            url: art.url,
            sentimentLabel: "Neutral", // Finnhub free doesn't provide
            relevance: 1.0 // If it's in the headline, it's highly relevant
          });
        }
      });
    }

    // 3. Cleanup: Deduplicate and Sort
    const seenUrls = new Set();
    const finalArticles = combinedArticles
      .filter(art => {
        if (seenUrls.has(art.url)) return false;
        seenUrls.add(art.url);
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 6);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ articles: finalArticles });

  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
