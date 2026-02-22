export default async function handler(req, res) {
  const { asset } = req.query; 
  if (!asset) return res.status(400).json({ error: "Asset is required" });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

  // 1. Fix the Date Formatting (Must be YYYY-MM-DD)
  const dateObj = new Date();
  const today = dateObj.toISOString().split('T')[0];
  dateObj.setMonth(dateObj.getMonth() - 1); // Go back 30 days
  const lastMonth = dateObj.toISOString().split('T')[0];

  // 2. Determine Endpoint (Stock vs. Crypto)
  const symbol = asset.toUpperCase();
  const cryptoCheck = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LINK", "DOT"];
  const isCrypto = cryptoCheck.includes(symbol) || asset.toLowerCase().includes("bitcoin");

  // This is the fix for the line you pointed out:
  const url = isCrypto 
    ? `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`
    : `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${lastMonth}&to=${today}&token=${FINNHUB_KEY}`;

  try {
    const response = await fetch(url);
    const rawData = await response.json();

    // 3. Simple relevant-only filter
    let processed = Array.isArray(rawData) ? rawData : [];
    
    // If crypto, we have to find our specific coin in the general crypto feed
    if (isCrypto) {
      processed = processed.filter(art => 
        art.headline.toLowerCase().includes(asset.toLowerCase()) || 
        art.summary.toLowerCase().includes(asset.toLowerCase())
      );
    }

    // 4. Map to the 6 high-quality articles you requested
    const finalNews = processed.slice(0, 6).map(art => {
      // Basic Sentiment Math
      const text = (art.headline + art.summary).toLowerCase();
      let score = 50;
      if (text.match(/surge|growth|bull|up|high|gain/)) score += 20;
      if (text.match(/drop|fall|bear|down|low|loss/)) score -= 20;

      return {
        title: art.headline,
        summary: art.summary,
        url: art.url,
        source: art.source,
        date: new Date(art.datetime * 1000).toLocaleDateString(),
        sentiment: score
      };
    });

    // 5. Calculate Overall Sentiment and Future Outlook
    const avgSentiment = finalNews.length > 0 
      ? Math.round(finalNews.reduce((acc, a) => acc + a.sentiment, 0) / finalNews.length) 
      : 50;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      asset: symbol,
      overallSentiment: avgSentiment,
      summary: finalNews.length > 0 ? `The outlook for ${symbol} is currently ${avgSentiment > 50 ? 'Positive' : 'Cautious'}.` : "No recent news found.",
      articles: finalNews
    });

  } catch (error) {
    res.status(500).json({ error: "Finnhub fetch failed" });
  }
}
