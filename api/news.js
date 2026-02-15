const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const { q = 'stock market', pageSize = 10 } = req.query;
  const apiKey = process.env.NEWS_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${pageSize}&language=en&sortBy=publishedAt&apiKey=${apiKey}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
