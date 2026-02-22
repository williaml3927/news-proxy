// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query; // e.g., "AAPL"
  
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

  // Finnhub requires a date range (we'll use the last 7 days)
  const today = new Date().toISOString().split('T')[0];
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const finnhubUrl = `https://finnhub.io/api/v1/company-news?symbol=${asset}&from=${lastWeek}&to=${today}&token=${FINNHUB_KEY}`;
  const alphaUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&limit=10&apikey=${ALPHA_KEY}`;

  try {
    // Fetch from both APIs at the same time
    const [finnRes, alphaRes] = await Promise.all([
      fetch(finnhubUrl),
      fetch(alphaUrl)
    ]);

    const finnData = await finnRes.json();
    const alphaData = await alphaRes.json();
    
    // Add CORS headers so your AI Studio app can talk to Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Return exactly what both APIs give us in one simple object
    res.status(200).json({
      finnhubNews: finnData,
      alphaVantageNews: alphaData
    });

  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
