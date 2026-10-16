"""抓取行情（Yahoo Finance 公开图表接口），生成给 AI 看的市场快照。

python tools/fetch.py          抓观察池 + 持仓 + 自选，写 data/prices/*.json、data/snapshot.json、data/snapshot.md
"""
import json, time, math, sys, urllib.request, urllib.parse
from config import DATA, ETFS, STOCKS, INDICATORS, BENCHMARK, to_et
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}


def get_json(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if k == tries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def fetch_symbol(sym, rng='2y'):
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval=1d&includePrePost=false&events=div'
    res = get_json(url)['chart']['result'][0]
    meta, ts = res['meta'], res.get('timestamp') or []
    q = res['indicators']['quote'][0]
    rows = []
    for i, t in enumerate(ts):
        c = q['close'][i]
        if c is None:
            continue
        d = to_et(t).date().isoformat()
        rows.append([d, round(q['open'][i] or c, 4), round(q['high'][i] or c, 4), round(q['low'][i] or c, 4), round(c, 4), int(q['volume'][i] or 0)])
    # 交易时段内，最后一根是"今天到目前为止"
    # 分红：按除息日记录每股金额
    divs = {to_et(int(v['date'])).date().isoformat(): v['amount'] for v in (res.get('events') or {}).get('dividends', {}).values()}
    return {
        'symbol': sym, 'name': meta.get('longName') or meta.get('shortName') or sym, 'divs': divs,
        'price': meta.get('regularMarketPrice'), 'time': meta.get('regularMarketTime'),
        'rows': rows,
    }


def market_state(now=None):
    """粗略判断美股现在的状态：pre / open / closed（周末 / 节假日靠 SPY 当天是否有K线判断）"""
    now = now or to_et()
    if now.weekday() >= 5:
        return 'closed'
    mins = now.hour * 60 + now.minute
    if mins < 9 * 60 + 30:
        return 'pre'
    if mins < 16 * 60:
        return 'open'
    return 'after'


def sma(xs, n):
    return sum(xs[-n:]) / n if len(xs) >= n else None


def rsi(xs, n=14):
    if len(xs) <= n:
        return None
    gains = losses = 0.0
    for a, b in zip(xs[-n - 1:-1], xs[-n:]):
        d = b - a
        gains += max(d, 0); losses += max(-d, 0)
    if losses == 0:
        return 100.0
    rs = gains / losses
    return 100 - 100 / (1 + rs)


def ret(xs, n):
    return (xs[-1] / xs[-1 - n] - 1) if len(xs) > n and xs[-1 - n] else None


def summarize(d):
    rows = d['rows']
    closes = [r[4] for r in rows]
    vols = [r[5] for r in rows]
    if len(closes) < 2:
        return None
    last = closes[-1]
    hi52 = max(r[2] for r in rows[-252:]); lo52 = min(r[3] for r in rows[-252:])
    s20, s50, s200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    v20 = sma(vols[:-1], 20)
    # 20 日年化波动
    rets = [math.log(b / a) for a, b in zip(closes[-21:-1], closes[-20:]) if a and b]
    vol = (sum(r * r for r in rets) / max(1, len(rets))) ** 0.5 * math.sqrt(252) if rets else None
    return {
        'symbol': d['symbol'], 'name': d['name'], 'date': rows[-1][0], 'last': last,
        'chg1d': ret(closes, 1), 'chg5d': ret(closes, 5), 'chg20d': ret(closes, 20), 'chg60d': ret(closes, 60), 'chg250d': ret(closes, 250),
        'vs_sma20': last / s20 - 1 if s20 else None, 'vs_sma50': last / s50 - 1 if s50 else None, 'vs_sma200': last / s200 - 1 if s200 else None,
        'rsi14': rsi(closes), 'from_52w_high': last / hi52 - 1, 'from_52w_low': last / lo52 - 1,
        'vol_ratio': vols[-1] / v20 if v20 else None, 'vol20_ann': vol,
    }


def pct(x, d=1):
    return '—' if x is None else f'{x * 100:+.{d}f}%'


def main():
    DATA.mkdir(exist_ok=True)
    (DATA / 'prices').mkdir(exist_ok=True)
    watch = []
    try:
        watch = json.loads((DATA / 'watchlist.json').read_text(encoding='utf-8')).get('symbols', [])
    except FileNotFoundError:
        pass
    held = []
    try:
        held = list(json.loads((DATA / 'portfolio.json').read_text(encoding='utf-8'))['positions'].keys())
    except FileNotFoundError:
        pass
    syms = list(dict.fromkeys(ETFS + STOCKS + watch + held))
    out, fails = {}, []
    for s in syms + list(INDICATORS):
        try:
            d = fetch_symbol(s)
            (DATA / 'prices' / f'{s.replace("^", "_")}.json').write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8')
            out[s] = d
        except Exception as e:
            fails.append(f'{s}: {e}')
        time.sleep(0.15)

    now = to_et()
    state = market_state(now)
    spy_last = out.get(BENCHMARK, {}).get('rows', [[None]])[-1][0]
    if state == 'open' and spy_last != now.date().isoformat():
        state = 'closed'   # 工作日但 SPY 没有今天的K线 → 节假日
    snap = {
        'generated_at': now.isoformat(timespec='minutes'), 'market_state': state, 'session_date': spy_last,
        'indicators': {k: summarize(out[k]) for k in INDICATORS if k in out},
        'symbols': {s: summarize(out[s]) for s in syms if s in out and summarize(out[s])},
        'failed': fails,
    }
    (DATA / 'snapshot.json').write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding='utf-8')

    # 给 AI 读的 Markdown 版
    L = [f'# 市场快照  {snap["generated_at"]} (美东)  状态: {state}  交易日: {spy_last}', '']
    L.append('## 宏观指标')
    for k, label in INDICATORS.items():
        x = snap['indicators'].get(k)
        if x:
            L.append(f'- {label} ({k}): {x["last"]:.2f}  1日 {pct(x["chg1d"])}  5日 {pct(x["chg5d"])}  20日 {pct(x["chg20d"])}')
    L += ['', '## 观察池（价格为最近成交 / 收盘）', '',
          '| 代码 | 价格 | 1日 | 5日 | 20日 | 60日 | 1年 | 距MA50 | 距MA200 | RSI14 | 距52周高 | 量比 | 年化波动 |',
          '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for s in syms:
        x = snap['symbols'].get(s)
        if not x:
            continue
        vr = '—' if x['vol_ratio'] is None else f'{x["vol_ratio"]:.2f}'
        rs = '—' if x['rsi14'] is None else round(x['rsi14'])
        L.append(f'| {s} | {x["last"]:.2f} | {pct(x["chg1d"])} | {pct(x["chg5d"])} | {pct(x["chg20d"])} | {pct(x["chg60d"])} | {pct(x["chg250d"], 0)} | '
                 f'{pct(x["vs_sma50"])} | {pct(x["vs_sma200"])} | {rs} | {pct(x["from_52w_high"])} | {vr} | {pct(x["vol20_ann"], 0)} |')
    if fails:
        L += ['', '## 抓取失败', *[f'- {f}' for f in fails]]
    (DATA / 'snapshot.md').write_text('\n'.join(L) + '\n', encoding='utf-8')
    print(f'fetched {len(out)} symbols, state={state}, session={spy_last}, failed={len(fails)}')
    return 0 if len(out) > len(syms) * 0.8 else 1


if __name__ == '__main__':
    sys.exit(main())
