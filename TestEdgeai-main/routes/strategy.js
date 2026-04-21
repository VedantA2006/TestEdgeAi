// routes/strategy.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const runPython = require("../utils/runPython");
const { GoogleGenAI } = require("@google/genai");
const Strategy = require("../models/Strategy");
const User = require("../models/User");

const router = express.Router();

// Initialize Gemini AI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MAX_RETRIES = 3;

// ─── PLAN CONFIGURATION: QUICK & DEEP ────────────────────────────────────────
const PLAN_CONFIG = {
  // ── QUICK MODE: Fast, lightweight, beginner-friendly ──────────────────────
  quick: {
    credits: 3,
    maxWords: 150,       // Strictly 150 word prompt
    maxAssets: 2,        // Max 2 assets
    maxInds: 3,          // Max 3 indicators
    maxDataDays: 365,    // Max 1 year of historical data
    allowedTimeframes: ['1d', '1h'], // Daily or 1H only
    model: "gemini-3-flash-preview",
    modelDesc: "Gemini Flash",
    modeLabel: "QUICK",
    estimatedTime: "~30 sec",
    features: { optimization: false, walkForward: false, monteCarlo: false, positionSizing: false }
  },
  // ── DEEP MODE: Professional-grade, full power ─────────────────────────────
  deep: {
    credits: 12,
    maxWords: 1500,
    maxAssets: 999,
    maxInds: 999,
    maxDataDays: 99999,  // No limit
    allowedTimeframes: null, // All timeframes allowed
    model: "gemini-3-flash-preview",
    modelDesc: "Gemini Pro",
    modeLabel: "DEEP",
    estimatedTime: "2–5 min",
    features: { optimization: true, walkForward: true, monteCarlo: true, positionSizing: true }
  },
  // ── Legacy aliases for backward compatibility ─────────────────────────────
  smart: { credits: 4, maxWords: 1500, maxAssets: 3, maxInds: 10, maxDataDays: 2000, model: "gemini-3-flash-preview", modelDesc: "Flash", modeLabel: "SMART", features: { optimization: false } },
  research: { credits: 16, maxWords: 3000, maxAssets: 5, maxInds: 999, maxDataDays: 99999, model: "gemini-3-flash-preview", modelDesc: "Pro", modeLabel: "DEEP", features: { optimization: true } }
};

// ─── YAHOO FINANCE DATA LIMITS (CRITICAL) ────────────────────────────────────
const YF_LIMITS = {
  '1m': { days: 7, note: '7 days max for 1-minute candles' },
  '5m': { days: 60, note: '60 days max for 5-minute candles' },
  '15m': { days: 180, note: '180 days max for 15-minute candles' },
  '30m': { days: 180, note: '180 days max for 30-minute candles' },
  '1h': { days: 729, note: '730 days max for 1-hour candles' },
  '4h': { days: 729, note: '730 days max for 4-hour candles' },
  '1d': { days: 3650, note: '10+ years for daily candles' }
};

// ─── GET SAFE DATE RANGE (PREVENTS YAHOO ERRORS) ─────────────────────────────
function getSafeDateRange(timeframe) {
  const now = new Date();
  const limit = YF_LIMITS[timeframe] || YF_LIMITS['1h'];

  // Calculate start date (never exceed Yahoo limits)
  const startDate = new Date(now.getTime() - limit.days * 24 * 60 * 60 * 1000);

  return {
    start: startDate.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0],
    maxDays: limit.days,
    note: limit.note
  };
}

// ─── KNOWN INDIAN STOCK SYMBOLS (NSE TOP 50) ───────────────────────────────
const INDIAN_STOCKS = new Set([
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'ITC', 'SBIN',
  'BAJFINANCE', 'BHARTIARTL', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'HCLTECH', 'AXISBANK',
  'ADANIENT', 'MARUTI', 'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'NESTLEIND', 'WIPRO',
  'TECHM', 'POWERGRID', 'NTPC', 'ONGC', 'TATAMOTORS', 'TATASTEEL', 'JSWSTEEL', 'HINDALCO',
  'ADANIPORTS', 'BAJAJFINSV', 'BPCL', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'EICHERMOT',
  'HEROMOTOCO', 'INDUSINDBK', 'APOLLOHOSP', 'COALINDIA', 'GRASIM', 'BRITANNIA',
  'HINDZINC', 'PIDILITIND', 'SIEMENS', 'VEDL', 'SAIL', 'IDEA', 'ZOMATO', 'PAYTM',
  'NYKAA', 'DELHIVERY', 'POLICYBZR', 'IRCTC', 'TATAPOWER', 'ADANIGREEN'
]);

const CRYPTO_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'MATIC', 'LINK',
  'AVAX', 'ATOM', 'UNI', 'LTC', 'BCH', 'ALGO', 'FIL', 'VET', 'THETA', 'FTM',
  'SHIB', 'PEPE', 'WIF', 'BONK'
]);

const FOREX_PAIRS = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'EURAUD', 'EURCHF', 'CADJPY'
]);

const COMMODITY_MAP = {
  'GOLD': 'GC=F', 'SILVER': 'SI=F', 'OIL': 'CL=F', 'CRUDEOIL': 'CL=F',
  'NATURALGAS': 'NG=F', 'COPPER': 'HG=F', 'WHEAT': 'ZW=F', 'CORN': 'ZC=F'
};

