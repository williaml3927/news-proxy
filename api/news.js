// api/news.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const rawAsset = (req.query.asset || "").trim();
  if (!rawAsset) {
    return res.status(400).json({ error: "Missing asset parameter" });
  }

  const asset = rawAsset.toUpperCase();

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

  // Very basic crypto detection
  const cryptoList = ["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "MATIC", "AVAX", "DOT", "LINK"];
  const isCrypto = cryptoList.includes(asset);

  // Query terms
  const searchTerms = isCrypto ? `${asset} crypto` : asset;

  // ---- FETCH FINNHUB NEWS ----
  let finnhubArticles = [];
  try {
    const finnhubUrl = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`;
    const r = await fetch(finnhubUrl);
    const data = await r.json();

    finnhubArticles = data.filter(a =>
      a.headline &&
      a.url &&
      a.summary &&
      a.headline.toLowerCase().includes(asset.toLowerCase())
    );
  } catch (e) {
    console.log("Finnhub error", e);
  }

  // ---- FETCH ALPHA VANTAGE NEWS ----
  let alphaArticles = [];
  try {
    const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&apikey=${ALPHA_KEY}`;
    const r = await fetch(alphaUrl);
    const data = await r.json();

    if (data.feed) {
      alphaArticles = data.feed.map(a => ({
        title: a.title,
        url: a.url,
        summary: a.summary,
        source: a.source,
        time_published: a.time_published
      }));
    }
  } catch (e) {
    console.log("Alpha error", e);
  }

  // ---- MERGE & CLEAN ARTICLES ----
  let articles = [...finnhubArticles, ...alphaArticles];

  // Remove duplicates by URL
  const seen = new Set();
  articles = articles.filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // Filter spammy URLs
  const badDomains = ["github.com", "reddit.com", "medium.com"];
  articles = articles.filter(a =>
    !badDomains.some(d => a.url.includes(d))
  );

  // Limit to 6
  articles = articles.slice(0, 6);

  // ---- SIMPLE SENTIMENT SCORING ----
  let sentimentScore = 50;
  let explanation = "";

  const positiveWords = ["growth", "beat", "surge", "bull", "record", "upgrade"];
  const negativeWords = ["drop", "miss", "crash", "bear", "downgrade", "lawsuit"];

  let pos = 0, neg = 0;

  for (const a of articles) {
    const text = (a.title + " " + (a.summary || "")).toLowerCase();
    positiveWords.forEach(w => { if (text.includes(w)) pos++; });
    negativeWords.forEach(w => { if (text.includes(w)) neg++; });
  }

  if (pos + neg > 0) {
    sentimentScore = Math.round((pos / (pos + neg)) * 100);
  }

  if (sentimentScore > 60) explanation = "News is mostly positive. People think the asset will grow.";
  else if (sentimentScore < 40) explanation = "News is mostly negative. Investors are worried about the future.";
  else explanation = "News is mixed. Some good and some bad things are happening.";

  // ---- CHILD-FRIENDLY SUMMARY ----
  const summary = articles.map((a, i) => ({
    title: a.title,
    source: a.source || "Unknown",
    date: a.time_published || a.datetime || "",
    url: a.url
  }));

  return res.status(200).json({
    asset,
    isCrypto,
    sentimentScore,
    explanation,
    articles: summary
  });
}
