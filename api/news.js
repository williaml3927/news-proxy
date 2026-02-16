export default async function handler(req, res) {
  const { asset } = req.query; // e.g. AAPL, TSLA, BTC, Bitcoin
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_API_KEY;

  if (!asset) {
    return res.status(400).json({ error: "Missing asset parameter" });
  }

  try {
    // ---------- FINNHUB ----------
    const finnUrl = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`;
    const finnResp = await fetch(finnUrl);
    const finnData = await finnResp.json();

    // ---------- ALPHA VANTAGE ----------
    const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&apikey=${ALPHA_KEY}`;
    const alphaResp = await fetch(alphaUrl);
    const alphaData = await alphaResp.json();

    // Return BOTH raw responses so you can debug
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset,
      finnhub: finnData,
      alphavantage: alphaData
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch news", details: err.message });
  }
}
