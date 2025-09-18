const express = require('express');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// Create WebSocket server
const wss = new WebSocket.Server({ port: 8080 });

let technicalData = {
  // 1. Core Price Info
  currentPrice: '0',
  last5Candles: {
    ohlc: [], // Array of {open, high, low, close, timestamp, volume}
    timestamps: []
  },
  
  // 2. Moving Averages
  ema7: '0',
  ema25: '0',
  ema99: '0',
  
  // 3. Volatility
  atr14: '0',
  
  // 4. Bollinger Bands
  bbUpper: '0',
  bbMiddle: '0',
  bbLower: '0',
  
  // 5. Parabolic SAR
  psarValue: '0',
  psarPosition: 'Below',
  
  // 6. Volume Analysis
  volumes: {
    v1: '0', v2: '0', v3: '0', v4: '0', v5: '0',
    averageVolume: '0'
  },
  
  // 7. Candlestick Patterns
  candlePatterns: [], // Last 5 candle patterns
  
  // 8. Order Book Analysis
  orderBook: {
    biggestBuyWall: { price: '0', size: '0' },
    biggestSellWall: { price: '0', size: '0' },
    buyToSellRatio: '0',
    top10Bids: [],
    top10Asks: []
  },
  
  // 9. Higher Timeframe Trends
  htfTrends: {
    h1Trend: 'Neutral', // Above/Below EMA99
    h1Position: 'Below',
    h4Trend: 'Neutral', // Above/Below EMA99
    h4Position: 'Below'
  },
  
  timestamp: Date.now(),
  symbol: 'SOL/USDT'
};

// Technical Analysis Functions
function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
  }
  
  return ema;
}

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  
  const trueRanges = [];
  
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    
    // True Range = MAX of:
    // 1. Current High - Current Low
    // 2. ABS(Current High - Previous Close)
    // 3. ABS(Current Low - Previous Close)
    const tr1 = current.high - current.low;
    const tr2 = Math.abs(current.high - previous.close);
    const tr3 = Math.abs(current.low - previous.close);
    
    const trueRange = Math.max(tr1, tr2, tr3);
    trueRanges.push(trueRange);
  }
  
  // Take the last 'period' true ranges and calculate Simple Moving Average
  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
  
  return atr;
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  
  const recentPrices = prices.slice(-period);
  const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
  const squaredDifferences = recentPrices.map(price => Math.pow(price - sma, 2));
  const variance = squaredDifferences.reduce((a, b) => a + b, 0) / period;
  const standardDeviation = Math.sqrt(variance);
  
  return {
    upper: sma + (standardDeviation * stdDev),
    middle: sma,
    lower: sma - (standardDeviation * stdDev)
  };
}

function calculatePSAR(candles, af = 0.02, maxAf = 0.2) {
  if (candles.length < 2) return { value: candles[0]?.low || 0, position: 'Below' };
  
  let psar = candles[0].low;
  let isUptrend = candles[1].close > candles[0].close;
  let acceleration = af;
  let extremePoint = isUptrend ? candles[0].high : candles[0].low;
  
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    
    // Calculate PSAR
    psar = psar + acceleration * (extremePoint - psar);
    
    if (isUptrend) {
      // Uptrend logic
      if (current.high > extremePoint) {
        extremePoint = current.high;
        acceleration = Math.min(acceleration + af, maxAf);
      }
      
      if (current.low < psar) {
        isUptrend = false;
        psar = extremePoint;
        acceleration = af;
        extremePoint = current.low;
      }
    } else {
      // Downtrend logic
      if (current.low < extremePoint) {
        extremePoint = current.low;
        acceleration = Math.min(acceleration + af, maxAf);
      }
      
      if (current.high > psar) {
        isUptrend = true;
        psar = extremePoint;
        acceleration = af;
        extremePoint = current.high;
      }
    }
  }
  
  const lastCandle = candles[candles.length - 1];
  const position = psar < lastCandle.close ? 'Below' : 'Above';
  
  return { value: psar, position };
}

