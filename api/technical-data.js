// api/technical-data.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const url = "https://api.bybit.com/v5/market/tickers?category=spot&symbol=SOLUSDT";
    const response = await fetch(url);
    const json = await response.json();

    if (json.retCode !== 0) {
      throw new Error(json.retMsg || "Bybit API error");
    }

    const ticker = json.result.list[0];

    const result = {
      symbol: ticker.symbol,
      currentPrice: ticker.lastPrice,
      high24h: ticker.highPrice24h,
      low24h: ticker.lowPrice24h,
      volume24h: ticker.volume24h,
      turnover24h: ticker.turnover24h,
      timestamp: Date.now()
    };

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch data from Bybit" });
  }
}
