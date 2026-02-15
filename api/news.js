export default async function handler(req, res) {
  const { asset } = req.query;
  if (!asset) return res.status(400).json({ error: "Asset symbol required" });

  const keys = {
    news: process.env.NEWS_API_KEY,
    finn: process.env.FINNHUB_API_KEY,
    alpha: process.env.ALPHA_VANTAGE_KEY
  };

  try {
    const results = await Promise.allSettled([
      // 1. Alpha Vantage (Best for Sentiment & Benzinga)
      fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${asset}&limit=10&apikey=${keys.alpha}`).then(res => res.json()),
      
      // 2. Finnhub (Company specific)
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${asset.toUpperCase()}&from=2024-01-01&to=${new Date().toISOString().split('T')[0]}&token=${keys.finn}`).then(res => res.json()),
      
      // 3. NewsAPI (The widest net)
      fetch(`https://newsapi.org/v2/everything?q=${asset}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${keys.news}`).then(res => res.json())
    ]);

    let articles = [];

    // Parse Alpha Vantage
    if (results[0].status === 'fulfilled' && results[0].value.feed) {
      articles.push(...results[0].value.feed.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        date: a.time_published,
        summary: a.summary,
        sentiment: Math.round((parseFloat(a.overall_sentiment_score) + 1) * 50)
      })));
    }

    // Parse Finnhub
    if (results[1].status === 'fulfilled' && Array.isArray(results[1].value)) {
      articles.push(...results[1].value.map(a => ({
        title: a.headline,
        url: a.url,
        source: a.source,
        date: new Date(a.datetime * 1000).toISOString(),
        summary: a.summary,
        sentiment: 50
      })));
    }

    // Parse NewsAPI
    if (results[2].status === 'fulfilled' && results[2].value.articles) {
      articles.push(...results[2].value.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        date: a.publishedAt,
        summary: a.description,
        sentiment: 50
      })));
    }

    // --- THE FIX: SMART FILTERING ---
    // 1. Remove obvious junk
    articles = articles.filter(a => a.title && !a.title.includes("[Removed]"));

    // 2. Remove Duplicates
    const seen = new Set();
    articles = articles.filter(a => {
      const isDup = seen.has(a.url);
      seen.add(a.url);
      return !isDup;
    });

    // 3. FALLBACK LOGIC: If we have NO news mentioning the asset, 
    // we keep the general results so the user isn't looking at a blank screen.
    const relevantArticles = articles.filter(a => 
      (a.title + a.summary).toLowerCase().includes(asset.toLowerCase())
    );

    const finalSelection = relevantArticles.length > 0 ? relevantArticles : articles;
    const top6 = finalSelection.slice(0, 6);

    // AI Summary & Sentiment
    const avgSentiment = top6.length > 0 
      ? Math.round(top6.reduce((s, a) => s + a.sentiment, 0) / top6.length) 
      : 50;
    
    const summary = top6.length > 0 
      ? `The latest outlook for ${asset.toUpperCase()} shows ${avgSentiment > 50 ? 'positive' : 'cautious'} momentum. Top reports from ${top6[0].source} discuss: ${top6[0].title}.`
      : "No news found for this specific ticker. Market activity might be low.";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      asset: asset.toUpperCase(),
      sentimentScore: avgSentiment,
      summary: summary,
      articles: top6
    });

  } catch (err) {
    res.status(500).json({ error: "Server Error", details: err.message });
  }
}
