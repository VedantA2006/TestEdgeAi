import pandas as pd
import numpy as np
import yfinance as yf
import ta
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

# CONFIGURATION
TICKERS = ["BTC-USD"]
INTERVAL = "4h"
START_DATE = "2020-01-01"  # Increased history for better EMA 200 calculation
END_DATE = datetime.now().strftime('%Y-%m-%d')
INITIAL_CAPITAL = 100000
MAX_DAYS_LIMIT = 3000

def load_data(tickers, start, end, interval, max_days):
    try:
        start_dt = datetime.strptime(start, '%Y-%m-%d')
        limit_date = datetime.now() - timedelta(days=max_days)
        if start_dt < limit_date:
            start_dt = limit_date + timedelta(days=1)
        
        df = yf.download(tickers, start=start_dt.strftime('%Y-%m-%d'), end=end, interval=interval, progress=False, auto_adjust=True)
        
        if df is None or df.empty:
            df = yf.download(tickers, period="max", interval=interval, progress=False, auto_adjust=True)
            
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
            
        df = df.dropna().copy()
        return df
    except Exception as e:
        print(f"ERROR: Data load failed: {e}")
        exit(1)

# Execution
df = load_data(TICKERS, START_DATE, END_DATE, INTERVAL, MAX_DAYS_LIMIT)

# Indicators
df['ema50'] = ta.trend.ema_indicator(df['Close'], window=50)
df['ema200'] = ta.trend.ema_indicator(df['Close'], window=200)
df['rsi14'] = ta.momentum.rsi(df['Close'], window=14)
df['atr'] = ta.volatility.average_true_range(df['High'], df['Low'], df['Close'], window=14)

# Optimized Strategy Logic (Trend + Momentum + Safety Filter)
# We enter only when short-term trend confirms long-term trend and RSI shows fresh momentum
df['long_entry'] = (df['Close'] > df['ema200']) & (df['ema50'] > df['ema200']) & (df['rsi14'] > 50) & (df['rsi14'].shift(1) <= 50)
df['long_exit'] = (df['Close'] < df['ema50']) | (df['rsi14'] < 40)

df['short_entry'] = (df['Close'] < df['ema200']) & (df['ema50'] < df['ema200']) & (df['rsi14'] < 50) & (df['rsi14'].shift(1) >= 50)
df['short_exit'] = (df['Close'] > df['ema50']) | (df['rsi14'] > 60)

# Position Management (Reduced trades by using specific entry/exit instead of always-in)
df['position'] = 0
current_pos = 0

for i in range(1, len(df)):
    if current_pos == 0:
        if df['long_entry'].iloc[i]:
            current_pos = 1
        elif df['short_entry'].iloc[i]:
            current_pos = -1
    elif current_pos == 1:
        if df['long_exit'].iloc[i]:
            current_pos = 0
    elif current_pos == -1:
        if df['short_exit'].iloc[i]:
            current_pos = 0
    df.at[df.index[i], 'position'] = current_pos

# Backtest Calculations
df['market_returns'] = df['Close'].pct_change()
df['strategy_returns'] = df['position'].shift(1) * df['market_returns']
# Add a small slippage/fee (0.1% per trade)
df['trade_change'] = df['position'].diff().fillna(0).abs()
df['strategy_returns'] = df['strategy_returns'] - (df['trade_change'] * 0.001)

df['cumulative_returns'] = (1 + df['strategy_returns'].fillna(0)).cumprod()
df['equity_curve'] = INITIAL_CAPITAL * df['cumulative_returns']

# Metrics
total_return = (df['equity_curve'].iloc[-1] / INITIAL_CAPITAL - 1) * 100
days = (df.index[-1] - df.index[0]).days
cagr = (((df['equity_curve'].iloc[-1] / INITIAL_CAPITAL) ** (365 / max(days, 1))) - 1) * 100

rolling_max = df['equity_curve'].cummax()
drawdown = (df['equity_curve'] - rolling_max) / rolling_max
max_drawdown = drawdown.min() * 100

# Trade analysis
trades = df[df['trade_change'] != 0].copy()
total_trades = len(trades)

trade_returns = []
if len(trades) > 1:
    pos_history = trades['position'].tolist()
    price_history = trades['Close'].tolist()
    for i in range(len(pos_history) - 1):
        if pos_history[i] != 0:
            # Simple trade return estimation: (exit_price/entry_price - 1) * direction
            ret = (price_history[i+1] / price_history[i] - 1) * pos_history[i]
            trade_returns.append(ret)

win_rate = (len([r for r in trade_returns if r > 0]) / len(trade_returns) * 100) if trade_returns else 0
sharpe = (df['strategy_returns'].mean() / df['strategy_returns'].std() * np.sqrt(365 * 6)) if df['strategy_returns'].std() != 0 else 0

# Yearly Returns
yearly_returns = df['strategy_returns'].resample('YE').apply(lambda x: (np.prod(1 + x) - 1) * 100)

# Print Summary
print(f"BACKTEST SUMMARY (OPTIMIZED):")
print(f"Start Date: {df.index[0].strftime('%Y-%m-%d')}")
print(f"End Date: {df.index[-1].strftime('%Y-%m-%d')}")
print(f"Total Return (%): {total_return:.2f}%")
print(f"CAGR (%): {cagr:.2f}%")
print(f"Max Drawdown (%): {max_drawdown:.2f}%")
print(f"Win Rate (%): {win_rate:.2f}%")
print(f"Sharpe Ratio: {sharpe:.2f}")
print(f"Total Trades: {total_trades}")

print(f"\nYEARLY RETURNS:")
for yr, val in yearly_returns.items():
    print(f"{yr.year}: {val:.2f}%")

# Plotting
plt.figure(figsize=(12, 6))
plt.plot(df['equity_curve'], label='Optimized Strategy Equity', color='#2ca02c')
plt.title(f'Optimized Equity Curve: {TICKERS[0]} (Safe Trend Following)')
plt.xlabel('Date')
plt.ylabel('Capital (USD)')
plt.grid(True, alpha=0.3)
plt.legend()
plt.savefig('equity_69c1747b903b24bb63de5ee4.png', dpi=150, bbox_inches='tight')