function detectCandlestickPattern(candle) {
  const { open, high, low, close } = candle;
  
  // Avoid division by zero or invalid candles
  if (high === low || open === undefined || close === undefined) {
    return 'Invalid Candle';
  }
  
  const bodySize = Math.abs(close - open);
  const totalRange = high - low;
  const upperShadow = high - Math.max(open, close);
  const lowerShadow = Math.min(open, close) - low;
  const bodyTop = Math.max(open, close);
  const bodyBottom = Math.min(open, close);
  
  // Calculate ratios for pattern detection
  const bodyToRangeRatio = bodySize / totalRange;
  const upperShadowToBodyRatio = bodySize > 0 ? upperShadow / bodySize : upperShadow / (totalRange * 0.01);
  const lowerShadowToBodyRatio = bodySize > 0 ? lowerShadow / bodySize : lowerShadow / (totalRange * 0.01);
  
  // 1. DOJI PATTERNS (very small body - less than 5% of total range)
  if (bodyToRangeRatio < 0.05) {
    // Long-Legged Doji: Both shadows are long
    if (upperShadow > totalRange * 0.4 && lowerShadow > totalRange * 0.4) {
      return 'Long-Legged Doji';
    }
    // Dragonfly Doji: Long lower shadow, minimal upper shadow
    if (lowerShadow > totalRange * 0.6 && upperShadow < totalRange * 0.1) {
      return 'Dragonfly Doji';
    }
    // Gravestone Doji: Long upper shadow, minimal lower shadow
    if (upperShadow > totalRange * 0.6 && lowerShadow < totalRange * 0.1) {
      return 'Gravestone Doji';
    }
    // Regular Doji: Small shadows
    return 'Doji';
  }
  
  // 2. MARUBOZU PATTERNS (large body with minimal shadows - body > 90% of range)
  if (bodyToRangeRatio > 0.9) {
    if (close > open) {
      // Bullish Marubozu: Large bullish body, minimal shadows
      if (upperShadow < totalRange * 0.05 && lowerShadow < totalRange * 0.05) {
        return 'Bullish Marubozu';
      }
      // Closing Marubozu: No upper shadow
      if (upperShadow < totalRange * 0.02) {
        return 'Bullish Closing Marubozu';
      }
      // Opening Marubozu: No lower shadow
      if (lowerShadow < totalRange * 0.02) {
        return 'Bullish Opening Marubozu';
      }
    } else {
      // Bearish Marubozu: Large bearish body, minimal shadows
      if (upperShadow < totalRange * 0.05 && lowerShadow < totalRange * 0.05) {
        return 'Bearish Marubozu';
      }
      // Closing Marubozu: No lower shadow
      if (lowerShadow < totalRange * 0.02) {
        return 'Bearish Closing Marubozu';
      }
      // Opening Marubozu: No upper shadow
      if (upperShadow < totalRange * 0.02) {
        return 'Bearish Opening Marubozu';
      }
    }
  }
  
  // 3. HAMMER PATTERNS (small body in upper part, long lower shadow)
  if (lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.5 && bodyTop > (low + totalRange * 0.6)) {
    if (close > open) {
      return 'Hammer';
    } else {
      return 'Hanging Man';
    }
  }
  
  // 4. INVERTED HAMMER PATTERNS (small body in lower part, long upper shadow)
  if (upperShadow > bodySize * 2 && lowerShadow < bodySize * 0.5 && bodyBottom < (low + totalRange * 0.4)) {
    if (close > open) {
      return 'Inverted Hammer';
    } else {
      return 'Shooting Star';
    }
  }
  
  // 5. SPINNING TOP (small body in middle, both shadows present)
  if (bodyToRangeRatio < 0.3 && upperShadow > bodySize * 0.5 && lowerShadow > bodySize * 0.5) {
    if (close > open) {
      return 'Bullish Spinning Top';
    } else {
      return 'Bearish Spinning Top';
    }
  }
  
  // 6. PAPER UMBRELLA (similar to hammer but more specific ratios)
  if (lowerShadow > bodySize * 3 && upperShadow < bodySize * 0.1) {
    if (close > open) {
      return 'Paper Umbrella (Bullish)';
    } else {
      return 'Paper Umbrella (Bearish)';
    }
  }
  
  // 7. BELT HOLD PATTERNS (Marubozu-like with one shadow)
  if (bodyToRangeRatio > 0.7) {
    if (close > open && lowerShadow < totalRange * 0.05) {
      return 'Bullish Belt Hold';
    }
    if (close < open && upperShadow < totalRange * 0.05) {
      return 'Bearish Belt Hold';
    }
  }
  
  // 8. HIGH WAVE CANDLE (very long shadows, small body)
  if (bodyToRangeRatio < 0.2 && (upperShadow > totalRange * 0.3 || lowerShadow > totalRange * 0.3)) {
    return 'High Wave';
  }
  
  // 9. RICKSHAW MAN (Doji with extremely long shadows)
  if (bodyToRangeRatio < 0.03 && upperShadow > totalRange * 0.3 && lowerShadow > totalRange * 0.3) {
    return 'Rickshaw Man';
  }
  
  // 10. BASIC BULLISH/BEARISH PATTERNS
  if (bodyToRangeRatio > 0.6) {
    if (close > open) {
      // Strong bullish candle
      if (upperShadow < bodySize * 0.25 && lowerShadow < bodySize * 0.25) {
        return 'Strong Bullish';
      }
      return 'Bullish';
    } else {
      // Strong bearish candle
      if (upperShadow < bodySize * 0.25 && lowerShadow < bodySize * 0.25) {
        return 'Strong Bearish';
      }
      return 'Bearish';
    }
  }
  
  // 11. MODERATE PATTERNS (medium body size)
  if (bodyToRangeRatio > 0.3) {
    if (close > open) {
      return 'Moderate Bullish';
    } else {
      return 'Moderate Bearish';
    }
  }
  
  // 12. WEAK PATTERNS (small body)
  if (close > open) {
    return 'Weak Bullish';
  } else if (close < open) {
    return 'Weak Bearish';
  }
  
  // Default fallback
  return 'Neutral';
}

