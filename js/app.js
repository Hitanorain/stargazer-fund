// 观星者基金：读取 data/*.json，渲染指标、净值图、日志、持仓、交易
(function () {
  const $ = id => document.getElementById(id);
  const get = p => fetch(p, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v, d = 0) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 2) => (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
  const cls = v => (v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : '');
  const SERIES = [
    { key: 'nav', name: '观星者基金', color: getComputedStyle(document.documentElement).getPropertyValue('--fund').trim(), glow: '#ffd98a', w: 2.4 },
    { key: 'spy', name: '标普500 (SPY)', color: '#3f97e6', w: 1.6 },
    { key: 'qqq', name: '纳指100 (QQQ)', color: '#d65f95', w: 1.6 },
  ];

  stars();
  load();

  async function load() {
    const [sum, nav, trades, idx] = await Promise.all([get('data/summary.json'), get('data/nav.json'), get('data/trades.json'), get('data/journal/index.json')]);
    renderKpis(sum, nav || []);
    renderChart(nav || []);
    renderHoldings(sum);
    renderTrades(trades || []);
    const days = idx || [];
    const journals = await Promise.all(days.map(d => Promise.all([get(`data/journal/${d}.json`), get(`data/orders/${d}.json`)])));
    const navBy = Object.fromEntries((nav || []).map((r, i, a) => [r.date, i ? r.nav / a[i - 1].nav - 1 : r.nav / (sum?.initial || 1e6) - 1]));
    renderToday(journals[0], sum);
    renderJournal(journals, navBy);
  }

  function renderKpis(s, nav) {
    if (!s) { $('kpis').innerHTML = '<div class="kpi main"><div class="label">基金净值</div><div class="value">$1,000,000</div><div class="sub2">等待第一个交易日结算</div></div>'; return; }
    const ex = s.ret - s.spy_ret;
    const k = (label, value, sub, c = '', main = '') => `<div class="kpi ${main}"><div class="label">${label}</div><div class="value ${c}">${value}</div><div class="sub2">${sub}</div></div>`;
    $('kpis').innerHTML =
      k('基金净值', money(s.nav), s.as_of ? `截至 ${s.as_of} 收盘 · 初始 ${money(s.initial)}` : '今天收盘后完成首次结算', '', 'main') +
      k('累计收益', pct(s.ret), `同期 SPY ${pct(s.spy_ret)}`, cls(s.ret)) +
      k('跑赢大盘', pct(ex), ex >= 0 ? '领先标普500' : '落后标普500', cls(ex)) +
      k('最近一日', pct(s.day_ret), `运行 ${s.days} 个交易日`, cls(s.day_ret)) +
      k('现金 / 回撤', `${(s.cash / s.nav * 100).toFixed(0)}%`, `最大回撤 ${pct(s.max_drawdown)}`);
  }

  // —— 净值图（SVG，单一纵轴，三条线都以 $1,000,000 起点对齐）——
  function renderChart(nav) {
    $('legend').innerHTML = SERIES.map(s => `<span><i style="background:${s.key === 'nav' ? s.glow : s.color}"></i>${s.name}</span>`).join('');
    const box = $('chart');
    const draw = () => {
      const W = box.clientWidth, H = box.clientHeight, m = { l: 64, r: 16, t: 12, b: 28 };
      if (!nav.length) { box.innerHTML = '<div class="empty">第一个交易日收盘后，这里会出现净值曲线</div>'; box.style.height = '80px'; return; }
      const pts = nav.length === 1 ? [{ ...nav[0], date: nav[0].date }] : nav;
      const vals = pts.flatMap(r => SERIES.map(s => r[s.key]).filter(v => v != null));
      let lo = Math.min(...vals, 1e6), hi = Math.max(...vals, 1e6);
      const pad = Math.max((hi - lo) * 0.15, 6000); lo -= pad; hi += pad;
      const X = i => m.l + (pts.length === 1 ? (W - m.l - m.r) / 2 : (i / (pts.length - 1)) * (W - m.l - m.r));
      const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
      const ticks = niceTicks(lo, hi, 5);
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="基金净值与标普500、纳指100对比">`;
      svg += `<defs><filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98a" stop-opacity=".18"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></linearGradient></defs>`;
      for (const t of ticks) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${fmtK(t)}</text>`;
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(1e6)}" y2="${Y(1e6)}" stroke="rgba(255,255,255,.22)" stroke-dasharray="3 5"/>`;
      const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor((W - m.l) / 90))));
      pts.forEach((r, i) => { if (i % step === 0 || i === pts.length - 1) svg += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" fill="var(--muted)" font-size="11">${r.date.slice(5)}</text>`; });
      // 先画基准，最后画基金（在最上层）
      for (const s of [...SERIES].reverse()) {
        const ps = pts.map((r, i) => r[s.key] == null ? null : [X(i), Y(r[s.key])]).filter(Boolean);
        if (!ps.length) continue;
        const d = ps.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        if (s.key === 'nav' && ps.length > 1) {
          svg += `<path d="${d} L${ps[ps.length - 1][0]} ${H - m.b} L${ps[0][0]} ${H - m.b} Z" fill="url(#fill)"/>`;
          svg += `<path d="${d}" fill="none" stroke="${s.glow}" stroke-width="6" opacity=".35" filter="url(#glow)"/>`;
        }
        svg += `<path d="${d}" fill="none" stroke="${s.key === 'nav' ? s.glow : s.color}" stroke-width="${s.w}" stroke-linejoin="round" stroke-linecap="round"/>`;
        const [lx, ly] = ps[ps.length - 1];
        svg += `<circle cx="${lx}" cy="${ly}" r="${s.key === 'nav' ? 4.5 : 3.5}" fill="${s.key === 'nav' ? s.glow : s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      }
      svg += `<line id="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="rgba(255,255,255,.35)" opacity="0"/>`;
      svg += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="hit"/></svg>`;
      box.innerHTML = svg;
      const hit = box.querySelector('#hit'), xh = box.querySelector('#xh'), tip = $('tip');
      const show = e => {
        const r = box.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const i = pts.length === 1 ? 0 : Math.max(0, Math.min(pts.length - 1, Math.round((x - m.l) / (W - m.l - m.r) * (pts.length - 1))));
        const p = pts[i];
        xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('opacity', 1);
        tip.innerHTML = `<b>${p.date}</b>` + SERIES.filter(s => p[s.key] != null).map(s =>
          `<div class="row"><span><i style="background:${s.key === 'nav' ? s.glow : s.color}"></i>${s.name}</span><span class="num">${money(p[s.key])} <span class="${cls(p[s.key] / 1e6 - 1)}">${pct(p[s.key] / 1e6 - 1)}</span></span></div>`).join('');
        tip.classList.add('on');
        const tx = r.left + X(i) + 14, tw = tip.offsetWidth;
        tip.style.left = (tx + tw > innerWidth - 8 ? r.left + X(i) - tw - 14 : tx) + 'px';
        tip.style.top = (r.top + 20) + 'px';
      };
      const hide = () => { xh.setAttribute('opacity', 0); tip.classList.remove('on'); };
      hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hide);
    };
    draw();
    addEventListener('resize', draw);
    $('chart-note').textContent = nav.length < 5 ? `基金从 ${nav[0]?.date || '2026-10-16'} 开始运行，曲线会随着交易日一天天变长。三条线都按 $1,000,000 起点对齐。` : '三条线都按 $1,000,000 起点对齐，便于直接比较。';
  }
  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw);
    const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) out.push(v); return out;
  }
  const fmtK = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 3).replace(/0+$/, '').replace(/\.$/, '') + 'M' : '$' + Math.round(v / 1000) + 'K';

  function ordersHtml(book) {
    if (!book || !book.orders || !book.orders.length) return '<p class="status">今天没有下单，继续持有观察。</p>';
    const fills = Object.fromEntries((book.fills || []).map(f => [f.symbol + f.side, f]));
    const st = { pending: '挂单中 · 按今天收盘价成交', filled: '已按收盘价成交', expired: '已作废' }[book.status] || book.status;
    return `<p class="status">${st}</p><div class="orders">` + book.orders.map(o => {
      const f = fills[o.symbol + o.side];
      const amt = f ? `${f.shares} 股 × ${money(f.price, 2)} = ${money(f.value)}` : o.value != null ? `约 ${money(o.value)}` : o.shares === 'all' ? '全部' : `${o.shares} 股`;
      return `<div class="order"><span class="side ${o.side}">${o.side === 'buy' ? '买入' : '卖出'}</span><span class="sym">${esc(o.symbol)}</span><span class="amt">${amt}${f && f.pnl != null ? ` · <span class="${cls(f.pnl)}">${f.pnl >= 0 ? '+' : ''}${money(f.pnl)}</span>` : ''}</span><div class="why">${esc(o.reason)}</div></div>`;
    }).join('') + (book.notes?.length ? `<p class="status">${book.notes.map(esc).join('；')}</p>` : '') + '</div>';
  }
  const paras = t => esc(t).split(/\n+/).filter(Boolean).map(p => `<p>${p}</p>`).join('');
  function entryBody(j, book) {
    return `<div class="prose">${paras(j.market)}</div>
      <div class="section-label">思考</div><div class="prose">${paras(j.thinking)}</div>
      <div class="section-label">交易</div>${ordersHtml(book)}
      ${j.news?.length ? `<div class="section-label">参考新闻</div><ul class="news">${j.news.map(n => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <small>${esc(n.source || '')}</small></li>`).join('')}</ul>` : ''}
      ${j.watch?.length ? `<div class="section-label">接下来关注</div><ul class="watch">${j.watch.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
  }
  function renderToday(pair, s) {
    if (!pair || !pair[0]) { $('today').innerHTML = '<div class="empty">第一篇交易日志即将出现</div>'; return; }
    const [j, book] = pair;
    $('today').innerHTML = `<div class="date">${j.date} · ${esc(j.written_at || '')} · 最新交易日志</div>
      <h2 class="headline">${esc(j.headline)}<span class="mood" data-m="${esc(j.mood)}">${esc(j.mood)}</span></h2>${entryBody(j, book)}`;
  }
  function renderJournal(list, navBy) {
    const items = list.filter(p => p[0]).slice(1);
    $('journal').innerHTML = items.length ? items.map(([j, book]) => {
      const r = navBy[j.date];
      return `<details class="day"><summary><span class="d">${j.date}</span><span class="h">${esc(j.headline)} <span class="mood" data-m="${esc(j.mood)}">${esc(j.mood)}</span></span>${r != null ? `<span class="r ${cls(r)}">${pct(r)}</span>` : ''}</summary><div class="body">${entryBody(j, book)}</div></details>`;
    }).join('') : '<div class="empty">更早的日志会按日期排在这里</div>';
  }

  function renderHoldings(s) {
    $('hold-asof').textContent = s?.as_of ? `截至 ${s.as_of} 收盘` : '';
    if (!s || !s.holdings.length) { $('holdings').innerHTML = `<div class="empty">目前全部为现金${s ? ' · ' + money(s.cash) : ''}</div>`; return; }
    const rows = s.holdings.map(h => `<tr><td><b>${esc(h.symbol)}</b></td><td class="hide-m">${h.shares}</td><td class="hide-m">${money(h.cost, 2)}</td><td>${money(h.price, 2)}</td>
      <td>${money(h.value)}</td><td><span class="wbar" style="width:${Math.max(2, h.weight * 160)}px"></span>${(h.weight * 100).toFixed(1)}%</td><td class="${cls(h.pnl_pct)}">${pct(h.pnl_pct)}</td></tr>`).join('');
    $('holdings').innerHTML = `<table><thead><tr><th>代码</th><th class="hide-m">股数</th><th class="hide-m">成本</th><th>现价</th><th>市值</th><th>占比</th><th>盈亏</th></tr></thead><tbody>${rows}
      <tr><td>现金</td><td class="hide-m"></td><td class="hide-m"></td><td></td><td>${money(s.cash)}</td><td><span class="wbar" style="width:${Math.max(2, s.cash / s.nav * 160)}px;opacity:.35"></span>${(s.cash / s.nav * 100).toFixed(1)}%</td><td></td></tr></tbody></table>`;
  }
  function renderTrades(t) {
    $('trade-count').textContent = t.length ? `共 ${t.length} 笔` : '';
    if (!t.length) { $('trades').innerHTML = '<div class="empty">还没有成交</div>'; return; }
    $('trades').innerHTML = `<table><thead><tr><th>日期</th><th>方向</th><th>代码</th><th>股数</th><th>成交价</th><th>金额</th></tr></thead><tbody>` +
      [...t].reverse().map(f => `<tr title="${esc(f.reason)}"><td>${f.date.slice(5)}</td><td class="${f.side === 'buy' ? 'up' : 'down'}">${f.side === 'buy' ? '买' : '卖'}</td><td><b>${esc(f.symbol)}</b></td><td>${f.shares}</td><td>${money(f.price, 2)}</td><td>${money(f.value)}</td></tr>`).join('') + '</tbody></table>';
  }

  // 背景星点
  function stars() {
    const cv = $('stars'), g = cv.getContext('2d');
    let pts = [];
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const size = () => {
      const d = Math.min(2, devicePixelRatio || 1);
      cv.width = innerWidth * d; cv.height = innerHeight * d; g.setTransform(d, 0, 0, d, 0, 0);
      pts = Array.from({ length: Math.round(innerWidth * innerHeight / 7000) }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 1.2 + 0.3, p: Math.random() * 6, s: 0.4 + Math.random() * 1.4 }));
    };
    const draw = t => {
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (const s of pts) { g.fillStyle = `rgba(255,244,220,${(0.2 + 0.55 * (0.5 + 0.5 * Math.sin(t / 1000 * s.s + s.p))) * (1 - s.y / innerHeight * 0.6)})`; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.283); g.fill(); }
      if (!still) requestAnimationFrame(draw);
    };
    addEventListener('resize', () => { size(); if (still) draw(0); });
    size(); requestAnimationFrame(draw);
  }
})();
