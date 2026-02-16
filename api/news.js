// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset required" });

  const FINNHUB = process.env.FINNHUB_API_KEY;
  const ALPHA = process.env.ALPHA_VANTAGE_KEY;

  const input = asset.toLowerCase();

  // -------------------------------
  // AUTO MAP COMMON CRYPTO NAMES
  // -------------------------------
  const cryptoMap = {
    btc: "Bitcoin",
    bitcoin: "Bitcoin",
    eth: "Ethereum",
    ethereum: "Ethereum",
    sol: "Solana",
    solana: "Solana",
    xrp: "Ripple",
    ripple: "Ripple"
  };

  let ticker = asset.toUpperCase();
  let name = cryptoMap[input] || asset;

  // Detect crypto
  const isCrypto = Object.keys(cryptoMap).includes(input);

  // -------------------------------
  // BUILD SEARCH QUERIES
  // -------------------------------
  const searchTerms = isCrypto
    ? `${name} OR ${ticker} OR ${ticker} crypto`
    : `${name} OR ${ticker}`;

  try {
    // -------------------------------
    // FINNHUB SEARCH (ticker only)
    // -------------------------------
    const finnUrl = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=2025-02-01&to=2026-02-15&token=${FINNHUB}`;
    const finnRes = await fetch(finnUrl);
    const finnData = await finnRes.json();

    // -------------------------------
    // ALPHA VANTAGE SEARCH (name + ticker)
    // -------------------------------
    const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&topics=finance,crypto&apikey=${ALPHA}`;
    const alphaRes = await fetch(alphaUrl);
    const alphaData = await alphaRes.json();

    let articles = [];

    // Finnhub
    if (Array.isArray(finnData)) {
      articles.push(...finnData.map(a => ({
        title: a.headline,
        url: a.url,
        date: new Date(a.datetime * 1000).toISOString(),
        source: a.source,
        summary: a.summary
      })));
    }

    // Alpha
    if (alphaData.feed) {
      articles.push(...alphaData.feed.map(a => ({
        title: a.title,
        url: a.url,
        date: a.time_published,
        source: a.source,
        summary: a.summary
      })));
    }

    // -------------------------------
    // FILTER NON-ENGLISH (basic)
    // -------------------------------
    articles = articles.filter(a =>
      /^[\x00-\x7F]*$/.test(a.title)
    );

    // -------------------------------
    // FILTER SPAM DOMAINS
    // -------------------------------
    const spamDomains = ["github.com","reddit.com","youtube.com","medium.com","substack.com"];
    articles = articles.filter(a => !spamDomains.some(d => a.url.includes(d)));

    // -------------------------------
    // KEEP HIGH QUALITY SOURCES
    // -------------------------------
    const goodSources = ["Bloomberg","Reuters","CNBC","Yahoo","Financial Times","WSJ","CoinDesk","Cointelegraph"];
    articles = articles.filter(a =>
      goodSources.some(s => (a.source || "").includes(s))
    );

    // -------------------------------
    // REMOVE DUPLICATES
    // -------------------------------
    const seen = new Set();
    articles = articles.filter(a => {
      const key = a.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // -------------------------------
    // SORT + LIMIT
    // -------------------------------
    articles.sort((a,b) => new Date(b.date) - new Date(a.date));
    articles = articles.slice(0,6);

    // -------------------------------
    // SIMPLE SENTIMENT 0–100
    // -------------------------------
    const pos = ["beats","growth","bullish","record","upgrade","profit","strong"];
    const neg = ["miss","lawsuit","crash","decline","downgrade","loss","weak"];

    function score(text){
      let s=0;
      pos.forEach(w => text.toLowerCase().includes(w) && s++);
      neg.forEach(w => text.toLowerCase().includes(w) && s--);
      return s;
    }

    let total=0;
    articles = articles.map(a=>{
      const s = score(a.title + " " + a.summary);
      total += s;
      return {...a, sentiment:s};
    });

    const max = articles.length * 2 || 1;
    let sentimentScore = Math.round(((total + max)/(max*2))*100);
    sentimentScore = Math.max(0, Math.min(100, sentimentScore));

    let mood = "Neutral";
    if (sentimentScore > 60) mood = "Bullish";
    if (sentimentScore < 40) mood = "Bearish";

    // Beginner explanation
    const summary =
      mood === "Bullish" ? "News is mostly positive. Investors think this asset could go up."
      : mood === "Bearish" ? "News is mostly negative. Investors are worried it could go down."
      : "News is mixed. No clear direction yet.";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      input,
      ticker,
      name,
      isCrypto,
      sentimentScore,
      mood,
      summary,
      articles
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
