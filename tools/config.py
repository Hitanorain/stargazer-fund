"""观星者基金：共用配置"""
import sys as _sys
try:
    _sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'

INCEPTION = '2026-10-16'
INITIAL_CASH = 1_000_000.0
SLIPPAGE = 0.0005          # 成交价相对收盘价的不利滑点（0.05%）
COMMISSION = 0.0           # 美股主流券商零佣金
MAX_WEIGHT = 0.20          # 单只标的上限（按下单时净值估算）
MAX_ORDERS = 12            # 每日最多下单笔数
BENCHMARK = 'SPY'

# 观察池：宽基 / 行业 / 债券商品 ETF + 大盘龙头。AI 可以在 data/watchlist.json 里追加。
ETFS = ['SPY', 'QQQ', 'IWM', 'DIA',
        'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH',
        'TLT', 'IEF', 'SHY', 'GLD', 'SLV', 'USO']
STOCKS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'BRK-B', 'JPM',
          'V', 'MA', 'UNH', 'LLY', 'XOM', 'JNJ', 'PG', 'HD', 'COST', 'ABBV',
          'MRK', 'PEP', 'KO', 'WMT', 'BAC', 'CVX', 'ORCL', 'CRM', 'AMD', 'NFLX',
          'ADBE', 'INTC', 'CSCO', 'QCOM', 'TXN', 'IBM', 'DIS', 'MCD', 'CAT', 'GS',
          'MS', 'PLTR', 'UBER', 'MU', 'NOW', 'INTU', 'ISRG', 'AMAT', 'LRCX', 'PANW',
          'SHOP', 'COIN', 'BA', 'GE', 'RTX', 'NEE', 'LIN', 'TMO', 'PFE', 'T']
# 只看不交易的指标
INDICATORS = {'^VIX': 'VIX 恐慌指数', '^TNX': '美国10年期国债收益率(×10)', 'DX-Y.NYB': '美元指数'}


# —— 美东时间（不依赖 tzdata，Windows 也能跑）——
import datetime as _dt


def _nth_sunday(year, month, n):
    d = _dt.date(year, month, 1)
    d += _dt.timedelta(days=(6 - d.weekday()) % 7)
    return d + _dt.timedelta(weeks=n - 1)


def et_offset(utc):
    """给定 UTC datetime，返回美东相对 UTC 的偏移（夏令时 -4h，冬令时 -5h）"""
    y = utc.year
    start = _dt.datetime.combine(_nth_sunday(y, 3, 2), _dt.time(7))    # 3 月第二个周日 2:00 EST = 7:00 UTC
    end = _dt.datetime.combine(_nth_sunday(y, 11, 1), _dt.time(6))     # 11 月第一个周日 2:00 EDT = 6:00 UTC
    naive = utc.replace(tzinfo=None)
    return _dt.timedelta(hours=-4 if start <= naive < end else -5)


def to_et(ts=None):
    """unix 时间戳（或当前时间）→ 美东时间（带时区）"""
    utc = _dt.datetime.now(_dt.timezone.utc) if ts is None else _dt.datetime.fromtimestamp(ts, _dt.timezone.utc)
    off = et_offset(utc)
    return utc.astimezone(_dt.timezone(off))
