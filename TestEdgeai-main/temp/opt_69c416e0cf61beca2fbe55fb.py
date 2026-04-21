import pandas as pd
import numpy as np
import yfinance as yf
import ta
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

TICKERS = ["BTC-USD"]
INTERVAL = "1h"
START_DATE = (datetime.now() - timedelta(days=729)).strftime('%Y-%m-%d')
END_DATE = datetime.now().strftime('%Y-%m-%d')
INITIAL_CAPITAL = 100000
MAX_DAYS_LIMIT = 729

def load_data(tickers, start, end, interval, max_days):
    try:
        start_dt = datetime.strptime(start, '%Y-%m-%d')
        end_dt = datetime.strptime(end, '%Y-%m-%d')
        actual_days = (end_dt - start_dt).days
        
        if actual_days > max_days:
            start_dt = end_dt - timedelta(days=max_days)
            start = start_dt.strftime('%Y-%m-%d')
        
        ticker_str = tickers[0]
        df = yf.download(ticker_str, start=start, end=end, interval=interval, progress=False)
        
        if df is None or df.empty:
            exit(1)
        
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        
        df = df.sort_index().dropna()
        df = df[~df.index.duplicated(keep='first')]
        return df
    except Exception:
        exit(1)

df = load_data(TICKERS, START_DATE, END_DATE, INTERVAL, MAX_DAYS_LIMIT)

# Indicators - Optimized parameters
df['EMA_Fast'] = ta.trend.EMAIndicator(df['Close'], window=50).ema_indicator()
df['EMA_Slow'] = ta.trend.EMAIndicator(df['Close'], window=200).ema_indicator()
df['RSI'] = ta.momentum.RSIIndicator(df['Close'], window=14).rsi()
df = df.dropna()

capital = INITIAL_CAPITAL
position = 0 
entry_price = 0
closed_trades = []
equity_curve = []

close_prices = df['Close'].values
ema_fast = df['EMA_Fast'].values
ema_slow = df['EMA_Slow'].values
rsi_values = df['RSI'].values
timestamps = df.index

for i in range(1, len(df)):
    current_close = close_prices[i]
    current_ema_f = ema_fast[i]
    current_ema_s = ema_slow[i]
    current_rsi = rsi_values[i]
    prev_rsi = rsi_values[i-1]
    
    # Exit Logic
    if position == 1:
        # Exit long if price crosses below fast EMA or RSI hits overbought
        if current_close < current_ema_f or current_rsi > 80:
            pnl = (current_close - entry_price) / entry_price
            capital *= (1 + pnl)
            closed_trades.append(pnl)
            position = 0
    elif position == -1:
        # Exit short if price crosses above fast EMA or RSI hits oversold
        if current_close > current_ema_f or current_rsi < 20:
            pnl = (entry_price - current_close) / entry_price
            capital *= (1 + pnl)
            closed_trades.append(pnl)
            position = 0
            
    # Entry Logic - Added EMA_Slow filter and adjusted RSI thresholds to reduce trade count
    if position == 0:
        # Long: Price above both EMAs + RSI crosses above 55
        if current_close > current_ema_f and current_close > current_ema_s and prev_rsi <= 55 and current_rsi > 55:
            position = 1
            entry_price = current_close
        # Short: Price below both EMAs + RSI crosses below 45
        elif current_close < current_ema_f and current_close < current_ema_s and prev_rsi >= 45 and current_rsi < 45:
            position = -1
            entry_price = current_close
            
    equity_curve.append(capital)

# Metrics Calculation
total_return = (capital - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100
days_diff = (timestamps[-1] - timestamps[0]).days
cagr = ((capital / INITIAL_CAPITAL) ** (365 / max(days_diff, 1)) - 1) * 100

equity_series = pd.Series(equity_curve, index=timestamps[1:])
rolling_max = equity_series.cummax()
drawdown = (equity_series - rolling_max) / rolling_max
max_dd = drawdown.min() * 100

win_rate = (len([t for t in closed_trades if t > 0]) / len(closed_trades) * 100) if closed_trades else 0
gross_profit = sum([t for t in closed_trades if t > 0])
gross_loss = abs(sum([t for t in closed_trades if t < 0]))
profit_factor = (gross_profit / gross_loss) if gross_loss != 0 else float('inf')

returns = equity_series.pct_change().dropna()
sharpe_ratio = (returns.mean() / returns.std() * np.sqrt(252 * 24)) if len(returns) > 1 and returns.std() != 0 else 0

try:
    monthly_returns = equity_series.resample('ME').last().pct_change().dropna() * 100
    yearly_returns_raw = equity_series.resample('YE').last().pct_change().dropna() * 100
except:
    monthly_returns = equity_series.resample('M').last().pct_change().dropna() * 100
    yearly_returns_raw = equity_series.resample('A').last().pct_change().dropna() * 100

yearly_returns = {date.year: val for date, val in yearly_returns_raw.items()}

print(f"\nBACKTEST SUMMARY:")
print(f"Start Date: {df.index[0].strftime('%Y-%m-%d')}")
print(f"End Date: {df.index[-1].strftime('%Y-%m-%d')}")
print(f"Timeframe: {INTERVAL}")
print(f"Total Return (%): {total_return:.2f}")
print(f"CAGR (%): {cagr:.2f}")
print(f"Max Drawdown (%): {max_dd:.2f}")
print(f"Win Rate (%): {win_rate:.2f}")
print(f"Profit Factor: {profit_factor:.2f}")
print(f"Sharpe Ratio: {sharpe_ratio:.2f}")
print(f"Total Trades: {len(closed_trades)}")

print(f"\nYEARLY RETURNS:")
for year, return_value in yearly_returns.items():
    print(f"{year}: {return_value:.2f}%")

print(f"\nMONTHLY RETURNS:")
for date, return_value in monthly_returns.items():
    print(f"{date.strftime('%b-%Y')}: {return_value:.2f}%")

plt.figure(figsize=(12, 6))
plt.plot(equity_series, label='Equity Curve', color='#2ecc71')
plt.title(f'Optimized Equity Curve - {TICKERS[0]}')
plt.xlabel('Date')
plt.ylabel('Capital')
plt.grid(True, alpha=0.3)
plt.legend()
plt.savefig('equity_69c416e0cf61beca2fbe55fb.png', dpi=150, bbox_inches='tight')