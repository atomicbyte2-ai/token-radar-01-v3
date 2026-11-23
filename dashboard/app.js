/* app.js — the page. Rebuilds the snapshot from data.js, refits with radar.js, draws the board. */
(function () {
  'use strict';
  var D = window.RADAR_DATA, Rd = window.Radar, M = Rd.money;
  var snap = { as_of: D.as_of, source: D.source, floor_usd: D.floor_usd, watchlist: D.watchlist,
    protocols: D.protocols.map(function (a) { return { slug: a[0], name: a[1], category: a[2], chains: a[3], tvl_usd: a[4], change_7d: a[5], mcap_usd: a[6], listed_at: a[7], gecko_id: a[8], symbol: a[9] }; }) };
  var R = Rd.run(snap);                       // the whole model, refitted here in the browser
  var WL = {}; snap.watchlist.forEach(function (s) { WL[s] = 1; });
  var COLORS = { watch: '#6cc6d8', early: '#b39ddb', priced: '#f0b44c', nocap: '#a0855a', above: '#5d7a72', bridge: '#3e4f57', lst: '#4b5d66', cex: '#56666d', ver: '#6b7a80' };
  var DEF = { tab: 'board', verdict: 'ALL', tier: 'ALL', q: '', cat: '', chain: '', dep: 'plan', share: Math.round(D.scenario.dropShare * 1000) / 10, weeks: D.scenario.weeks, sort: 'rank', dir: 1, p: '' };
  var S = {};

  // ---- does this browser's fit equal board.json? ----
  var byRank = R.board, agree = 0;
  D.board.forEach(function (b, i) { var r = byRank[i]; if (r && r.slug === b[0] && r.rank === b[1] && r.implied === b[2]) agree++; });
  var monotone = R.board.every(function (b, i) { return !i || b.implied <= R.board[i - 1].implied; });
  var total = R.board.reduce(function (s, b) { return s + b.implied; }, 0), totalFile = D.board.reduce(function (s, b) { return s + b[2]; }, 0);
  var C = Rd.counts(R), nLedger = Object.keys(C).reduce(function (s, k) { return s + C[k]; }, 0);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function short(x) { var a = Math.abs(x); return (x < 0 ? '−$' : '$') + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0)); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + '%'; }
  function times(lnMiss) { return '×' + Math.exp(lnMiss).toFixed(2); }
  function deposit(b) { return S.dep === 'plan' ? null : +S.dep; }
  function plan(b) { return Rd.farmPlan(b, deposit(b), S.share / 100, S.weeks, R.exitX); }
  function age(f) { return f.yrsKnown ? f.yrs.toFixed(1) + ' y' : 'n/a'; }

  // ---- hash state: #, #p=slug, #verdict=FARM&tier=EARLY … ----
  function readHash() {
    S = JSON.parse(JSON.stringify(DEF));
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i)), v = decodeURIComponent(kv.slice(i + 1));
      if (k in DEF) S[k] = typeof DEF[k] === 'number' ? +v : v;
    });
  }
  function writeHash() {
    var parts = []; Object.keys(DEF).forEach(function (k) { if (S[k] !== DEF[k] && S[k] !== '') parts.push(k + '=' + encodeURIComponent(S[k])); });
    history.replaceState(null, '', '#' + parts.join('&')); render();
  }

  // ---- header + KPI strip ----
  function head() {
    var plans = R.board.map(plan), farm = plans.filter(function (p) { return p.verdict === 'FARM'; }).length;
    var V = R.value, O = R.odds, H = R.honest;
    document.getElementById('meta').innerHTML = 'Snapshot ' + esc(D.as_of) + ' · ' + snap.protocols.length + ' protocols read · no network · model refitted in this browser · scenario: ' +
      (S.dep === 'plan' ? 'plan-size deposit' : M(+S.dep)) + ', ' + S.share + '% of value to users, ' + S.weeks + ' weeks';
    var k = [
      ['Held-out miss', times(V.best.loo), 'vs flat ' + times(V.flat.loo) + ' · walk-fwd ' + times(V.best.walk) + ' vs ' + times(V.flat.walk), 'good'],
      ['Is the range honest?', pct(H.in50) + ' <small>/</small> ' + pct(H.in80), 'later peers inside P25–P75 / P10–P90 (stated 50 / 80) · n=' + H.n, H.in50 < 0.4 ? 'warn' : 'good'],
      ['Odds Brier', O.best.fold.toFixed(3), 'base rate ' + O.base.fold.toFixed(3) + ' · walk-fwd ' + O.best.walk.toFixed(3) + ' vs ' + O.base.walk.toFixed(3), 'good'],
      ['Terms that survived', '<small>value</small> ' + V.kept.length + '/' + V.tried.length + ' <small>· odds</small> ' + O.kept.length + '/' + O.tried.length, 'kept only if both held-out tests improve', ''],
      ['Worth farming', farm + ' <small>of ' + R.board.length + '</small>', 'FARM = net > 0 and ≥ $25 / hour in this scenario', farm ? 'good' : 'bad'],
      ['Watchlist covered', R.board.filter(function (b) { return WL[b.slug]; }).length + ' <small>/ ' + snap.watchlist.length + '</small>', 'every watchlist protocol is ranked', 'good']
    ];
    document.getElementById('kpis').innerHTML = k.map(function (c) { return '<div class="kpi"><div class="k">' + c[0] + '</div><div class="v ' + c[3] + '">' + c[1] + '</div><div class="n">' + c[2] + '</div></div>'; }).join('');
    var bar = Rd.GROUPS.map(function (g) { return '<i style="width:' + (100 * C[g.id] / nLedger) + '%;background:' + COLORS[g.id] + '" title="' + esc(g.label) + '"></i>'; }).join('');
    var leg = Rd.GROUPS.map(function (g) { return '<span style="--c:' + COLORS[g.id] + '">' + esc(g.label) + ' <b class="mono">' + C[g.id] + '</b></span>'; }).join('');
    function chip(ok, t) { return '<span class="chip' + (ok ? '' : ' x') + '">' + (ok ? '✓ ' : '✗ ') + t + '</span>'; }
    document.getElementById('acct').innerHTML = '<div class="sub"><b>ledger()</b> — every protocol in the snapshot sits in exactly one group</div><div class="bar">' + bar + '</div><div class="legend">' + leg + '</div><div class="chips">' +
      chip(agree === D.board.length && agree === R.board.length, 'this table = board.json · ' + agree + ' of ' + D.board.length + ' rows recomputed here') +
      chip(monotone, 'ranks 1–' + R.board.length + ', values never rise') +
      chip(total === totalFile, 'totals equal ' + short(total)) +
      chip(snap.watchlist.every(function (s) { return R.board.some(function (b) { return b.slug === s; }); }), 'watchlist ' + snap.watchlist.length + ' of ' + snap.watchlist.length + ' ranked') +
      chip(nLedger === snap.protocols.length, 'ledger ' + nLedger + ' of ' + snap.protocols.length) +
      chip(D.name_hits === 0, D.name_hits + ' protocol names in the code (main.ts scans every file)') + '</div>';
  }

  // ---- evidence panel ----
  function scatter() {
    var W = 344, H = 170, pad = 26, pts = R.peers.map(function (r) { return [r.lt / Math.LN10, Math.log(r.p.mcap_usd) / Math.LN10]; });
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.floor(Math.min.apply(0, xs)), x1 = Math.ceil(Math.max.apply(0, xs)), y0 = Math.floor(Math.min.apply(0, ys)), y1 = Math.ceil(Math.max.apply(0, ys));
    function X(v) { return pad + (v - x0) / (x1 - x0) * (W - pad - 6); } function Y(v) { return H - 16 - (v - y0) / (y1 - y0) * (H - 24); }
    var m = R.value.model, line = [];
    for (var t = x0; t <= x1 + 1e-9; t += (x1 - x0) / 20) line.push(X(t).toFixed(1) + ',' + Y(m.predict({ lt: t * Math.LN10, cat: '', g7: 0, yrs: 0, nch: 0 }) / Math.LN10).toFixed(1));
    var s = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="log TVL vs log cap">';
    for (var gx = x0; gx <= x1; gx++) s += '<line x1="' + X(gx) + '" x2="' + X(gx) + '" y1="6" y2="' + (H - 16) + '" stroke="#26343a"/>' + (gx < x1 ? '<text x="' + X(gx) + '" y="' + (H - 4) + '" text-anchor="middle">' + short(Math.pow(10, gx)) + '</text>' : '');
    for (var gy = y0; gy <= y1; gy += 2) s += '<line x1="' + pad + '" x2="' + W + '" y1="' + Y(gy) + '" y2="' + Y(gy) + '" stroke="#26343a"/><text x="2" y="' + (Y(gy) + 3) + '">' + short(Math.pow(10, gy)) + '</text>';
    pts.forEach(function (p) { s += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="#f0b44c" fill-opacity=".55"/>'; });
    return s + '<polyline points="' + line.join(' ') + '" fill="none" stroke="#6cc6d8" stroke-width="2"/></svg>';
  }
  function evidence() {
    var V = R.value, O = R.odds, H = R.honest;
    var vt = '<tr><th>value term</th><th class="num">leave-one-out</th><th class="num">walk-forward</th><th></th></tr><tr><td>flat median cap/TVL</td><td class="num">' + times(V.flat.loo) + '</td><td class="num">' + times(V.flat.walk) + '</td><td class="drop">baseline</td></tr>' +
      V.tried.map(function (t) { return '<tr><td>' + esc(t.label) + '</td><td class="num">' + times(t.loo) + '</td><td class="num">' + times(t.walk) + '</td><td class="' + (t.kept ? 'kept">kept' : 'drop">tested, not kept') + '</td></tr>'; }).join('');
    var ot = '<tr><th>odds term</th><th class="num">ten-fold</th><th class="num">walk-fwd</th><th></th></tr><tr><td>base rate ' + pct(O.base.rate) + '</td><td class="num">' + O.base.fold.toFixed(3) + '</td><td class="num">' + O.base.walk.toFixed(3) + '</td><td class="drop">baseline</td></tr>' +
      O.tried.map(function (t) { return '<tr><td>' + esc(t.label) + '</td><td class="num">' + t.fold.toFixed(3) + '</td><td class="num">' + t.walk.toFixed(3) + '</td><td class="' + (t.kept ? 'kept">kept' : 'drop">tested, not kept') + '</td></tr>'; }).join('');
    var co = R.oddsNames.slice(0, 4).map(function (n, i) { return '<tr><td>' + esc(n) + '</td><td class="num">' + R.odds.model.w[i].toFixed(2) + '</td><td class="num">± ' + R.boot.se[i].toFixed(2) + '</td></tr>'; }).join('');
    return '<div class="panel ev"><h2>Evidence</h2><p>Each term enters only if it lowers the held-out miss in <b>both</b> tests. Miss ×2 means the model is off by a factor of two on a peer it never saw.</p>' +
      '<h3>fitValue() · log cap on ' + V.model.terms + ' over ' + R.peers.length + ' priced peers</h3><table>' + vt + '</table>' +
      '<h3>fitOdds() · logistic, “records a token”, ' + R.pool.length + ' protocols</h3><table>' + ot + '</table>' +
      '<h3>odds coefficients · bootstrap s.e. (' + R.boot.B + ' seeded refits)</h3><table>' + co + '</table>' +
      '<h3>heldOut() · is the printed range honest?</h3><table><tr><th>band</th><th class="num">stated</th><th class="num">later peers inside</th></tr><tr><td>P25–P75</td><td class="num">50%</td><td class="num">' + pct(H.in50) + '</td></tr><tr><td>P10–P90</td><td class="num">80%</td><td class="num">' + pct(H.in80) + '</td></tr></table>' +
      '<h3>priced peers · log TVL vs log cap, fitted line</h3>' + scatter() + '</div>';
  }

  // ---- filtering + sorting ----
  function chainsOf(b) { return b.f.p.chains; }
  function filtered() {
    var q = S.q.toLowerCase();
    var rows = R.board.map(function (b) { return { b: b, pl: plan(b) }; }).filter(function (o) {
      var b = o.b;
      if (S.verdict !== 'ALL' && o.pl.verdict !== S.verdict) return false;
      if (S.tier === 'WATCH' && !WL[b.slug]) return false;
      if (S.tier === 'EARLY' && WL[b.slug]) return false;
      if (S.cat && b.f.p.category !== S.cat) return false;
      if (S.chain && chainsOf(b).indexOf(S.chain) < 0) return false;
      if (q && (b.name + ' ' + b.slug + ' ' + b.f.p.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = { rank: function (o) { return o.b.rank; }, tvl: function (o) { return o.b.f.p.tvl_usd; }, g7: function (o) { return o.b.f.p.change_7d || 0; }, age: function (o) { return o.b.f.yrs; },
      odds: function (o) { return o.b.odds; }, ifl: function (o) { return o.b.ifLaunch; }, implied: function (o) { return o.b.implied; }, net: function (o) { return o.pl.net; }, ph: function (o) { return o.pl.perHour; }, name: function (o) { return o.b.name.toLowerCase(); } }[S.sort] || function (o) { return o.b.rank; };
    rows.sort(function (a, c) { var x = key(a), y = key(c); return (x < y ? -1 : x > y ? 1 : a.b.rank - c.b.rank) * S.dir; });
    return rows;
  }
  var SORTNAME = { rank: 'rank', tvl: 'TVL', g7: '7-day change', age: 'no-token age', odds: 'token odds', ifl: 'value if it launches', implied: 'implied value', net: 'net of fees', ph: 'net / hour', name: 'name' };

  function controls() {
    function seg(key, opts) { return '<span class="seg">' + opts.map(function (o) { return '<button data-k="' + key + '" data-v="' + o[0] + '" class="' + (String(S[key]) === String(o[0]) ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</span>'; }
    var cats = {}, chs = {}; R.board.forEach(function (b) { cats[b.f.p.category] = 1; b.f.p.chains.forEach(function (c) { chs[c] = 1; }); });
    function sel(key, list, all) { return '<select data-k="' + key + '"><option value="">' + all + '</option>' + Object.keys(list).sort().map(function (c) { return '<option' + (S[key] === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>'; }
    var nT = R.board.length, nP = R.peers.length, nO = nLedger - nT - nP;
    return '<div class="controls">' + seg('tab', [['board', 'No token yet ' + nT], ['priced', 'Token trades ' + nP], ['out', 'Set aside ' + nO]]) +
      (S.tab === 'board' ? seg('verdict', [['ALL', 'All'], ['FARM', 'Farm'], ['MARGINAL', 'Marginal'], ['SKIP', 'Skip']]) + seg('tier', [['ALL', 'All'], ['WATCH', 'Watchlist'], ['EARLY', 'Early &lt; ' + short(D.floor_usd)]]) : '') +
      '<input type="search" data-k="q" placeholder="search" value="' + esc(S.q) + '">' + (S.tab === 'board' ? sel('cat', cats, 'all categories') + sel('chain', chs, 'all chains') : '') + '</div>' +
      (S.tab === 'board' ? '<div class="controls"><select data-k="dep">' + [['plan', 'deposit: plan size (0.1% of TVL)'], ['1000', 'deposit: $1,000'], ['5000', 'deposit: $5,000'], ['10000', 'deposit: $10,000']].map(function (o) { return '<option value="' + o[0] + '"' + (String(S.dep) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<label class="sl">drop share <input type="range" min="1" max="20" step="0.5" data-k="share" value="' + S.share + '"><b>' + S.share + '%</b></label>' +
      '<label class="sl">horizon <input type="range" min="2" max="26" step="1" data-k="weeks" value="' + S.weeks + '"><b>' + S.weeks + ' wk</b></label>' +
      '<button class="b" data-act="reset">Reset</button><button class="b" data-act="csv">CSV export</button></div>' : '');
  }
  function boardTable() {
    var rows = filtered(), cap = '';
    if (S.verdict !== 'ALL' || S.tier !== 'ALL' || S.q || S.cat || S.chain || S.sort !== 'rank')
      cap = '<div class="cap">Filtered to ' + [S.verdict !== 'ALL' ? 'verdict ' + S.verdict : '', S.tier === 'WATCH' ? 'watchlist' : S.tier === 'EARLY' ? 'early' : '', S.cat, S.chain, S.q ? '“' + esc(S.q) + '”' : ''].filter(Boolean).join(' · ') +
        ' — ' + rows.length + ' of ' + R.board.length + ' · sorted by ' + SORTNAME[S.sort] + (S.dir < 0 ? ' ↓' : ' ↑') + '</div>';
    function th(k, t, cls) { return '<th class="s ' + (cls || '') + (S.sort === k ? ' on' : '') + '" data-sort="' + k + '">' + t + (S.sort === k ? (S.dir < 0 ? ' ↓' : ' ↑') : '') + '</th>'; }
    var h = '<tr>' + th('rank', '#') + th('name', 'protocol') + th('tvl', 'TVL', 'num') + th('g7', '7D', 'num') + th('age', 'no-token age', 'num') + th('odds', 'odds') + th('ifl', 'if it launches', 'num') + th('implied', 'implied value · P25–P75', 'num') + th('net', 'verdict · net', '') + th('ph', 'net / h', 'num') + '</tr>';
    var hiAll = Math.log(R.board[0].hi75), loAll = Math.log(Math.max(1, R.board[R.board.length - 1].lo25));
    function pos(v) { return 100 * (Math.log(Math.max(1, v)) - loAll) / (hiAll - loAll); }
    var body = rows.slice(0, 30).map(function (o) {
      var b = o.b, p = b.f.p, pl = o.pl, g = p.change_7d;
      return '<tr data-p="' + esc(b.slug) + '"><td><span class="rk">' + b.rank + '</span><span class="rr">' + b.rankLo + '–' + b.rankHi + '</span></td>' +
        '<td><span class="pn">' + esc(b.name) + '</span><span class="badge ' + (WL[b.slug] ? 'w">watchlist' : 'e">early') + '</span><span class="pm">' + esc(p.category) + ' · ' + esc(p.chains[0]) + (p.chains.length > 1 ? ' +' + (p.chains.length - 1) : '') + '</span></td>' +
        '<td class="num">' + short(p.tvl_usd) + '</td><td class="num ' + (g == null ? '' : g >= 0 ? 'pos' : 'neg') + '">' + (g == null ? '—' : (g >= 0 ? '+' : '') + g.toFixed(1) + '%') + '</td><td class="num">' + age(b.f) + '</td>' +
        '<td class="mono"><span class="odds"><i style="width:' + pct(b.odds) + '"></i></span>' + pct(b.odds) + '</td><td class="num">' + short(b.ifLaunch) + '</td>' +
        '<td class="num">' + short(b.implied) + ' <span class="sub">' + short(b.lo25) + '–' + short(b.hi75) + '</span><span class="strip"><i style="left:' + pos(b.lo25) + '%;width:' + (pos(b.hi75) - pos(b.lo25)) + '%"></i><b style="left:' + pos(b.implied) + '%"></b></span></td>' +
        '<td><span class="v ' + pl.verdict + '">' + pl.verdict + '</span><span class="vn">' + M(pl.net) + '</span></td><td class="num ' + (pl.perHour >= 25 ? 'pos' : pl.perHour < 0 ? 'neg' : '') + '">' + M(pl.perHour) + '</td></tr>';
    }).join('');
    return cap + '<table class="board">' + h + body + '</table>' + (rows.length > 30 ? '<div class="more">+ ' + (rows.length - 30) + ' more rows — narrow with the filters or export CSV</div>' : '');
  }
  function pricedTable() {
    var rows = R.peers.map(function (r) { return { r: r, m: Math.exp(R.value.model.predict(r)) }; }).sort(function (a, b) { return b.r.p.mcap_usd - a.r.p.mcap_usd; });
    var q = S.q.toLowerCase(); if (q) rows = rows.filter(function (o) { return o.r.p.name.toLowerCase().indexOf(q) >= 0; });
    return '<div class="cap">Token trades — the ' + R.peers.length + ' priced peers the value curve is fitted on: real cap vs the model</div><table class="board"><tr><th>protocol</th><th>token</th><th class="num">TVL</th><th class="num">real cap</th><th class="num">model cap</th><th class="num">cap ÷ model</th></tr>' +
      rows.slice(0, 34).map(function (o) { var p = o.r.p, x = p.mcap_usd / o.m; return '<tr><td><span class="pn">' + esc(p.name) + '</span><span class="pm">' + esc(p.category) + '</span></td><td class="mono">' + esc(p.symbol || '') + '</td><td class="num">' + short(p.tvl_usd) + '</td><td class="num">' + short(p.mcap_usd) + '</td><td class="num">' + short(o.m) + '</td><td class="num ' + (x > 1 ? 'pos' : 'neg') + '">×' + x.toFixed(2) + '</td></tr>'; }).join('') + '</table>';
  }
  function outTable() {
    var g = {}; Rd.GROUPS.forEach(function (x) { g[x.id] = x.label; });
    var rows = R.F.filter(function (r) { return r.group !== 'watch' && r.group !== 'early' && r.group !== 'priced'; });
    var q = S.q.toLowerCase(); if (q) rows = rows.filter(function (r) { return r.p.name.toLowerCase().indexOf(q) >= 0; });
    rows.sort(function (a, b) { return b.p.tvl_usd - a.p.tvl_usd; });
    return '<div class="cap">Set aside — not ranked, with the house rule that put each one there</div><table class="board"><tr><th>protocol</th><th>group</th><th>category</th><th class="num">TVL</th></tr>' +
      rows.slice(0, 34).map(function (r) { return '<tr><td class="pn">' + esc(r.p.name) + '</td><td class="sub">' + esc(g[r.group]) + '</td><td class="sub">' + esc(r.p.category) + '</td><td class="num">' + short(r.p.tvl_usd) + '</td></tr>'; }).join('') + '</table>';
  }

  // ---- detail view ----
  function detail(b) {
    var p = b.f.p, pl = plan(b), V = R.value, O = R.odds, beta = V.model.beta || [];
    var shares = [3.5, 7, 14], deps = [1000, 3000, Rd.defaultDeposit(p.tvl_usd), 30000];
    var grid = '<tr><th>drop share</th>' + deps.map(function (d, i) { return '<th class="num">' + (i === 2 ? 'plan ' : '') + short(d) + '</th>'; }).join('') + '</tr>' + shares.map(function (s) {
      return '<tr><td class="mono">' + s + '%</td>' + deps.map(function (d) { var x = Rd.farmPlan(b, d, s / 100, S.weeks, R.exitX); return '<td class="' + x.verdict + '">' + M(x.net) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var f = b.f, w = O.model.w, xs = [['intercept', 1]];
    ['size', 'g7', 'yrs', 'nch'].forEach(function (t) { if (O.kept.indexOf(t) >= 0) xs.push([Rd.TERM_LABEL[t], { size: f.lt, g7: f.g7, yrs: f.yrs, nch: f.nch }[t]]); });
    if (O.kept.indexOf('cat') >= 0) O.levels.forEach(function (l) { xs.push(['category: ' + l, f.cat === l ? 1 : 0]); });
    var lg = 0, ot = xs.map(function (x, i) { var c = w[i] * x[1]; lg += c; return x[1] ? '<tr><td>' + esc(x[0]) + '</td><td class="num">' + w[i].toFixed(2) + ' × ' + x[1].toFixed(2) + '</td><td class="num">' + (c >= 0 ? '+' : '') + c.toFixed(2) + '</td></tr>' : ''; }).join('') +
      '<tr class="t"><td>log-odds → odds 1/(1+e<sup>−x</sup>)</td><td class="num">' + lg.toFixed(2) + '</td><td class="num">' + pct(b.odds, 1) + '</td></tr>';
    var math = '<table class="math"><tr><td>base e<sup>' + (beta[0] || 0).toFixed(2) + '</sup></td><td class="num">' + short(Math.exp(beta[0] || 0)) + '</td></tr>' +
      (V.kept.indexOf('size') >= 0 ? '<tr><td>× size TVL<sup>' + beta[1].toFixed(3) + '</sup> (' + short(p.tvl_usd) + ')</td><td class="num">× ' + Math.pow(p.tvl_usd, beta[1]).toFixed(0) + '</td></tr>' : '') +
      '<tr class="t"><td>value if a token launches</td><td class="num">' + short(b.ifLaunch) + '</td></tr>' +
      '<tr><td>× token odds (fitOdds: ' + O.kept.map(function (t) { return Rd.TERM_LABEL[t]; }).join(', ') + ')</td><td class="num">× ' + pct(b.odds, 1) + '</td></tr>' +
      '<tr class="t"><td>implied value (rank ' + b.rank + ', bootstrap ' + b.rankLo + '–' + b.rankHi + ')</td><td class="num">' + M(b.implied) + '</td></tr>' +
      '<tr><td>P25–P75 · P10–P90 (held-out misses)</td><td class="num">' + short(b.lo25) + '–' + short(b.hi75) + ' · ' + short(b.lo10) + '–' + short(b.hi90) + '</td></tr></table>';
    var peers = Rd.nearestPeers(R, b, 5).map(function (x) { return '<tr><td>' + esc(x.name) + ' <span class="sub">' + esc(x.symbol || '') + '</span></td><td class="num">' + short(x.tvl) + '</td><td class="num">' + short(x.cap) + '</td><td class="num">' + x.ratio.toFixed(2) + '</td><td class="num">×' + x.vsModel.toFixed(2) + '</td></tr>'; }).join('');
    var steps = pl.steps.map(function (s) { return '<li><span class="w">' + esc(s.when) + '</span><span>' + esc(s.text) + '</span><span class="c"><span>COST ' + M(s.cost) + '</span><span>TIME ' + s.min + ' min</span></span></li>'; }).join('');
    var tb = pl.deposit * Rd.TBILL * S.weeks / 52;
    return '<a class="back" href="#">← back to the board</a><div class="det"><div><div class="panel"><div class="dh"><h2>' + esc(p.name) + '</h2><span class="rk">#' + b.rank + '</span><span class="badge ' + (WL[b.slug] ? 'w">watchlist' : 'e">early') + '</span><span class="sub">' + esc(p.category) + ' · ' + p.chains.map(esc).join(', ') + '</span></div>' +
      '<div class="dk">' + [['TVL', short(p.tvl_usd)], ['7-day change', p.change_7d == null ? '—' : p.change_7d.toFixed(2) + '%'], ['listed since', p.listed_at || 'n/a'], ['no-token age', age(b.f)]].map(function (k) { return '<div class="kpi"><div class="k">' + k[0] + '</div><div class="v">' + k[1] + '</div></div>'; }).join('') + '</div>' +
      '<h2>How the figure is made</h2>' + math + '<h3>token odds, term by term (7-day growth and time listed enter here)</h3><table class="math">' + ot + '</table><p class="note">No token is recorded for ' + esc(p.name) + ' on DefiLlama; odds are the share of protocols like it that record one, not a forecast that it will.</p></div>' +
      '<div class="panel" style="margin-top:12px"><h2>farmPlan() · ' + pl.steps.length + ' steps, ' + pl.hours.toFixed(1) + ' h, ' + M(pl.costs) + ' in fees</h2><ul class="steps">' + steps + '</ul></div></div>' +
      '<div><div class="panel"><h2>Farm verdict</h2><div class="vbox"><span class="v ' + pl.verdict + '">' + pl.verdict + '</span> <span class="big ' + (pl.net > 0 ? 'pos' : 'neg') + '">' + M(pl.net) + '</span> <span class="sub">net · ' + M(pl.perHour) + ' / hour</span>' +
      '<table class="math" style="margin-top:6px"><tr><td>deposit on ' + esc(pl.chain) + '</td><td class="num">' + M(pl.deposit) + '</td></tr><tr><td>modelled drop = implied × ' + S.share + '% × deposit ÷ (TVL + deposit)</td><td class="num">' + M(pl.drop) + '</td></tr><tr><td>− gas + bridge (' + M(pl.gas) + ' per tx)</td><td class="num">' + M(pl.costs) + '</td></tr><tr><td>− forgone T-bill ' + pct(Rd.TBILL) + ' × ' + S.weeks + ' wk</td><td class="num">' + M(pl.forgone) + '</td></tr><tr class="t"><td>net</td><td class="num">' + M(pl.net) + '</td></tr></table></div>' +
      '<h3>net by drop share × deposit</h3><table class="sg">' + grid + '</table>' +
      '<h3>benchmarks</h3><table class="math"><tr><td>same money in T-bills, ' + S.weeks + ' weeks</td><td class="num">' + M(tb) + '</td></tr><tr><td>drop share that just covers fees + T-bill</td><td class="num">' + pct(pl.breakeven, 1) + '</td></tr></table>' +
      '<h3>nearest priced peers</h3><table class="ev"><tr><th>token</th><th class="num">TVL</th><th class="num">cap</th><th class="num">cap/TVL</th><th class="num">cap ÷ model</th></tr>' + peers + '</table></div></div></div>';
  }

  // ---- draw ----
  function render() {
    head();
    var v = document.getElementById('view'), b = S.p && R.board.filter(function (x) { return x.slug === S.p; })[0];
    if (b) { v.innerHTML = detail(b); return; }
    var main = S.tab === 'priced' ? pricedTable() : S.tab === 'out' ? outTable() : boardTable();
    v.innerHTML = '<div class="grid"><div class="panel">' + controls() + main + '</div>' + evidence() + '</div>';
  }
  function csv() {
    var lines = ['rank,slug,name,tier,category,tvl_usd,change_7d,odds,value_if_launches,implied,p25,p75,verdict,net,net_per_hour'];
    filtered().forEach(function (o) { var b = o.b; lines.push([b.rank, b.slug, '"' + b.name.replace(/"/g, '""') + '"', WL[b.slug] ? 'watchlist' : 'early', '"' + b.f.p.category + '"', b.f.p.tvl_usd, b.f.p.change_7d, b.odds.toFixed(4), Math.round(b.ifLaunch), b.implied, b.lo25, b.hi75, o.pl.verdict, o.pl.net.toFixed(2), o.pl.perHour.toFixed(2)].join(',')); });
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'token-radar-' + D.as_of + '.csv'; a.click();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sort],[data-k],[data-act],tr[data-p]'); if (!t) return;
    if (t.dataset.sort) { if (S.sort === t.dataset.sort) S.dir = -S.dir; else { S.sort = t.dataset.sort; S.dir = t.dataset.sort === 'rank' || t.dataset.sort === 'name' ? 1 : -1; } writeHash(); }
    else if (t.tagName === 'BUTTON' && t.dataset.k) { S[t.dataset.k] = t.dataset.v; writeHash(); }
    else if (t.dataset.act === 'reset') { location.hash = ''; }
    else if (t.dataset.act === 'csv') csv();
    else if (t.dataset.p) { S.p = t.dataset.p; writeHash(); window.scrollTo(0, 0); }
  });
  document.addEventListener('change', function (e) { var k = e.target.dataset && e.target.dataset.k; if (k && e.target.tagName !== 'BUTTON') { S[k] = typeof DEF[k] === 'number' ? +e.target.value : e.target.value; writeHash(); } });
  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash(); render();
})();