function convertTicker(ticker) {
  if (!ticker) return '';

  // Preserve already-correct formats
  const original = ticker.trim();
  if (original.includes('-USD') || original.includes('=X') || original.includes('=F') ||
    original.endsWith('.NS') || original.endsWith('.BO')) {
    return original.replace('/', '-');
  }

  // Clean for lookup
  const clean = original.replace(/[^A-Z0-9]/gi, '').toUpperCase();

  // Explicit ticker map (highest priority)
  const TICKER_MAP = {
    'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD', 'BNB': 'BNB-USD',
    'XRP': 'XRP-USD', 'ADA': 'ADA-USD', 'DOGE': 'DOGE-USD', 'DOT': 'DOT-USD',
    'MATIC': 'MATIC-USD', 'LINK': 'LINK-USD', 'AVAX': 'AVAX-USD', 'ATOM': 'ATOM-USD',
    'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X', 'USDJPY': 'USDJPY=X',
    'USDCHF': 'USDCHF=X', 'AUDUSD': 'AUDUSD=X', 'USDCAD': 'USDCAD=X',
    'GOLD': 'GC=F', 'SILVER': 'SI=F', 'OIL': 'CL=F', 'CRUDEOIL': 'CL=F',
    'NATURALGAS': 'NG=F', 'WHEAT': 'ZW=F'
  };
  if (TICKER_MAP[clean]) return TICKER_MAP[clean];

  // Commodities
  if (COMMODITY_MAP[clean]) return COMMODITY_MAP[clean];

  // Forex pairs (6-char like EURUSD)
  if (FOREX_PAIRS.has(clean)) return clean + '=X';
  if (clean.length === 6 && /^[A-Z]{6}$/.test(clean)) return clean + '=X';

  // Crypto
  if (CRYPTO_SYMBOLS.has(clean)) return clean + '-USD';
  // crypto/usdt or crypto-usdt patterns
  if (original.toUpperCase().includes('/USDT') || original.toUpperCase().includes('-USDT')) {
    return clean.replace('USDT', '') + '-USD';
  }
  if (original.toUpperCase().includes('/USD') || original.toUpperCase().includes('-USD')) {
    return clean.replace('USD', '') + '-USD';
  }

  // Indian stocks (known list)
  if (INDIAN_STOCKS.has(clean)) return clean + '.NS';
  // Explicit .NS or .BO in original
  if (original.includes('.NS') || original.includes('.BO')) return original.toUpperCase();

  // US stocks — standard 1-5 letter tickers (AAPL, MSFT, SPY, etc.) stay as-is
  // DO NOT blindly append .NS to US stocks
  if (/^[A-Z]{1,5}$/.test(clean)) return clean;  // US market — return as-is

  // Default: clean up slashes
  return original.replace('/', '-').toUpperCase();
}

// ─── In-memory session store ─────────────────────────────────────────────────
const sessions = new Map();

// ─── CLASSIFY ERROR (prevents unnecessary AI retries) ────────────────────────
function classifyError(errorText) {
  const e = (errorText || '').toLowerCase();
  if (e.includes('no data') || e.includes('no price data') ||
    e.includes('invalid or unsupported symbol') || e.includes('delisted') ||
    e.includes('data not available') || e.includes('yfpricesmissingerror') ||
    (e.includes('insufficient data') && e.includes('candles')))
    return 'data_error';     // Python handled gracefully — DO NOT retry with AI
  if (e.includes('importerror') || e.includes('modulenotfounderror'))
    return 'import_error';   // Python env issue — DO NOT retry with AI
  if (e.includes('syntaxerror') || e.includes('indentationerror'))
    return 'syntax_error';   // AI can fix
  if (e.includes('attributeerror') || e.includes('typeerror') ||
    e.includes('valueerror') || e.includes('nameerror') ||
    e.includes('indexerror') || e.includes('keyerror'))
    return 'logic_error';    // AI can fix
  return 'unknown';
}

// ─── INJECT RELIABILITY PREAMBLE (smart data loader + chart verifier) ─────────
function injectReliabilityPreamble(code, tickers, timeframe, maxDays) {
  const tJson = JSON.stringify(tickers);

  const preamble = `import os, sys, time
import pandas as pd
import numpy as np
import yfinance as yf
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

# ====================================================
# RELIABILITY LAYER v2: smart loader + chart verifier
# ====================================================

_CHART_PATH = 'equity.png'
_MAX_DAYS = ${maxDays}
_INTERVAL = '${timeframe}'

def _detect_exchange(symbol):
    s = symbol.strip().upper()
    if any(s.endswith(x) for x in ['-USD','-USDT','=X','=F','.NS','.BO','.AX','.L','.TO']):
        return [s]
    if '/' in s:
        base = s.split('/')[0]
        return [base + '-USD']
    if len(s) == 6 and s.isalpha(): return [s + '=X']  # forex
    CRYPTO = {'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','MATIC','LINK',
              'AVAX','ATOM','UNI','LTC','BCH','SHIB','PEPE','WIF','BONK'}
    if s in CRYPTO: return [s + '-USD']
    INDIAN = {'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','SBIN','WIPRO',
              'HINDUNILVR','ITC','BAJFINANCE','BHARTIARTL','KOTAKBANK','LT',
              'HCLTECH','AXISBANK','MARUTI','SUNPHARMA','TITAN','NTPC','ONGC',
              'TATAMOTORS','TATASTEEL','ZOMATO','PAYTM','IRCTC','TATAPOWER',
              'ADANIENT','ADANIPORTS','BAJAJFINSV','DRREDDY','CIPLA','DIVISLAB'}
    if s in INDIAN: return [s + '.NS', s + '.BO']
    return [s, s + '.NS']  # US stock as-is, then .NS fallback

def _try_download(sym, start, end, interval):
    try:
        df = yf.download(sym, start=start, end=end, interval=interval,
                         progress=False, auto_adjust=True)
        if df is not None and not df.empty and len(df) >= 10:
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            return df.dropna().ffill(), sym
    except Exception:
        pass
    return None, None

def smart_load_data(raw_tickers, interval=None, max_days=None):
    interval = interval or _INTERVAL
    max_days = max_days or _MAX_DAYS
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=max_days - 1)
    start, end = start_dt.strftime('%Y-%m-%d'), end_dt.strftime('%Y-%m-%d')
    results = {}
    for raw in raw_tickers:
        candidates = _detect_exchange(raw)
        loaded = False
        for sym in candidates:
            df, used = _try_download(sym, start, end, interval)
            if df is not None:
                print(f'[DATA] {used}: {len(df)} rows ({start} to {end})')
                results[sym] = df
                loaded = True
                break
        if not loaded:
            print(f'Invalid or unsupported symbol: {raw} (tried: {candidates})')
    if not results:
        print('ERROR: No data could be fetched. Check symbol names.')
        sys.exit(1)
    if len(raw_tickers) == 1:
        df = list(results.values())[0]
        if len(df) < 30:
            print(f'ERROR: Insufficient data ({len(df)} rows, need >= 30).')
            sys.exit(1)
        return df
    return results

def _save_chart(path=_CHART_PATH):
    try:
        plt.savefig(path, dpi=150, bbox_inches='tight')
        plt.close()
        if os.path.exists(path):
            print(f'[CHART] Saved: {path} ({os.path.getsize(path)} bytes)')
            return True
    except Exception as e:
        print(f'[CHART-WARN] {e}')
    try:
        fig, ax = plt.subplots(figsize=(10, 4))
        ax.text(0.5, 0.5, 'Chart generation failed', ha='center', va='center',
                transform=ax.transAxes, fontsize=14, color='red')
        fig.savefig(path, dpi=100)
        plt.close(fig)
        print(f'[CHART] Fallback chart saved: {path}')
        return True
    except Exception:
        return False

# END OF RELIABILITY LAYER
# Use: df = smart_load_data(${tJson})
`;

  // Strip duplicate top-level imports from AI code (preamble covers them)
  let stripped = code
    .replace(/^import os[^\n]*/gm, '')
    .replace(/^import sys[^\n]*/gm, '')
    .replace(/^import time[^\n]*/gm, '')
    .replace(/^import pandas[^\n]*/gm, '')
    .replace(/^import numpy[^\n]*/gm, '')
    .replace(/^import yfinance[^\n]*/gm, '')
    .replace(/^import matplotlib(?!\.)[^\n]*/gm, '')
    .replace(/^import matplotlib\.pyplot[^\n]*/gm, '')
    .replace(/^from datetime import[^\n]*/gm, '')
    .replace(/^matplotlib\.use\([^)]+\)[^\n]*/gm, '')
    .trim();

  return preamble + '\nimport ta\n\n' + stripped;
}

