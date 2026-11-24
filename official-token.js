(function () {
  'use strict';
  var address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  var byId = function (id) { return document.getElementById(id); };
  var currentMint = null;
  var endpoint = '';
  var polling = false;
  var lastMarketLookup = 0;

  function money(value, compact) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
      notation: compact ? 'compact' : 'standard', maximumFractionDigits: number < 1 ? 8 : 2 }).format(number);
  }
  function setText(id, value) { if (byId(id)) byId(id).textContent = value; }
  function showMint(mint) {
    var published = !!mint;
    setText('official-ca', mint || 'TBA');
    setText('official-ca-note', published
      ? 'Official h/monhook Mint address. Verify the full address before trading.'
      : 'The official h/monhook contract address has not been published. Do not trust unofficial addresses.');
    setText('official-ca-faq', published
      ? 'The official h/monhook Mint is ' + mint + '. Verify the full address before trading.'
      : 'The official address is TBA. Check the full address here when it is published; do not rely on a ticker alone.');
    setText('official-market-mint', mint || 'TBA');
    setText('home-official-mint', published ? 'Mint: ' + mint.slice(0, 5) + '…' + mint.slice(-5) : 'Official Mint: TBA');
    if (byId('home-official-mint')) byId('home-official-mint').title = mint || '';
    setText('home-official-status', published ? 'OFFICIAL · CA PUBLISHED' : 'OFFICIAL · CA TBA');
    setText('home-official-note', published
      ? 'Verify the full Mint address before trading. Market data may be delayed.'
      : 'Official token. No CA has been published.');
    setText('official-market-status', published ? 'CA PUBLISHED' : 'CA TBA');
    setText('official-market-subtitle', published ? 'Solana mainnet · official Mint' : 'Official Mint address to be announced');
    setText('official-market-note', published
      ? 'Official CA published by h/monhook. Market figures come from a third-party index and may be delayed.'
      : 'The official CA has not been published. This reserved listing is not a live market.');
    if (byId('official-market-copy')) byId('official-market-copy').hidden = !published;
    if (byId('official-market-actions')) byId('official-market-actions').hidden = !published;
    if (published) {
      setText('home-official-price', 'Loading market data');
      ['price', 'cap', 'liquidity', 'volume'].forEach(function (part) { setText('official-market-' + part, '—'); });
      setText('official-market-change', 'Loading market data');
      if (byId('official-market-chart')) byId('official-market-chart').hidden = true;
      if (byId('official-market-trade')) byId('official-market-trade').href = './intent/?outputMint=' + encodeURIComponent(mint);
      if (byId('official-market-pump')) byId('official-market-pump').href = 'https://pump.fun/coin/' + encodeURIComponent(mint);
      if (byId('official-market-explorer')) byId('official-market-explorer').href = 'https://explorer.solana.com/address/' + encodeURIComponent(mint);
    } else {
      setText('home-official-price', 'Awaiting launch');
      ['price', 'cap', 'liquidity', 'volume'].forEach(function (part) { setText('official-market-' + part, '—'); });
      setText('official-market-change', 'Awaiting launch');
      if (byId('official-market-chart')) byId('official-market-chart').hidden = true;
    }
  }
  async function updateMarket(mint) {
    if (!mint || (!byId('official-market-price') && !byId('home-official-price'))) return;
    try {
      var response = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + encodeURIComponent(mint), { cache: 'no-store' });
      if (!response.ok) throw new Error('Index unavailable');
      var rows = await response.json();
      var pairs = (Array.isArray(rows) ? rows : []).filter(function (row) {
        return row && row.baseToken && row.baseToken.address === mint;
      }).sort(function (a, b) {
        return Number(b.liquidity && b.liquidity.usd || 0) - Number(a.liquidity && a.liquidity.usd || 0);
      });
      if (mint !== currentMint) return;
      var pair = pairs[0];
      setText('home-official-price', pair ? money(pair.priceUsd, false) : 'Awaiting market data');
      setText('official-market-price', money(pair && pair.priceUsd, false));
      setText('official-market-cap', money(pair && (pair.marketCap || pair.fdv), true));
      setText('official-market-liquidity', money(pair && pair.liquidity && pair.liquidity.usd, true));
      setText('official-market-volume', money(pair && pair.volume && pair.volume.h24, true));
      setText('official-market-change', pair && pair.priceChange && Number.isFinite(Number(pair.priceChange.h24))
        ? Number(pair.priceChange.h24).toFixed(2) + '% / 24H' : 'Awaiting market data');
      var chart = byId('official-market-chart');
      if (chart) {
        chart.hidden = !pair || !/^https:\/\//.test(pair.url || '');
        if (!chart.hidden) chart.href = pair.url;
      }
    } catch (_) {
      setText('official-market-change', 'Market data temporarily unavailable');
      if (byId('home-official-price')) setText('home-official-price', 'Market data unavailable');
    }
  }
  async function poll() {
    if (polling || !endpoint || document.visibilityState === 'hidden') return;
    polling = true;
    try {
      var response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error('Official token feed unavailable');
      var data = await response.json();
      var mint = data && data.token && data.token.mint;
      if (mint !== null && mint !== undefined && !address.test(String(mint))) throw new Error('Invalid official Mint');
      mint = mint || null;
      if (mint !== currentMint) {
        currentMint = mint;
        window.hmonhookOfficialMint = mint;
        showMint(mint);
        window.dispatchEvent(new Event('hmonhook-official-updated'));
        lastMarketLookup = 0;
      }
      if (mint && Date.now() - lastMarketLookup > 30000) {
        lastMarketLookup = Date.now();
        void updateMarket(mint);
      }
    } catch (_) {
      if (currentMint === null) setText('official-market-note', 'Official address feed is temporarily unavailable. Verify the CA before trading.');
    } finally { polling = false; }
  }
  if (byId('official-market-copy')) byId('official-market-copy').addEventListener('click', async function () {
    if (!currentMint) return;
    try { await navigator.clipboard.writeText(currentMint); this.textContent = 'COPIED'; }
    catch (_) { this.textContent = 'COPY FAILED'; }
    var button = this;
    setTimeout(function () { button.textContent = 'COPY'; }, 1800);
  });
  fetch(new URL('markets/registry-service.json', document.baseURI), { cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : {}; })
    .then(function (config) {
      var url = new URL(config.officialEndpoint || '', document.baseURI);
      if (url.protocol !== 'https:') return;
      endpoint = url.href;
      void poll();
      setInterval(poll, 2000);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') void poll(); });
    }).catch(function () { /* Keep the unpublished placeholder. */ });
}());
