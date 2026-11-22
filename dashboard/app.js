// Token Launch Radar's page. It reads window.RADAR — the data file main.ts writes beside this
// folder from the same board board.json carries — and renders the ranked board, its filters, a
// detail view per protocol with the model's own arithmetic, the tokenised peer set the multiples
// are learned from, and the method. No network: every figure shown is in that data file.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows;
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, sort: 'implied', selected: null };
  var RENDER_CAP = 150;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="chains">unreported</span>';
    return '<span class="' + (n >= 0 ? 'pos' : 'neg') + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageText(r) {
    if (!r.age_known || r.age_days === null) return 'unreported';
    if (r.age_days >= 365) return (r.age_days / 365.25).toFixed(1) + ' yrs';
    return r.age_days + ' days';
  }
  function chainText(chains) {
    if (chains.length <= 3) return esc(chains.join(', '));
    return esc(chains.slice(0, 3).join(', ')) + ' +' + (chains.length - 3);
  }
  function $(id) { return document.getElementById(id); }

  /* ---------- header and stats ---------- */

  $('lede').textContent =
    'One sealed snapshot of ' + D.protocol_count + ' protocols (DefiLlama, as of ' + D.as_of + '). ' +
    'The board ranks ' + D.board_size + ' protocols that record no token by an implied launch value, ' +
    'covers all ' + D.watchlist_size + ' protocols on the house watchlist, and keeps the ones whose ' +
    'token already trades apart, as the peer set the values are learned from.';

  $('stats').innerHTML =
    '<div class="stat"><b>' + D.protocol_count + '</b><span>protocols in the snapshot</span></div>' +
    '<div class="stat hot"><b>' + D.watchlist_size + ' of ' + D.watchlist_size + '</b><span>watchlist protocols on the board</span></div>' +
    '<div class="stat"><b>' + D.board_size + '</b><span>pre-token protocols ranked</span></div>' +
    '<div class="stat"><b>' + D.model.global_peer_count + '</b><span>tokenised peers behind the multiples</span></div>';

  /* ---------- controls ---------- */

  var cats = [];
  var chainsSeen = {};
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { chainsSeen[c] = true; });
  });
  cats.sort();
  var chainNames = Object.keys(chainsSeen).sort();

  $('controls').innerHTML =
    '<label>Search <input type="search" id="ctl-q" placeholder="name or slug"></label>' +
    '<label>Category <select id="ctl-cat"><option value="all">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select></label>' +
    '<label>Chain <select id="ctl-chain"><option value="all">All chains</option>' +
      chainNames.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select></label>' +
    '<label class="toggle"><input type="checkbox" id="ctl-watch"> Watchlist only</label>' +
    '<label>Sort <select id="ctl-sort">' +
      '<option value="implied">Implied value</option><option value="tvl">TVL</option>' +
      '<option value="growth">7-day growth</option><option value="age">Age</option>' +
      '<option value="multiple">Peer multiple</option></select></label>' +
    '<span class="count" id="ctl-count"></span>';

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      multiple: function (r) { return r.peer_multiple; }
    }[state.sort];
    out.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return out;
  }

  /* ---------- board ---------- */

  function renderBoard() {
    var list = filtered();
    $('ctl-count').textContent = list.length + ' of ' + rows.length + ' shown';
    var shown = list.slice(0, RENDER_CAP);
    var html = '<table><thead><tr>' +
      '<th>Rank</th><th>Protocol</th><th class="hide-s">Category</th><th class="hide-s">Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num hide-s">Age</th>' +
      '<th class="num hide-s">Multiple</th><th class="num">Implied value</th></tr></thead><tbody>';
    shown.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="is-selected"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td>' + (r.on_watchlist ? '<span class="dot" title="On the house watchlist"></span>' : '') +
          '<span class="name">' + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td class="hide-s">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains hide-s">' + chainText(r.chains) + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num hide-s">' + ageText(r) + '</td>' +
        '<td class="num hide-s">' + r.peer_multiple.toFixed(2) + 'x</td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b></td></tr>';
    });
    html += '</tbody></table>';
    if (list.length > shown.length) {
      html += '<p class="more-note">Showing the first ' + shown.length + ' of ' + list.length + ' matching protocols — narrow the search or a filter to see the rest.</p>';
    }
    $('board-wrap').innerHTML = html;
    var trs = $('board-wrap').querySelectorAll('tbody tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { select(this.getAttribute('data-slug')); });
    }
  }

  /* ---------- detail ---------- */

  function select(slug) {
    state.selected = slug;
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var recomputed = Math.round(r.tvl_usd * r.peer_multiple * r.momentum * r.maturity * r.breadth);
    var agree = recomputed === r.implied_value_usd
      ? 'The page recomputes the board\u2019s figure from these factors and lands on the same dollar.'
      : 'Factors are shown rounded to four places; the board\u2019s figure is computed from them as shown.';
    var badges = (r.on_watchlist ? '<span class="badge watch">On the house watchlist</span>' : '<span class="badge">Early radar — below the watchlist floor</span>') +
      '<span class="badge">' + esc(r.category || 'Uncategorised') + '</span>' +
      '<span class="badge">Rank ' + r.rank + ' of ' + D.board_size + '</span>' +
      '<span class="badge">Records no token</span>';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detail').innerHTML =
      '<button type="button" class="view-btn close-btn" id="detail-close">Close</button>' +
      '<h2>' + esc(r.name) + '</h2><div class="badges">' + badges + '</div>' +
      '<div class="figs">' +
        '<div class="fig"><span>TVL</span><b>' + usd(r.tvl_usd) + '</b></div>' +
        '<div class="fig"><span>7-day change</span><b>' + (r.change_7d === null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></div>' +
        '<div class="fig"><span>Tracked for</span><b>' + ageText(r) + '</b></div>' +
        '<div class="fig"><span>Chains</span><b>' + r.chains.length + '</b></div>' +
        '<div class="fig"><span>Implied value</span><b>' + usd(r.implied_value_usd) + '</b></div>' +
      '</div>' +
      '<div class="maths">' + usd(r.tvl_usd) + ' TVL &times; ' + r.peer_multiple.toFixed(4) + ' peer multiple &times; ' +
        r.momentum.toFixed(4) + ' momentum &times; ' + r.maturity.toFixed(4) + ' maturity &times; ' + r.breadth.toFixed(4) +
        ' breadth = <span class="eq">' + usd(r.implied_value_usd) + '</span>' +
        '<span class="why">Peer multiple: ' + esc(r.peer_basis) + '. Momentum from its 7-day TVL change, ' +
        'maturity from how long DefiLlama has tracked it' + (r.age_known ? '' : ' (its listing date is unreported, so it counts as one year)') +
        ', breadth from its ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': ' + esc(r.chains.join(', ')) + '. ' + agree + '</span></div>' +
      '<h3>How to farm ' + esc(r.name) + '</h3><ol class="steps">' + steps + '</ol>';
    $('detail').hidden = false;
    $('detail-close').addEventListener('click', function () {
      $('detail').hidden = true;
      state.selected = null;
      renderBoard();
    });
    renderBoard();
    $('detail').scrollIntoView({ block: 'nearest' });
  }

  /* ---------- peers ---------- */

  function renderPeers() {
    var html = '<table><thead><tr><th>Protocol</th><th class="hide-s">Token</th><th class="hide-s">Category</th>' +
      '<th class="num">TVL</th><th class="num">Market cap</th><th class="num">Its multiple</th><th class="num">7d</th></tr></thead><tbody>';
    D.peers.forEach(function (p) {
      html += '<tr><td><span class="name">' + esc(p.name) + '</span><span class="sub">' + esc(p.slug) + '</span></td>' +
        '<td class="hide-s">' + esc(p.symbol || '—') + '</td>' +
        '<td class="hide-s">' + esc(p.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td>' +
        '<td class="num"><b>' + usd(p.mcap_usd) + '</b></td>' +
        '<td class="num">' + p.multiple.toFixed(2) + 'x</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    });
    $('peers-wrap').innerHTML = html + '</tbody></table>';
  }

  /* ---------- method ---------- */

  function renderMethod() {
    var m = D.model;
    var catRows = m.category_multiples.map(function (c) {
      var used = c.peers >= m.min_category_peers;
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td>' +
        '<td class="num">' + c.multiple.toFixed(4) + 'x</td>' +
        '<td>' + (used ? 'Scores its own category' : 'Too few peers — the global median stands in') + '</td></tr>';
    }).join('');
    $('method').innerHTML =
      '<h2>How the value is worked out</h2>' +
      '<p>An implied value is a claim about one thing: if this protocol issued a token today and the ' +
      'market priced it the way it prices the same kind of protocol that already trades, what would ' +
      'that token be worth? It is not a prediction that a token will come.</p>' +
      '<p class="formula">implied value = TVL &times; peer multiple &times; momentum &times; maturity &times; breadth</p>' +
      '<p><code>Peer multiple</code> — the median market-cap / TVL of the snapshot\u2019s own tokenised protocols in the ' +
      'same category, each ratio first clamped to [0.01, 10] so one broken record cannot bend a median. A category ' +
      'needs at least ' + m.min_category_peers + ' tokenised peers to speak for itself; otherwise the global median, ' +
      m.global_multiple.toFixed(4) + 'x across ' + m.global_peer_count + ' protocols, stands in. The multiple used is ' +
      'clamped to [0.02, 3].</p>' +
      '<p><code>Momentum</code> — 1 + ' + m.momentum_per_pct + ' &times; the 7-day TVL change in per cent, clamped to [' +
      m.momentum_floor_pct + ', +' + m.momentum_cap_pct + ']: a protocol that doubled in a week scores 1.40, one that ' +
      'halved scores 0.80, and an unreported change scores 1.</p>' +
      '<p><code>Maturity</code> — ' + m.maturity_base + ' + ' + m.maturity_span + ' &times; years tracked (up to ' +
      m.maturity_full_years + ') / ' + m.maturity_full_years + ': a protocol tracked five years with no token earns the ' +
      'full factor; an unreported listing date counts as one year.</p>' +
      '<p><code>Breadth</code> — 1 + ' + m.breadth_per_chain + ' &times; each chain past the first, up to eight: a wider ' +
      'footprint is harder to walk away from.</p>' +
      '<p>The board covers every watchlist protocol, then the strongest early protocols below the $' +
      (D.floor_usd / 1e6) + 'M floor by TVL — skipping exchanges themselves, versioned pools, and wrapped, staked or ' +
      'bridged products of tokens that already trade, none of which is a launch still to come. No protocol is named ' +
      'in the model: the same arithmetic scores every row, and each row\u2019s detail view shows its own working.</p>' +
      '<h3>The multiples this snapshot taught the model</h3>' +
      '<table><thead><tr><th>Category</th><th class="num">Tokenised peers</th><th class="num">Median multiple</th><th>How it is used</th></tr></thead>' +
      '<tbody>' + catRows + '</tbody></table>';
  }

  /* ---------- wiring ---------- */

  $('ctl-q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('ctl-cat').addEventListener('change', function () { state.category = this.value; renderBoard(); });
  $('ctl-chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('ctl-watch').addEventListener('change', function () { state.watchOnly = this.checked; renderBoard(); });
  $('ctl-sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  $('view-board').addEventListener('click', function () {
    $('board-panel').hidden = false; $('peers-panel').hidden = true;
    $('view-board').classList.add('is-on'); $('view-peers').classList.remove('is-on');
  });
  $('view-peers').addEventListener('click', function () {
    $('board-panel').hidden = true; $('peers-panel').hidden = false;
    $('view-peers').classList.add('is-on'); $('view-board').classList.remove('is-on');
  });

  renderBoard();
  renderPeers();
  renderMethod();
  $('foot').textContent = 'Data: ' + D.source + '. Every figure on this page is computed from that snapshot by the entry\u2019s program; the page itself runs with no network.';
})();
