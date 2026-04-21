import pandas as pd
import numpy as np
import yfinance as yf
import ta
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

# CONFIGURATION
TICKERS = "BTC-USD"
INTERVAL = "1h"
START_DATE = "2020-01-01"  # Increased history for better optimization
END_DATE = datetime.now().strftime('%Y-%m-%d')
INITIAL_CAPITAL = 100000
MAX_DAYS_LIMIT = 729 

def load_data(ticker, start, end, interval, max_days):
    try:
        start_dt = datetime.strptime(start, '%Y-%m-%d')
        limit_date = datetime.now() - timedelta(days=max_days)
        if start_dt < limit_date:
            start_dt = limit_date + timedelta(days=1)
            start = start_dt.strftime('%Y-%m-%d')

        df = yf.download(ticker, start=start, end=end, interval=interval, progress=False)
        
        if df is None or df.empty:
            df = yf.download(ticker, period="2y", interval=interval, progress=False)
            
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
            
        df = df.dropna()
        return df
    except Exception as e:
        print(f"ERROR: {e}")
        exit(1)

# Main Execution
df = load_data(TICKERS, START_DATE, END_DATE, INTERVAL, MAX_DAYS_LIMIT)

# Calculate Indicators - Optimized for quality over quantity
df['ema200'] = ta.trend.ema_indicator(df['Close'], window=200) # Long term trend filter
df['rsi14'] = ta.momentum.rsi(df['Close'], window=14)
df['atr'] = ta.volatility.average_true_range(df['High'], df['Low'], df['Close'], window=14)
df = df.dropna().copy()

# Strategy Variables
position = 0 
entry_price = 0
stop_loss = 0
equity = [INITIAL_CAPITAL]
trades = []
current_capital = INITIAL_CAPITAL

# Constants for Optimization
RSI_LONG_ENTRY = 60  # Higher threshold to ensure momentum
RSI_SHORT_ENTRY = 40 # Lower threshold to ensure momentum
RSI_LONG_EXIT = 45   # Tight exit to preserve gains
RSI_SHORT_EXIT = 55  # Tight exit to preserve gains
ATR_MULTIPLIER = 3.5 # Volatility based stop loss

# Backtest Loop
for i in range(1, len(df)):
    current_price = float(df['Close'].iloc[i])
    prev_rsi = float(df['rsi14'].iloc[i-1])
    curr_rsi = float(df['rsi14'].iloc[i])
    curr_ema = float(df['ema200'].iloc[i])
    curr_atr = float(df['atr'].iloc[i])
    
    if position == 0:
        # Filter: Price must be in long-term trend (EMA 200) + Strong Momentum (RSI 60)
        if current_price > curr_ema and prev_rsi < RSI_LONG_ENTRY and curr_rsi >= RSI_LONG_ENTRY:
            position = 1
            entry_price = current_price
            stop_loss = entry_price - (ATR_MULTIPLIER * curr_atr)
            trades.append({'type': 'LONG', 'entry_time': df.index[i], 'entry_price': entry_price})
            
        elif current_price < curr_ema and prev_rsi > RSI_SHORT_ENTRY and curr_rsi <= RSI_SHORT_ENTRY:
            position = -1
            entry_price = current_price
            stop_loss = entry_price + (ATR_MULTIPLIER * curr_atr)
            trades.append({'type': 'SHORT', 'entry_time': df.index[i], 'entry_price': entry_price})
            
    elif position == 1:
        # Exit if momentum fades, trend breaks, or stop loss hit
        if current_price < curr_ema or curr_rsi < RSI_LONG_EXIT or current_price <= stop_loss:
            pnl = (current_price - entry_price) / entry_price
            current_capital *= (1 + pnl)
            trades[-1].update({'exit_time': df.index[i], 'exit_price': current_price, 'pnl': pnl})
            position = 0
            
    elif position == -1:
        # Exit if momentum fades, trend breaks, or stop loss hit
        if current_price > curr_ema or curr_rsi > RSI_SHORT_EXIT or current_price >= stop_loss:
            pnl = (entry_price - current_price) / entry_price
            current_capital *= (1 + pnl)
            trades[-1].update({'exit_time': df.index[i], 'exit_price': current_price, 'pnl': pnl})
            position = 0
            
    if position == 1:
        temp_pnl = (current_price - entry_price) / entry_price
        equity.append(current_capital * (1 + temp_pnl))
    elif position == -1:
        temp_pnl = (entry_price - current_price) / entry_price
        equity.append(current_capital * (1 + temp_pnl))
    else:
        equity.append(current_capital)

# Analysis
df['Equity'] = equity
df['Returns'] = df['Equity'].pct_change()

total_return = (df['Equity'].iloc[-1] - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100
days_passed = max((df.index[-1] - df.index[0]).days, 1)
cagr = (((df['Equity'].iloc[-1] / INITIAL_CAPITAL) ** (365 / days_passed)) - 1) * 100
max_dd = ((df['Equity'] / df['Equity'].cummax() - 1).min()) * 100

closed_trades = [t for t in trades if 'pnl' in t]
win_rate = (len([t for t in closed_trades if t['pnl'] > 0]) / len(closed_trades) * 100) if closed_trades else 0
gross_profit = sum([t['pnl'] for t in closed_trades if t['pnl'] > 0])
gross_loss = abs(sum([t['pnl'] for t in closed_trades if t['pnl'] < 0]))
profit_factor = (gross_profit / gross_loss) if gross_loss != 0 else float('inf')

volatility = df['Returns'].std() * np.sqrt(24 * 252)
sharpe_ratio = (df['Returns'].mean() * 24 * 252) / volatility if volatility > 0 else 0

print(f"\nOPTIMIZED BACKTEST SUMMARY (EMA 200 + Momentum Filter):")
print(f"Total Return: {total_return:.2f}%")
print(f"CAGR: {cagr:.2f}%")
print(f"Max Drawdown: {max_dd:.2f}%")
print(f"Win Rate: {win_rate:.2f}%")
print(f"Profit Factor: {profit_factor:.2f}")
print(f"Sharpe Ratio: {sharpe_ratio:.2f}")
print(f"Total Trades: {len(closed_trades)}")

# Yearly Returns
try:
    yearly_df = df['Equity'].resample('YE').last()
    if not yearly_df.empty:
        print(f"\nYEARLY RETURNS:")
        yearly_rets = yearly_df.pct_change()
        yearly_rets.iloc[0] = (yearly_df.iloc[0] - INITIAL_CAPITAL) / INITIAL_CAPITAL
        for date, val in yearly_rets.items():
            print(f"{date.year}: {val*100:.2f}%")
except:
    pass

# Plotting
plt.figure(figsize=(12, 6))
plt.plot(df.index, df['Equity'], label='Optimized Strategy', color='#3498db', linewidth=1.5)
plt.title('Equity Curve - Optimized BTC 1H (High Momentum / 200 EMA)', fontsize=14)
plt.xlabel('Date')
plt.ylabel('Capital (USD)')
plt.grid(True, alpha=0.3)
plt.legend()
plt.savefig('equity_69c40f90157f270e583579e5.png', dpi=150, bbox_inches='tight')