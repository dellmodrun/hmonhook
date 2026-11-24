(function () {
  'use strict';
  var list = document.getElementById('home-market-list');
  if (!list) return;
  var officialCard = document.getElementById('home-official-card');
  var count = document.getElementById('home-market-count');
  var live = document.getElementById('home-market-live');
  var search = document.getElementById('home-market-search');
  var message = document.getElementById('home-market-message');
  var allRows = [];
  var pairs = new Map();
  var directoryError = false;
  var validMint = function (value) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || '')); };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function safeUrl(value) {
    try { var url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
    catch (_) { return ''; }
  }
  function short(value) { return value.slice(0, 5) + '…' + value.slice(-5); }
  function money(value, compact) {
    var amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
      notation: compact ? 'compact' : 'standard', maximumFractionDigits: amount < 1 ? 8 : 2 }).format(amount);
  }
  function card(row, pair) {
    var mint = row.mint;
    var token = pair && pair.baseToken && pair.baseToken.address === mint ? pair.baseToken : {};
    var image = safeUrl(row.image || (pair && pair.info && pair.info.imageUrl));
    var name = row.name || token.name || 'Unresolved token';
    var symbol = row.symbol || token.symbol || '—';
    var change = pair && pair.priceChange && Number(pair.priceChange.h24);
    var changeText = Number.isFinite(change) ? (change > 0 ? '+' : '') + change.toFixed(2) + '% / 24H' : 'Awaiting market data';
    var chartUrl = safeUrl(pair && pair.url);
    var article = document.createElement('article');
    article.className = 'market-card';
    article.dataset.mint = mint;
    article.innerHTML =
      '<div class="market-card-head"><div class="market-token-image">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' : '<span>' + escapeHtml(symbol.slice(0, 2)) + '</span>') +
      '</div><div><div class="market-badges"><b>VERIFIED LAUNCH</b><b class="' + (pair ? 'live' : 'pending') + '">' +
        (pair ? 'LIVE MARKET' : 'AWAITING INDEX') + '</b></div><h2>' + escapeHtml(name) + '</h2><p>$' + escapeHtml(symbol) + ' · ' + escapeHtml(short(mint)) + '</p></div></div>' +
      '<div class="market-price"><span>PRICE USD</span><strong>' + money(pair && pair.priceUsd, false) + '</strong><em>' + escapeHtml(changeText) + '</em></div>' +
      '<div class="market-metrics"><div><span>MARKET CAP</span><b>' + money(pair && (pair.marketCap || pair.fdv), true) + '</b></div><div><span>LIQUIDITY</span><b>' + money(pair && pair.liquidity && pair.liquidity.usd, true) + '</b></div><div><span>VOLUME 24H</span><b>' + money(pair && pair.volume && pair.volume.h24, true) + '</b></div><div><span>LAUNCH DATE</span><b>' + escapeHtml(row.created_at ? new Date(row.created_at).toLocaleDateString('en-US') : '—') + '</b></div></div>' +
      '<div class="market-ca"><span>MINT</span><code>' + escapeHtml(mint) + '</code><button type="button" data-copy-mint="' + escapeHtml(mint) + '">COPY</button></div>' +
      '<div class="market-actions"><a class="button button-solid" href="./intent/?outputMint=' + encodeURIComponent(mint) + '">trade with intent</a><a class="button" href="https://pump.fun/coin/' + encodeURIComponent(mint) + '" target="_blank" rel="noreferrer">pump market</a>' +
        (chartUrl ? '<a class="button" href="' + escapeHtml(chartUrl) + '" target="_blank" rel="noreferrer">live chart</a>' : '') +
        '<a class="button" href="https://explorer.solana.com/address/' + encodeURIComponent(mint) + '" target="_blank" rel="noreferrer">explorer</a></div>' +
      '<p class="market-source">Pump creation verified on-chain. Market figures come from a third-party index and may be delayed.</p>';
    return article;
  }
  function empty(title, detail) {
    var box = document.createElement('div');
    box.className = 'market-empty';
    var heading = document.createElement('h2'); heading.textContent = title;
    var paragraph = document.createElement('p'); paragraph.textContent = detail;
    box.append(heading, paragraph);
    list.appendChild(box);
  }
  function render() {
    var rows = allRows.filter(function (row) { return row.mint !== window.hmonhookOfficialMint; });
    var visible = rows.slice(0, 30);
    count.textContent = directoryError ? '—' : String(rows.length);
    live.textContent = directoryError ? '—' : String(visible.filter(function (row) { return pairs.has(row.mint); }).length);
    list.replaceChildren(officialCard);
    if (directoryError) {
      empty('Market directory is temporarily unavailable.', 'You can still search a Mint on the Markets page.');
      return;
    }
    visible.forEach(function (row) { list.appendChild(card(row, pairs.get(row.mint))); });
  }
  async function load() {
    try {
      var configResponse = await fetch(new URL('markets/registry-service.json', document.baseURI), { cache: 'no-store' });
      if (!configResponse.ok) throw new Error('Directory unavailable');
      var endpoint = (await configResponse.json()).endpoint;
      if (!endpoint || new URL(endpoint).protocol !== 'https:') throw new Error('Directory unavailable');
      var response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error('Directory unavailable');
      var data = await response.json();
      var seen = new Set();
      allRows = (Array.isArray(data.launches) ? data.launches : []).filter(function (row) {
        if (!row || !validMint(row.mint) || seen.has(row.mint)) return false;
        seen.add(row.mint); return true;
      });
      var recent = allRows.slice(0, 30);
      if (recent.length) {
        try {
          var prices = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + recent.map(function (row) { return row.mint; }).join(','));
          if (prices.ok) {
            var found = await prices.json();
            (Array.isArray(found) ? found : []).forEach(function (pair) {
              var mint = pair && pair.baseToken && pair.baseToken.address;
              if (!validMint(mint) || !recent.some(function (row) { return row.mint === mint; })) return;
              var existing = pairs.get(mint);
              if (!existing || Number(pair.liquidity && pair.liquidity.usd || 0) > Number(existing.liquidity && existing.liquidity.usd || 0)) pairs.set(mint, pair);
            });
          }
        } catch (_) { /* Verified launches remain visible if the price index is unavailable. */ }
      }
      directoryError = false;
    } catch (_) { directoryError = true; }
    render();
  }
  list.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-copy-mint]');
    if (!button) return;
    try { await navigator.clipboard.writeText(button.dataset.copyMint); button.textContent = 'COPIED'; }
    catch (_) { button.textContent = 'COPY FAILED'; }
    setTimeout(function () { button.textContent = 'COPY'; }, 1800);
  });
  window.addEventListener('hmonhook-official-updated', render);
  search.addEventListener('submit', function (event) {
    event.preventDefault();
    var mint = document.getElementById('home-market-mint').value.trim();
    if (!validMint(mint)) { message.textContent = 'Enter a valid Solana Mint address.'; return; }
    location.href = new URL('markets/?mint=' + encodeURIComponent(mint), document.baseURI).href;
  });
  void load();
}());
