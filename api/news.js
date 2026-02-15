// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset required" });

  const FINNHUB = process.env.FINNHUB_API_KEY;
  const ALPHA = process.env.ALPHA_VANTAGE_KEY;

  const ticker = asset.toUpperCase();

  try {
    // ------------------------------
    // FETCH FINNHUB NEWS
    // ------------------------------
    const finnUrl = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=2025-02-01&to=2026-02-15&token=${FINNHUB}`;
    const finnRes = await fetch(finnUrl);
    const finnData = await finnRes.json();

    // ------------------------------
    // FETCH ALPHA VANTAGE NEWS
    // ------------------------------
    const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=50&apikey=${ALPHA}`;
    const alphaRes = await fetch(alphaUrl);
    const alphaData = await alphaRes.json();

    let articles = [];

    // Finnhub format
    if (Array.isArray(finnData)) {
      articles.push(...finnData.map(a => ({
        title: a.headline,
        url: a.url,
        date: new Date(a.datetime * 1000).toISOString(),
        source: a.source,
        summary: a.summary
      })));
    }

    // Alpha format
    if (alphaData.feed) {
      articles.push(...alphaData.feed.map(a => ({
        title: a.title,
        url: a.url,
        date: a.time_published,
        source: a.source,
        summary: a.summary
      })));
    }

    // ------------------------------
    // FILTER SPAM + NON NEWS
    // ------------------------------
    const spamDomains = ["github.com","reddit.com","medium.com","youtube.com","substack.com","blogspot.com"];
    articles = articles.filter(a => !spamDomains.some(d => a.url.includes(d)));

    // ------------------------------
    // FILTER HIGH QUALITY SOURCES
    // ------------------------------
    const goodSources = ["Bloomberg","Reuters","CNBC","Yahoo Finance","Financial Times","WSJ","CoinDesk","Cointelegraph"];
    articles = articles.filter(a => goodSources.some(s => a.source?.includes(s)));

    // ------------------------------
    // FILTER RELEVANT CONTENT
    // ------------------------------
    const keywords = ["earnings","revenue","profit","forecast","guidance","price","market","growth","decline","lawsuit","regulation"];
    articles = articles.filter(a =>
      keywords.some(k => (a.title + a.summary).toLowerCase().includes(k))
    );

    // ------------------------------
    // REMOVE DUPLICATES
    // ------------------------------
    const seen = new Set();
    articles = articles.filter(a => {
      const key = a.title + a.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort newest first
    articles.sort((a,b) => new Date(b.date) - new Date(a.date));

    // Keep only 6
    articles = articles.slice(0,6);

    // ------------------------------
    // SIMPLE SENTIMENT SCORING 0–100
    // ------------------------------
    const positive = ["beats","growth","strong","bullish","record","upgrade","profit"];
    const negative = ["miss","lawsuit","crash","weak","decline","downgrade","loss"];

    function score(text) {
      let s = 0;
      positive.forEach(w => text.toLowerCase().includes(w) && s++);
      negative.forEach(w => text.toLowerCase().includes(w) && s--);
      return s;
    }

    let total = 0;
    articles = articles.map(a => {
      const s = score(a.title + " " + a.summary);
      total += s;
      return { ...a, sentiment: s };
    });

    const max = articles.length * 2 || 1;
    let sentimentScore = Math.round(((total + max) / (max * 2)) * 100);
    sentimentScore = Math.max(0, Math.min(100, sentimentScore));

    let mood = "Neutral";
    if (sentimentScore > 60) mood = "Bullish";
    if (sentimentScore < 40) mood = "Bearish";

    // ------------------------------
    // BEGINNER SUMMARY
    // ------------------------------
    const summary =
      mood === "Bullish"
        ? "Most news is positive. The company or crypto is growing and investors feel confident."
        : mood === "Bearish"
        ? "Most news is negative. The company or crypto is struggling and investors feel worried."
        : "News is mixed. Investors are unsure what will happen next.";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      ticker,
      sentimentScore,
      mood,
      summary,
      articles
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
