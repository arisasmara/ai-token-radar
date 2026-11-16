// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan, and a model sandbox that recomputes the displayed implied
// values in the browser. No network: every byte it shows is in data.js.
//
// The shell (header, lede, controls, model panel) is built once; only the table re-renders, so the
// search box and the sandbox sliders never lose focus while the reader works them.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCHLIST = new Set(DATA.watchlist || []);
  var state = {
    q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    sandbox: {
      growth_weight: DATA.model.growth_weight,
      maturity_floor: DATA.model.maturity_floor,
      breadth_step: DATA.model.breadth_step
    }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // A multiplier for display: four decimals, trailing zeroes trimmed. The stored factors keep full
  // precision for the recompute; only their display is rounded.
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return String(parseFloat(n.toFixed(4)));
  }

  // The model in one function: the page recomputes a row from the snapshot figures and the category
  // multiple and breadth multiplier data.js carries, and checks the number board.json carries, so the
  // page's code and the board's data are visibly the same arithmetic. With the model's own constants
  // this must return the row's implied value exactly.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * row.breadth_multiplier));
  }
  // The sandbox twin of impliedOf: the same arithmetic, but breadth follows the sandbox's breadth step
  // instead of the stored factor, so moving that slider moves the displayed values.
  function sandboxImpliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_step * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth));
  }
  function sandboxActive() {
    return state.sandbox.growth_weight !== DATA.model.growth_weight ||
      state.sandbox.maturity_floor !== DATA.model.maturity_floor ||
      state.sandbox.breadth_step !== DATA.model.breadth_step;
  }
  function effectiveModel() {
    if (!sandboxActive()) return DATA.model;
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    m.growth_weight = state.sandbox.growth_weight;
    m.maturity_floor = state.sandbox.maturity_floor;
    m.breadth_step = state.sandbox.breadth_step;
    return m;
  }
  // The value the table shows for a row: the board's number, or the sandbox's recompute while the
  // sandbox is moved. The sandbox is page-side only and never changes board.json.
  function displayedImplied(row) {
    if (!sandboxActive()) return row.implied_value_usd;
    return sandboxImpliedOf(row, effectiveModel());
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the weekly action, the capital, the hold and every cost and time. No name is
  // special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function categoryKind(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'curator';
    if (c.indexOf('basis') >= 0) return 'basis';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'staking';
    if (c.indexOf('cdp') >= 0) return 'cdp';
    if (c.indexOf('collateral') >= 0) return 'collateral';
    if (c.indexOf('lend') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged') >= 0) return 'dex';
    if (c.indexOf('yield') >= 0) return 'yield';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'derivatives';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'payments';
    if (c === 'chain') return 'chain';
    if (c.indexOf('stable') >= 0) return 'stable';
    return 'other';
  }
  function actionFor(p, capital, chain) {
    var name = p.name;
    switch (categoryKind(p)) {
      case 'lending': return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
      case 'cdp': return 'Lock $' + capital + ' of collateral in ' + name + ' on ' + chain + ', mint a small amount of its stable asset against it, and keep the vault open.';
      case 'collateral': return 'Supply $' + capital + ' of collateral to ' + name + ' on ' + chain + ', borrow a small amount against it, and keep the loan healthy.';
      case 'dex': return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
      case 'yield': return 'Deposit $' + capital + " into " + name + "'s highest-yield vault on " + chain + ' and keep the shares.';
      case 'bridge': return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
      case 'staking': return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
      case 'derivatives': return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
      case 'prediction': return 'Fund $' + capital + ' and place one market position on ' + name + '.';
      case 'curator': return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
      case 'rwa': return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
      case 'insurance': return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
      case 'basis': return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and hold the delta-neutral position.';
      case 'payments': return 'Route $' + capital + ' through ' + name + ' on ' + chain + ' and keep the account active for the next payment.';
      case 'chain': return 'Bridge $' + capital + ' to ' + name + ' and use one of its native apps so the wallet is active on the chain.';
      case 'stable': return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
      default: return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    }
  }
  function weeklyActionFor(p) {
    switch (categoryKind(p)) {
      case 'lending': return 'Borrow a small amount against the position and repay it the same week so the account shows borrowing activity.';
      case 'cdp': return 'Adjust the vault once a week, minting or repaying a small amount so the account shows active management.';
      case 'collateral': return 'Top up the collateral or repay a little of the loan each week so the account shows active borrowing.';
      case 'dex': return 'Swap a small amount in the pool and add a little more liquidity so the account shows trading and LP activity.';
      case 'yield': return 'Claim any yield and compound it back into the vault each week so the account shows compounding.';
      case 'bridge': return 'Bridge a small amount back or onward through the protocol each week so the account shows repeated bridging.';
      case 'staking': return 'Claim any staking reward and restake it each week so the account shows compounding.';
      case 'derivatives': return 'Open and close one small hedged trade each week so the account shows trading activity.';
      case 'prediction': return 'Place one more small market position each week so the account shows repeated prediction activity.';
      case 'curator': return 'Deposit a small top-up into the vault each week so the account shows repeated allocation.';
      case 'rwa': return 'Buy a small top-up of the yield asset each week so the account shows repeated minting.';
      case 'insurance': return 'Keep the policy active and top it up when it nears expiry so the account shows continuous cover.';
      case 'basis': return 'Rebalance the basis position once a week so the account shows active management.';
      case 'payments': return 'Make one more payment through the protocol each week so the account shows repeated use.';
      case 'chain': return 'Use one native app on the chain each week so the account shows on-chain activity.';
      case 'stable': return 'Mint or redeem a small amount of the stable asset each week so the account shows repeated use.';
      default: return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
    }
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyActionFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Check ' + p.name + "'s points or leaderboard page each week and finish any social quest it lists, such as following its account or joining its community.", cost: 'no fee to check; gas only for on-chain quests', time: '10 minutes a week' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCHLIST.has(r.slug)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = displayedImplied(a); bv = displayedImplied(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { class: 'model-tag', text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M</b> of TVL and no token on record. The early radar adds <b>' + DATA.early_size + '</b> pre-token protocols below that floor. Implied value is a model, not a promise: a protocol may never issue a token, and a token may trade far from its implied value.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  var tableHost, countEl, modelPanelEl, sandboxEls = {};

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); renderTable(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); renderTable(); });
    var wl = el('button', { type: 'button', class: 'toggle', id: 'watchlist-only', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only' });
    wl.addEventListener('click', function () {
      state.watchlistOnly = !state.watchlistOnly;
      wl.setAttribute('aria-pressed', state.watchlistOnly ? 'true' : 'false');
      writeHash(); renderTable();
    });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token' });
    pre.addEventListener('click', function () { state.tab = 'pre-token'; renderTable(); });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token' });
    live.addEventListener('click', function () { state.tab = 'live'; renderTable(); });
    countEl = el('span', { class: 'count' });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { text: 'Scope' }), wl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      countEl
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderTable(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var parts = [];
    if (sandboxActive()) {
      parts.push(el('p', { class: 'sandbox-note', text: 'Sandbox active: implied values below are recomputed in your browser with the sandbox settings. They do not change board.json.' }));
    }
    if (list.length === 0) {
      parts.push(el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); buildShell(); } })
      )));
      return parts;
    }
    var max = 1;
    list.forEach(function (r) { var v = displayedImplied(r); if (v > max) max = v; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var shown = displayedImplied(r);
      var nameCell = el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      );
      if (WATCHLIST.has(r.slug)) nameCell.appendChild(el('span', { class: 'badge', text: 'watchlist' }));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, nameCell),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shown / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shown) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    parts.push(el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    ));
    return parts;
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return [el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    )];
  }

  function sliderField(key, label, min, max, step) {
    var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(state.sandbox[key]), 'aria-label': label });
    var output = el('output', { text: String(state.sandbox[key]) });
    input.addEventListener('input', function () {
      state.sandbox[key] = parseFloat(input.value);
      output.textContent = input.value;
      renderTable();
    });
    sandboxEls[key] = { input: input, output: output };
    return el('div', { class: 'slider-field' }, el('label', null, el('span', { text: label }), output), input);
  }

  function modelPanel() {
    var m = DATA.model;
    var multiples = el('div', { class: 'multiples' });
    Object.keys(DATA.category_multiples || {}).forEach(function (c) {
      multiples.appendChild(el('div', null, el('span', { text: c }), el('b', { text: fmtMult(DATA.category_multiples[c]) })));
    });
    multiples.appendChild(el('div', null, el('span', { text: 'All other categories (overall median)' }), el('b', { text: fmtMult(DATA.overall_multiple) })));
    var reset = el('button', { class: 'button ghost', type: 'button', text: 'Reset to model defaults' });
    reset.addEventListener('click', function () {
      state.sandbox.growth_weight = DATA.model.growth_weight;
      state.sandbox.maturity_floor = DATA.model.maturity_floor;
      state.sandbox.breadth_step = DATA.model.breadth_step;
      Object.keys(sandboxEls).forEach(function (k) {
        sandboxEls[k].input.value = String(state.sandbox[k]);
        sandboxEls[k].output.textContent = String(state.sandbox[k]);
      });
      renderTable();
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ', el('b', { text: 'categoryMultiple' }),
        ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight +
        ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range +
        ') x (1 + ' + m.breadth_step + ' x min(chains - 1, ' + m.breadth_max_extra + ')) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category (at least ' + m.category_min_live + ' of them), or the overall median when a category holds too few live protocols; it is clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Breadth counts the chains a protocol runs on. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      el('h3', { text: 'Category multiples from this snapshot' }),
      multiples,
      el('div', { class: 'sandbox' },
        el('div', { class: 'sandbox-head' },
          el('h3', { text: 'Model sandbox — try the model yourself' }),
          reset
        ),
        el('p', { class: 'sub', text: 'Move a slider and the board recomputes in your browser. The sandbox is page-side only: it never changes board.json, and the detail view still shows the board number beside the sandbox number.' }),
        el('div', { class: 'sandbox-grid' },
          sliderField('growth_weight', 'Growth weight', 0, 1.2, 0.05),
          sliderField('maturity_floor', 'Maturity floor', 0, 0.9, 0.05),
          sliderField('breadth_step', 'Breadth step per chain', 0, 0.05, 0.005)
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var matches = recomputed === row.implied_value_usd;
    var equation = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
      el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
      el('div', null, el('span', { text: 'Category' }), el('b', { class: 'num', text: row.category || 'Other' })),
      el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
      el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
      el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
      el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: fmtMult(row.breadth_multiplier) })),
      el('div', null, el('span', { text: 'Implied value (board)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
      el('div', null, el('span', { text: 'Recomputed by this page' }), el('b', { class: matches ? 'num match-ok' : 'num match-bad', text: fmtUsd(recomputed) + (matches ? ' — matches' : ' — differs') }))
    );
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCHLIST.has(row.slug) ? ' — watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      equation,
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (matches ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    if (sandboxActive()) {
      var sandboxValue = sandboxImpliedOf(row, effectiveModel());
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Sandbox value' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'With the sandbox settings' }), el('b', { class: 'num', text: fmtUsd(sandboxValue) }))
        ),
        el('p', { class: 'sub', text: 'Recomputed in your browser from the sandbox sliders. The sandbox never changes board.json.' })
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function renderTable() {
    if (!tableHost) return;
    tableHost.textContent = '';
    var parts = state.tab === 'pre-token' ? boardTable() : liveTable();
    parts.forEach(function (p) { tableHost.appendChild(p); });
    if (countEl) {
      countEl.textContent = state.tab === 'pre-token'
        ? filteredRows().length + ' rows shown' + (sandboxActive() ? ' — sandbox on' : '')
        : DATA.live.length + ' live-token protocols';
    }
    // The model panel belongs to the pre-token board; hide it on the live-token tab.
    if (modelPanelEl) modelPanelEl.style.display = state.tab === 'pre-token' ? '' : 'none';
    // Keep the tab buttons' pressed state in step with the state.
    var tabs = document.querySelectorAll('.tabs button');
    if (tabs.length === 2) {
      tabs[0].setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
      tabs[1].setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    }
    if (state.selected) openDetail(state.selected);
  }

  function buildShell() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    tableHost = el('div', null);
    shell.appendChild(tableHost);
    modelPanelEl = modelPanel();
    shell.appendChild(modelPanelEl);
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    renderTable();
  }

  readHash();
  buildShell();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
