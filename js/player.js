// 观星者基金 · 玩家模式：用 $1,000,000 和 AI 同规则比赛。
// 账户只存在这台设备的浏览器里（localStorage）；订单在浏览器里按 data/closes.json 的收盘价结算，结果完全由「开户日 + 订单」决定，
// 所以分享链接里只需要这两样。
(function () {
  const $ = id => document.getElementById(id);
  const get = p => fetch(p, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v, d = 0) => (v < 0 ? '-$' : '$') + Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 2) => { if (Math.abs(v) < 0.5 * 10 ** -(d + 2)) v = 0; return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%'; };
  const cls = v => (v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : '');

  // 规则与 AI 一致（tools/config.py）
  const R = { cash: 1e6, slip: 0.0005, maxW: 0.2, maxOrders: 12, inception: '2026-10-16' };
  const KEY = 'stargazer.player.v1', TAB = 'stargazer.tab';
  const S = {
    me: { name: '我', color: '#8557c8', halo: '#a98be6', w: 2.4 },
    ai: { name: '观星者 AI', color: '#ffd98a', w: 1.8 },
    spy: { name: '标普500 (SPY 含分红)', color: '#3f97e6', w: 1.6 },
  };
  const CN = {
    SPY: '标普500 ETF', QQQ: '纳指100 ETF', IWM: '罗素2000 ETF', DIA: '道指 ETF', XLK: '科技板块 ETF', XLF: '金融板块 ETF', XLE: '能源板块 ETF',
    XLV: '医疗板块 ETF', XLY: '可选消费 ETF', XLP: '必需消费 ETF', XLI: '工业板块 ETF', XLU: '公用事业 ETF', XLB: '原材料 ETF', XLRE: '房地产 ETF',
    XLC: '通信服务 ETF', SMH: '半导体 ETF', TLT: '20年+美债 ETF', IEF: '7-10年美债 ETF', SHY: '1-3年短债 ETF', GLD: '黄金 ETF', SLV: '白银 ETF', USO: '原油 ETF',
    AAPL: '苹果', MSFT: '微软', NVDA: '英伟达', AMZN: '亚马逊', GOOGL: '谷歌', META: 'Meta', TSLA: '特斯拉', AVGO: '博通', 'BRK-B': '伯克希尔', JPM: '摩根大通',
    V: 'Visa', MA: '万事达', UNH: '联合健康', LLY: '礼来', XOM: '埃克森美孚', JNJ: '强生', PG: '宝洁', HD: '家得宝', COST: '好市多', ABBV: '艾伯维',
    MRK: '默沙东', PEP: '百事', KO: '可口可乐', WMT: '沃尔玛', BAC: '美国银行', CVX: '雪佛龙', ORCL: '甲骨文', CRM: '赛富时', AMD: '超威半导体', NFLX: '奈飞',
    ADBE: '奥多比', INTC: '英特尔', CSCO: '思科', QCOM: '高通', TXN: '德州仪器', IBM: 'IBM', DIS: '迪士尼', MCD: '麦当劳', CAT: '卡特彼勒', GS: '高盛',
    MS: '摩根士丹利', PLTR: 'Palantir', UBER: '优步', MU: '美光', NOW: 'ServiceNow', INTU: 'Intuit', ISRG: '直觉外科', AMAT: '应用材料', LRCX: '泛林集团', PANW: 'Palo Alto',
    SHOP: 'Shopify', COIN: 'Coinbase', BA: '波音', GE: '通用电气航天', RTX: 'RTX 雷神', NEE: '新纪元能源', LIN: '林德', TMO: '赛默飞', PFE: '辉瑞', T: 'AT&T',
  };
  const HOT = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'GLD', 'SMH'];

  // —— 美股交易日历（NYSE 休市日 / 提前收盘）。不在表里的休市日也没关系：订单会顺延到 closes.json 里下一个有收盘价的交易日 ——
  const HOLIDAYS = new Set(['2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
    '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24', '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19', '2028-07-04',
    '2028-09-04', '2028-11-23', '2028-12-25']);
  const EARLY = { '2026-11-27': 780, '2026-12-24': 780, '2027-11-26': 780, '2028-07-03': 780, '2028-11-24': 780 };
  const WD = '日一二三四五六';
  const addDay = (d, n = 1) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const wday = d => new Date(d + 'T12:00:00Z').getUTCDay();
  const dlabel = d => `${d.slice(5)}（周${WD[wday(d)]}）`;
  const isSession = d => wday(d) % 6 !== 0 && !HOLIDAYS.has(d);
  const closeMin = d => EARLY[d] || 960;
  const nextSession = d => { do d = addDay(d); while (!isSession(d)); return d; };
  function etNow() {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).map(x => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
    } catch (e) { // 极老的浏览器：按 UTC-4 粗算
      const t = new Date(Date.now() - 4 * 3600e3); return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
    }
  }
  // 现在下单，会按哪个交易日的收盘价成交
  function targetSession() {
    const n = etNow();
    let d = n.date;
    if (!(isSession(d) && n.min < closeMin(d))) d = nextSession(d);
    const last = C.dates[C.dates.length - 1];
    if (last && d <= last) d = nextSession(last);      // 本机时钟不准时，也不能下到已经有收盘价的日子
    if (d < R.inception) d = R.inception;
    return d;
  }

  // —— 数据 ——
  let C = { dates: [], c: {}, div: {}, idx: {} }, Q = { q: {} }, AI = [];
  let acct = null, view = null, shared = null, sel = null;
  const T = { side: 'buy', mode: 'v' };

  // —— 账户存取（所有读写都 try/catch：隐私模式、禁用存储时页面照样能看）——
  const SYM_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function clean(a) {
    if (!a || typeof a !== 'object' || !DATE_RE.test(a.start) || !Array.isArray(a.orders) || a.orders.length > 5000) return null;
    const orders = [];
    for (const [i, o] of a.orders.entries()) {
      if (!o || !SYM_RE.test(o.s) || !DATE_RE.test(o.d) || o.d < a.start || !['buy', 'sell'].includes(o.side) || !['v', 'n', 'a'].includes(o.m)) return null;
      const q = o.m === 'a' ? 0 : Number(o.q);
      if (o.m !== 'a' && !(q > 0 && q < 1e9 && isFinite(q))) return null;
      if (o.m === 'a' && o.side !== 'sell') return null;
      orders.push({ id: String(o.id || 'o' + i), t: Number(o.t) || i, d: o.d, s: o.s, side: o.side, m: o.m, q: o.m === 'n' ? Math.floor(q) : Math.round(q * 100) / 100 });
    }
    return { v: 1, start: a.start, orders };
  }
  function loadAcct() { try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return null; } }
  function saveAcct() {
    try { localStorage.setItem(KEY, JSON.stringify(acct)); return true; } catch (e) { toast('浏览器不允许保存数据（可能是隐私模式），刷新后账户会丢失'); return false; }
  }

  // —— 结算引擎：从开户日起逐个交易日记账，与 tools/settle.py 同规则 ——
  function lastClose(s, i) { const a = C.c[s]; if (!a) return null; for (let k = Math.min(i, a.length - 1); k >= 0; k--) if (a[k] != null) return a[k]; return null; }
  function simulate(a) {
    let cash = R.cash;
    const pos = {}, nav = [], fills = [], res = {}, divs = [];
    const orders = [...a.orders].sort((x, y) => x.t - y.t);
    const dates = C.dates.filter(d => d >= a.start);
    const byDate = {}, pending = [];
    for (const o of orders) {
      const d = dates.find(x => x >= o.d);
      if (d) (byDate[d] = byDate[d] || []).push(o); else pending.push(o);
    }
    for (const d of dates) {
      const i = C.idx[d];
      for (const [s, p] of Object.entries(pos)) {        // 除息日：按前一日收盘时的持股数入账股息
        const amt = C.div[s]?.[d];
        if (amt) { cash += p.sh * amt; divs.push({ date: d, s, sh: p.sh, per: amt, amount: p.sh * amt }); }
      }
      const px = s => lastClose(s, i);
      const navPre = cash + Object.entries(pos).reduce((t, [s, p]) => t + p.sh * (px(s) ?? p.cost), 0);
      const todays = (byDate[d] || []).slice().sort((x, y) => (x.side === 'sell' ? 0 : 1) - (y.side === 'sell' ? 0 : 1) || x.t - y.t);
      for (const o of todays) {
        const c = C.c[o.s]?.[i];
        const r = res[o.id] = { date: d, status: 'void', notes: [] };
        if (c == null) { r.notes.push('当日无收盘价，订单作废'); continue; }
        const p = pos[o.s] || { sh: 0, cost: 0 };
        if (o.side === 'sell') {
          const want = o.m === 'a' ? p.sh : o.m === 'n' ? o.q : Math.floor(o.q / c);
          const qty = Math.min(want, p.sh);
          if (qty <= 0) { r.notes.push(p.sh ? '金额不足一股' : '没有可卖持仓'); continue; }
          if (qty < want) r.notes.push(`只持有 ${p.sh} 股，全部卖出`);
          const price = c * (1 - R.slip), value = qty * price, pnl = (price - p.cost) * qty;
          cash += value; p.sh -= qty;
          if (p.sh === 0) delete pos[o.s]; else pos[o.s] = p;
          Object.assign(r, { status: 'filled', qty, price, value, pnl });
        } else {
          const price = c * (1 + R.slip);
          const want = o.m === 'n' ? o.q : Math.floor(o.q / price);
          const capW = Math.max(0, Math.floor(R.maxW * navPre / c) - p.sh), capC = Math.max(0, Math.floor(cash / price));
          const qty = Math.min(want, capW, capC);
          if (qty <= 0) { r.notes.push(want <= 0 ? '金额不足一股' : capW <= 0 ? '已达单只 20% 上限' : '现金不足'); continue; }
          if (qty < want) r.notes.push(capW < capC && capW < want ? `单只上限 20%，只买到 ${qty}/${want} 股` : `现金不足，只买到 ${qty}/${want} 股`);
          const value = qty * price;
          cash -= value;
          p.cost = (p.cost * p.sh + value) / (p.sh + qty); p.sh += qty; pos[o.s] = p;
          Object.assign(r, { status: 'filled', qty, price, value });
        }
        fills.push({ ...o, ...r });
      }
      const mv = Object.entries(pos).reduce((t, [s, p]) => t + p.sh * (px(s) ?? p.cost), 0);
      nav.push({ date: d, nav: cash + mv, cash });
    }
    return { cash, pos, nav, fills, res, pending, divs, last: dates[dates.length - 1] || null };
  }

  // 三条线：都从开户日前一个交易日收盘 = $1,000,000 起步
  function compare(a, sim) {
    const base = C.dates.filter(d => d < a.start).pop();
    if (!base || !sim.nav.length) return null;
    const rows = [{ date: base, me: R.cash, ai: R.cash, spy: R.cash }];
    const aiBy = Object.fromEntries(AI.map(r => [r.date, r.nav]));
    const aiBase = base < R.inception ? R.cash : aiBy[base];
    let spy = R.cash;
    for (const r of sim.nav) {
      const i = C.idx[r.date], c0 = lastClose('SPY', i - 1), c1 = C.c.SPY?.[i];
      if (c0 && c1) spy *= (c1 + (C.div.SPY?.[r.date] || 0)) / c0;
      rows.push({ date: r.date, me: r.nav, ai: aiBase && aiBy[r.date] != null ? aiBy[r.date] / aiBase * R.cash : null, spy });
    }
    return rows;
  }
  function stats(rows, k) {
    const v = rows.map(r => r[k]).filter(x => x != null);
    if (!v.length) return null;
    let peak = 0, mdd = 0, best = null, worst = null;
    v.forEach((x, i) => {
      peak = Math.max(peak, x); mdd = Math.min(mdd, x / peak - 1);
      if (i) { const d = x / v[i - 1] - 1; best = best == null ? d : Math.max(best, d); worst = worst == null ? d : Math.min(worst, d); }
    });
    return { last: v[v.length - 1], ret: v[v.length - 1] / R.cash - 1, mdd, best, worst };
  }
  function duel(rows, k) {
    let w = 0, l = 0, t = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (a[k] == null || b[k] == null) continue;
      const d = (b.me / a.me - 1) - (b[k] / a[k] - 1);
      if (Math.abs(d) < 1e-6) t++; else if (d > 0) w++; else l++;
    }
    return { w, l, t };
  }

  // —— 分享：开户日 + 订单 → JSON → deflate → base64url，放在 #p= 后面。不含任何个人信息 ——
  const b64 = u8 => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const pipe = async (u8, Stream) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer());
  async function encode(a) {
    const o = [...a.orders].sort((x, y) => x.t - y.t).map(o => [o.d, o.s, o.side === 'buy' ? 1 : 0, o.m, o.q]);
    const raw = new TextEncoder().encode(JSON.stringify({ v: 1, s: a.start, o }));
    try { if (window.CompressionStream) return 'z' + b64(await pipe(raw, CompressionStream)); } catch (e) { }
    return 'j' + b64(raw);
  }
  async function decode(code) {
    try {
      const u8 = unb64(code.slice(1));
      const raw = code[0] === 'z' ? await pipe(u8, DecompressionStream) : code[0] === 'j' ? u8 : null;
      const x = JSON.parse(new TextDecoder().decode(raw));
      if (x.v !== 1) return null;
      return clean({ start: x.s, orders: x.o.map((r, i) => ({ id: 'o' + i, t: i, d: r[0], s: r[1], side: r[2] ? 'buy' : 'sell', m: r[3], q: r[4] })) });
    } catch (e) { return null; }
  }

  // —— 页面切换：#ai / #play / #p=分享码 ——
  async function route() {
    const h = location.hash;
    let v = h.startsWith('#p=') ? 'shared' : h === '#play' ? 'play' : h === '#ai' ? 'ai' : null;
    if (!v) { try { v = localStorage.getItem(TAB) === 'play' ? 'play' : 'ai'; } catch (e) { v = 'ai'; } }
    if (v === 'shared') {
      shared = await decode(h.slice(3));
      if (!shared) { toast('这个分享链接无法识别，可能复制不完整'); v = 'play'; }
    } else { try { localStorage.setItem(TAB, v); } catch (e) { } }
    view = v;
    $('view-ai').hidden = v !== 'ai';
    $('view-play').hidden = v === 'ai';
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.v === (v === 'ai' ? 'ai' : 'play')));
    if (v !== 'ai') render();
    dispatchEvent(new Event('resize'));       // 让刚显示出来的图表按真实宽度重画
  }

  // —— 渲染 ——
  const quote = s => { const q = Q.q[s]; return q ? { name: q[0], price: q[1], prev: q[2], chg: q[2] ? q[1] / q[2] - 1 : null } : null; };
  const priceOf = s => quote(s)?.price ?? lastClose(s, C.dates.length - 1);
  const cnName = s => CN[s] || '';
  function render() {
    const a = view === 'shared' ? shared : acct;
    $('shared-bar').innerHTML = view === 'shared' ? `<div class="card shared"><div><b>你在看一份分享的战绩</b><span class="muted">只读 · ${dlabel(a.start)}开户 · ${a.orders.length} 笔订单 · 结算按你这边最新的收盘数据重新计算</span></div>
      <div class="btns"><button class="btn" id="imp">导入到我的账户</button><a class="btn ghost" href="#play">回到我的账户</a></div></div>` : '';
    if (view === 'shared') $('imp').onclick = importShared;
    $('open-card').hidden = !!a;
    $('play-body').hidden = !a;
    if (!a) return renderOpen();
    const ta = view === 'shared';
    $('p-chart-title').textContent = ta ? 'TA vs AI vs 大盘' : '我 vs AI vs 大盘';
    $('p-hold-title').textContent = ta ? 'TA 的持仓' : '我的持仓';
    $('p-pending-sub').textContent = ta ? '按收盘价成交' : '按收盘价成交，收盘结算前可以撤单';
    const sim = simulate(a), rows = compare(a, sim);
    renderKpis(a, sim, rows);
    renderChart(rows, a);
    renderScore(rows, sim);
    $('p-trade').hidden = $('p-account').hidden = view === 'shared';
    if (view !== 'shared') renderTrade(sim);
    renderPending(a, sim);
    renderHold(sim);
    renderFills(a, sim);
  }

  function renderOpen() {
    const d = targetSession();
    $('open-card').innerHTML = `<div class="open">
      <p class="kicker">CHALLENGE · 我来挑战</p>
      <h2>领 $1,000,000，和 AI 比一比</h2>
      <p class="sub">规则和观星者 AI 完全一样：只做多美股和 ETF，下单后按当天收盘价成交。<br class="m">每个交易日收盘后结算，看看谁的星图更亮。</p>
      <ul class="rules">
        <li>美东 16:00 前下单 → 当天收盘价成交；收盘后、周末或假日下单 → 下一个交易日收盘价成交</li>
        <li>买入价 = 收盘价 × 1.0005，卖出价 = 收盘价 × 0.9995（0.05% 滑点，零佣金）</li>
        <li>整数股；单只成交后不超过净值 20%；每个交易日最多 12 笔；现金不足按剩余现金缩量</li>
        <li>持仓在除息日自动领取分红；对比用的标普500 也按全收益计算</li>
      </ul>
      <button class="btn primary big" id="open">开户 · 领取 $1,000,000</button>
      <p class="muted">从 ${dlabel(d)} 收盘开始计分。账户只保存在这台设备的浏览器里，可以用分享链接换设备。</p></div>`;
    $('open').onclick = () => {
      acct = { v: 1, start: targetSession(), orders: [] };
      saveAcct(); render(); toast('开户成功，$1,000,000 已到账');
    };
  }

  function renderKpis(a, sim, rows) {
    const me = rows && stats(rows, 'me'), ai = rows && stats(rows, 'ai'), spy = rows && stats(rows, 'spy');
    const settled = sim.nav[sim.nav.length - 1]?.nav ?? R.cash;
    const live = sim.cash + Object.entries(sim.pos).reduce((t, [s, p]) => t + p.sh * (priceOf(s) ?? p.cost), 0);
    const dv = rows ? duel(rows, 'ai') : null;
    const k = (label, value, sub, c = '', main = '') => `<div class="kpi ${main}"><div class="label">${label}</div><div class="value ${c}">${value}</div><div class="sub2">${sub}</div></div>`;
    const ex = me && ai ? me.ret - ai.ret : null;
    $('p-kpis').innerHTML =
      k(view === 'shared' ? 'TA 的净值' : '我的净值', money(settled), sim.last ? `截至 ${sim.last.slice(5)} 收盘${Object.keys(sim.pos).length ? ' · 按最新价约 ' + money(live) : ''}` : `${dlabel(a.start)}收盘后首次结算`, '', 'main me') +
      k('累计收益', me ? pct(me.ret) : '—', me ? `同期 AI ${ai ? pct(ai.ret) : '—'} · SPY ${pct(spy.ret)}` : '等待首个交易日收盘', me ? cls(me.ret) : '') +
      k('对 AI', ex == null ? '—' : pct(ex), ex == null ? '收盘结算后比较' : ex >= 0 ? '领先观星者 AI' : '落后观星者 AI', ex == null ? '' : cls(ex)) +
      k('每日对决', dv && dv.w + dv.l + dv.t ? `${dv.w} 胜 ${dv.l} 负` : '—', dv && dv.w + dv.l + dv.t ? `对 AI · ${dv.t ? dv.t + ' 平 · ' : ''}共 ${dv.w + dv.l + dv.t} 天` : '每天收盘比谁涨得多') +
      k('现金 / 回撤', `${(sim.cash / settled * 100).toFixed(0)}%`, `最大回撤 ${me ? pct(me.mdd) : '—'}${sim.divs.length ? ' · 股息 ' + money(sim.divs.reduce((t, x) => t + x.amount, 0)) : ''}`);
  }

  function renderChart(rows, a) {
    const box = $('p-chart'), keys = ['spy', 'ai', 'me'];
    $('p-legend').innerHTML = ['me', 'ai', 'spy'].map(k => `<span><i style="background:${S[k].color}"></i>${k === 'me' && view === 'shared' ? 'TA' : S[k].name}</span>`).join('');
    $('p-chart-note').textContent = `三条线都从 ${dlabel(a.start)}的前一个交易日收盘 = $1,000,000 起步；AI 的净值按同一天重新对齐，基准按全收益（分红再投资）计算。`;
    drawChart = () => {
      if ($('view-play').hidden) return;
      if (!rows) { box.style.height = '80px'; box.innerHTML = `<div class="empty">${dlabel(a.start)}收盘结算后，这里会出现你、AI 和标普500 的三条线</div>`; return; }
      box.style.height = '';
      const W = box.clientWidth, H = box.clientHeight, m = { l: 64, r: 16, t: 12, b: 28 };
      if (!W) return;
      const vals = rows.flatMap(r => keys.map(k => r[k]).filter(v => v != null));
      let lo = Math.min(...vals), hi = Math.max(...vals);
      const pad = Math.max((hi - lo) * 0.15, 6000); lo -= pad; hi += pad;
      const X = i => m.l + (i / (rows.length - 1)) * (W - m.l - m.r);
      const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="我的净值与观星者 AI、标普500 对比"><defs><filter id="pglow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter>
        <linearGradient id="pfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${S.me.halo}" stop-opacity=".2"/><stop offset="1" stop-color="${S.me.halo}" stop-opacity="0"/></linearGradient></defs>`;
      for (const t of niceTicks(lo, hi, 5)) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${fmtK(t)}</text>`;
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(1e6)}" y2="${Y(1e6)}" stroke="rgba(255,255,255,.22)" stroke-dasharray="3 5"/>`;
      const step = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((W - m.l) / 90))));
      rows.forEach((r, i) => { if (i % step === 0 || i === rows.length - 1) svg += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" fill="var(--muted)" font-size="11">${r.date.slice(5)}</text>`; });
      for (const k of keys) {
        const ps = rows.map((r, i) => r[k] == null ? null : [X(i), Y(r[k])]).filter(Boolean);
        if (!ps.length) continue;
        const d = ps.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        if (k === 'me' && ps.length > 1) {
          svg += `<path d="${d} L${ps[ps.length - 1][0]} ${H - m.b} L${ps[0][0]} ${H - m.b} Z" fill="url(#pfill)"/>`;
          svg += `<path d="${d}" fill="none" stroke="${S.me.halo}" stroke-width="6" opacity=".4" filter="url(#pglow)"/>`;
        }
        svg += `<path d="${d}" fill="none" stroke="${S[k].color}" stroke-width="${S[k].w}" stroke-linejoin="round" stroke-linecap="round"/>`;
        const [lx, ly] = ps[ps.length - 1];
        svg += `<circle cx="${lx}" cy="${ly}" r="${k === 'me' ? 4.5 : 3.5}" fill="${S[k].color}" stroke="var(--surface)" stroke-width="2"/>`;
      }
      svg += `<line id="pxh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="rgba(255,255,255,.35)" opacity="0"/><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="phit"/></svg>`;
      box.innerHTML = svg;
      const hit = box.querySelector('#phit'), xh = box.querySelector('#pxh'), tip = $('tip');
      const show = e => {
        const r = box.getBoundingClientRect(), x = e.clientX - r.left;
        const i = Math.max(0, Math.min(rows.length - 1, Math.round((x - m.l) / (W - m.l - m.r) * (rows.length - 1)))), p = rows[i];
        xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('opacity', 1);
        tip.innerHTML = `<b>${p.date}${i === 0 ? ' · 起点' : ''}</b>` + ['me', 'ai', 'spy'].filter(k => p[k] != null).map(k =>
          `<div class="row"><span><i style="background:${S[k].color}"></i>${k === 'me' && view === 'shared' ? 'TA' : S[k].name}</span><span class="num">${money(p[k])} <span class="${cls(p[k] / 1e6 - 1)}">${pct(p[k] / 1e6 - 1)}</span></span></div>`).join('');
        tip.classList.add('on');
        const tx = r.left + X(i) + 14, tw = tip.offsetWidth;
        tip.style.left = (tx + tw > innerWidth - 8 ? r.left + X(i) - tw - 14 : tx) + 'px';
        tip.style.top = (r.top + 20) + 'px';
      };
      const hide = () => { xh.setAttribute('opacity', 0); tip.classList.remove('on'); };
      hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hide);
    };
    drawChart();
  }
  let drawChart = () => { };
  addEventListener('resize', () => drawChart());
  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw);
    const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) out.push(v); return out;
  }
  const fmtK = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + 'M' : '$' + Math.round(v / 1000) + 'K';

  function renderScore(rows, sim) {
    const el = $('p-score-body');
    if (!rows) { el.innerHTML = '<div class="empty">第一个交易日收盘结算后开始计分</div>'; return; }
    const who = view === 'shared' ? 'TA' : '我';
    const line = (k, label) => {
      const s = stats(rows, k);
      if (!s) return `<tr><td><i class="dot" style="background:${S[k].color}"></i>${label}</td><td colspan="5" class="muted">暂无数据</td></tr>`;
      return `<tr><td><i class="dot" style="background:${S[k].color}"></i>${label}</td><td>${money(s.last)}</td><td class="${cls(s.ret)}">${pct(s.ret)}</td><td class="down">${pct(s.mdd)}</td>
        <td class="hide-m ${cls(s.best)}">${s.best == null ? '—' : pct(s.best)}</td><td class="hide-m ${cls(s.worst)}">${s.worst == null ? '—' : pct(s.worst)}</td></tr>`;
    };
    const vAi = duel(rows, 'ai'), vSpy = duel(rows, 'spy');
    const tally = (v, name) => `<div class="tally"><span class="muted">${who} vs ${name}</span><b class="up">${v.w} 胜</b><b class="down">${v.l} 负</b>${v.t ? `<b>${v.t} 平</b>` : ''}</div>`;
    // 每日谁赢：当天涨得最多的那一方
    const days = rows.slice(1).map((r, j) => {
      const p = rows[j], ch = ['me', 'ai', 'spy'].filter(k => r[k] != null && p[k] != null).map(k => [k, r[k] / p[k] - 1]);
      const top = ch.reduce((a, b) => (b[1] > a[1] + 1e-9 ? b : a), ch[0]);
      return `<span class="day-dot" style="background:${S[top[0]].color}" title="${r.date} 当天最佳：${top[0] === 'me' ? who : S[top[0]].name} ${pct(top[1])}"></span>`;
    }).slice(-60).join('');
    el.innerHTML = `<table><thead><tr><th></th><th>净值</th><th>累计收益</th><th>最大回撤</th><th class="hide-m">最好一天</th><th class="hide-m">最差一天</th></tr></thead><tbody>
      ${line('me', who)}${line('ai', S.ai.name)}${line('spy', '标普500 (含分红)')}</tbody></table>
      <div class="tallies">${tally(vAi, 'AI')}${tally(vSpy, '标普500')}</div>
      <div class="days"><span class="muted">每天谁涨得最多</span><span class="dots">${days}</span></div>`;
  }

  // —— 下单 ——
  function renderTrade(sim) {
    const t = Q.updated_at ? Q.updated_at.slice(11, 16) : null;
    $('q-time').textContent = `价格延迟约 15~30 分钟${t ? ` · 更新于美东 ${Q.updated_at.slice(5, 10)} ${t}` : ''}`;
    $('chips').innerHTML = HOT.filter(s => Q.q[s]).map(s => `<button class="chip" data-s="${s}">${s}</button>`).join('');
    $('chips').querySelectorAll('.chip').forEach(b => b.onclick = () => pick(b.dataset.s));
    renderTicket(sim);
  }
  function universe() { return Object.keys(Q.q).length ? Object.keys(Q.q) : Object.keys(C.c); }
  function search(text) {
    const t = text.trim().toUpperCase();
    if (!t) return [];
    const score = s => {
      const q = Q.q[s], en = (q?.[0] || '').toUpperCase(), cn = cnName(s).toUpperCase();
      if (s === t) return 0; if (s.startsWith(t)) return 1; if (cn.includes(t)) return 2; if (en.includes(t)) return 3; if (s.includes(t)) return 4; return 9;
    };
    return universe().map(s => [s, score(s)]).filter(x => x[1] < 9).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 8).map(x => x[0]);
  }
  function showResults() {
    const list = search($('q').value), el = $('results');
    if (!$('q').value.trim()) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = list.length ? list.map((s, i) => {
      const q = quote(s);
      return `<button class="res${i === 0 ? ' hi' : ''}" data-s="${s}"><b>${s}</b><span class="nm">${esc(cnName(s))} <small>${esc(q?.name || '')}</small></span><span class="num">${q ? money(q.price, 2) : ''} ${q?.chg != null ? `<small class="${cls(q.chg)}">${pct(q.chg)}</small>` : ''}</span></button>`;
    }).join('') : '<div class="res none">观察池里没有找到。目前可以交易的是 AI 同一个观察池里的 ETF 和大盘股。</div>';
    el.querySelectorAll('.res[data-s]').forEach(b => b.onclick = () => pick(b.dataset.s));
  }
  function pick(s) {
    sel = s; $('q').value = ''; $('results').hidden = true;
    T.side = 'buy'; T.mode = 'v'; T.amt = null;
    render();
    $('ticket').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function projected(sim) {
    // 估算挂单全部成交后的现金和持股（按最新价）
    let cash = sim.cash; const sh = Object.fromEntries(Object.entries(sim.pos).map(([s, p]) => [s, p.sh]));
    for (const o of sim.pending) {
      const px = priceOf(o.s); if (!px) continue;
      if (o.side === 'sell') { const q = Math.min(sh[o.s] || 0, o.m === 'a' ? sh[o.s] || 0 : o.m === 'n' ? o.q : Math.floor(o.q / px)); sh[o.s] = (sh[o.s] || 0) - q; cash += q * px * (1 - R.slip); }
      else { const q = o.m === 'n' ? o.q : Math.floor(o.q / (px * (1 + R.slip))); sh[o.s] = (sh[o.s] || 0) + q; cash -= q * px * (1 + R.slip); }
    }
    const nav = sim.cash + Object.entries(sim.pos).reduce((t, [s, p]) => t + p.sh * (priceOf(s) ?? p.cost), 0);
    return { cash, sh, nav };
  }
  function renderTicket(sim) {
    const el = $('ticket');
    if (!sel) { el.innerHTML = '<p class="muted hint">搜索或点上面的代码，选一个标的开始下单。</p>'; return; }
    const q = quote(sel), px = priceOf(sel), held = sim.pos[sel]?.sh || 0, pr = projected(sim);
    const d = targetSession(), nToday = acct.orders.filter(o => o.d === d).length;
    if (T.side === 'buy' && T.mode === 'a') T.mode = 'v';
    const seg = (name, opts, cur) => `<div class="seg" data-k="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}${name === 'side' ? ' ' + v : ''}">${l}</button>`).join('')}</div>`;
    const quick = T.side === 'buy'
      ? [['v', 10000, '$1万'], ['v', 50000, '$5万'], ['v', 100000, '$10万'], ['max', 0, '上限']]
      : [['frac', 0.25, '1/4'], ['frac', 0.5, '一半'], ['a', 0, '全部']];
    el.innerHTML = `<div class="tk-head"><div><b class="tk-sym">${sel}</b> <span>${esc(cnName(sel))}</span><div class="muted">${esc(q?.name || '')}</div></div>
        <div class="tk-px"><span class="num">${px ? money(px, 2) : '—'}</span>${q?.chg != null ? ` <small class="${cls(q.chg)}">${pct(q.chg)}</small>` : ''}<div class="muted">${held ? `持有 ${held} 股` : '未持有'}</div></div></div>
      <div class="tk-row">${seg('side', [['buy', '买入'], ['sell', '卖出']], T.side)}
        ${seg('mode', T.side === 'buy' ? [['v', '按金额'], ['n', '按股数']] : [['v', '按金额'], ['n', '按股数'], ['a', '全部']], T.mode)}</div>
      <div class="tk-row"><label class="amt ${T.mode === 'a' ? 'off' : ''}"><span>${T.mode === 'n' ? '股' : '$'}</span><input id="amt" type="number" inputmode="${T.mode === 'n' ? 'numeric' : 'decimal'}" min="0" step="${T.mode === 'n' ? 1 : 100}" placeholder="${T.mode === 'n' ? '股数' : '金额（美元）'}" ${T.mode === 'a' ? 'disabled' : ''}></label>
        <div class="quick">${quick.map(([k, v, l]) => `<button class="chip" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="est" id="est"></div>
      <button class="btn primary big" id="place">${T.side === 'buy' ? '挂买单' : '挂卖单'} · 按 ${dlabel(d)}收盘价成交</button>
      <p class="muted when">美东 16:00 前下单按当天收盘价成交；收盘后、周末或假日下单按下一个交易日收盘价成交。${dlabel(d)}已下 ${nToday}/${R.maxOrders} 笔。</p>`;
    const amt = $('amt');
    if (T.amt != null && T.mode !== 'a') amt.value = T.amt;
    el.querySelectorAll('.seg').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => {
      T[g.dataset.k] = b.dataset.v;
      if (g.dataset.k === 'side') T.mode = 'v';
      T.amt = null; renderTicket(sim);
    }));
    el.querySelectorAll('.quick .chip').forEach(b => b.onclick = () => {
      const k = b.dataset.k, v = +b.dataset.v;
      if (k === 'a') { T.mode = 'a'; T.amt = null; return renderTicket(sim); }
      if (k === 'frac') { T.mode = 'n'; T.amt = Math.floor(held * v); return renderTicket(sim); }
      if (k === 'max') {
        const room = Math.max(0, Math.floor(R.maxW * pr.nav / px) - (pr.sh[sel] || 0)), byCash = Math.max(0, Math.floor(pr.cash / (px * (1 + R.slip))));
        T.mode = 'n'; T.amt = Math.min(room, byCash); return renderTicket(sim);
      }
      T.mode = 'v'; T.amt = v; renderTicket(sim);
    });
    const upd = () => { T.amt = amt.value === '' ? null : +amt.value; estimate(sim, pr); };
    amt.oninput = upd;
    amt.onkeydown = e => { if (e.key === 'Enter') place(sim); };
    $('place').onclick = () => place(sim);
    estimate(sim, pr);
  }
  function orderFromTicket() {
    const q = T.mode === 'a' ? 0 : Number(T.amt);
    if (T.mode !== 'a' && !(q > 0 && isFinite(q))) return { err: T.mode === 'n' ? '请输入股数' : '请输入金额' };
    if (T.mode === 'n' && !Number.isInteger(q)) return { err: '股数必须是整数（不支持碎股）' };
    return { o: { s: sel, side: T.side, m: T.mode, q: T.mode === 'n' ? q : Math.round(q * 100) / 100 } };
  }
  function estimate(sim, pr) {
    const el = $('est'), px = priceOf(sel), { o, err } = orderFromTicket();
    if (err || !px) { el.innerHTML = `<span class="muted">${px ? '输入后显示预计成交（按最新价估算，实际按收盘价）' : '暂时没有这个标的的价格'}</span>`; return; }
    const warn = [];
    const have = pr.sh[sel] || 0;
    let qty, price, value;
    if (o.side === 'buy') {
      price = px * (1 + R.slip); qty = o.m === 'n' ? o.q : Math.floor(o.q / price); value = qty * price;
      if (qty < 1) warn.push('金额不足一股');
      if (value > pr.cash + 1) warn.push(`可用现金约 ${money(Math.max(0, pr.cash))}（已扣除挂单），成交时会按剩余现金缩量`);
      const w = (have + qty) * px / pr.nav;
      if (w > R.maxW + 1e-9) warn.push(`成交后约占净值 ${(w * 100).toFixed(1)}%，超过 20% 上限，成交时会缩量到 20%`);
      el.innerHTML = `预计 <b>${qty}</b> 股 × ${money(price, 2)} ≈ <b>${money(value)}</b> · 成交后约占 ${(Math.min(w, R.maxW) * 100).toFixed(1)}%`;
    } else {
      price = px * (1 - R.slip); const want = o.m === 'a' ? have : o.m === 'n' ? o.q : Math.floor(o.q / px);
      qty = Math.min(want, have); value = qty * price;
      if (!have) warn.push('目前没有可卖持仓（包括挂单中的买入）');
      else if (want > have) warn.push(`只持有 ${have} 股，成交时全部卖出`);
      const cost = sim.pos[sel]?.cost;
      el.innerHTML = `预计卖出 <b>${qty}</b> 股 × ${money(price, 2)} ≈ <b>${money(value)}</b>${cost ? ` · 盈亏约 <span class="${cls(price - cost)}">${money((price - cost) * qty)}</span>` : ''}`;
    }
    if (warn.length) el.innerHTML += `<div class="warn">${warn.map(esc).join('<br>')}</div>`;
  }
  function place(sim) {
    const { o, err } = orderFromTicket();
    if (err) return toast(err);
    const d = targetSession(), pr = projected(sim);
    if (acct.orders.filter(x => x.d === d).length >= R.maxOrders) return toast(`${dlabel(d)}已经下了 ${R.maxOrders} 笔，达到每日上限`);
    if (o.side === 'sell' && !(pr.sh[sel] > 0)) return toast('没有可卖的持仓');
    if (o.side === 'buy' && o.m === 'v' && o.q < priceOf(sel) * (1 + R.slip)) return toast('金额不足一股');
    acct.orders.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), d, ...o });
    if (!saveAcct()) { acct.orders.pop(); return; }
    T.amt = null;
    toast(`已挂单：${o.side === 'buy' ? '买入' : '卖出'} ${o.s}，按 ${dlabel(d)}收盘价成交`);
    render();
  }

  function orderText(o) { return o.m === 'a' ? '全部' : o.m === 'n' ? `${o.q} 股` : `约 ${money(o.q)}`; }
  function renderPending(a, sim) {
    const el = $('p-pending-body'), now = targetSession();
    $('p-pending').hidden = !sim.pending.length;
    el.innerHTML = `<div class="orders">` + sim.pending.map(o => {
      const closed = now > o.d;     // 那个交易日已经收盘，等收盘数据结算
      const canCancel = view !== 'shared' && !closed;
      return `<div class="order"><span class="side ${o.side}">${o.side === 'buy' ? '买入' : '卖出'}</span><span class="sym">${esc(o.s)} <small class="muted">${esc(cnName(o.s))}</small></span>
        <span class="amt">${orderText(o)}</span><div class="why">${closed ? `${dlabel(o.d)}已收盘，等待收盘数据结算（约美东 18:20）` : `挂单中 · 将按 ${dlabel(o.d)}收盘价成交`}${canCancel ? ` <button class="link" data-id="${esc(o.id)}">撤单</button>` : ''}</div></div>`;
    }).join('') + '</div>';
    el.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => {
      const i = acct.orders.findIndex(o => o.id === b.dataset.id);
      if (i < 0) return;
      const [o] = acct.orders.splice(i, 1);
      if (!saveAcct()) { acct.orders.splice(i, 0, o); return; }
      toast(`已撤单：${o.s}`); render();
    });
  }
  function renderHold(sim) {
    const navNow = sim.cash + Object.entries(sim.pos).reduce((t, [s, p]) => t + p.sh * (priceOf(s) ?? p.cost), 0);
    $('p-hold-asof').textContent = Object.keys(sim.pos).length ? '现价为最新延迟行情' : '';
    const hs = Object.entries(sim.pos).map(([s, p]) => { const px = priceOf(s) ?? p.cost; return { s, ...p, px, val: p.sh * px }; }).sort((a, b) => b.val - a.val);
    if (!hs.length) { $('p-holdings').innerHTML = `<div class="empty">目前全部为现金 · ${money(sim.cash)}</div>`; return; }
    const rows = hs.map(h => `<tr${view !== 'shared' ? ` class="pick" data-s="${h.s}"` : ''}><td><b>${esc(h.s)}</b></td><td class="hide-m">${h.sh}</td><td class="hide-m">${money(h.cost, 2)}</td><td>${money(h.px, 2)}</td>
      <td>${money(h.val)}</td><td><span class="wbar me" style="width:${Math.max(2, h.val / navNow * 160)}px"></span>${(h.val / navNow * 100).toFixed(1)}%</td><td class="${cls(h.px / h.cost - 1)}">${pct(h.px / h.cost - 1)}</td></tr>`).join('');
    $('p-holdings').innerHTML = `<table><thead><tr><th>代码</th><th class="hide-m">股数</th><th class="hide-m">成本</th><th>现价</th><th>市值</th><th>占比</th><th>盈亏</th></tr></thead><tbody>${rows}
      <tr><td>现金</td><td class="hide-m"></td><td class="hide-m"></td><td></td><td>${money(sim.cash)}</td><td><span class="wbar me" style="width:${Math.max(2, sim.cash / navNow * 160)}px;opacity:.35"></span>${(sim.cash / navNow * 100).toFixed(1)}%</td><td></td></tr></tbody></table>`;
    $('p-holdings').querySelectorAll('tr.pick').forEach(tr => tr.onclick = () => pick(tr.dataset.s));
  }
  function renderFills(a, sim) {
    const done = a.orders.filter(o => sim.res[o.id]).map(o => ({ o, r: sim.res[o.id] })).sort((x, y) => y.r.date.localeCompare(x.r.date) || y.o.t - x.o.t);
    $('p-trade-count').textContent = done.length ? `共 ${done.filter(x => x.r.status === 'filled').length} 笔成交` : '';
    if (!done.length) { $('p-trades').innerHTML = '<div class="empty">还没有成交</div>'; return; }
    $('p-trades').innerHTML = `<table><thead><tr><th>日期</th><th>方向</th><th>代码</th><th>股数</th><th class="hide-m">成交价</th><th>金额</th></tr></thead><tbody>` + done.map(({ o, r }) =>
      r.status === 'filled'
        ? `<tr><td>${r.date.slice(5)}</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? '买' : '卖'}</td><td><b>${esc(o.s)}</b></td><td>${r.qty}</td><td class="hide-m">${money(r.price, 2)}</td><td>${money(r.value)}${r.pnl != null ? `<div class="${cls(r.pnl)} small">${r.pnl >= 0 ? '+' : ''}${money(r.pnl)}</div>` : ''}</td></tr>${r.notes.length ? `<tr class="note-row"><td></td><td colspan="5">${r.notes.map(esc).join('；')}</td></tr>` : ''}`
        : `<tr class="void"><td>${r.date.slice(5)}</td><td>${o.side === 'buy' ? '买' : '卖'}</td><td><b>${esc(o.s)}</b></td><td colspan="3" class="void-note">未成交 · ${r.notes.map(esc).join('；')}</td></tr>`).join('') + '</tbody></table>' +
      (sim.divs.length ? `<p class="note">股息：${sim.divs.slice(-6).reverse().map(x => `${x.date.slice(5)} ${esc(x.s)} ${money(x.amount, 2)}`).join(' · ')}</p>` : '');
  }

  // —— 分享 / 导入 / 重置 ——
  async function share() {
    const url = location.href.split('#')[0] + '#p=' + await encode(acct);
    $('share-out').hidden = false;
    $('share-url').value = url;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { }
    if (!ok) { $('share-url').focus(); $('share-url').select(); }
    toast(ok ? '链接已复制，发给朋友看看你的战绩吧' : '请手动复制下面的链接');
  }
  function importShared() {
    if (acct && acct.orders.length && !confirm(`导入会覆盖这台设备上现有的账户（${acct.orders.length} 笔订单），确定吗？`)) return;
    acct = clean(shared);
    if (!saveAcct()) return;
    toast('已导入到我的账户');
    location.hash = '#play';
  }
  function reset() {
    if (!confirm('重置后，这台设备上的账户和所有订单都会清空（分享出去的链接不受影响）。确定吗？')) return;
    try { localStorage.removeItem(KEY); } catch (e) { }
    acct = null; sel = null; render();
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 3200);
  }

  async function init() {
    const [c, q, n] = await Promise.all([get('data/closes.json'), get('data/quotes.json'), get('data/nav.json')]);
    if (c && Array.isArray(c.dates)) { C = { dates: c.dates, c: c.c || {}, div: c.div || {}, idx: Object.fromEntries(c.dates.map((d, i) => [d, i])) }; }
    if (q && q.q) Q = q;
    AI = Array.isArray(n) ? n : [];
    acct = loadAcct();
    $('q').addEventListener('input', showResults);
    $('q').addEventListener('keydown', e => {
      if (e.key === 'Enter') { const r = search($('q').value); if (r.length) pick(r[0]); }
      if (e.key === 'Escape') { $('q').value = ''; $('results').hidden = true; }
    });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) $('results').hidden = true; });
    $('share').onclick = share;
    $('reset').onclick = reset;
    $('copy').onclick = async () => { try { await navigator.clipboard.writeText($('share-url').value); toast('已复制'); } catch (e) { $('share-url').select(); } };
    addEventListener('hashchange', route);
    route();
  }
  init();
})();
