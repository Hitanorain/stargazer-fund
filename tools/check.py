"""AI 下单前的检查：校验当日日志 / 订单格式、决策节奏和风控，估算成交后的仓位。

节奏：每周一次决策（日志 kind = "weekly"），在决策日（周五）或补做上周漏掉的决策时使用；
其余交易日写观察日志（kind = "daily"），只允许执行事先写好的止损 / 减仓条件（只卖不买，笔数有上限）。
订单一律 "fill": "next_close"：下一个交易日收盘价成交。

python tools/check.py [YYYY-MM-DD]     默认检查今天（美东）的 data/orders/<日期>.json 和 data/journal/<日期>.json
退出码非 0 表示有错误，必须修正后再提交。
"""
import json, sys, datetime as dt
from config import DATA, MAX_WEIGHT, MAX_ORDERS, MAX_RISK_ORDERS, DECISION_WEEKDAY, SLIPPAGE, to_et

d = sys.argv[1] if len(sys.argv) > 1 else to_et().date().isoformat()
errs, warns = [], []
J = lambda p: json.loads(p.read_text(encoding='utf-8'))

snap = J(DATA / 'snapshot.json')
pf = J(DATA / 'portfolio.json') if (DATA / 'portfolio.json').exists() else {'cash': 1_000_000.0, 'positions': {}}
px = {s: x['last'] for s, x in snap['symbols'].items()}

WEEKDAYS = '一二三四五六日'
day = dt.date.fromisoformat(d)


def weekly_within(days):
    """d 之前 days 天内（不含 d）是否已经有周决策日志"""
    for k in range(1, days + 1):
        p = DATA / 'journal' / f'{(day - dt.timedelta(days=k)).isoformat()}.json'
        if p.exists() and J(p).get('kind') == 'weekly':
            return True
    return False


kind = 'daily'
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
    kind = j.get('kind')
    if kind not in ('weekly', 'daily'):
        errs.append('日志 kind 必须是 "weekly"（每周决策）或 "daily"（日常观察）')
    elif kind == 'weekly' and day.weekday() != DECISION_WEEKDAY and weekly_within(6):
        errs.append(f'今天是周{WEEKDAYS[day.weekday()]}，不是决策日（周{WEEKDAYS[DECISION_WEEKDAY]}），而且最近 6 天内已有周决策；日常日志请用 kind = "daily"')
    elif kind == 'daily' and day.weekday() == DECISION_WEEKDAY:
        warns.append('今天是周决策日，日志 kind 一般应为 "weekly"')
    elif kind == 'daily' and not weekly_within(9):
        warns.append('最近一周多没有周决策（可能上周五的运行失败了），今天可以用 kind = "weekly" 补做')
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
    if book.get('fill') != 'next_close':
        errs.append('订单必须写 "fill": "next_close"（下一个交易日收盘价成交）')
    orders = book.get('orders', [])
if kind == 'weekly' and len(orders) > MAX_ORDERS:
    errs.append(f'订单 {len(orders)} 笔，超过上限 {MAX_ORDERS}')
if kind != 'weekly' and orders:
    if len(orders) > MAX_RISK_ORDERS:
        errs.append(f'非决策日最多 {MAX_RISK_ORDERS} 笔订单，现在 {len(orders)} 笔')
    if any(o.get('side') != 'sell' for o in orders):
        errs.append('非决策日只能卖出（执行事先写好的止损 / 减仓条件），买入留到周决策')

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

if snap.get('session_date') and snap['session_date'] < d:
    warns.append(f'快照停在 {snap["session_date"]}（生成于 {snap["generated_at"]}），不是 {d} 的收盘数据，请在日志里注明')
print(f'估算（按快照价 {snap["generated_at"]}，下一个交易日收盘成交价会不同）：净值 ${nav:,.0f}  成交后现金 ${cash:,.0f} ({cash / nav:.1%})')
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
