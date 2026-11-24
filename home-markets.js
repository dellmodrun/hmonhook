(function () {
  'use strict';
  var list = document.getElementById('home-market-list');
  if (!list) return;
  var count = document.getElementById('home-market-count');
  var live = document.getElementById('home-market-live');
  var search = document.getElementById('home-market-search');
  var message = document.getElementById('home-market-message');
  var validMint = function (value) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || '')); };
  function short(value) { return value.slice(0, 5) + '…' + value.slice(-5); }
  function money(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 'Awaiting market data';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
      maximumFractionDigits: number < 1 ? 8 : 2 }).format(number);
  }
  function empty(title, detail) {
    list.replaceChildren();
    var card = document.createElement('div'); card.className = 'home-market-empty';
    var heading = document.createElement('strong'); heading.textContent = title;
    var text = document.createElement('p'); text.textContent = detail;
    card.append(heading, text); list.appendChild(card);
  }
  function card(row, pair) {
    var article = document.createElement('article'); article.className = 'home-market-card';
    var top = document.createElement('div'); top.className = 'home-market-card-top';
    var name = document.createElement('strong'); name.textContent = row.name || 'Unnamed coin';
    var tag = document.createElement('span'); tag.textContent = pair ? 'LIVE MARKET' : 'AWAITING MARKET DATA';
    top.append(name, tag);
    var identity = document.createElement('p'); identity.textContent = '$' + (row.symbol || '—') + ' · ' + short(row.mint);
    var price = document.createElement('b'); price.textContent = pair ? money(pair.priceUsd) : 'Awaiting market data';
    var note = document.createElement('small');
    note.textContent = pair ? 'Price from a third-party market index. May be delayed.' : 'Pump launch verified. Market data may appear after trading starts.';
    var link = document.createElement('a'); link.href = './markets/?mint=' + encodeURIComponent(row.mint);
    link.textContent = 'View market';
    article.append(top, identity, price, note, link);
    return article;
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
      var rows = (Array.isArray(data.launches) ? data.launches : []).filter(function (row) {
        if (!row || !validMint(row.mint) || seen.has(row.mint)) return false;
        seen.add(row.mint); return true;
      });
      count.textContent = String(rows.length);
      if (!rows.length) {
        live.textContent = '0';
        empty('The first verified launch will appear here.', 'Browse markets by Mint or create a coin to start the directory.');
        return;
      }
      var recent = rows.slice(0, 3);
      var pairs = new Map();
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
      } catch (_) { /* Verified launches remain visible if price indexing is unavailable. */ }
      live.textContent = String(recent.filter(function (row) { return pairs.has(row.mint); }).length);
      list.replaceChildren();
      recent.forEach(function (row) { list.appendChild(card(row, pairs.get(row.mint))); });
    } catch (_) {
      count.textContent = '—'; live.textContent = '—';
      empty('Market directory is temporarily unavailable.', 'You can still search a Mint on the Markets page.');
    }
  }
  search.addEventListener('submit', function (event) {
    event.preventDefault();
    var mint = document.getElementById('home-market-mint').value.trim();
    if (!validMint(mint)) { message.textContent = 'Enter a valid Solana Mint address.'; return; }
    location.href = new URL('markets/?mint=' + encodeURIComponent(mint), document.baseURI).href;
  });
  void load();
}());
