"""抓取行情（Yahoo Finance 公开图表接口），生成给 AI 看的市场快照。

python tools/fetch.py          抓观察池 + 持仓 + 自选，写 data/prices/*.json、data/snapshot.json、data/snapshot.md，
                               以及网页用的 data/quotes.json（最新价）和 data/closes.json（每日收盘价 + 分红，玩家结算用）
python tools/fetch.py --quotes 盘中轻量刷新：只更新 data/quotes.json（价格没变就不写文件）
"""
import json, time, math, sys, urllib.request, urllib.parse
from config import DATA, ETFS, STOCKS, PLAYER_EXTRA, INDICATORS, BENCHMARK, INCEPTION, to_et
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}


def get_json(url, tries=3, timeout=12):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if k == tries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def fetch_symbol(sym, rng='2y', tries=3, timeout=12):
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval=1d&includePrePost=false&events=div'
    res = get_json(url, tries, timeout)['chart']['result'][0]
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
    # Yahoo 的长周期日线偶尔滞后一两天（最新交易日还没有K线），用 meta 里的最新成交补上这一根，免得快照回退到旧交易日
    t, px = meta.get('regularMarketTime'), meta.get('regularMarketPrice')
    if t and px and rng != '1d' and (not rows or to_et(t).date().isoformat() > rows[-1][0]):
        rows.append([to_et(t).date().isoformat(), round(px, 4), round(meta.get('regularMarketDayHigh') or px, 4),
                     round(meta.get('regularMarketDayLow') or px, 4), round(px, 4), int(meta.get('regularMarketVolume') or 0)])
    # 分红：按除息日记录每股金额
    divs = {to_et(int(v['date'])).date().isoformat(): v['amount'] for v in (res.get('events') or {}).get('dividends', {}).values()}
    # 前收：最近一根K线就是最新价所在的交易日时，取它前一根；range=1d 时 Yahoo 直接给 chartPreviousClose
    if rng == '1d' or not rows:
        prev = meta.get('chartPreviousClose')
    elif t and rows[-1][0] == to_et(t).date().isoformat():
        prev = rows[-2][4] if len(rows) > 1 else None
    else:
        prev = rows[-1][4]
    return {
        'symbol': sym, 'name': meta.get('longName') or meta.get('shortName') or sym, 'divs': divs,
        'price': meta.get('regularMarketPrice'), 'time': t, 'prev': prev,
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


def universe():
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
    return list(dict.fromkeys(ETFS + STOCKS + watch + held))


def player_extra(syms):
    return [s for s in PLAYER_EXTRA if s not in syms]


def fetch_many(syms, rng):
    out, streak = {}, 0
    for s in syms:
        if streak >= 8:
            break
        try:
            out[s] = fetch_symbol(s, rng, tries=2)
            streak = 0
        except Exception:
            streak += 1
        time.sleep(0.1)
    return out


def session_done(d, now):
    """该交易日是否已收完盘（16:20 美东之后才算，与 settle.py 一致）"""
    today = now.date().isoformat()
    return d < today or (d == today and now.hour * 60 + now.minute >= 16 * 60 + 20)


def write_quotes(out, state, now):
    """data/quotes.json：每个标的一行 [名称, 最新价, 前收, 成交时间(unix)]。价格都没变就不写，避免无意义的提交。"""
    p = DATA / 'quotes.json'
    q = {s: [d['name'], d['price'], d['prev'], d['time']] for s, d in out.items() if d.get('price') is not None}
    try:
        old = json.loads(p.read_text(encoding='utf-8')).get('q', {})
    except Exception:
        old = {}
    if old and all(s in old and old[s][1:3] == v[1:3] for s, v in q.items()):
        print('quotes.json：价格没有变化，不写入')
        return False
    for s, v in old.items():      # 本次没抓到的保留旧值
        q.setdefault(s, v)
    lines = [f'{json.dumps(s)}:{json.dumps(v, ensure_ascii=False, separators=(",", ":"))}' for s, v in q.items()]
    head = json.dumps({'updated_at': now.isoformat(timespec='minutes'), 'state': state}, ensure_ascii=False)[:-1]
    p.write_text(head + ',"q":{\n' + ',\n'.join(lines) + '\n}}\n', encoding='utf-8')
    print(f'quotes.json：{len(q)} 个标的')
    return True


def write_closes(out, now):
    """data/closes.json：自基金开始前一个交易日起，每个交易日所有标的的收盘价（未复权）和除息日分红，供网页结算玩家订单。
    只追加 / 更新，不删除已有标的和日期；每个标的一行，方便 git 做增量压缩。"""
    p = DATA / 'closes.json'
    try:
        old = json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        old = {'dates': [], 'c': {}, 'div': {}}
    spy = [r[0] for r in out[BENCHMARK]['rows']]
    base = [d for d in spy if d < INCEPTION][-1:]          # 起点前一个交易日，用作对齐基准
    dates = sorted(set(old['dates']) | {d for d in spy if d >= INCEPTION and session_done(d, now)} | set(base))
    cmap = {s: dict(zip(old['dates'], v)) for s, v in old['c'].items()}
    divs = {s: dict(v) for s, v in old.get('div', {}).items()}
    first = dates[0] if dates else INCEPTION
    for s, d in out.items():
        m = cmap.setdefault(s, {})
        for r in d['rows']:
            if r[0] in dates and m.get(r[0]) is None:    # 已记下的收盘价不再改动，玩家的历史结算结果保持稳定
                m[r[0]] = r[4]
        dv = {k: v for k, v in d.get('divs', {}).items() if k > first and k in dates}
        if dv:
            divs.setdefault(s, {}).update(dv)
    c = {s: [m.get(d) for d in dates] for s, m in cmap.items()}
    lines = [f'{json.dumps(s)}:{json.dumps(v, separators=(",", ":"))}' for s, v in c.items()]
    p.write_text('{"dates":' + json.dumps(dates) + ',\n"div":' + json.dumps(divs, separators=(',', ':')) +
                 ',\n"c":{\n' + ',\n'.join(lines) + '\n}}\n', encoding='utf-8')
    print(f'closes.json：{len(dates)} 个交易日 × {len(c)} 个标的')


def probe():
    """先探一下网络：连 Yahoo 都连不上（例如受限的云端沙箱），就立刻退出"""
    try:
        fetch_symbol(BENCHMARK, '5d', tries=1, timeout=8)
        return True
    except Exception as e:
        print(f'网络不通，无法访问 Yahoo Finance（{e}）。未改动任何文件，请使用仓库里已有的 data/snapshot.md。')
        return False


def quotes_only():
    if not probe():
        return 2
    syms = universe()
    syms += player_extra(syms)
    out = fetch_many(syms, '1d')
    if len(out) < len(syms) * 0.8:
        print(f'只抓到 {len(out)}/{len(syms)} 个标的，不更新 quotes.json')
        return 1
    now = to_et()
    write_quotes(out, market_state(now), now)
    return 0


def main():
    if '--quotes' in sys.argv:
        return quotes_only()
    DATA.mkdir(exist_ok=True)
    (DATA / 'prices').mkdir(exist_ok=True)
    syms = universe()
    # 先探一下网络：连 Yahoo 都连不上（例如受限的云端沙箱），就立刻退出，改用仓库里已有的快照
    if not probe():
        return 2
    out, fails = {}, []
    streak = 0
    for s in syms + list(INDICATORS):
        if streak >= 5:
            fails.append(f'{s}: 连续失败过多，跳过'); continue
        try:
            d = fetch_symbol(s)
            (DATA / 'prices' / f'{s.replace("^", "_")}.json').write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8')
            out[s] = d
            streak = 0
        except Exception as e:
            fails.append(f'{s}: {e}')
            streak += 1
        time.sleep(0.15)

    now = to_et()
    state = market_state(now)
    spy_last = out.get(BENCHMARK, {}).get('rows', [[None]])[-1][0]
    if state == 'open' and spy_last != now.date().isoformat():
        state = 'closed'   # 工作日但 SPY 没有今天的K线 → 节假日
    if len(out) < len(syms) * 0.8:
        print(f'只抓到 {len(out)}/{len(syms)} 个标的，保留原快照不覆盖。失败示例：{fails[:3]}')
        return 1
    try:
        old_session = json.loads((DATA / 'snapshot.json').read_text(encoding='utf-8')).get('session_date') or ''
    except Exception:
        old_session = ''
    if not spy_last or spy_last < old_session:
        # 抓到的数据比仓库里的快照还旧（Yahoo 偶尔返回过期数据）：不覆盖快照，也不写 quotes / closes
        print(f'抓到的交易日 {spy_last} 早于现有快照的 {old_session}，数据过期，保留原快照不覆盖')
        return 0
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
    tradable = {s: out[s] for s in syms if s in out}
    # 玩家额外标的：不进快照，只取最近一个月日线，够追加 closes.json
    extra = fetch_many(player_extra(syms), '1mo')
    print(f'玩家额外标的 {len(extra)}/{len(player_extra(syms))}')
    tradable.update(extra)
    write_quotes(tradable, state, now)
    if BENCHMARK in tradable:
        write_closes(tradable, now)
    print(f'fetched {len(out)} symbols, state={state}, session={spy_last}, failed={len(fails)}')
    return 0 if len(out) > len(syms) * 0.8 else 1


if __name__ == '__main__':
    sys.exit(main())
