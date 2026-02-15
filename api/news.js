// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset required" });

  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

  // 1. Detect Asset Type & Timeframe
  const cryptoTickers = ["btc", "eth", "sol", "xrp", "bnb", "doge", "ada", "matic"];
  const isCrypto = cryptoTickers.some(c => asset.toLowerCase().includes(c));
  
  // Get dates for Finnhub (requires YYYY-MM-DD)
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const toDate = today.toISOString().split('T')[0];
  const fromDate = sevenDaysAgo.toISOString().split('T')[0];

  try {
    // 2. Fetch from Multiple Sources Parallelly
    const queries = [];

    // Source A: NewsAPI (Broad Search)
    // We add "finance" or "price" to the query to reduce non-financial noise
    const newsQuery = isCrypto 
      ? `"${asset}" AND (crypto OR blockchain OR price)` 
      : `"${asset}" AND (stock OR market OR finance)`;
    
    queries.push(
      fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(newsQuery)}&language=en&sortBy=relevancy&pageSize=20&apiKey=${NEWS_API_KEY}`)
        .then(res => res.json())
    );

    // Source B: Finnhub (Targeted Company/Crypto News)
    if (isCrypto) {
       // Finnhub Crypto General News (filtered later)
       queries.push(
         fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_API_KEY}`)
           .then(res => res.json())
       );
    } else {
       // Finnhub Specific Company News (Very high quality for stocks)
       queries.push(
         fetch(`https://finnhub.io/api/v1/company-news?symbol=${asset}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`)
           .then(res => res.json())
       );
    }

    const [newsApiData, finnhubData] = await Promise.all(queries);

    // 3. Normalize Data into One List
    let allArticles = [];

    // Normalize NewsAPI
    if (newsApiData.articles) {
      allArticles.push(...newsApiData.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        time: a.publishedAt,
        summary: a.description || "",
        image: a.urlToImage
      })));
    }

    // Normalize Finnhub
    // Finnhub returns an array directly
    const finnArray = Array.isArray(finnhubData) ? finnhubData : [];
    allArticles.push(...finnArray.map(a => ({
      title: a.headline,
      url: a.url,
      source: a.source,
      time: new Date(a.datetime * 1000).toISOString(),
      summary: a.summary || "",
      image: a.image
    })));

    // 4. The "High Quality" Filter Logic
    const trustedSources = [
      "Bloomberg", "Reuters", "CNBC", "Wall Street Journal", "Financial Times",
      "Yahoo Finance", "MarketWatch", "Benzinga", "The Street", "Forbes",
      "CoinDesk", "Cointelegraph", "Decrypt", "Barron's", "Investopedia"
    ];

    // Remove duplicates
    const seenUrls = new Set();
    allArticles = allArticles.filter(a => {
      if (seenUrls.has(a.url)) return false;
      seenUrls.add(a.url);
      return true;
    });

    // Scoring Algorithm
    allArticles = allArticles.map(article => {
      let score = 0;
      
      // Bonus: Is it from a Trusted Source?
      if (trustedSources.some(s => article.source.includes(s))) score += 20;

      // Bonus: Does title mention the asset explicitly?
      if (article.title.toLowerCase().includes(asset.toLowerCase())) score += 10;
      
      // Bonus: Does it mention price/market action?
      if (/price|surge|crash|rally|forecast|earnings|revenue|profit/.test(article.title.toLowerCase())) score += 5;

      // Penalty: Generic or Spammy
      if (article.title.includes("Removed")) score -= 100;
      if (article.url.includes("google.com/search")) score -= 100;

      return { ...article, score };
    });

    // Sort by Score (High to Low)
    allArticles.sort((a, b) => b.score - a.score);

    // 5. Select Top 6 & Analyze Sentiment
    const finalArticles = allArticles.slice(0, 6);

    // Simple Sentiment Calculation for the "Future Outlook"
    let bullCount = 0;
    let bearCount = 0;
    const bullWords = ["surge", "jump", "high", "gain", "buy", "outperform", "strong", "growth"];
    const bearWords = ["drop", "fall", "loss", "sell", "weak", "crash", "plunge", "miss"];

    finalArticles.forEach(a => {
      const text = (a.title + " " + a.summary).toLowerCase();
      if (bullWords.some(w => text.includes(w))) bullCount++;
      if (bearWords.some(w => text.includes(w))) bearCount++;
    });

    let prediction = "Neutral / Consolidation";
    let explanation = "The news is mixed. Analysts are watching for the next major catalyst.";
    
    if (bullCount > bearCount) {
      prediction = "Bullish / Uptrend";
      explanation = `Positive sentiment is dominant in ${bullCount} out of 6 top stories. Expect potential price growth.`;
    } else if (bearCount > bullCount) {
      prediction = "Bearish / Downtrend";
      explanation = `Negative sentiment detected in ${bearCount} out of 6 top stories. Caution is advised.`;
    }

    // 6. Return Response
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset,
      prediction,
      explanation,
      articles: finalArticles
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
