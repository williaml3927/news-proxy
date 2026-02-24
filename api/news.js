// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query; 
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

  if (!asset) return res.status(400).json({ error: "Ticker required" });

  const symbol = asset.toUpperCase();
  const today = new Date().toISOString().split('T')[0];
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  // Logic: Identify Crypto for endpoint switching
  const cryptoTickers = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "UNI", "LINK"];
  const isCrypto = cryptoTickers.includes(symbol);

  // 1. Prepare URLs
  const finnUrl = isCrypto 
    ? `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`
    : `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${lastWeek}&to=${today}&token=${FINNHUB_KEY}`;

  const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${isCrypto ? 'CRYPTO:' + symbol : symbol}&limit=10&apikey=${ALPHA_KEY}`;

  try {
    // 2. Fetch from both in parallel (allSettled prevents one failure from breaking both)
    const [finnRes, alphaRes] = await Promise.allSettled([
      fetch(finnUrl).then(r => r.json()),
      fetch(alphaUrl).then(r => r.json())
    ]);

    let combinedArticles = [];

    // 3. Process Finnhub Results
    if (finnRes.status === 'fulfilled' && Array.isArray(finnRes.value)) {
      let finnData = finnRes.value;
      if (isCrypto) {
        finnData = finnData.filter(art => 
          art.headline.toUpperCase().includes(symbol) || art.summary.toUpperCase().includes(symbol)
        );
      }
      combinedArticles.push(...finnData.map(art => ({
        title: art.headline,
        source: art.source,
        publishedAt: new Date(art.datetime * 1000).toISOString(),
        url: art.url
      })));
    }

    // 4. Process Alpha Vantage Results
    if (alphaRes.status === 'fulfilled' && alphaRes.value.feed) {
      combinedArticles.push(...alphaRes.value.feed.map(art => ({
        title: art.title,
        source: art.source,
        // Alpha Vantage format: 20240315T120000 -> Convert to ISO
        publishedAt: art.time_published.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z'),
        url: art.url
      })));
    }

    // 5. Cleanup: Deduplicate by URL and Sort by Date
    const seenUrls = new Set();
    const uniqueArticles = combinedArticles
      .filter(art => {
        if (seenUrls.has(art.url)) return false;
        seenUrls.add(art.url);
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 8); // Top 8 total

    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (uniqueArticles.length === 0) {
      return res.status(200).json({ articles: [], message: "No recent verified news found." });
    }

    res.status(200).json({ articles: uniqueArticles });

  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news from sources" });
  }
}
