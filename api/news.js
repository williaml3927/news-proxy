export default async function handler(req, res) {
  const { asset } = req.query;
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_API_KEY;

  if (!asset) return res.status(400).json({ error: "Missing asset" });

  const today = new Date().toISOString().split("T")[0];
  const lastMonth = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
    .toISOString()
    .split("T")[0];

  try {
    // Finnhub company-specific news
    const finnUrl = `https://finnhub.io/api/v1/company-news?symbol=${asset}&from=${lastMonth}&to=${today}&token=${FINNHUB_KEY}`;
    const finnResp = await fetch(finnUrl);
    const finnData = await finnResp.json();

    // Alpha Vantage news
    const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&apikey=${ALPHA_KEY}`;
    const alphaResp = await fetch(alphaUrl);
    const alphaData = await alphaResp.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset,
      finnhub: finnData,
      alphavantage: alphaData
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
