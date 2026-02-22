// api/news.js

export default async function handler(req, res) {
  const asset = req.query.asset?.toUpperCase();
  if (!asset) return res.status(400).json({ error: "Missing asset" });

  const FINNHUB_KEY = process.env.FINNHUB_KEY;
  const ALPHA_KEY = process.env.ALPHA_KEY;

  // Basic crypto detection
  const cryptoList = ["BTC", "ETH", "SOL", "BNB", "MATIC", "ADA", "UNI", "XRP", "DOGE", "AVAX", "ATOM"];
  const isCrypto = cryptoList.includes(asset);

  // Date range for Finnhub stocks
  const today = new Date().toISOString().split("T")[0];
  const lastMonth = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().split("T")[0];

  let articles = [];

  try {
    // ================= FINNHUB (STOCKS) =================
    if (!isCrypto) {
      const finnUrl = `https://finnhub.io/api/v1/company-news?symbol=${asset}&from=${lastMonth}&to=${today}&token=${FINNHUB_KEY}`;
      const finnRes = await fetch(finnUrl);
      const finnData = await finnRes.json();

      if (Array.isArray(finnData)) {
        articles = finnData.map(a => ({
          title: a.headline,
          url: a.url,
          source: a.source,
          publishedAt: new Date(a.datetime * 1000).toISOString(),
        }));
      }
    }

    // ================= ALPHA VANTAGE (CRYPTO + BACKUP) =================
    const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&apikey=${ALPHA_KEY}`;
    const alphaRes = await fetch(alphaUrl);
    const alphaData = await alphaRes.json();

    if (alphaData.feed) {
      const alphaArticles = alphaData.feed.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        publishedAt: a.time_published,
      }));
      articles = articles.concat(alphaArticles);
    }

    // ================= CLEAN + FILTER =================

    // Remove duplicates by URL
    const unique = [];
    const seen = new Set();
    for (const a of articles) {
      if (a.url && !seen.has(a.url)) {
        seen.add(a.url);
        unique.push(a);
      }
    }

    // English only (simple filter)
    const english = unique.filter(a => {
      return a.title && /^[A-Za-z0-9\s.,'"!?-]+$/.test(a.title);
    });

    // Limit to 6 latest
    const finalNews = english
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 6);

    // ================= SIMPLE SENTIMENT SCORE =================
    let score = 50; // neutral baseline
    const positiveWords = ["growth", "beat", "strong", "bull", "surge", "profit", "adoption"];
    const negativeWords = ["crash", "decline", "drop", "lawsuit", "bear", "weak", "hack"];

    finalNews.forEach(n => {
      const text = n.title.toLowerCase();
      positiveWords.forEach(w => { if (text.includes(w)) score += 5; });
      negativeWords.forEach(w => { if (text.includes(w)) score -= 5; });
    });

    score = Math.max(0, Math.min(100, score));

    // Simple explanation for beginners
    let explanation = "News is neutral.";
    if (score > 65) explanation = "Most news is positive. Investors feel optimistic.";
    if (score < 35) explanation = "Most news is negative. Investors feel worried.";

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");

    res.status(200).json({
      asset,
      isCrypto,
      sentimentScore: score,
      sentimentExplanation: explanation,
      articles: finalNews,
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
