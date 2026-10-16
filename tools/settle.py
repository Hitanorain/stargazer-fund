"""收盘结算：按收盘价成交挂单（MOC），逐个交易日记账，更新净值。可以重复运行（幂等）。

python tools/settle.py
"""
import json, math, sys
from config import DATA, INCEPTION, INITIAL_CASH, SLIPPAGE, COMMISSION, BENCHMARK, to_et
from fetch import fetch_symbol

J = lambda p, d=None: json.loads(p.read_text(encoding='utf-8')) if p.exists() else d


def W(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding='utf-8')


_cache = {}


def closes(sym):
    """{date: close}，同一次运行内缓存"""
    if sym not in _cache:
        try:
            _cache[sym] = {r[0]: r[4] for r in fetch_symbol(sym, '6mo')['rows']}
        except Exception as e:
            print(f'  ! 取不到 {sym}: {e}')
            _cache[sym] = {}
    return _cache[sym]


def close_on(sym, d, exact=False):
    c = closes(sym)
    if d in c:
        return c[d]
    if exact:
        return None
    prev = [k for k in c if k <= d]
    return c[max(prev)] if prev else None


def completed_sessions():
    """已经收完盘的交易日（以 SPY 日线为准）"""
    rows = sorted(closes(BENCHMARK))
    now = to_et()
    today = now.date().isoformat()
    done_today = now.hour * 60 + now.minute >= 16 * 60 + 20
    return [d for d in rows if d >= INCEPTION and (d < today or (d == today and done_today))]


def fill_orders(d, pf, trades):
    p = DATA / 'orders' / f'{d}.json'
    book = J(p)
    if not book or book.get('status') != 'pending':
        return
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
        f = {'date': d, 'symbol': sym, 'side': side, 'shares': qty, 'price': round(price, 4), 'value': round(value, 2), 'reason': o.get('reason', '')}
        if pnl is not None:
            f['pnl'] = round(pnl, 2)
        fills.append(f); trades.append(f)
    book['status'] = 'filled'
    book['fills'] = fills
    book['notes'] = notes
    W(p, book)
    print(f'  {d}: 成交 {len(fills)} 笔' + (f'；{"；".join(notes)}' if notes else ''))


def expire_stale(sessions):
    """挂在非交易日（节假日 / 周末）的单子作废"""
    for p in (DATA / 'orders').glob('*.json'):
        book = J(p)
        d = p.stem
        if book.get('status') == 'pending' and sessions and d < sessions[-1] and d not in sessions:
            book['status'] = 'expired'; book['notes'] = ['当天不是交易日，订单作废']
            W(p, book)


def main():
    pf = J(DATA / 'portfolio.json', {'cash': INITIAL_CASH, 'positions': {}, 'as_of': None})
    trades = J(DATA / 'trades.json', [])
    nav = J(DATA / 'nav.json', [])
    sessions = completed_sessions()
    expire_stale(sessions)
    last = nav[-1]['date'] if nav else None
    spy0 = close_on(BENCHMARK, sessions[0]) if sessions else None
    qqq0 = close_on('QQQ', sessions[0]) if sessions else None
    for d in sessions:
        if last and d <= last:
            continue
        fill_orders(d, pf, trades)
        mv = sum(p['shares'] * (close_on(s, d) or p['cost']) for s, p in pf['positions'].items())
        v = pf['cash'] + mv
        nav.append({'date': d, 'nav': round(v, 2), 'cash': round(pf['cash'], 2), 'invested': round(mv, 2),
                    'spy': round(INITIAL_CASH * close_on(BENCHMARK, d) / spy0, 2),
                    'qqq': round(INITIAL_CASH * close_on('QQQ', d) / qqq0, 2) if qqq0 else None})
        pf['as_of'] = d
        print(f'  {d}: 净值 {v:,.2f}')

    W(DATA / 'portfolio.json', pf)
    W(DATA / 'trades.json', trades)
    W(DATA / 'nav.json', nav)
    write_summary(pf, nav, trades)
    return 0


def write_summary(pf, nav, trades):
    d = pf['as_of']
    hold = []
    total = nav[-1]['nav'] if nav else INITIAL_CASH
    for s, p in sorted(pf['positions'].items()):
        px = close_on(s, d) if d else p['cost']
        val = p['shares'] * px
        hold.append({'symbol': s, 'shares': p['shares'], 'cost': round(p['cost'], 4), 'price': px, 'value': round(val, 2),
                     'weight': val / total, 'pnl': round((px - p['cost']) * p['shares'], 2), 'pnl_pct': px / p['cost'] - 1})
    hold.sort(key=lambda h: -h['value'])
    peak, mdd = 0, 0
    for r in nav:
        peak = max(peak, r['nav']); mdd = min(mdd, r['nav'] / peak - 1)
    pending = []
    for p in sorted((DATA / 'orders').glob('*.json')):
        b = J(p)
        if b.get('status') == 'pending':
            pending.append({'date': p.stem, 'orders': b.get('orders', [])})
    journal = sorted((p.stem for p in (DATA / 'journal').glob('20*.json')), reverse=True)
    W(DATA / 'journal' / 'index.json', journal)
    W(DATA / 'summary.json', {
        'as_of': d, 'updated_at': to_et().isoformat(timespec='minutes'), 'inception': INCEPTION, 'initial': INITIAL_CASH,
        'nav': total, 'cash': pf['cash'], 'ret': total / INITIAL_CASH - 1,
        'spy_ret': nav[-1]['spy'] / INITIAL_CASH - 1 if nav else 0,
        'day_ret': nav[-1]['nav'] / nav[-2]['nav'] - 1 if len(nav) > 1 else total / INITIAL_CASH - 1,
        'max_drawdown': mdd, 'days': len(nav), 'trades': len(trades), 'holdings': hold, 'pending': pending,
    })


if __name__ == '__main__':
    sys.exit(main())
