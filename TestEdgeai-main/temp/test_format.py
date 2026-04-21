import pandas as pd
import numpy as np
from datetime import datetime

# Test data
INTERVAL = "1h"
total_return = 25.50
cagr = 15.30
max_dd = -12.45
win_rate = 55.20
profit_factor = 1.85
sharpe_ratio = 1.25
closed_trades = [1, 2, 3, 4, 5]

# Create dummy dataframe
dates = pd.date_range(start='2024-01-01', end='2024-12-31', freq='D')
df = pd.DataFrame({'value': np.random.randn(len(dates))}, index=dates)

# Test output format
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
print(f"2024: 25.50%")
print(f"2023: 15.30%")

print(f"\nMONTHLY RETURNS:")
print(f"Jan-2024: 5.20%")
print(f"Feb-2024: -2.10%")
