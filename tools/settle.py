"""收盘结算：按收盘价成交挂单（MOC），逐个交易日记账，更新净值。可以重复运行（幂等）。

订单簿 data/orders/<日期>.json 的成交日：
- "fill": "next_close"（现行规则）：<日期> 之后第一个交易日的收盘价成交。AI 在收盘后决策，所以只能成交在下一个交易日。
- 没有 fill 字段（手册 v1 时期的旧订单）：<日期> 当天收盘价成交。

python tools/settle.py
"""
import json, math, sys
from config import DATA, INCEPTION, INITIAL_CASH, SLIPPAGE, COMMISSION, CALENDAR, BENCHMARK, to_et
from fetch import fetch_symbol

J = lambda p, d=None: json.loads(p.read_text(encoding='utf-8')) if p.exists() else d


def W(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding='utf-8')


_cache, _divs = {}, {}


def closes(sym):
    """{date: close}，同一次运行内缓存（收盘价为未复权价；分红单独计入现金）"""
    if sym not in _cache:
        try:
            d = fetch_symbol(sym, '6mo')
            _cache[sym] = {r[0]: r[4] for r in d['rows']}
            _divs[sym] = d.get('divs', {})
        except Exception as e:
            print(f'  ! 取不到 {sym}: {e}')
            _cache[sym], _divs[sym] = {}, {}
    return _cache[sym]


def div_on(sym, d):
    closes(sym)
    return _divs.get(sym, {}).get(d, 0.0)


def prev_session(sym, d):
    prev = [k for k in closes(sym) if k < d]
    return max(prev) if prev else None


def close_on(sym, d, exact=False):
    c = closes(sym)
    if d in c:
        return c[d]
    if exact:
        return None
    prev = [k for k in c if k <= d]
    return c[max(prev)] if prev else None


def bench(nav, key, sym, d):
    """基准按全收益计算（分红再投资），首日为 $1,000,000"""
    if not nav or nav[-1].get(key) is None:
        return INITIAL_CASH
    pd = prev_session(sym, d)
    c0, c1 = close_on(sym, pd), close_on(sym, d)
    if not c0 or not c1:
        return nav[-1][key]
    return round(nav[-1][key] * (c1 + div_on(sym, d)) / c0, 2)


def completed_sessions():
    """已经收完盘的交易日（以 SPY 日线为准）"""
    rows = sorted(closes(CALENDAR))
    now = to_et()
    today = now.date().isoformat()
    done_today = now.hour * 60 + now.minute >= 16 * 60 + 20
    return [d for d in rows if d >= INCEPTION and (d < today or (d == today and done_today))]


def fill_date(book_date, book, sessions):
    """订单簿应在哪个交易日成交；还没到（下一个交易日尚未收盘）返回 None"""
    if book.get('fill') == 'next_close':
        nxt = [s for s in sessions if s > book_date]
        return nxt[0] if nxt else None
    return book_date


def pending_books():
    out = []
    for p in sorted((DATA / 'orders').glob('20*.json')):
        b = J(p)
        if b and b.get('status') == 'pending':
            out.append((p.stem, p, b))
    return out


def fill_orders(d, p, book, pf, trades):
    """按交易日 d 的收盘价成交订单簿 book（文件 p）"""
    fills, notes = [], []
    orders = book.get('orders', [])
    # 先卖后买
    for o in sorted(orders, key=lambda o: o['side'] != 'sell'):
        sym, side = o['symbol'].upper(), o['side']
        px = close_on(sym, d, exact=True)
        if px is None:
            notes.append(f'{sym} 当日无收盘价，订单作废'); continue
        pos = pf['positions'].get(sym, {'shares': 0, 'cost': 0.0})
        if side == 'sell':
            want = pos['shares'] if o.get('shares') == 'all' else int(o.get('shares') or math.floor((o.get('value') or 0) / px))
            qty = min(want, pos['shares'])
            if qty <= 0:
                notes.append(f'{sym} 没有可卖持仓'); continue
            price = px * (1 - SLIPPAGE)
            value = qty * price
            pf['cash'] += value - COMMISSION
            pnl = (price - pos['cost']) * qty
            pos['shares'] -= qty
            if pos['shares'] == 0:
                pf['positions'].pop(sym, None)
            else:
                pf['positions'][sym] = pos
        else:
            price = px * (1 + SLIPPAGE)
            want = int(o['shares']) if o.get('shares') not in (None, 'all') else math.floor((o.get('value') or 0) / price)
            qty = min(want, math.floor((pf['cash'] - COMMISSION) / price))
            if qty <= 0:
                notes.append(f'{sym} 现金不足或数量为 0'); continue
            if qty < want:
                notes.append(f'{sym} 现金不足，只买到 {qty}/{want} 股')
            value = qty * price
            pf['cash'] -= value + COMMISSION
            tot = pos['shares'] + qty
            pos['cost'] = (pos['cost'] * pos['shares'] + value) / tot
            pos['shares'] = tot
            pf['positions'][sym] = pos
            pnl = None
        f = {'date': d, 'order_date': p.stem, 'symbol': sym, 'side': side, 'shares': qty, 'price': round(price, 4), 'value': round(value, 2), 'reason': o.get('reason', '')}
        if pnl is not None:
            f['pnl'] = round(pnl, 2)
        fills.append(f); trades.append(f)
    book['status'] = 'filled'
    book['fills'] = fills
    book['notes'] = notes
    W(p, book)
    print(f'  {d}: 成交 {p.stem} 的订单 {len(fills)} 笔' + (f'；{"；".join(notes)}' if notes else ''))


