// api/news.js
export default async function handler(req, res) {
  const { asset } = req.query; // e.g., "AAPL" or "Bitcoin"
  const apiKey = process.env.NEWS_API_KEY; 
  
  const url = `https://newsapi.org/v2/everything?q=${asset}&sortBy=publishedAt&apiKey=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    // Add CORS headers so your AI Studio app can talk to Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
