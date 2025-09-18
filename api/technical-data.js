// api/technical-data.js

export default async function handler(req, res) {
  try {
    const url = "https://api.bybit.com/v5/market/tickers?category=spot&symbol=SOLUSDT";
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Bybit API error: ${response.statusText}` });
    }

    const json = await response.json();

    if (json.retCode !== 0) {
      return res.status(500).json({ error: json.retMsg || "Bybit returned error" });
    }

    const ticker = json.result.list[0];

    return res.status(200).json({
      symbol: ticker.symbol,
      currentPrice: ticker.lastPrice,
      high24h: ticker.highPrice24h,
      low24h: ticker.lowPrice24h,
      volume24h: ticker.volume24h,
      turnover24h: ticker.turnover24h,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch data from Bybit" });
  }
}
