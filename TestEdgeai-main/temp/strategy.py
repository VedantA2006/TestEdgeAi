import pandas as pd
import numpy as np
import yfinance as yf
import ta
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

# CONFIGURATION
TICKERS = ["AAPL"]
INTERVAL = "1d"
START_DATE = "2024-01-01"
END_DATE = datetime.now().strftime('%Y-%m-%d')
INITIAL_CAPITAL = 100000
MAX_DAYS_LIMIT = 3650
TRAILING_STOP_PCT = 0.03
POSITION_SIZE_PCT = 0.95

def load_data(tickers, start, end, interval, max_days):
    try:
        start_dt = datetime.strptime(start, '%Y-%m-%d')
        end_dt = datetime.strptime(end, '%Y-%m-%d')
        
        limit_start = datetime.now() - timedelta(days=max_days)
        if start_dt < limit_start:
            start_dt = limit_start
            start = start_dt.strftime('%Y-%m-%d')
        
        df = yf.download(tickers, start=start, end=end, interval=interval, progress=False)
        
        if df is None or df.empty:
            print(f"ERROR: No data downloaded for {tickers}. Check symbol availability.")
            exit(1)
        
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        
        df = df.dropna()
        
        if len(df) < 50:
            print(f"ERROR: Insufficient data ({len(df)} candles, need at least 50)")
            exit(1)
            
        return df
        
    except Exception as e:
        print(f"ERROR: Failed to download data: {e}")
        exit(1)

# Load Data
df = load_data(TICKERS, START_DATE, END_DATE, INTERVAL, MAX_DAYS_LIMIT)

# Indicators
df['ema9'] = ta.trend.ema_indicator(df['Close'], window=9)
df['ema21'] = ta.trend.ema_indicator(df['Close'], window=21)
df['rsi'] = ta.momentum.rsi(df['Close'], window=14)
df = df.dropna()

# Backtest Variables
capital = INITIAL_CAPITAL
position = 0
shares = 0
entry_price = 0
highest_price = 0
trades = []
equity_curve = []

# Simulation Loop
for i in range(len(df)):
    current_date = df.index[i]
    current_price = df['Close'].iloc[i]
    current_high = df['High'].iloc[i]
    current_low = df['Low'].iloc[i]
    
    ema9 = df['ema9'].iloc[i]
    ema21 = df['ema21'].iloc[i]
    rsi = df['rsi'].iloc[i]
    
    if i < 1:
        equity_curve.append(capital)
        continue

    prev_ema9 = df['ema9'].iloc[i-1]
    prev_ema21 = df['ema21'].iloc[i-1]

    # Exit Logic
    if position > 0:
        highest_price = max(highest_price, current_high)
        stop_price = highest_price * (1 - TRAILING_STOP_PCT)
        
        if (ema9 < ema21 and prev_ema9 >= prev_ema21) or (current_low <= stop_price):
            exit_price = stop_price if current_low <= stop_price else current_price
            capital = shares * exit_price
            trades.append({
                'entry_date': entry_date,
                'exit_date': current_date,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'pnl': (exit_price - entry_price) / entry_price
            })
            position = 0
            shares = 0
            
    # Entry Logic
    if position == 0:
        if (ema9 > ema21 and prev_ema9 <= prev_ema21) and rsi > 50:
            entry_price = current_price
            entry_date = current_date
            highest_price = current_high
            trade_capital = capital * POSITION_SIZE_PCT
            shares = trade_capital / entry_price
            position = 1
            
    current_equity = capital if position == 0 else shares * current_price
    equity_curve.append(current_equity)

# Metrics Calculation
df['Equity'] = equity_curve
df['Returns'] = df['Equity'].pct_change()

total_return = (equity_curve[-1] - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100
days = (df.index[-1] - df.index[0]).days
cagr = (((equity_curve[-1] / INITIAL_CAPITAL) ** (365 / max(days, 1))) - 1) * 100

peak = df['Equity'].expanding(min_periods=1).max()
drawdown = (df['Equity'] - peak) / peak
max_drawdown = drawdown.min() * 100

win_rate = len([t for t in trades if t['pnl'] > 0]) / len(trades) * 100 if trades else 0
gross_profit = sum([t['pnl'] for t in trades if t['pnl'] > 0])
gross_loss = abs(sum([t['pnl'] for t in trades if t['pnl'] < 0]))
profit_factor = gross_profit / gross_loss if gross_loss != 0 else float('inf')

sharpe = (df['Returns'].mean() / df['Returns'].std()) * np.sqrt(252) if df['Returns'].std() != 0 else 0

# Output Formatting
print(f"BACKTEST SUMMARY:")
print(f"Start Date: {df.index[0].strftime('%Y-%m-%d')}")
print(f"End Date: {df.index[-1].strftime('%Y-%m-%d')}")
print(f"Total Return (%): {total_return:.2f}%")
print(f"CAGR (%): {cagr:.2f}%")
print(f"Max Drawdown (%): {max_drawdown:.2f}%")
print(f"Win Rate (%): {win_rate:.2f}%")
print(f"Profit Factor: {profit_factor:.2f}")
print(f"Sharpe Ratio: {sharpe:.2f}")
print(f"Total Trades: {len(trades)}")

# Resampling with updated aliases
print(f"\nYEARLY RETURNS:")
yearly = df['Equity'].resample('YE').ffill().pct_change()
for date, val in yearly.items():
    if not pd.isna(val):
        print(f"{date.year}: {val*100:.2f}%")

print(f"\nMONTHLY RETURNS:")
monthly = df['Equity'].resample('ME').ffill().pct_change()
for date, val in monthly.items():
    if not pd.isna(val):
        print(f"{date.strftime('%b-%Y')}: {val*100:.2f}%")

# Chart Generation
plt.figure(figsize=(12, 6))
plt.plot(df.index, df['Equity'], label='Strategy Equity', color='#2ca02c')
plt.title(f'Equity Curve - {TICKERS[0]}')
plt.xlabel('Date')
plt.ylabel('Portfolio Value')
plt.grid(True, alpha=0.3)
plt.legend()
plt.savefig('equity.png', dpi=150, bbox_inches='tight')