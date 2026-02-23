// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query; // Now expects just the ticker (e.g., "AAPL")
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

  if (!asset) return res.status(400).json({ error: "Ticker required" });

  const symbol = asset.toUpperCase();
  const today = new Date().toISOString().split('T')[0];
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  // Logic: Only use the specialized Finnhub 'company-news' endpoint
  // It is the most reliable for professional stock news.
  const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${lastWeek}&to=${today}&token=${FINNHUB_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // Map Finnhub data to the format your Prompt expects
    const articles = Array.isArray(data) ? data.slice(0, 6).map(art => ({
      title: art.headline,
      source: art.source,
      publishedAt: new Date(art.datetime * 1000).toISOString(),
      url: art.url
    })) : [];

    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // If we found nothing, let the frontend know so it triggers the failsafe
    if (articles.length === 0) {
      return res.status(200).json({ articles: [], message: "No recent verified news found." });
    }

    res.status(200).json({ articles });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