function generateRealistic15mCandles(currentPrice, count = 150) {
  const candles = [];
  const now = new Date();
  
  // Round down to the nearest 15-minute mark
  const currentMinute = now.getMinutes();
  const roundedMinute = Math.floor(currentMinute / 15) * 15;
  
  // Get the most recent completed 15-minute candle close time
  const lastCandleClose = new Date(now);
  lastCandleClose.setMinutes(roundedMinute, 0, 0); // Set seconds and milliseconds to 0
  
  // If we're currently in a 15-minute period, go back to the previous completed one
  if (now.getTime() > lastCandleClose.getTime()) {
    // We're in the current 15-min period, so use the previous completed candle
    lastCandleClose.setMinutes(lastCandleClose.getMinutes() - 15);
  }
  
  // Generate candles going backwards from the last completed candle
  for (let i = 0; i < count; i++) {
    const candleCloseTime = new Date(lastCandleClose);
    candleCloseTime.setMinutes(candleCloseTime.getMinutes() - (i * 15));
    
    const candleOpenTime = new Date(candleCloseTime);
    candleOpenTime.setMinutes(candleOpenTime.getMinutes() - 15);
    
    // Generate realistic price action for this 15-minute period
    const variation = (Math.random() - 0.5) * 0.08; // ±4% variation from current price
    const basePrice = currentPrice * (1 + variation * (1 - i * 0.01)); // Slight trend over time
    
    const volatility = 0.015; // 1.5% average volatility for 15min candle
    let high = basePrice * (1 + Math.random() * volatility);
    let low = basePrice * (1 - Math.random() * volatility);
    
    // Open and close should be between high and low
    const open = low + (high - low) * Math.random();
    let close;
    
    // For the most recent candle, use current price
    if (i === 0) {
      close = currentPrice;
      // Adjust high/low to accommodate current price if needed
      if (close > high) high = close * 1.001;
      if (close < low) low = close * 0.999;
    } else {
      close = low + (high - low) * Math.random();
    }
    
    // Ensure OHLC relationships are valid
    const adjustedHigh = Math.max(high, open, close);
    const adjustedLow = Math.min(low, open, close);
    
    const volume = 30000 + Math.random() * 150000; // Random volume between 30k-180k
    
    candles.unshift({ // Add to beginning so array is chronologically ordered
      timestamp: candleCloseTime.getTime(),
      openTime: candleOpenTime.getTime(),
      closeTime: candleCloseTime.getTime(),
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(adjustedHigh.toFixed(4)),
      low: parseFloat(adjustedLow.toFixed(4)),
      close: parseFloat(close.toFixed(4)),
      volume: parseFloat(volume.toFixed(0)),
      // Add formatted time strings for display
      openTimeFormatted: candleOpenTime.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      closeTimeFormatted: candleCloseTime.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    });
  }
  
  return candles;
}

