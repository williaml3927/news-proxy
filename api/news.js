// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset symbol is required (e.g., AAPL, BTC)" });

  // Get Keys
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_API_KEY = process.env.ALPHA_VANTAGE_KEY;

  // Helpers
  const cryptoTickers = ["btc", "eth", "sol", "xrp", "ada", "doge", "shib", "dot"];
  const isCrypto = cryptoTickers.some((t) => asset.toLowerCase().includes(t));
  
  // Dates for Finnhub (YYYY-MM-DD)
  const today = new Date();
  const pastDate = new Date();
  pastDate.setDate(today.getDate() - 5); // Look back 5 days
  const toDate = today.toISOString().split('T')[0];
  const fromDate = pastDate.toISOString().split('T')[0];

  try {
    const fetchPromises = [];

    // --- SOURCE 1: Alpha Vantage (Includes Benzinga, Reuters, Motley Fool) ---
    // This is the highest quality source for sentiment and price relevance
    const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&sort=LATEST&limit=15&apikey=${ALPHA_API_KEY}`;
    fetchPromises.push(
      fetch(alphaUrl).then(r => r.json()).catch(() => ({}))
    );

    // --- SOURCE 2: Finnhub (Company Specific or Crypto) ---
    let finnUrl = "";
    if (isCrypto) {
      finnUrl = `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_API_KEY}`;
    } else {
      finnUrl = `https://finnhub.io/api/v1/company-news?symbol=${asset}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`;
    }
    fetchPromises.push(
      fetch(finnUrl).then(r => r.json()).catch(() => [])
    );

    // --- SOURCE 3: NewsAPI (Broad Backup) ---
    // Only fetching from top-tier financial domains to reduce spam
    const trustedDomains = "bloomberg.com,reuters.com,cnbc.com,wsj.com,finance.yahoo.com,coindesk.com,cointelegraph.com";
    const newsApiUrl = `https://newsapi.org/v2/everything?q=${asset}&domains=${trustedDomains}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_API_KEY}`;
    fetchPromises.push(
      fetch(newsApiUrl).then(r => r.json()).catch(() => ({}))
    );

    // Wait for all APIs
    const [alphaData, finnData, newsApiData] = await Promise.all(fetchPromises);

    let allArticles = [];

    // --- PROCESS ALPHA VANTAGE ---
    if (alphaData.feed) {
      allArticles.push(...alphaData.feed.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        summary: a.summary,
        time: a.time_published, // format: 20240215T230000
        image: a.banner_image,
        // Alpha Vantage gives scores like 0.35 (Bullish). We normalize to 0-100.
        // -1 (Bearish) -> 0, 0 (Neutral) -> 50, 1 (Bullish) -> 100
        sentimentScore: a.overall_sentiment_score 
          ? Math.round((parseFloat(a.overall_sentiment_score) + 1) * 50) 
          : 50
      })));
    }

    // --- PROCESS FINNHUB ---
    if (Array.isArray(finnData)) {
      allArticles.push(...finnData.map(a => ({
        title: a.headline,
        url: a.url,
        source: a.source,
        summary: a.summary,
        time: new Date(a.datetime * 1000).toISOString(),
        image: a.image,
        sentimentScore: 50 // Finnhub doesn't give sentiment, default to Neutral
      })));
    }

    // --- PROCESS NEWSAPI ---
    if (newsApiData.articles) {
      allArticles.push(...newsApiData.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        summary: a.description,
        time: a.publishedAt,
        image: a.urlToImage,
        sentimentScore: 50 // NewsAPI doesn't give sentiment, default to Neutral
      })));
    }

    // --- FILTERING & CLEANING ---
    
    // 1. Remove Spam / Removed Content
    allArticles = allArticles.filter(a => 
      a.title && 
      !a.title.includes("[Removed]") && 
      !a.url.includes("google.com/search")
    );

    // 2. Strict Relevance Check (Asset name must be in title or summary)
    // For crypto, we check symbol (BTC) or name (Bitcoin). For stocks, usually symbol is enough.
    allArticles = allArticles.filter(a => {
      const text = (a.title + " " + a.summary).toLowerCase();
      return text.includes(asset.toLowerCase());
    });

    // 3. Deduplication (by URL)
    const seen = new Set();
    allArticles = allArticles.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    // 4. Sort by "Quality"
    // We prioritize AlphaVantage (has sentiment) and recent dates
    allArticles.sort((a, b) => {
      // Prioritize articles that have a non-50 sentiment score (meaning they were analyzed)
      const aQual = a.sentimentScore !== 50 ? 1 : 0;
      const bQual = b.sentimentScore !== 50 ? 1 : 0;
      return bQual - aQual || new Date(b.time) - new Date(a.time);
    });

    // --- FINAL SELECTION ---
    const top6 = allArticles.slice(0, 6);

    // --- AGGREGATE SENTIMENT & SUMMARY ---
    
    // Calculate Average Sentiment (0-100)
    const avgScore = top6.length > 0
      ? Math.round(top6.reduce((acc, curr) => acc + curr.sentimentScore, 0) / top6.length)
      : 50;

    let mood = "Neutral";
    if (avgScore >= 60) mood = "Bullish";
    if (avgScore <= 40) mood = "Bearish";

    // Generate Text Summary based on the top articles
    const summaryText = top6.length > 0 
      ? `Market sentiment for ${asset.toUpperCase()} is currently ${mood} (${avgScore}/100). Key drivers include: ${top6[0].title}. Sources like ${top6[0].source} and ${top6[1]?.source || "others"} are reporting widely on this trend.`
      : "No significant news found for this asset recently.";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset,
      overallSentiment: avgScore,
      mood,
      summary: summaryText,
      articleCount: top6.length,
      articles: top6
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch news." });
  }
}
