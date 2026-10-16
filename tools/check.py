"""AI 下单前的检查：校验当日订单格式和风控，估算成交后的仓位。

python tools/check.py [YYYY-MM-DD]     默认检查今天（美东）的 data/orders/<日期>.json 和 data/journal/<日期>.json
退出码非 0 表示有错误，必须修正后再提交。
"""
import json, sys
from config import DATA, MAX_WEIGHT, MAX_ORDERS, SLIPPAGE, to_et

d = sys.argv[1] if len(sys.argv) > 1 else to_et().date().isoformat()
errs, warns = [], []
J = lambda p: json.loads(p.read_text(encoding='utf-8'))

snap = J(DATA / 'snapshot.json')
pf = J(DATA / 'portfolio.json') if (DATA / 'portfolio.json').exists() else {'cash': 1_000_000.0, 'positions': {}}
px = {s: x['last'] for s, x in snap['symbols'].items()}

jp = DATA / 'journal' / f'{d}.json'
if not jp.exists():
    errs.append(f'缺少日志 {jp.name}')
else:
    j = J(jp)
    for k in ('date', 'headline', 'mood', 'market', 'thinking', 'news', 'watch'):
        if k not in j:
            errs.append(f'日志缺少字段 {k}')
    if j.get('date') != d:
        errs.append('日志 date 与文件名不一致')
    for n in j.get('news', []):
        if not n.get('title') or not n.get('url'):
            errs.append(f'新闻条目需要 title 和 url: {n}')

op = DATA / 'orders' / f'{d}.json'
orders = []
if op.exists():
    book = J(op)
    if book.get('date') != d:
        errs.append('订单 date 与文件名不一致')
    if book.get('status') != 'pending':
        errs.append('新订单的 status 必须是 "pending"')
    orders = book.get('orders', [])
if len(orders) > MAX_ORDERS:
    errs.append(f'订单 {len(orders)} 笔，超过上限 {MAX_ORDERS}')

nav = pf['cash'] + sum(p['shares'] * px.get(s, p['cost']) for s, p in pf['positions'].items())
cash = pf['cash']
hold = {s: p['shares'] for s, p in pf['positions'].items()}
for o in sorted(orders, key=lambda o: o.get('side') != 'sell'):
    s, side = str(o.get('symbol', '')).upper(), o.get('side')
    if side not in ('buy', 'sell'):
        errs.append(f'{s}: side 必须是 buy 或 sell'); continue
    if s not in px:
        errs.append(f'{s}: 不在快照里（先加进 data/watchlist.json 并重新运行 fetch.py）'); continue
    if not o.get('reason'):
        errs.append(f'{s}: 每笔订单都要写 reason')
    has_sh, has_val = o.get('shares') is not None, o.get('value') is not None
    if has_sh == has_val:
        errs.append(f'{s}: shares 和 value 必须二选一'); continue
    p = px[s]
    if side == 'sell':
        q = hold.get(s, 0) if o.get('shares') == 'all' else int(o['shares']) if has_sh else int(o['value'] // p)
        if q > hold.get(s, 0):
            errs.append(f'{s}: 卖出 {q} 股，但只持有 {hold.get(s, 0)} 股')
            q = hold.get(s, 0)
        hold[s] = hold.get(s, 0) - q
        cash += q * p * (1 - SLIPPAGE)
    else:
        if o.get('shares') == 'all':
            errs.append(f'{s}: 买入不能用 "all"'); continue
        q = int(o['shares']) if has_sh else int(o['value'] // (p * (1 + SLIPPAGE)))
        cost = q * p * (1 + SLIPPAGE)
        if cost > cash + 1:
            errs.append(f'{s}: 预计需要 ${cost:,.0f}，现金只剩 ${cash:,.0f}')
        cash -= cost
        hold[s] = hold.get(s, 0) + q

print(f'估算（按快照价 {snap["generated_at"]}，收盘成交价会不同）：净值 ${nav:,.0f}  成交后现金 ${cash:,.0f} ({cash / nav:.1%})')
for s, q in sorted(hold.items(), key=lambda kv: -kv[1] * px.get(kv[0], 0)):
    if q <= 0:
        continue
    w = q * px[s] / nav
    flag = '  ← 超过单只上限' if w > MAX_WEIGHT + 0.005 else ''
    print(f'  {s:6} {q:>8} 股  ${q * px[s]:>12,.0f}  {w:6.1%}{flag}')
    if flag:
        errs.append(f'{s}: 成交后占比 {w:.1%}，超过 {MAX_WEIGHT:.0%}')
if cash < -1:
    errs.append('成交后现金为负')

for w in warns:
    print('提醒:', w)
for e in errs:
    print('错误:', e)
print('OK' if not errs else f'{len(errs)} 个错误')
sys.exit(1 if errs else 0)