def expire_stale(sessions):
    """当天成交的旧式订单挂在非交易日（节假日 / 周末）就作废；next_close 订单会顺延到下一个交易日，不作废"""
    for p in (DATA / 'orders').glob('*.json'):
        book = J(p)
        d = p.stem
        if book.get('status') == 'pending' and book.get('fill') != 'next_close' and sessions and d < sessions[-1] and d not in sessions:
            book['status'] = 'expired'; book['notes'] = ['当天不是交易日，订单作废']
            W(p, book)


def main():
    try:
        fetch_symbol(CALENDAR, '5d', tries=1, timeout=8)
    except Exception as e:
        print(f'网络不通，无法访问 Yahoo Finance（{e}），跳过结算；收盘后的 GitHub Actions 会完成结算。')
        return 2
    pf = J(DATA / 'portfolio.json', {'cash': INITIAL_CASH, 'positions': {}, 'as_of': None})
    trades = J(DATA / 'trades.json', [])
    nav = J(DATA / 'nav.json', [])
    divs = J(DATA / 'dividends.json', [])
    sessions = completed_sessions()
    expire_stale(sessions)
    last = nav[-1]['date'] if nav else None
    books = pending_books()
    for bd, p, book in books:
        t = fill_date(bd, book, sessions)
        if book.get('fill') == 'next_close' and t and last and t <= last:
            # 订单提交时它的成交日已经结算过了（例如补写的旧日期订单），不能再按过去的价格成交
            book['status'] = 'expired'; book['notes'] = [f'成交日 {t} 已结算，订单作废']
            W(p, book)
    for d in sessions:
        if last and d <= last:
            continue
        # 除息日：按前一日收盘时的持股数入账股息（在当日成交之前）
        for s, p in list(pf['positions'].items()):
            a = div_on(s, d)
            if a:
                pf['cash'] += p['shares'] * a
                divs.append({'date': d, 'symbol': s, 'shares': p['shares'], 'per_share': a, 'amount': round(p['shares'] * a, 2)})
                print(f'  {d}: {s} 分红 ${p["shares"] * a:,.2f}')
        for bd, p, book in books:
            if book.get('status') == 'pending' and fill_date(bd, book, sessions) == d:
                fill_orders(d, p, book, pf, trades)
        mv = sum(p['shares'] * (close_on(s, d) or p['cost']) for s, p in pf['positions'].items())
        v = pf['cash'] + mv
        nav.append({'date': d, 'nav': round(v, 2), 'cash': round(pf['cash'], 2), 'invested': round(mv, 2),
                    'spy': bench(nav, 'spy', 'SPY', d), 'qqq': bench(nav, 'qqq', 'QQQ', d)})
        pf['as_of'] = d
        print(f'  {d}: 净值 {v:,.2f}')

    W(DATA / 'portfolio.json', pf)
    W(DATA / 'trades.json', trades)
    W(DATA / 'nav.json', nav)
    W(DATA / 'dividends.json', divs)
    write_summary(pf, nav, trades, divs)
    return 0


def write_summary(pf, nav, trades, divs):
    d = pf['as_of']
    hold = []
    total = nav[-1]['nav'] if nav else INITIAL_CASH
    for s, p in sorted(pf['positions'].items()):
        px = close_on(s, d) if d else p['cost']
        val = p['shares'] * px
        hold.append({'symbol': s, 'shares': p['shares'], 'cost': round(p['cost'], 4), 'price': px, 'value': round(val, 2),
                     'weight': val / total, 'pnl': round((px - p['cost']) * p['shares'], 2), 'pnl_pct': px / p['cost'] - 1})
    hold.sort(key=lambda h: -h['value'])
    def max_dd(key):
        peak, dd = 0, 0
        for r in nav:
            if r.get(key) is None:
                continue
            peak = max(peak, r[key]); dd = min(dd, r[key] / peak - 1)
        return dd
    mdd = max_dd('nav')
    bkey = BENCHMARK.lower()
    pending = []
    for p in sorted((DATA / 'orders').glob('*.json')):
        b = J(p)
        if b.get('status') == 'pending':
            pending.append({'date': p.stem, 'fill': b.get('fill', 'same_close'), 'orders': b.get('orders', [])})
    journal = sorted((p.stem for p in (DATA / 'journal').glob('20*.json')), reverse=True)
    W(DATA / 'journal' / 'index.json', journal)
    W(DATA / 'summary.json', {
        'as_of': d, 'updated_at': to_et().isoformat(timespec='minutes'), 'inception': INCEPTION, 'initial': INITIAL_CASH,
        'nav': total, 'cash': pf['cash'], 'ret': total / INITIAL_CASH - 1,
        'benchmark': BENCHMARK,
        'bench_ret': nav[-1][bkey] / INITIAL_CASH - 1 if nav else 0,
        'bench_max_drawdown': max_dd(bkey),
        'spy_ret': nav[-1]['spy'] / INITIAL_CASH - 1 if nav else 0,
        'qqq_ret': nav[-1]['qqq'] / INITIAL_CASH - 1 if nav else 0,
        'day_ret': nav[-1]['nav'] / nav[-2]['nav'] - 1 if len(nav) > 1 else total / INITIAL_CASH - 1,
        'max_drawdown': mdd, 'days': len(nav), 'trades': len(trades), 'dividends': round(sum(x['amount'] for x in divs), 2), 'holdings': hold, 'pending': pending,
    })


if __name__ == '__main__':
    sys.exit(main())