function generateOrderBook(currentPrice) {
  const spread = currentPrice * 0.001; // 0.1% spread
  const bids = [];
  const asks = [];
  
  // Generate 10 bids and asks
  for (let i = 0; i < 10; i++) {
    const bidPrice = currentPrice - (spread * (i + 1));
    const askPrice = currentPrice + (spread * (i + 1));
    const bidSize = 10 + Math.random() * 500;
    const askSize = 10 + Math.random() * 500;
    
    bids.push({
      price: bidPrice.toFixed(4),
      size: bidSize.toFixed(1),
      total: (bidPrice * bidSize).toFixed(2)
    });
    
    asks.push({
      price: askPrice.toFixed(4),
      size: askSize.toFixed(1),
      total: (askPrice * askSize).toFixed(2)
    });
  }
  
  // Find biggest walls
  const biggestBuyWall = bids.reduce((max, bid) => 
    parseFloat(bid.total) > parseFloat(max.total) ? bid : max
  );
  
  const biggestSellWall = asks.reduce((max, ask) => 
    parseFloat(ask.total) > parseFloat(max.total) ? ask : max
  );
  
  const buyToSellRatio = (parseFloat(biggestBuyWall.total) / parseFloat(biggestSellWall.total)).toFixed(3);
  
  return {
    biggestBuyWall: { 
      price: biggestBuyWall.price, 
      size: biggestBuyWall.total 
    },
    biggestSellWall: { 
      price: biggestSellWall.price, 
      size: biggestSellWall.total 
    },
    buyToSellRatio,
    top10Bids: bids,
    top10Asks: asks
  };
}