// ─── CLEAN CODE FUNCTION ─────────────────────────────────────────────────────
function cleanCode(code) {

  if (!code || typeof code !== 'string') return '';

  let cleaned = code;

  // Remove markdown code fences
  cleaned = cleaned.replace(/```python\n/gi, '');
  cleaned = cleaned.replace(/```\n/gi, '');
  cleaned = cleaned.replace(/```/g, '');

  // Remove invisible Unicode characters
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
  cleaned = cleaned.replace(/\u00A0/g, ' ');
  cleaned = cleaned.replace(/\u2018|\u2019/g, "'");
  cleaned = cleaned.replace(/\u201C|\u201D/g, '"');
  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\t/g, '    ');

  // Remove AI preamble text
  const importMatch = cleaned.match(/^(.*?)(^import\s|^from\s)/ms);
  if (importMatch && importMatch[1].trim()) {
    const preamble = importMatch[1];
    if (!preamble.includes('def ') && !preamble.includes('class ')) {
      cleaned = cleaned.substring(importMatch[1].length);
    }
  }

  // Remove common AI phrases
  cleaned = cleaned.replace(/^Here is the code.*?\n/gi, '');
  cleaned = cleaned.replace(/^Here is.*?\n/gi, '');
  cleaned = cleaned.replace(/^Sure,.*?\n/gi, '');
  cleaned = cleaned.replace(/^I'll generate.*?\n/gi, '');
  cleaned = cleaned.replace(/^Below is.*?\n/gi, '');

  // Ensure starts with import
  const firstImport = cleaned.search(/^import\s|^from\s/m);
  if (firstImport !== -1) {
    cleaned = cleaned.substring(firstImport);
  }

  return cleaned.trim();
}

// ─── STRATEGY TEMPLATES ENDPOINT ────────────────────────────────────────────
router.get("/templates", (req, res) => {
  const templates = [
    {
      id: "rsi_reversal",
      name: "RSI Reversal",
      icon: "fa-arrows-rotate",
      description: "Buy oversold, sell overbought using RSI",
      prompt: "Buy when RSI(14) drops below 30 (oversold) and then crosses back above 30. Sell when RSI rises above 70 (overbought) and crosses back below 70. Use 2% stop-loss and 6% take-profit. Risk 2% of capital per trade.",
      indicators: ["RSI"],
      suggestedAssets: ["BTC/USDT"],
      suggestedTimeframe: "1h"
    },
    {
      id: "ema_crossover",
      name: "EMA Crossover",
      icon: "fa-chart-line",
      description: "Fast/slow moving average crossover strategy",
      prompt: "Buy when the 9-period EMA crosses above the 21-period EMA with RSI above 50 as confirmation. Sell when the 9 EMA crosses below the 21 EMA or a 3% trailing stop triggers. Invest 95% of available capital per trade.",
      indicators: ["EMA", "RSI"],
      suggestedAssets: ["AAPL"],
      suggestedTimeframe: "1d"
    },
    {
      id: "breakout",
      name: "Breakout Strategy",
      icon: "fa-rocket",
      description: "Trade breakouts from key resistance/support levels",
      prompt: "Buy when price breaks above the 20-bar high with volume 50% above average. Use a 1.5% stop-loss below the breakout candle's low. Take profit at 3x the risk (4.5% above entry). Risk 1.5% of portfolio per trade.",
      indicators: ["Volume", "ATR"],
      suggestedAssets: ["SPY"],
      suggestedTimeframe: "1d"
    },
    {
      id: "mean_reversion",
      name: "Mean Reversion",
      icon: "fa-arrows-left-right",
      description: "Trade pullbacks to the mean using Bollinger Bands",
      prompt: "Buy when price touches the lower Bollinger Band (20-period, 2 std dev) and RSI is below 35. Exit when price returns to the 20-period moving average (middle band). Use a 2.5% stop-loss. Risk 1% of capital per trade.",
      indicators: ["Bollinger Bands", "RSI", "SMA"],
      suggestedAssets: ["ETH/USDT"],
      suggestedTimeframe: "1h"
    }
  ];
  res.json({ success: true, templates });
});

// ─── STEP 1: Client POSTs prompt → receives sessionId ───────────────────────
router.post("/start", async (req, res) => {
  try {
    let { prompt, plan, timeframe, assets, indicators, deepFeatures, strategyName } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized - Please login" });
    }

    // Normalize plan key — support legacy aliases
    const planKey = (plan === 'research' || plan === 'smart') ? plan : (plan === 'deep' ? 'deep' : 'quick');
    const planConfig = PLAN_CONFIG[planKey] || PLAN_CONFIG.quick;

    // ── QUICK MODE: Auto-simplify & enforce constraints ──────────────────────
    let simplifiedWarning = null;
    if (planKey === 'quick') {
      if (assets && assets.length > planConfig.maxAssets) {
        assets = assets.slice(0, planConfig.maxAssets);
        simplifiedWarning = `Assets trimmed to ${planConfig.maxAssets} (QUICK limit). `;
      }
      if (indicators && indicators.length > planConfig.maxInds) {
        indicators = indicators.slice(0, planConfig.maxInds);
        simplifiedWarning = (simplifiedWarning || '') + `Indicators trimmed to ${planConfig.maxInds} (QUICK limit). `;
      }
      const words = prompt.trim().split(/\s+/);
      if (words.length > planConfig.maxWords) {
        prompt = words.slice(0, planConfig.maxWords).join(' ');
        simplifiedWarning = (simplifiedWarning || '') + `Prompt auto-trimmed to ${planConfig.maxWords} words. `;
      }
      if (planConfig.allowedTimeframes && !planConfig.allowedTimeframes.includes(timeframe)) {
        timeframe = '1h';
        simplifiedWarning = (simplifiedWarning || '') + 'Timeframe set to 1h (QUICK supports 1d/1h only).';
      }
    }

    // Deep mode: +3 credits if optimization addon requested
    const optAddon = (planKey === 'deep' && deepFeatures?.optimization) ? 3 : 0;
    const creditsNeeded = planConfig.credits + optAddon;

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.creditTokens < creditsNeeded) {
      return res.status(402).json({ error: `Insufficient credits. Need ${creditsNeeded}, you have ${user.creditTokens}.` });
    }

    // NOTE: Credits will be deducted ONLY after successful completion

    // Create strategy record
    const strategy = new Strategy({
      userId: req.session.userId,
      plan: planKey,
      timeframe,
      assets: assets || [],
      indicators: indicators || [],
      strategyLogic: prompt,
      prompt,
      name: strategyName || null,
      status: "running",
      creditsUsed: creditsNeeded,
      deepFeatures: deepFeatures || {}
    });

    await strategy.save();

    user.strategies.push(strategy._id);
    await user.save();

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);

    sessions.set(sessionId, {
      prompt,
      clients: [],
      strategyId: strategy._id,
      plan: planKey,
      timeframe,
      assets,
      indicators,
      deepFeatures: deepFeatures || {},
      model: planConfig.model,
      userId: req.session.userId,
      creditsToDeduct: creditsNeeded,
      modeLabel: planConfig.modeLabel || planKey.toUpperCase()
    });

    console.log(`✅ Strategy session: ${sessionId} | User: ${req.session.userId} | Plan: ${planKey} | Credits: ${creditsNeeded}`);

    res.json({
      sessionId,
      strategyId: strategy._id,
      newCredits: user.creditTokens,
      model: planConfig.modelDesc,
      modeLabel: planConfig.modeLabel || planKey.toUpperCase(),
      estimatedTime: planConfig.estimatedTime || null,
      warning: simplifiedWarning || null
    });

    // Background processing
    processStrategy(sessionId, prompt).catch((err) => {
      console.error("processStrategy error:", err);
    });

  } catch (err) {
    console.error("Error in /start:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// ─── STEP 2: Client opens SSE connection ──────────────────────────────────────
router.get("/stream/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).send("Session not found");
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(": connected\n\n");
  session.clients.push(res);

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const s = sessions.get(sessionId);
    if (s) s.clients = s.clients.filter((c) => c !== res);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendEvent(sessionId, event, data) {
  const session = sessions.get(sessionId);
  if (!session || session.clients.length === 0) return false;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  let sent = 0;
  session.clients.forEach((client) => {
    try {
      client.write(payload);
      sent++;
    } catch (_) { }
  });

  return sent > 0;
}

// ─── Core processing pipeline v2 ─────────────────────────────────────────────
async function processStrategy(sessionId, prompt) {
  const session = sessions.get(sessionId);
  const log = (msg, type = 'info') => sendEvent(sessionId, 'log', { msg, type });
  const send = (event, data) => sendEvent(sessionId, event, data);

  try {
    const planConfig = PLAN_CONFIG[session.plan] || PLAN_CONFIG.quick;
    const modelName = session.model || planConfig.model;
    const tempDir = path.join(__dirname, '../temp');
    const chartPath = path.join(tempDir, 'equity.png');
    const filePath = path.join(tempDir, 'strategy.py');

    // ── Clean up stale artifacts ─────────────────────────────────────────────
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    [chartPath,
      path.join(process.cwd(), 'equity.png'),
      path.join(__dirname, '../equity.png')
    ].filter(p => fs.existsSync(p)).forEach(p => { try { fs.unlinkSync(p); } catch (_) { } });

    log('━━━ QuantAI Execution Engine v2 ━━━', 'bold');
    log(`Model: ${modelName} | Plan: ${planConfig.modeLabel || session.plan.toUpperCase()}`, 'info');
    log(`Assets: ${(session.assets || []).join(', ')} | TF: ${session.timeframe}`, 'info');
    send('code_status', { state: 'running', message: `Generating code (${planConfig.modelDesc})…` });
    send('progress', { value: 10, label: 'Generating code…' });

    // ── Step 1: Generate base code via AI ────────────────────────────────────
    log('Generating Python backtesting code…', 'info');
    let baseCode = await generateCode(prompt, session, modelName);
    if (!baseCode || !baseCode.includes('import')) {
      throw new Error('AI failed to generate valid Python code');
    }
    log('✅ Python code generated', 'success');

    // ── Step 2: Inject reliability preamble ──────────────────────────────────
    const dateRange = getSafeDateRange(session.timeframe);
    const convertedTicks = (session.assets || ['BTC-USD']).map(a => convertTicker(a));
    let code = injectReliabilityPreamble(baseCode, convertedTicks, session.timeframe, dateRange.maxDays);
    send('code', { code });
    send('progress', { value: 25, label: 'Reliability layer injected…' });

    let lastError = '';
    let lastSanitized = '';

    // ── Execution loop: 3 attempts ────────────────────────────────────────────
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let attemptCode = code;

      // Attempt 2 → verified fallback template (ZERO AI calls, saves credits)
      if (attempt === 2) {
        log('⚠️ Switching to verified fallback template (no AI call)…', 'warn');
        send('code_status', { state: 'error', message: 'Attempt 1 failed — using fallback template…' });
        const dr2 = getSafeDateRange(session.timeframe);
        attemptCode = FALLBACK_TEMPLATE
          .replace(/{ASSET}/g, (session.assets || ['BTC-USD'])[0])
          .replace(/{TIMEFRAME}/g, session.timeframe || '1h')
          .replace(/{MAX_DAYS}/g, dr2.maxDays);
        send('code', { code: attemptCode });
        send('progress', { value: 55, label: 'Running fallback template…' });
      }

      // Attempt 3 → AI self-heal (only for fixable error types)
      if (attempt === 3) {
        const errType = classifyError(lastError);
        if (errType === 'data_error' || errType === 'import_error') {
          log(`💀 [${errType}] cannot be fixed by AI. Stopping.`, 'error');
          send('code_status', { state: 'error', message: `Unrecoverable: ${errType}` });
          send('done', { success: false, error: lastError, attempt: 2 });
          await saveStrategyToDB(session.strategyId, {
            status: 'failed', error: lastError, attempt: 2, generatedCode: lastSanitized
          });
          sessions.delete(sessionId);
          return;
        }
        log('🧠 Attempt 3 — AI self-healing…', 'warn');
        send('code_status', { state: 'error', message: 'Attempt 2 failed — AI self-healing…' });
        send('progress', { value: 70, label: 'AI self-healing…' });
        let fixed = await fixCode(baseCode, lastError, modelName, session.timeframe);
        if (!fixed || !fixed.includes('import')) {
          log('⚠️ AI fix invalid — using base code', 'warn');
          fixed = baseCode;
        }
        attemptCode = injectReliabilityPreamble(fixed, convertedTicks, session.timeframe, dateRange.maxDays);
        send('code', { code: attemptCode });
      }

      // Sanitize + write to disk
      const sanitized = attemptCode
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, '    ');
      lastSanitized = sanitized;
      fs.writeFileSync(filePath, sanitized, 'utf-8');
      console.log(`✅ strategy.py written [attempt ${attempt}] ${sanitized.length} bytes`);

      log(`━━━ Attempt ${attempt} / ${MAX_RETRIES} ━━━`, 'bold');
      log('Launching Python execution engine…', 'info');
      send('code_status', { state: 'running', message: `Executing backtest… (Attempt ${attempt})` });
      send('progress', {
        value: attempt === 1 ? 40 : attempt === 2 ? 65 : 85,
        label: `Running Python (attempt ${attempt})…`
      });

      try {
        const output = await runPython(filePath);

        // Detect graceful data errors printed inside Python (not exceptions)
        const lOut = output.toLowerCase();
        if (lOut.includes('invalid or unsupported symbol') ||
          lOut.includes('no data could be fetched') ||
          lOut.includes('no data for')) {
          log('⚠️ Symbol not found — check asset name.', 'warn');
          send('code_status', { state: 'error', message: 'Invalid symbol — no data found' });
          send('output', { output });
          send('done', { success: false, error: 'Invalid or unsupported symbol', attempt });
          await saveStrategyToDB(session.strategyId, {
            status: 'failed', error: 'Invalid symbol', attempt, generatedCode: sanitized
          });
          sessions.delete(sessionId);
          return; // DO NOT retry — data won't appear magically
        }

        log('✅ Python execution complete!', 'success');
        log('Parsing backtest metrics…', 'info');
        send('progress', { value: 92, label: 'Parsing results…' });
        send('code_status', { state: 'success', message: 'Backtest Complete' });
        send('output', { output });

        // Chart path search (Python CWD varies)
        const chartCandidates = [
          chartPath,
          path.join(process.cwd(), 'equity.png'),
          path.join(tempDir, 'equity_chart.png'),
          path.join(process.cwd(), 'equity_chart.png')
        ];
        let chartFound = false;
        for (const cp of chartCandidates) {
          if (fs.existsSync(cp)) {
            if (cp !== chartPath) {
              fs.copyFileSync(cp, chartPath);
              console.log(`ℹ️ Copied chart from ${cp}`);
            }
            chartFound = true;
            log('✅ Equity curve chart ready', 'success');
            break;
          }
        }
        send('chart', { exists: chartFound });
        if (!chartFound) log('⚠️ Chart not generated by Python script', 'warn');

        send('progress', { value: 100, label: '✅ Complete!' });
        send('done', { success: true, attempt, output });

        if (session && session.strategyId) {
          await saveStrategyToDB(session.strategyId, {
            generatedCode: sanitized, output, status: 'completed', attempt
          }, session.userId, session.creditsToDeduct);
        }
        sessions.delete(sessionId);
        return;

      } catch (err) {
        lastError = err.toString();
        const errType = classifyError(lastError);
        console.error(`❌ Attempt ${attempt} [${errType}]:`, lastError.slice(0, 300));
        log(`❌ Attempt ${attempt} failed [${errType}]`, 'error');
        lastError.split('\n').slice(0, 8).forEach(l => { if (l.trim()) log(`  ${l}`, 'error'); });

        // Short-circuit: unrecoverable error types
        if (errType === 'data_error' || errType === 'import_error') {
          log(`💀 ${errType} — cannot recover. Stopping.`, 'error');
          send('code_status', { state: 'error', message: `Unrecoverable: ${errType}` });
          send('done', { success: false, error: lastError, attempt });
          await saveStrategyToDB(session.strategyId, {
            status: 'failed', error: lastError, attempt, generatedCode: sanitized
          });
          sessions.delete(sessionId);
          return;
        }

        if (attempt >= MAX_RETRIES) {
          log(`💀 All ${MAX_RETRIES} attempts exhausted`, 'error');
          send('code_status', { state: 'error', message: 'Failed after all attempts' });
          send('done', { success: false, error: lastError, attempt });
          await saveStrategyToDB(session.strategyId, {
            status: 'failed', error: lastError, attempt, generatedCode: sanitized
          });
          sessions.delete(sessionId);
        } else {
          log(`⏳ Will retry with ${attempt === 1 ? 'fallback template' : 'AI self-healing'}…`, 'warn');
        }
      }
    }

  } catch (err) {
    console.error('processStrategy fatal:', err);
    send('log', { msg: `🔥 Fatal: ${err.message}`, type: 'error' });
    send('done', { success: false, error: err.message });
    if (session && session.strategyId) {
      await saveStrategyToDB(session.strategyId, { status: 'failed', error: err.message });
    }
    sessions.delete(sessionId);
  }
}

// ─── SAVE STRATEGY TO DATABASE ───────────────────────────────────────────────


// ─── SAVE STRATEGY TO DATABASE ───────────────────────────────────────────────
async function saveStrategyToDB(strategyId, data, userId, creditsToDeduct) {
  try {
    const updateData = {
      status: data.status,
      attempt: data.attempt || 1
    };

    if (data.generatedCode) {
      updateData.generatedCode = data.generatedCode;
    }

    if (data.error) {
      updateData.error = data.error;
    }

    if (data.output) {
      const metrics = parseMetrics(data.output);
      if (metrics) {
        updateData.metrics = {
          totalReturn: metrics.totalReturn,
          cagr: metrics.cagr,
          maxDrawdown: metrics.maxDrawdown,
          winRate: metrics.winRate,
          profitFactor: metrics.profitFactor,
          sharpeRatio: metrics.sharpeRatio,
          totalTrades: metrics.totalTrades,
          startDate: metrics.startDate,
          endDate: metrics.endDate
        };
        updateData.yearlyReturns = metrics.yearlyReturns || [];
        updateData.monthlyReturns = metrics.monthlyReturns || [];
      }
    }

    await Strategy.findByIdAndUpdate(strategyId, updateData);
    console.log(`✅ Strategy ${strategyId} updated in database`);

    // ✅ DEDUCT CREDITS ONLY AFTER SUCCESSFUL COMPLETION
    if (data.status === 'completed' && userId && creditsToDeduct) {
      try {
        const User = require('../models/User');
        const user = await User.findById(userId);
        if (user) {
          user.creditTokens -= creditsToDeduct;
          await user.save();
          console.log(`💰 Strategy ${strategyId} - Deducted ${creditsToDeduct} credits from user ${userId}`);
        }
      } catch (creditErr) {
        console.error(`⚠️ Strategy ${strategyId} - Failed to deduct credits:`, creditErr.message);
        // Don't fail the strategy if credit deduction fails
      }
    }
  } catch (err) {
    console.error("❌ Error saving strategy to DB:", err);
  }
}

// ─── PARSE METRICS FROM OUTPUT ───────────────────────────────────────────────
function parseMetrics(output) {
  try {
    if (!output) return null;

    const lines = output.split('\n');
    const metrics = {};
    const yearlyReturns = [];
    const monthlyReturns = [];
    let mode = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === 'BACKTEST SUMMARY:') {
        mode = 'summary';
        continue;
      }
      if (trimmed === 'YEARLY RETURNS:') {
        mode = 'yearly';
        continue;
      }
      if (trimmed === 'MONTHLY RETURNS:') {
        mode = 'monthly';
        continue;
      }

      if (!trimmed) continue;

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();

      if (mode === 'summary') {
        metrics[key] = value;
      } else if (mode === 'yearly') {
        const val = parseFloat(value.replace('%', '')) || 0;
        yearlyReturns.push({ year: key, value: val });
      } else if (mode === 'monthly') {
        const val = parseFloat(value.replace('%', '')) || 0;
        const monthMatch = key.match(/([A-Za-z]{3})-(\d{4})/);
        if (monthMatch) {
          monthlyReturns.push({
            month: monthMatch[1],
            year: monthMatch[2],
            value: val
          });
        }
      }
    }

    return {
      totalReturn: metrics['Total Return (%)'] || '0',
      cagr: metrics['CAGR (%)'] || '0',
      maxDrawdown: metrics['Max Drawdown (%)'] || '0',
      winRate: metrics['Win Rate (%)'] || '0',
      profitFactor: metrics['Profit Factor'] || '0',
      sharpeRatio: metrics['Sharpe Ratio'] || '0',
      sortinoRatio: metrics['Sortino Ratio'] || '0',
      totalTrades: metrics['Total Trades'] || '0',
      startDate: metrics['Start Date'] || '',
      endDate: metrics['End Date'] || '',
      timeframe: metrics['Timeframe'] || '',
      yearlyReturns,
      monthlyReturns
    };
  } catch (err) {
    console.error("Error parsing metrics:", err);
    return null;
  }
}

// ─── GENERATE CODE PROMPT (MODE-AWARE) ───────────────────────────────────────
async function generateCode(prompt, session, modelName) {
  const assets = session?.assets || ['BTC-USD'];
  const timeframe = session?.timeframe || '1h';
  const convertedAssets = assets.map(a => convertTicker(a));
  let dateRange = getSafeDateRange(timeframe);
  const planKey = session?.plan || 'quick';
  const planConfig = PLAN_CONFIG[planKey] || PLAN_CONFIG.quick;
  const df = session?.deepFeatures || {};

  // QUICK: Hard cap at 365 days regardless of timeframe
  if (planKey === 'quick' && dateRange.maxDays > 365) {
    const now = new Date();
    const capped = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    dateRange = { ...dateRange, maxDays: 365, start: capped.toISOString().split('T')[0] };
  }

  // Build mode-specific preamble
  const modePreamble = planKey === 'quick'
    ? `QUICK MODE: Generate a simple, fast strategy. Max 3 indicators. No nested conditions. No multi-timeframe logic. Keep it clean and efficient. Single asset focus.`
    : `DEEP MODE: Generate a professional-grade institutional strategy. Include comprehensive risk management, position sizing, and all required advanced metrics including Sortino Ratio. Multi-condition logic encouraged.${df.walkForward ? '\nWALK-FORWARD: Split data into 5 folds. Train on 80%, test on last 20%. Report per-fold metrics and average.' : ''
    }${df.monteCarlo ? '\nMONTE CARLO: After main backtest, shuffle trade sequence 1000 times and report 5th/25th/75th/95th percentile total return distribution.' : ''
    }${df.positionSizing ? '\nPOSITION SIZING: Implement Kelly Criterion position sizing. Calculate optimal f based on win rate and avg win/loss ratio.' : ''
    }`;

  // DEEP mode: additionally require Sortino Ratio in output
  const deepMetricsRequirement = planKey !== 'quick' ? `
Sortino Ratio: {value}` : '';

  const fullPrompt = `
================================================================================
PYTHON CODE GENERATOR - STRICT OUTPUT RULES
================================================================================

OUTPUT REQUIREMENTS:
1. Output ONLY executable Python code
2. NO markdown backticks
3. NO explanations before or after code
4. START with 'import' statements
5. PRESERVE proper Python indentation (4 spaces)

================================================================================
REQUIRED IMPORTS:
================================================================================
import pandas as pd
import numpy as np
import yfinance as yf
import ta
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

================================================================================
CONFIGURATION (USE THESE EXACT VALUES - ALREADY VALIDATED):
================================================================================
TICKERS = ${JSON.stringify(convertedAssets)}
INTERVAL = "${timeframe}"
START_DATE = "${dateRange.start}"
END_DATE = datetime.now().strftime('%Y-%m-%d')
INITIAL_CAPITAL = 100000
MAX_DAYS_LIMIT = ${dateRange.maxDays}  # Yahoo Finance limit for this timeframe

================================================================================
DATA LOADING FOR RELIABILITY LAYER (MUST USE EXACTLY THIS):
================================================================================
The execution environment automatically injects a \`smart_load_data(tickers)\` function 
which handles exchange detection, fallback checking, multi-asset data alignment, and rate limits.

DO NOT import yfinance directly. DO NOT use yf.download().

USE THIS EXACT BOILERPLATE TO LOAD DATA:
\`\`\`python
# Load all data using the pre-injected smart_load_data function
# WARNING: DO NOT use yf.download() directly!
df = smart_load_data(TICKERS)
\`\`\`

If TICKERS has multiple assets, df will be a dict of DataFrames. If single asset, it will be one DataFrame.

================================================================================
CRITICAL CODING RULES:
================================================================================
1. DO NOT implement symbol fallback logic — smart_load_data already does this.
2. DO NOT write your own start_date/end_date logic — smart_load_data enforces the safest timeframe.
3. If df is empty, the environment will exit with an error. You don't need to check.

================================================================================
REQUIRED OUTPUT FORMAT (PRINT EXACTLY):
================================================================================
BACKTEST SUMMARY:
Start Date: YYYY-MM-DD
End Date: YYYY-MM-DD
Timeframe: ${timeframe}
Total Return (%): {value}
CAGR (%): {value}
Max Drawdown (%): {value}
Win Rate (%): {value}
Profit Factor: {value}
Sharpe Ratio: {value}
Sortino Ratio: {value}${deepMetricsRequirement ? '' : ''}
Total Trades: {value}

YEARLY RETURNS:
YYYY: value%
YYYY: value%

MONTHLY RETURNS:
MMM-YYYY: value%
MMM-YYYY: value%

================================================================================
REQUIRED CHART:
================================================================================
The environment injects a \`_save_chart()\` helper.
You MUST generate an equity curve chart and call:
\`\`\`python
# DO NOT call plt.savefig or plt.show() directly.
# Use the injected helper:
_save_chart()
\`\`\`

================================================================================
PROHIBITED PATTERNS:
================================================================================
❌ fillna(method='ffill') → Use .ffill()
❌ plt.show() → Use plt.savefig()
❌ resample('M') → Use resample('ME')
❌ resample('Y') → Use resample('YE')
❌ Any text before 'import' statements
❌ No empty DataFrame checks (MUST check if df.empty)
❌ Accessing .iloc[-1] without checking DataFrame has data
❌ Using future dates for END_DATE
❌ Using ticker with slash (BTC/USD) - must use dash (BTC-USD)
❌ Ignoring MAX_DAYS_LIMIT (will cause Yahoo errors)

================================================================================
ERROR HANDLING (MANDATORY):
================================================================================
1. Always wrap yf.download() in try-except
2. Check if DataFrame is empty after loading
3. Check if DataFrame has minimum 50 candles
4. Validate date range doesn't exceed MAX_DAYS_LIMIT
5. Print clear error messages with possible causes
6. Exit with exit(1) if critical errors occur

================================================================================
USER STRATEGY:
================================================================================
${prompt}

================================================================================
GENERATE CODE NOW. START WITH 'import'. NO EXPLANATIONS.
INCLUDE ALL ERROR HANDLING FOR YAHOO FINANCE LIMITS.
USE THE EXACT load_data() FUNCTION PATTERN PROVIDED ABOVE.
================================================================================
`;

  try {
    const result = await ai.models.generateContent({
      model: modelName,
      contents: fullPrompt,
    });

    console.log(`Gemini (${modelName}) response:`, result.text?.length || 0, 'chars');
    return cleanCode(result.text);

  } catch (err) {
    console.error("Error generating code:", err);
    throw err;
  }
}

// ─── FIX CODE PROMPT ─────────────────────────────────────────────────────────
async function fixCode(oldCode, error, modelName, timeframe) {
  const dateRange = getSafeDateRange(timeframe);

  const fixPrompt = `
================================================================================
PYTHON DEBUGGING EXPERT - FIX YAHOO FINANCE ERRORS
================================================================================

OUTPUT RULES:
1. Output ONLY corrected Python code
2. NO markdown backticks
3. NO explanations
4. START with 'import' statements
5. PRESERVE indentation

================================================================================
ERROR TO FIX:
================================================================================
${error}

================================================================================
CODE TO FIX:
================================================================================
${oldCode}

================================================================================
YAHOO FINANCE LIMITS FOR ${timeframe}:
================================================================================
- Maximum days of data: ${dateRange.maxDays} days
- Safe start date: ${dateRange.start}
- End date: ${dateRange.end} (today)

================================================================================
COMMON FIXES:
================================================================================
1. Syntax & Logic: Fix IndentationError, NameError, TypeError, KeyError.
2. Indexing: Check len(df) > 0 before accessing df.iloc[-1].
3. Empty Data Operations: Wrap math that assumes data exists in if not df.empty.
4. DO NOT manually import yfinance or write yf.download(). The environment provides \`smart_load_data(TICKERS)\` which handles all data loading.
5. If the error is about missing data, you cannot fix it. Just return the same code.

================================================================================
CRITICAL CODING RULES:
================================================================================
- Preserve the use of \`smart_load_data(TICKERS)\`
- Preserve the use of \`_save_chart()\`

================================================================================
OUTPUT ONLY THE FIXED CODE. START WITH 'import'.
================================================================================
`;

  try {
    const result = await ai.models.generateContent({
      model: modelName,
      contents: fixPrompt,
    });

    return cleanCode(result.text);

  } catch (err) {
    console.error("Error fixing code:", err);
    throw err;
  }
}

// ─── FALLBACK TEMPLATE (GUARANTEED TO WORK) ──────────────────────────────────
const FALLBACK_TEMPLATE = `import pandas as pd
import numpy as np
import yfinance as yf
import ta
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

TICKERS = ["{ASSET}"]
INTERVAL = "{TIMEFRAME}"
MAX_DAYS = {MAX_DAYS}
INITIAL_CAPITAL = 100000

def load_data(tickers, interval, max_days):
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=max_days-1)
    start = start_dt.strftime('%Y-%m-%d')
    end = end_dt.strftime('%Y-%m-%d')
    
    try:
        df = yf.download(tickers, start=start, end=end, interval=interval, progress=False)
        if df is None or df.empty:
            print(f"ERROR: No data for {tickers}")
            exit(1)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.dropna()
        df = df.ffill()
        if len(df) < 50:
            print(f"ERROR: Only {len(df)} candles")
            exit(1)
        print(f"✅ Loaded {len(df)} candles")
        return df
    except Exception as e:
        print(f"ERROR: {e}")
        exit(1)

class BacktestStrategy:
    def __init__(self, df, capital=INITIAL_CAPITAL):
        self.df = df.copy()
        self.capital = capital
        self.cash = capital
        self.position = None
        self.trades = []
        self.equity_curve = pd.Series(dtype=float)
        self._add_indicators()
    
    def _add_indicators(self):
        self.df['ema_9'] = ta.trend.ema_indicator(self.df['Close'], window=9)
        self.df['ema_21'] = ta.trend.ema_indicator(self.df['Close'], window=21)
        self.df['rsi'] = ta.momentum.rsi(self.df['Close'], window=14)
        self.df['entry'] = (self.df['ema_9'].shift(1) < self.df['ema_21'].shift(1)) & (self.df['ema_9'] > self.df['ema_21']) & (self.df['rsi'] > 40) & (self.df['rsi'] < 60)
        self.df['exit'] = (self.df['ema_9'].shift(1) > self.df['ema_21'].shift(1)) & (self.df['ema_9'] < self.df['ema_21'])
    
    def run(self):
        self.df.dropna(inplace=True)
        for i, row in self.df.iterrows():
            price = row['Close']
            pv = self.cash + (self.position[1] * price if self.position else 0)
            self.equity_curve.at[i] = pv
            if self.position and row['exit']:
                pnl = (price - self.position[0]) * self.position[1]
                self.cash += price * self.position[1]
                self.trades.append({'entry': self.position[2], 'exit': i, 'pnl': pnl})
                self.position = None
            if not self.position and row['entry']:
                qty = self.cash * 0.95 / price
                if qty > 0:
                    self.position = (price, qty, i)
                    self.cash -= price * qty
        if self.position:
            fp = self.df['Close'].iloc[-1]
            self.cash += fp * self.position[1]
            self.trades.append({'entry': self.position[2], 'exit': self.df.index[-1], 'pnl': (fp - self.position[0]) * self.position[1]})
    
    def get_metrics(self):
        fv = self.cash
        tr = ((fv - self.capital) / self.capital) * 100
        days = (self.df.index[-1] - self.df.index[0]).days
        cagr = (((fv / self.capital) ** (365.25 / days)) - 1) * 100 if days > 0 else 0
        wins = [t for t in self.trades if t['pnl'] > 0]
        losses = [t for t in self.trades if t['pnl'] <= 0]
        wr = (len(wins) / len(self.trades) * 100) if self.trades else 0
        gp = sum(t['pnl'] for t in wins)
        gl = abs(sum(t['pnl'] for t in losses))
        pf = gp / gl if gl > 0 else 0
        if not self.equity_curve.empty:
            peak = self.equity_curve.cummax()
            dd = ((self.equity_curve - peak) / peak).min() * 100
        else:
            dd = 0
        if len(self.equity_curve) > 1:
            rets = self.equity_curve.pct_change().dropna()
            sh = (rets.mean() / rets.std()) * np.sqrt(252) if rets.std() > 0 else 0
        else:
            sh = 0
        return {'start': str(self.df.index[0].date()), 'end': str(self.df.index[-1].date()), 'tr': tr, 'cagr': cagr, 'dd': dd, 'wr': wr, 'pf': pf, 'sh': sh, 'tt': len(self.trades)}
    
    def get_yearly(self):
        y = self.equity_curve.resample('YE').last()
        r = y.pct_change() * 100
        return [(str(i.year), v) for i, v in r.dropna().items()]
    
    def get_monthly(self):
        m = self.equity_curve.resample('ME').last()
        r = m.pct_change() * 100
        return [(i.strftime('%b-%Y'), v) for i, v in r.dropna().items()]
    
    def plot(self):
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.plot(self.equity_curve.index, self.equity_curve.values, linewidth=2, color='#0284C7')
        ax.set_title('Equity Curve', fontsize=14, fontweight='bold')
        ax.set_xlabel('Date')
        ax.set_ylabel('Portfolio Value (USD)')
        ax.grid(True, alpha=0.3, linestyle='--')
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        plt.tight_layout()
        plt.savefig('equity.png', dpi=150, bbox_inches='tight')
        plt.close()

if __name__ == "__main__":
    df = load_data(TICKERS, INTERVAL, MAX_DAYS)
    st = BacktestStrategy(df)
    st.run()
    m = st.get_metrics()
    yr = st.get_yearly()
    mo = st.get_monthly()
    st.plot()
    print("\\nBACKTEST SUMMARY:")
    print(f"Start Date: {m['start']}")
    print(f"End Date: {m['end']}")
    print(f"Timeframe: {INTERVAL}")
    print(f"Total Return (%): {m['tr']:.2f}")
    print(f"CAGR (%): {m['cagr']:.2f}")
    print(f"Max Drawdown (%): {m['dd']:.2f}")
    print(f"Win Rate (%): {m['wr']:.2f}")
    print(f"Profit Factor: {m['pf']:.2f}")
    print(f"Sharpe Ratio: {m['sh']:.2f}")
    print(f"Total Trades: {m['tt']}")
    print("\\nYEARLY RETURNS:")
    for y, v in yr:
        print(f"{y}: {v:.2f}%")
    print("\\nMONTHLY RETURNS:")
    for mo_, v in mo[-12:]:
        print(f"{mo_}: {v:.2f}%")
`;

// Use fallback after 2 failed attempts (add in processStrategy)
// if (attempt >= 2) {
//   log(`⚠️  Attempt ${attempt + 1} — Using fallback template`, "warn");
//   const dateRange = getSafeDateRange(session.timeframe);
//   code = FALLBACK_TEMPLATE
//     .replace('{ASSET}', session.assets[0] || 'BTC-USD')
//     .replace('{TIMEFRAME}', session.timeframe || '1h')
//     .replace('{MAX_DAYS}', dateRange.maxDays);
// }

module.exports = router;