/* radar.js — the whole value model and farm plan, as one classic script.
   Browser: window.Radar.  Node: module.exports.  Same code makes board.json and the page. */
(function (root) {
  'use strict';
  var LN10 = Math.log(10);

  // ---------- small numeric helpers ----------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sorted(xs) { return xs.slice().sort(function (a, b) { return a - b; }); }
  function quantile(xs, q) {
    var s = sorted(xs), n = s.length; if (!n) return NaN;
    var h = (n - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (s[hi] - s[lo]) * (h - lo);
  }
  function median(xs) { return quantile(xs, 0.5); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  // solve A x = b (A symmetric positive definite after ridge); Gaussian elimination with pivoting
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      var d = M[c][c] || 1e-12;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = M[r2][c] / d; if (!f) continue;
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / (M[i][i] || 1e-12);
    }
    return x;
  }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // ---------- features read off the snapshot ----------
  var DAY = 86400000;
  function yearsListed(p, asOf) {
    if (!p.listed_at) return null;
    return Math.max(0, (Date.parse(asOf) - Date.parse(p.listed_at)) / DAY / 365.25);
  }
  function hasToken(p) { return !!(p.gecko_id || p.symbol); }
  // 7-day TVL change in percent -> damped log growth (a few protocols report thousands of %)
  function growth(p) { return p.change_7d == null ? 0 : Math.log(1 + clamp(p.change_7d, -90, 300) / 100); }

  function features(snap) {
    var asOf = snap.as_of, ys = [];
    snap.protocols.forEach(function (p) { var y = yearsListed(p, asOf); if (y != null) ys.push(y); });
    var yMed = median(ys);
    return snap.protocols.map(function (p) {
      var y = yearsListed(p, asOf);
      return {
        p: p, slug: p.slug, lt: Math.log(p.tvl_usd), g7: growth(p),
        yrs: y == null ? yMed : y, yrsKnown: y != null, nch: Math.log(1 + p.chains.length),
        cat: p.category || 'Uncategorised'
      };
    });
  }

  // ---------- ledger: every protocol in exactly one group ----------
  var GROUPS = [
    { id: 'watch', label: 'Ranked · watchlist', ranked: true },
    { id: 'early', label: 'Ranked · early (no token, below floor)', ranked: true },
    { id: 'priced', label: 'Token trades · priced peer' },
    { id: 'nocap', label: 'Token recorded · no usable cap' },
    { id: 'above', label: 'Not ranked · no token, above floor, off watchlist' },
    { id: 'bridge', label: 'Out · bridge', out: true },
    { id: 'lst', label: 'Out · liquid staking & restaking', out: true },
    { id: 'cex', label: 'Out · exchange', out: true },
    { id: 'ver', label: 'Out · versioned or wrapped', out: true }
  ];
  function exchangePrefixes(snap) {
    // first word of every protocol the snapshot itself files as CEX — no names typed here
    var set = {};
    snap.protocols.forEach(function (p) { if (p.category === 'CEX') set[p.name.split(/[\s-]/)[0].toLowerCase()] = 1; });
    return set;
  }
  function ledger(snap) {
    var watch = {}; snap.watchlist.forEach(function (s) { watch[s] = 1; });
    var pre = exchangePrefixes(snap), out = {};
    snap.protocols.forEach(function (p) {
      var c = p.category || '', g;
      if (watch[p.slug]) g = 'watch';
      else if (/bridge/i.test(c)) g = 'bridge';
      else if (/liquid staking|restaking|liquid restaking|restaked/i.test(c)) g = 'lst';
      else if (c === 'CEX' || pre[p.name.split(/[\s-]/)[0].toLowerCase()]) g = 'cex';
      else if (/\b(v\d+(\.\d+)?|wrapped|staked|staking)\b/i.test(p.name)) g = 'ver';
      else if (p.mcap_usd > 0) g = 'priced';
      else if (hasToken(p)) g = 'nocap';
      else if (p.tvl_usd < snap.floor_usd) g = 'early';
      else g = 'above';
      out[p.slug] = g;
    });
    return out;
  }

  // ---------- design matrices ----------
  // term ids: size, cat, g7, yrs, nch
  function catLevels(rows, minN) {
    var n = {}; rows.forEach(function (r) { n[r.cat] = (n[r.cat] || 0) + 1; });
    return Object.keys(n).filter(function (k) { return n[k] >= minN; }).sort();
  }
  function design(r, terms, levels) {
    var x = [1];
    if (terms.indexOf('size') >= 0) x.push(r.lt);
    if (terms.indexOf('g7') >= 0) x.push(r.g7);
    if (terms.indexOf('yrs') >= 0) x.push(r.yrs);
    if (terms.indexOf('nch') >= 0) x.push(r.nch);
    if (terms.indexOf('cat') >= 0) levels.forEach(function (l) { x.push(r.cat === l ? 1 : 0); });
    return x;
  }
  function penaltyMask(terms, levels, lamCat, lam) {
    var m = [0];
    ['size', 'g7', 'yrs', 'nch'].forEach(function (t) { if (terms.indexOf(t) >= 0) m.push(lam); });
    if (terms.indexOf('cat') >= 0) levels.forEach(function () { m.push(lamCat); });
    return m;
  }

  // ---------- value if a token launches: log cap on log TVL over priced peers ----------
  var VALUE_TERMS = ['size', 'cat', 'g7', 'yrs', 'nch'];
  var TERM_LABEL = { size: 'size curve (log TVL)', cat: 'category effect (ridge)', g7: '7-day growth', yrs: 'years listed', nch: 'chain count' };
  function fitLinear(rows, terms, levels) {
    // terms=[] means flat baseline: log cap = log TVL + median log(cap/TVL)
    if (!terms.length) {
      var c = median(rows.map(function (r) { return Math.log(r.p.mcap_usd) - r.lt; }));
      return { flat: true, c: c, predict: function (r) { return r.lt + c; } };
    }
    var X = rows.map(function (r) { return design(r, terms, levels); });
    var y = rows.map(function (r) { return Math.log(r.p.mcap_usd); });
    var k = X[0].length, pen = penaltyMask(terms, levels, 3, 1e-3);
    var A = [], b = [];
    for (var i = 0; i < k; i++) { A.push(new Array(k).fill(0)); b.push(0); }
    X.forEach(function (x, n) {
      for (var i = 0; i < k; i++) { b[i] += x[i] * y[n]; for (var j = 0; j < k; j++) A[i][j] += x[i] * x[j]; }
    });
    for (var d = 0; d < k; d++) A[d][d] += pen[d];
    var beta = solve(A, b);
    return { beta: beta, terms: terms, levels: levels, predict: function (r) { return dot(design(r, terms, levels), beta); } };
  }
  function looMisses(rows, terms) {
    var levels = catLevels(rows, 3);
    return rows.map(function (r, i) {
      var tr = rows.filter(function (_, j) { return j !== i; });
      var m = fitLinear(tr, terms, levels);
      return m.predict(r) - Math.log(r.p.mcap_usd);
    });
  }
  function byListed(rows) {
    return rows.filter(function (r) { return r.yrsKnown; }).sort(function (a, b) {
      return a.p.listed_at < b.p.listed_at ? -1 : a.p.listed_at > b.p.listed_at ? 1 : a.slug < b.slug ? -1 : 1;
    });
  }
  function walkMisses(rows, terms) {
    // fit on peers DefiLlama listed earlier, test each later peer (second half in listing order)
    var s = byListed(rows), start = Math.floor(s.length / 2), out = [];
    for (var i = start; i < s.length; i++) {
      var tr = s.slice(0, i), levels = catLevels(tr, 3);
      out.push({ r: s[i], res: fitLinear(tr, terms, levels).predict(s[i]) - Math.log(s[i].p.mcap_usd), tr: tr });
    }
    return out;
  }
  function medAbs(xs) { return median(xs.map(Math.abs)); }

  function fitValue(peers) {
    var kept = [], tried = [];
    var flatL = medAbs(looMisses(peers, [])), flatW = medAbs(walkMisses(peers, []).map(function (o) { return o.res; }));
    var curL = flatL, curW = flatW;
    VALUE_TERMS.forEach(function (t) {
      var terms = kept.concat([t]);
      if (t !== 'size' && kept.indexOf('size') < 0) terms = ['size', t];
      var L = medAbs(looMisses(peers, terms)), W = medAbs(walkMisses(peers, terms).map(function (o) { return o.res; }));
      var keep = L < curL && W < curW;
      tried.push({ term: t, label: TERM_LABEL[t], loo: L, walk: W, kept: keep });
      if (keep) { kept = terms; curL = L; curW = W; }
    });
    var levels = catLevels(peers, 3);
    var model = fitLinear(peers, kept, levels);
    var res = looMisses(peers, kept);
    return { kept: kept, tried: tried, flat: { loo: flatL, walk: flatW }, best: { loo: curL, walk: curW },
      model: model, levels: levels, residuals: res,
      q: { p10: quantile(res, 0.1), p25: quantile(res, 0.25), p75: quantile(res, 0.75), p90: quantile(res, 0.9) } };
  }

  // ---------- token odds: logistic regression of "records a token" ----------
  var ODDS_TERMS = ['size', 'yrs', 'g7', 'cat', 'nch'];
  function fitLogit(rows, terms, levels, iters) {
    var X = rows.map(function (r) { return design(r, terms, levels); });
    var y = rows.map(function (r) { return r.tok; });
    var k = X[0].length, w = new Array(k).fill(0), pen = penaltyMask(terms, levels, 2, 1);
    var base = y.reduce(function (a, b) { return a + b; }, 0) / y.length;
    w[0] = Math.log((base + 1e-3) / (1 - base + 1e-3));
    for (var it = 0; it < (iters || 20); it++) {
      var H = [], g = [];
      for (var i = 0; i < k; i++) { H.push(new Array(k).fill(0)); g.push(-pen[i] * w[i]); H[i][i] = pen[i] + 1e-8; }
      for (var n = 0; n < X.length; n++) {
        var x = X[n], pr = 1 / (1 + Math.exp(-dot(x, w))), v = pr * (1 - pr), e = y[n] - pr;
        for (var a = 0; a < k; a++) { g[a] += e * x[a]; for (var c = 0; c < k; c++) H[a][c] += v * x[a] * x[c]; }
      }
      var step = solve(H, g);
      for (var q = 0; q < k; q++) w[q] += step[q];
    }
    return { w: w, terms: terms, levels: levels, prob: function (r) { return 1 / (1 + Math.exp(-dot(design(r, terms, levels), w))); } };
  }
  function brier(pairs) { return pairs.reduce(function (s, o) { return s + (o.p - o.y) * (o.p - o.y); }, 0) / pairs.length; }
  function fitProb(tr, terms) {
    if (!terms.length) { var b = tr.reduce(function (s, r) { return s + r.tok; }, 0) / tr.length; return function () { return b; }; }
    var m = fitLogit(tr, terms, catLevels(tr, 8), 20); return m.prob;
  }
  function tenFold(rows, terms) {
    var pairs = [];
    for (var f = 0; f < 10; f++) {
      var tr = rows.filter(function (_, i) { return i % 10 !== f; }), te = rows.filter(function (_, i) { return i % 10 === f; });
      var pf = fitProb(tr, terms);
      te.forEach(function (r) { pairs.push({ p: pf(r), y: r.tok }); });
    }
    return brier(pairs);
  }
  function walkBrier(rows, terms) {
    var s = byListed(rows), n = s.length, pairs = [];
    for (var b = 2; b <= 5; b++) {
      var lo = Math.floor(n * (b - 1) / 5), hi = Math.floor(n * b / 5);
      var pf = fitProb(s.slice(0, lo), terms);
      s.slice(lo, hi).forEach(function (r) { pairs.push({ p: pf(r), y: r.tok }); });
    }
    return brier(pairs);
  }
  function fitOdds(pool) {
    var kept = [], tried = [];
    var b10 = tenFold(pool, []), bW = walkBrier(pool, []), cur10 = b10, curW = bW;
    ODDS_TERMS.forEach(function (t) {
      var terms = kept.concat([t]);
      var B = tenFold(pool, terms), W = walkBrier(pool, terms), keep = B < cur10 && W < curW;
      tried.push({ term: t, label: TERM_LABEL[t], fold: B, walk: W, kept: keep });
      if (keep) { kept = terms; cur10 = B; curW = W; }
    });
    var levels = catLevels(pool, 8);
    var model = fitLogit(pool, kept.length ? kept : [], levels, 20);
    var base = pool.reduce(function (s, r) { return s + r.tok; }, 0) / pool.length;
    return { kept: kept, tried: tried, base: { fold: b10, walk: bW, rate: base }, best: { fold: cur10, walk: curW }, model: model, levels: levels };
  }

  // ---------- is the printed range honest? walk-forward coverage ----------
  function heldOut(peers, kept) {
    var wm = walkMisses(peers, kept), in50 = 0, in80 = 0;
    wm.forEach(function (o) {
      // the board band uses leave-one-out misses, so rebuild it the same way from earlier peers only
      var res = looMisses(o.tr, kept);
      // a miss is pred - actual; actual inside band  <=>  res inside [q_lo, q_hi]
      if (o.res >= quantile(res, 0.25) && o.res <= quantile(res, 0.75)) in50++;
      if (o.res >= quantile(res, 0.1) && o.res <= quantile(res, 0.9)) in80++;
    });
    return { n: wm.length, in50: in50 / wm.length, in80: in80 / wm.length };
  }

  // ---------- bootstrap: coefficient s.e. and rank ranges (seeded, deterministic) ----------
  function bootstrap(R, B, seed) {
    var rnd = mulberry32(seed), peers = R.peers, pool = R.pool, V = R.value, O = R.odds;
    var coefs = [], ranks = R.board.map(function () { return []; });
    for (var b = 0; b < B; b++) {
      var bp = [], bo = [], i;
      for (i = 0; i < peers.length; i++) bp.push(peers[Math.floor(rnd() * peers.length)]);
      for (i = 0; i < pool.length; i++) bo.push(pool[Math.floor(rnd() * pool.length)]);
      var vm = fitLinear(bp, V.kept, V.levels), om = fitLogit(bo, O.kept, O.levels, 12);
      coefs.push(om.w);
      var imp = R.board.map(function (row, j) { return { j: j, v: Math.exp(vm.predict(row.f)) * om.prob(row.f) }; });
      imp.sort(function (x, y) { return y.v - x.v || x.j - y.j; });
      imp.forEach(function (o, k) { ranks[o.j].push(k + 1); });
    }
    var se = O.model.w.map(function (_, k) {
      var xs = coefs.map(function (w) { return w[k]; }), m = xs.reduce(function (a, c) { return a + c; }, 0) / xs.length;
      return Math.sqrt(xs.reduce(function (a, c) { return a + (c - m) * (c - m); }, 0) / (xs.length - 1));
    });
    R.board.forEach(function (row, j) { row.rankLo = Math.round(quantile(ranks[j], 0.1)); row.rankHi = Math.round(quantile(ranks[j], 0.9)); });
    return { B: B, seed: seed, se: se };
  }
  function coefNames(terms, levels) {
    var n = ['intercept'];
    ['size', 'g7', 'yrs', 'nch'].forEach(function (t) { if (terms.indexOf(t) >= 0) n.push(TERM_LABEL[t]); });
    if (terms.indexOf('cat') >= 0) levels.forEach(function (l) { n.push('category: ' + l); });
    return n;
  }

  // ---------- farm plan ----------
  // gas per transaction by chain — stated assumptions, shown on the page
  var GAS = { Ethereum: 1.5, Bitcoin: 2.5, Solana: 0.02, _other: 0.12 };
  var BRIDGE_FEE = 3; // one move of funds onto a non-Ethereum chain, each way (assumption)
  var TBILL = 0.04;
  function cheapestChain(p) {
    var best = null, cost = Infinity;
    p.chains.forEach(function (c) { var g = GAS[c] != null ? GAS[c] : GAS._other; if (g < cost) { cost = g; best = c; } });
    return { chain: best || 'Ethereum', gas: cost === Infinity ? GAS.Ethereum : cost };
  }
  // what a depositor actually does, by the category DefiLlama files the protocol under
  function action(cat) {
    var c = cat || '';
    if (/Lending|CDP|Collateral|Uncollateralized/.test(c)) return { verb: 'supply stablecoins to a lending market', tx: 2, wk: 'check health factor and accrued interest', risk: 'bad-debt or oracle failure in the market you supply' };
    if (/Curator|Allocator|Yield|Basis|Farm|Indexes|Stablecoin|Leveraged/.test(c)) return { verb: 'deposit stablecoins into a curated vault', tx: 2, wk: 'check vault share price and points page', risk: 'strategy loss inside the vault and withdrawal queues' };
    if (/RWA|CeDeFi|Payments|Insurance/.test(c)) return { verb: 'subscribe to the tokenised product (KYC may apply)', tx: 2, wk: 'check NAV and redemption window', risk: 'issuer, custody and redemption-gate risk' };
    if (/Dex|Derivatives|Options|Prediction|Launchpad/.test(c)) return { verb: 'provide liquidity or trade the minimum that earns activity points', tx: 3, wk: 'rebalance or re-trade once', risk: 'impermanent loss or liquidation on open positions' };
    if (/Restaking|Staking|Chain|BTC|Governance/.test(c)) return { verb: 'stake or delegate the native asset', tx: 2, wk: 'claim or restake rewards', risk: 'slashing, unbonding delay and native-asset price swings' };
    return { verb: 'open the smallest position the app allows', tx: 2, wk: 'check the position', risk: 'smart-contract and operator risk' };
  }
  function commas(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(x) { return x < 0 ? '−' + money(-x) : '$' + (x >= 100 ? commas(x) : x.toFixed(2)); }
  // plan size: 0.1% of the pool, so the farmer never becomes the whale; clamped $1K–$20K
  function defaultDeposit(tvl) { return Math.round(clamp(tvl * 0.001, 1000, 20000) / 100) * 100; }
  function exitDrop(snap) {
    // a weekly TVL fall worse than 9 in 10 protocols in this very snapshot
    var xs = snap.protocols.map(function (p) { return p.change_7d; }).filter(function (x) { return x != null; });
    return Math.round(-quantile(xs, 0.1));
  }
  function farmPlan(row, deposit, dropShare, weeks, exitX) {
    var p = row.f.p, a = action(p.category), ch = cheapestChain(p), dep = deposit || defaultDeposit(p.tvl_usd);
    var bridge = ch.chain === 'Ethereum' || ch.chain === 'Bitcoin' ? 0 : BRIDGE_FEE;
    var st = [], tot = 0, mins = 0;
    function step(when, text, cost, min) { st.push({ when: when, text: text, cost: cost, min: min }); tot += cost; mins += min; }
    step('Day 0', 'Verify: open ' + p.name + "'s official docs from its DefiLlama page and match every contract address on " + ch.chain + '; never sign an approval sent by DM or ad.', 0, 20);
    step('Day 0', 'Fund: move ' + money(dep) + ' onto ' + ch.chain + (bridge ? ' via a canonical bridge or exchange withdrawal' : ' from your own wallet') + '.', bridge + ch.gas, 15);
    step('Day 0', 'Enter: ' + a.verb + ' on ' + p.name + ' (' + p.category + ', ' + a.tx + ' tx).', a.tx * ch.gas, 15);
    step('Day 0', 'Record: log date, amount, tx hashes and wallet in a sheet so the drop and taxes can be traced.', 0, 10);
    step('Weekly ×' + weeks, 'Monitor: ' + a.wk + ', and read ' + p.name + "'s TVL on DefiLlama; one claim or touch tx a week.", weeks * ch.gas, weeks * 5);
    step('Day 0', 'Risk: ' + a.risk + '; cap the position at ' + money(dep) + '. ' + p.name + ' records no token on DefiLlama, so any drop is a model guess, not a promise.', 0, 5);
    step('Any day', 'Exit rule: if TVL drops more than ' + exitX + '% in one week (worse than 9 in 10 protocols this week), withdraw that day.', 0, 5);
    step('Day ' + weeks * 7, 'Exit: withdraw, move funds back' + (bridge ? ' across the bridge' : '') + ', and close the sheet with the final balance.', a.tx * ch.gas + bridge, 20);
    var drop = row.implied * dropShare * dep / (p.tvl_usd + dep);
    var forgone = dep * TBILL * weeks / 52, net = drop - tot - forgone, hours = mins / 60, perHour = net / hours;
    var verdict = net <= 0 ? 'SKIP' : perHour >= 25 ? 'FARM' : 'MARGINAL';
    var breakeven = (tot + forgone) * (p.tvl_usd + dep) / (row.implied * dep); // drop share that just covers costs
    return { deposit: dep, chain: ch.chain, gas: ch.gas, steps: st, costs: tot, forgone: forgone, drop: drop, net: net, hours: hours, perHour: perHour, verdict: verdict, breakeven: breakeven };
  }
  function stepText(s) { return s.when + ' · ' + s.text + ' Cost: ' + money(s.cost) + '. Time: ' + s.min + ' min.'; }

  // ---------- run everything ----------
  function run(snap) {
    var F = features(snap), L = ledger(snap);
    F.forEach(function (r) { r.group = L[r.slug]; r.tok = hasToken(r.p) ? 1 : 0; });
    var peers = F.filter(function (r) { return r.group === 'priced'; });
    var pool = F.filter(function (r) { return !GROUPS.filter(function (g) { return g.id === r.group; })[0].out; });
    var V = fitValue(peers), O = fitOdds(pool);
    var board = F.filter(function (r) { return r.group === 'watch' || r.group === 'early'; }).map(function (r) {
      var ifl = Math.exp(V.model.predict(r)), odds = O.model.prob(r);
      return { slug: r.slug, name: r.p.name, f: r, ifLaunch: ifl, odds: odds, implied: Math.max(1, Math.round(ifl * odds)) };
    });
    board.sort(function (a, b) { return b.implied - a.implied || (a.slug < b.slug ? -1 : 1); });
    board.forEach(function (b, i) {
      b.rank = i + 1;
      if (i && b.implied > board[i - 1].implied) b.implied = board[i - 1].implied; // never rises down the board
      b.lo25 = Math.round(b.ifLaunch * Math.exp(-V.q.p75) * b.odds); b.hi75 = Math.round(b.ifLaunch * Math.exp(-V.q.p25) * b.odds);
      b.lo10 = Math.round(b.ifLaunch * Math.exp(-V.q.p90) * b.odds); b.hi90 = Math.round(b.ifLaunch * Math.exp(-V.q.p10) * b.odds);
    });
    var R = { snap: snap, F: F, ledger: L, peers: peers, pool: pool, value: V, odds: O, board: board };
    R.honest = heldOut(peers, V.kept);
    R.boot = bootstrap(R, 200, 20261114);
    R.oddsNames = coefNames(O.kept, O.levels);
    R.exitX = exitDrop(snap);
    return R;
  }
  function counts(R) {
    var c = {}; GROUPS.forEach(function (g) { c[g.id] = 0; });
    Object.keys(R.ledger).forEach(function (s) { c[R.ledger[s]]++; });
    return c;
  }
  function nearestPeers(R, row, k) {
    var same = R.peers.filter(function (r) { return r.cat === row.f.cat; });
    var list = (same.length >= 2 ? same : R.peers).slice();
    list.sort(function (a, b) { return Math.abs(a.lt - row.f.lt) - Math.abs(b.lt - row.f.lt) || (a.slug < b.slug ? -1 : 1); });
    return list.slice(0, k || 5).map(function (r) {
      var m = Math.exp(R.value.model.predict(r));
      return { name: r.p.name, symbol: r.p.symbol, tvl: r.p.tvl_usd, cap: r.p.mcap_usd, ratio: r.p.mcap_usd / r.p.tvl_usd, vsModel: r.p.mcap_usd / m };
    });
  }

  // worthFarming(): the n best FARM rows by net / hour for one scenario, plus verdict counts.
  // Same function feeds the page strip and main.ts's self-check.
  function worthFarming(R, deposit, dropShare, weeks, n) {
    var all = R.board.map(function (b) { return { b: b, pl: farmPlan(b, deposit, dropShare, weeks, R.exitX) }; }), c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    all.forEach(function (o) { c[o.pl.verdict]++; });
    var top = all.filter(function (o) { return o.pl.verdict === 'FARM'; }).sort(function (x, y) { return y.pl.perHour - x.pl.perHour || x.b.rank - y.b.rank; }).slice(0, n || 5);
    return { top: top, counts: c, lead: all[0] };
  }

  var api = { run: run, worthFarming: worthFarming, ledger: ledger, fitValue: fitValue, fitOdds: fitOdds, heldOut: heldOut, farmPlan: farmPlan, stepText: stepText,
    defaultDeposit: defaultDeposit, nearestPeers: nearestPeers, counts: counts, cheapestChain: cheapestChain, money: money,
    mulberry32: mulberry32, quantile: quantile, median: median, GROUPS: GROUPS, TERM_LABEL: TERM_LABEL, GAS: GAS, BRIDGE_FEE: BRIDGE_FEE, TBILL: TBILL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Radar = api;
})(typeof window !== 'undefined' ? window : this);
