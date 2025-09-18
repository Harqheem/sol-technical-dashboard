// api/technical-data.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    // Example: fetch live SOL/USDT price from Binance
    const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT");
    const data = await response.json();

    // You can extend this with indicators, order book, etc.
    const result = {
      symbol: "SOL/USDT",
      currentPrice: data.price,
      timestamp: Date.now()
    };

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
}