// Main data fetching function
async function fetchComprehensiveTechnicalData() {
  try {
    console.log('🔄 Fetching comprehensive SOL technical data...');
    
    let currentPrice = 245.86; // Fallback price
    
    // Try to get current price from CoinGecko with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        if (priceData.solana && priceData.solana.usd) {
          currentPrice = priceData.solana.usd;
          console.log(`📈 Live price fetched: ${currentPrice}`);
        }
      }
    } catch (fetchError) {
      console.log(`⚠️ Using fallback price due to: ${fetchError.message}`);
      // Use a slightly random price around the fallback to simulate price movement
      currentPrice = 245.86 + (Math.random() - 0.5) * 10; // ±$5 variation
    }
    
    // Use the real candle data for all calculations
    const candles = candleData;
    const closePrices = candles.map(c => c.close);
    
    // Get the last 5 completed candles (excluding current incomplete candle if any)
    const last5Candles = candles.slice(-5);
    
    // 2. Calculate Moving Averages using real close prices
    const ema7 = calculateEMA(closePrices, 7);
    const ema25 = calculateEMA(closePrices, 25);
    const ema99 = calculateEMA(closePrices, 99);
    
    // 3. Calculate ATR using real OHLC data
    const atr14 = calculateATR(candles, 14);
    
    // 4. Calculate Bollinger Bands using real close prices
    const bb = calculateBollingerBands(closePrices, 20, 2);
    
    // 5. Calculate PSAR using real OHLC data
    const psar = calculatePSAR(candles.slice(-50)); // Use last 50 candles for PSAR
    
    // 6. Real Volume Analysis from actual trading data
    const volumes = last5Candles.map(c => c.volume);
    const averageVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    
    // 7. Real Candlestick Patterns from actual OHLC data
    const candlePatterns = last5Candles.map(candle => ({
      pattern: detectCandlestickPattern(candle),
      timestamp: candle.timestamp,
      timeWindow: `${candle.openTimeFormatted}-${candle.closeTimeFormatted}`,
      date: candle.dateFormatted
    }));
    
    // 8. Generate simulated order book (real order book requires WebSocket connection)
    const orderBook = generateOrderBook(currentPrice);
    
    // 9. Higher Timeframe Analysis using real price data
    const h1Ema99 = calculateEMA(closePrices.slice(-240), 99); // Last 240 15m candles = 60 hours ≈ 1H timeframe simulation
    const h4Ema99 = calculateEMA(closePrices.slice(-960), 99); // Last 960 15m candles = 240 hours ≈ 4H timeframe simulation
    
    // Update technical data
    technicalData = {
      currentPrice: currentPrice.toFixed(4),
      
      last5Candles: {
        ohlc: last5Candles.map(c => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          openTime: c.openTimeFormatted,
          closeTime: c.closeTimeFormatted,
          timeWindow: `${c.openTimeFormatted}-${c.closeTimeFormatted}`,
          date: c.dateFormatted,
          volume: (c.volume / 1000).toFixed(1) + 'k',
          trades: c.numberOfTrades || 'N/A',
          timestamp: c.timestamp
        })),
        timestamps: last5Candles.map(c => `${c.dateFormatted} ${c.closeTimeFormatted}`)
      },
      
      ema7: ema7.toFixed(4),
      ema25: ema25.toFixed(4),
      ema99: ema99.toFixed(4),
      
      atr14: atr14.toFixed(4),
      
      bbUpper: bb.upper.toFixed(4),
      bbMiddle: bb.middle.toFixed(4),
      bbLower: bb.lower.toFixed(4),
      
      psarValue: psar.value.toFixed(4),
      psarPosition: psar.position,
      
      volumes: {
        v1: (volumes[4] / 1000).toFixed(1) + 'k', // Latest
        v2: (volumes[3] / 1000).toFixed(1) + 'k',
        v3: (volumes[2] / 1000).toFixed(1) + 'k',
        v4: (volumes[1] / 1000).toFixed(1) + 'k',
        v5: (volumes[0] / 1000).toFixed(1) + 'k', // Oldest
        averageVolume: (averageVolume / 1000).toFixed(1) + 'k'
      },
      
      candlePatterns: candlePatterns.reverse(), // Latest first
      
      orderBook: orderBook,
      
      htfTrends: {
        h1Trend: currentPrice > h1Ema99 ? 'Bullish' : 'Bearish',
        h1Position: currentPrice > h1Ema99 ? 'Above' : 'Below',
        h4Trend: currentPrice > h4Ema99 ? 'Bullish' : 'Bearish',
        h4Position: currentPrice > h4Ema99 ? 'Above' : 'Below'
      },
      
      timestamp: Date.now(),
      symbol: 'SOL/USDT'
    };

    console.log('✅ Technical data updated successfully');
    console.log(`💰 Price: $${technicalData.currentPrice} | EMA7: $${technicalData.ema7} | PSAR: ${technicalData.psarPosition}`);

    // Broadcast to all connected clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(technicalData));
      }
    });

  } catch (error) {
    console.error('❌ Error fetching technical data:', error.message);
  }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('👤 Client connected');
  
  // Send current data to newly connected client
  ws.send(JSON.stringify(technicalData));
  
  ws.on('close', () => {
    console.log('👤 Client disconnected');
  });
});

// Fetch data every 30 seconds (simulating 15m candle updates)
setInterval(fetchComprehensiveTechnicalData, 30000);

// Initial data fetch
fetchComprehensiveTechnicalData();

// API endpoint
app.get('/api/technical-data', (req, res) => {
  res.json(technicalData);
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log(`📡 WebSocket server running at ws://localhost:8080`);
  console.log('📊 Fetching comprehensive 15m SOL technical analysis...');
});