import sys
sys.path.append('.')
from datetime import datetime, timedelta
import pandas as pd
import yfinance as yf

# Mock the injected preamble
_MAX_DAYS = 365
_INTERVAL = '1d'

def _detect_exchange(symbol):
    s = symbol.strip().upper()
    if any(s.endswith(x) for x in ['-USD','-USDT','=X','=F','.NS','.BO','.AX','.L','.TO']):
        return [s]
    INDIAN = {'RELIANCE','TCS','HDFCBANK','INFY'}
    if s in INDIAN: return [s + '.NS', s + '.BO']
    return [s, s + '.NS']

def _try_download(sym, start, end, interval):
    try:
        df = yf.download(sym, start=start, end=end, interval=interval, progress=False, auto_adjust=True)
        if df is not None and not df.empty and len(df) >= 10:
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            return df.dropna().ffill(), sym
    except Exception as e:
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
        if not loaded: print(f'Invalid symbol: {raw}')
    return results

print('Testing AAPL (US):')
smart_load_data(['AAPL'])

print('\nTesting RELIANCE (India):')
smart_load_data(['RELIANCE'])
