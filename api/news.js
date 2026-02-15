// api/news.js
export default async function handler(req, res) {
  const { asset, priceChange } = req.query; 
  // priceChange = % price move from frontend (optional)

  const NEWS_API = process.env.NEWS_API_KEY;
  const FINNHUB_API = process.env.FINNHUB_API_KEY;
  const ALPHA_API = process.env.ALPHA_VANTAGE_KEY;

  if (!asset) return res.status(400).json({ error: "Asset required" });

  // Detect crypto vs stock
  const isCrypto = ["btc","eth","sol","xrp","bnb"].some(c => asset.toLowerCase().includes(c));

  const query = encodeURIComponent(asset);

  const newsApiUrl = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_API}`;
  const finnhubUrl = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API}`;
  const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&apikey=${ALPHA_API}`;
  const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=50&format=json`;

  try {
    const results = await Promise.allSettled([
      fetch(newsApiUrl).then(r => r.json()),
      fetch(finnhubUrl).then(r => r.json()),
      fetch(alphaUrl).then(r => r.json()),
      fetch(gdeltUrl).then(r => r.json())
    ]);

    let articles = [];

    // NewsAPI
    if (results[0].value?.articles) {
      articles.push(...results[0].value.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        publishedAt: a.publishedAt
      })));
    }

    // Finnhub
    if (Array.isArray(results[1].value)) {
      articles.push(...results[1].value.map(a => ({
        title: a.headline,
        url: a.url,
        source: "Finnhub",
        publishedAt: new Date(a.datetime * 1000).toISOString()
      })));
    }

    // Alpha Vantage
    if (results[2].value?.feed) {
      articles.push(...results[2].value.feed.map(a => ({
        title: a.title,
        url: a.url,
        source: "AlphaVantage",
        publishedAt: a.time_published
      })));
    }

    // GDELT
    if (results[3].value?.articles) {
      articles.push(...results[3].value.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: "GDELT",
        publishedAt: a.seendate
      })));
    }

    // Remove duplicates
    const seen = new Set();
    articles = articles.filter(a => {
      if (seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    // Remove spam blogs
    const blacklist = ["medium.com", "substack.com", "blogspot.com", "reddit.com"];
    articles = articles.filter(a => !blacklist.some(b => a.url.includes(b)));

    // ------------------------------
    // 0-100 Sentiment Scoring
    // ------------------------------
    const positiveWords = ["surge","bullish","beats","growth","profit","upgrade","record","strong","rally"];
    const negativeWords = ["crash","bearish","lawsuit","drop","miss","downgrade","weak","fall","collapse"];

    function scoreSentiment(title) {
      let score = 0;
      positiveWords.forEach(w => title.toLowerCase().includes(w) && score++);
      negativeWords.forEach(w => title.toLowerCase().includes(w) && score--);
      return score;
    }

    articles = articles.map(a => ({ ...a, sentiment: scoreSentiment(a.title) }));

    // Convert to 0–100 scale
    const raw = articles.reduce((s,a)=>s+a.sentiment,0);
    const maxPossible = articles.length * 2 || 1; // avoid divide by zero
    let sentimentScore = Math.round(((raw + maxPossible) / (maxPossible * 2)) * 100);
    sentimentScore = Math.max(0, Math.min(100, sentimentScore));

    let mood = "Neutral";
    if (sentimentScore > 60) mood = "Bullish";
    if (sentimentScore < 40) mood = "Bearish";

    // Correlate with price movement (optional)
    let correlation = "No price data given.";
    if (priceChange) {
      if (priceChange > 0 && sentimentScore > 50) correlation = "Price went up and news is positive → news likely pushed price up.";
      if (priceChange < 0 && sentimentScore < 50) correlation = "Price went down and news is negative → bad news likely caused the drop.";
      if (priceChange > 0 && sentimentScore < 50) correlation = "Price went up even though news is bad → traders ignored the news.";
      if (priceChange < 0 && sentimentScore > 50) correlation = "Price went down even though news is good → market fear or profit-taking.";
    }

    // Explain like to a 12-year-old
    const explanation = (() => {
      if (mood === "Bullish")
        return `The news is mostly good. People feel happy and may want to buy this.`;
      if (mood === "Bearish")
        return `The news is mostly bad. People feel scared and may want to sell.`;
      return `The news is mixed. People are unsure what will happen next.`;
    })();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset,
      isCrypto,
      sentimentScore,
      mood,
      explanation,
      correlation,
      count: articles.length,
      articles
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
