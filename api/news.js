// api/news.js
export default async function handler(req, res) {
  const { asset, priceChange } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset required" });

  const NEWS_API = process.env.NEWS_API_KEY;
  const FINNHUB_API = process.env.FINNHUB_API_KEY;
  const ALPHA_API = process.env.ALPHA_VANTAGE_KEY;

  // Auto-detect stock vs crypto
  const cryptoTickers = ["btc","eth","sol","xrp","bnb","uni","atom","ada"];
  const isCrypto = cryptoTickers.some(c => asset.toLowerCase().includes(c));

  // Build query string
  const assetName = asset; // Replace with full name from dataset if available
  const query = isCrypto
    ? encodeURIComponent(`"${assetName} crypto" OR ${asset}`)
    : encodeURIComponent(`"${assetName}" OR ${asset}`);

  const newsApiUrl = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${NEWS_API}`;

  try {
    // Fetch NewsAPI
    const newsApiRes = await fetch(newsApiUrl);
    const newsApiData = await newsApiRes.json();

    let articles = [];

    if (newsApiData?.articles) {
      articles.push(...newsApiData.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        publishedAt: a.publishedAt,
        language: 'en' // NewsAPI already filtered by English
      })));
    }

    // Filter: English only
    articles = articles.filter(a => !a.language || a.language === 'en');

    // Filter: source whitelist
    const allowedSources = [
      "Bloomberg", "Reuters", "CNBC", "Financial Times",
      "Yahoo Finance", "The Wall Street Journal", "CoinDesk",
      "Cointelegraph", "CryptoSlate", "Investopedia", "NASDAQ"
    ];
    articles = articles.filter(a => allowedSources.includes(a.source));

    // Filter: spam / non-news domains
    const spamDomains = ["github.com","medium.com","reddit.com","substack.com","blogspot.com","youtube.com"];
    articles = articles.filter(a => !spamDomains.some(domain => a.url.includes(domain)));

    // Deduplicate by title + url
    const seen = new Set();
    articles = articles.filter(a => {
      const key = a.title + a.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ------------------------------
    // 0-100 Beginner-Friendly Sentiment
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

    // Aggregate score 0–100
    const raw = articles.reduce((s,a)=>s+a.sentiment,0);
    const maxPossible = articles.length * 2 || 1; // avoid divide by zero
    let sentimentScore = Math.round(((raw + maxPossible) / (maxPossible * 2)) * 100);
    sentimentScore = Math.max(0, Math.min(100, sentimentScore));

    // Mood
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

    // Beginner-friendly explanation
    const explanation = (() => {
      if (mood === "Bullish") return `The news is mostly good. People feel happy and may want to buy this.`;
      if (mood === "Bearish") return `The news is mostly bad. People feel scared and may want to sell.`;
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
