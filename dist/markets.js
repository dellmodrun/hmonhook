(function () {
  "use strict";

  var STORAGE_KEY = "joltwork.launches.v1";
  var state = { launches: [], pairs: new Map(), filter: "all", sort: "newest", loading: false, publishing: false };
  var sharedMint = new URLSearchParams(window.location.search).get("mint");
  if (sharedMint && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sharedMint)) sharedMint = null;
  var byId = function (id) { return document.getElementById(id); };
  if (!byId("market-grid")) return;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function safeUrl(value) {
    try { var url = new URL(value, document.baseURI); return url.protocol === "https:" ? url.href : ""; }
    catch (_) { return ""; }
  }

  function validMint(value) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || "")); }
  function short(value) { return value ? value.slice(0, 5) + "…" + value.slice(-5) : "—"; }
  function number(value) { var result = Number(value); return Number.isFinite(result) ? result : 0; }
  function timestamp(value) {
    var numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function money(value, compact) {
    var amount = number(value);
    if (!amount) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: amount < 1 ? 6 : 2 }).format(amount);
  }
  function signed(value) {
    var amount = number(value);
    if (!Number.isFinite(amount)) return "—";
    return (amount > 0 ? "+" : "") + amount.toFixed(2) + "%";
  }
  function time(value) {
    if (!value) return "pending";
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? "pending" : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
  }

  function loadLocal() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(function (item) { return validMint(item && item.mint); }).map(function (item) {
        return Object.assign({}, item, { source: item.status === "pending" && !item.directoryPublished ? "pending" : "device",
          verified: item.status !== "pending" || !!item.directoryPublished });
      }) : [];
    } catch (_) { return []; }
  }

  async function loadRegistry() {
    var entries = [];
    try {
      var response = await fetch(new URL("markets/registry.json", document.baseURI), { cache: "no-store" });
      if (!response.ok) throw new Error("registry unavailable");
      var data = await response.json();
      entries = Array.isArray(data.launches) ? data.launches.filter(function (item) { return validMint(item && item.mint); }).map(function (item) {
        return Object.assign({}, item, { source: "registry", verified: true });
      }) : [];
    } catch (_) { /* The independent directory can still be available. */ }
    try {
      var configResponse = await fetch(new URL("markets/registry-service.json", document.baseURI), { cache: "no-store" });
      var config = configResponse.ok ? await configResponse.json() : {};
      if (config.endpoint && new URL(config.endpoint).protocol === "https:") {
        var liveResponse = await fetch(config.endpoint, { cache: "no-store" });
        if (!liveResponse.ok) throw new Error("verified directory unavailable");
        var liveData = await liveResponse.json();
        if (Array.isArray(liveData.launches)) entries = entries.concat(liveData.launches.filter(function (item) {
          return validMint(item && item.mint);
        }).map(function (item) {
          return { mint: item.mint, signature: item.signature, creator: item.creator, name: item.name,
            symbol: item.symbol, description: item.description, image: item.image,
            website: item.website, twitter: item.twitter, createdAt: item.created_at,
            source: "verified-pump", verified: true };
        }));
      }
    } catch (_) { /* Keep the static and device receipts visible. */ }
    return entries;
  }

  function mergeLaunches(items) {
    var map = new Map();
    items.forEach(function (item) {
      if (!item || !validMint(item.mint)) return;
      var previous = map.get(item.mint) || {};
      map.set(item.mint, Object.assign({}, previous, item));
    });
    return Array.from(map.values());
  }

  async function fetchPairs(mints) {
    var unique = Array.from(new Set(mints.filter(validMint)));
    for (var index = 0; index < unique.length; index += 30) {
      var batch = unique.slice(index, index + 30);
      try {
        var endpoint = "https://api.dexscreener.com/tokens/v1/solana/" + batch.join(",");
        var response = await fetch(endpoint, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("market data request failed");
        var pairs = await response.json();
        batch.forEach(function (mint) {
          var candidates = (Array.isArray(pairs) ? pairs : []).filter(function (pair) {
            return pair && pair.baseToken && pair.baseToken.address === mint;
          });
          candidates.sort(function (a, b) { return number(b.liquidity && b.liquidity.usd) - number(a.liquidity && a.liquidity.usd); });
          if (candidates[0]) state.pairs.set(mint, candidates[0]);
        });
      } catch (_) { /* Keep launch cards visible when the market-data provider is unavailable. */ }
    }
  }

  function pairToken(pair, mint) {
    if (!pair) return null;
    return pair.baseToken && pair.baseToken.address === mint ? pair.baseToken : null;
  }

  function sortLaunches(items) {
    return items.sort(function (a, b) {
      var pairA = state.pairs.get(a.mint) || {};
      var pairB = state.pairs.get(b.mint) || {};
      if (state.sort === "volume") return number(pairB.volume && pairB.volume.h24) - number(pairA.volume && pairA.volume.h24);
      if (state.sort === "liquidity") return number(pairB.liquidity && pairB.liquidity.usd) - number(pairA.liquidity && pairA.liquidity.usd);
      if (state.sort === "market-cap") return number(pairB.marketCap || pairB.fdv) - number(pairA.marketCap || pairA.fdv);
      return timestamp(b.createdAt || b.pairCreatedAt) - timestamp(a.createdAt || a.pairCreatedAt);
    });
  }

  function render() {
    var grid = byId("market-grid");
    var officialCard = byId("official-market-card");
    var launches = state.launches.filter(function (item) {
      if (item.mint === window.hmonhookOfficialMint) return false;
      var live = state.pairs.has(item.mint);
      if (state.filter === "live") return live;
      if (state.filter === "awaiting") return !live;
      if (state.filter === "device") return item.source === "device" || item.source === "pending";
      return true;
    });
    sortLaunches(launches);

    var verifiedLaunches = state.launches.filter(function (item) { return item.source !== "search" && item.source !== "pending"; });
    var liveCount = verifiedLaunches.filter(function (item) { return state.pairs.has(item.mint); }).length;
    var volume = verifiedLaunches.reduce(function (sum, item) { var pair = state.pairs.get(item.mint); return sum + number(pair && pair.volume && pair.volume.h24); }, 0);
    var liquidity = verifiedLaunches.reduce(function (sum, item) { var pair = state.pairs.get(item.mint); return sum + number(pair && pair.liquidity && pair.liquidity.usd); }, 0);
    byId("market-total").textContent = String(verifiedLaunches.length);
    byId("market-live").textContent = String(liveCount);
    byId("market-volume").textContent = money(volume, true);
    byId("market-liquidity").textContent = money(liquidity, true);
    byId("market-updated").textContent = "UPDATED " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    grid.replaceChildren(officialCard);
    if (!launches.length) return;
    grid.insertAdjacentHTML('beforeend', launches.map(function (item) {
      var pair = state.pairs.get(item.mint);
      var token = pairToken(pair, item.mint) || {};
      var info = pair && pair.info || {};
      var image = safeUrl(item.image || info.imageUrl);
      var name = item.name || token.name || "Unresolved token";
      var symbol = item.symbol || token.symbol || "—";
      var change = pair && pair.priceChange ? number(pair.priceChange.h24) : null;
      var pump = "https://pump.fun/coin/" + encodeURIComponent(item.mint);
      var explorer = "https://explorer.solana.com/address/" + encodeURIComponent(item.mint);
      var marketUrl = pair ? safeUrl(pair.url) : "";
      return '<article class="market-card">' +
        '<div class="market-card-head"><div class="market-token-image">' + (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' : '<span>' + escapeHtml(symbol.slice(0, 2)) + '</span>') + '</div>' +
        '<div><div class="market-badges"><b>' + (item.source === "pending" ? 'CONFIRMATION PENDING' : item.source === "search" ? 'MINT SEARCH' : item.official ? 'OFFICIAL TOKEN' : item.independent ? 'INDEPENDENT LAUNCH' : item.source === 'verified-pump' ? 'VERIFIED LAUNCH' : item.source === 'device' ? 'YOUR DEVICE' : 'REGISTRY ENTRY') + '</b><b class="' + (pair ? 'live' : 'pending') + '">' + (pair ? 'LIVE MARKET' : 'AWAITING INDEX') + '</b></div><h2>' + escapeHtml(name) + '</h2><p>$' + escapeHtml(symbol) + ' · ' + escapeHtml(short(item.mint)) + '</p></div></div>' +
        '<div class="market-price"><span>PRICE USD</span><strong>' + money(pair && pair.priceUsd, false) + '</strong><em class="' + (change != null && change < 0 ? 'negative' : '') + '">' + (change == null ? 'not indexed' : signed(change) + ' / 24H') + '</em></div>' +
        '<div class="market-metrics"><div><span>MARKET CAP</span><b>' + money(pair && (pair.marketCap || pair.fdv), true) + '</b></div><div><span>LIQUIDITY</span><b>' + money(pair && pair.liquidity && pair.liquidity.usd, true) + '</b></div><div><span>VOLUME 24H</span><b>' + money(pair && pair.volume && pair.volume.h24, true) + '</b></div><div><span>' + (item.createdAt ? 'LAUNCH DATE' : 'PAIR DATE') + '</span><b>' + escapeHtml(time(item.createdAt || (pair && pair.pairCreatedAt))) + '</b></div></div>' +
        '<div class="market-ca"><span>MINT</span><code>' + escapeHtml(item.mint) + '</code><button type="button" data-copy-mint="' + escapeHtml(item.mint) + '">COPY</button></div>' +
        '<div class="market-actions"><a class="button button-solid" href="./intent/?outputMint=' + encodeURIComponent(item.mint) + '">trade with intent</a><a class="button" href="' + escapeHtml(pump) + '" target="_blank" rel="noreferrer">pump market ↗</a>' + (marketUrl ? '<a class="button" href="' + escapeHtml(marketUrl) + '" target="_blank" rel="noreferrer">live chart ↗</a>' : '') + '<a class="button" href="' + escapeHtml(explorer) + '" target="_blank" rel="noreferrer">explorer ↗</a></div>' +
        '<p class="market-source">' + (item.source === "pending" ? 'The creation transaction was submitted, but confirmation is unresolved. Check its signature before trying again.' : item.official ? 'Verified official CA published by h/monhook.' : item.independent ? 'Independent mainnet launch with a finalized creation receipt; not the official h/monhook token.' : item.source === "verified-pump" ? 'Pump coin creation verified on-chain. This does not mean the developer locked tokens.' : item.source === "registry" ? 'Published h/monhook registry entry.' : item.source === "device" ? 'Launch receipt saved on this device after confirmation; verify its signature independently.' : 'Mint supplied for market discovery, not verified as an h/monhook launch.') + ' Market figures come from a third-party index and may be delayed.</p>' +
        '</article>';
    }).join(""));
  }

  async function retryDirectoryReceipts() {
    if (state.publishing) return;
    state.publishing = true;
    try {
      var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(stored)) return;
      var pending = stored.filter(function (item) {
        return item && !item.directoryPublished && validMint(item.mint) && validMint(item.creator) &&
          /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(item.signature || "");
      }).slice(0, 3);
      if (!pending.length) return;
      var configResponse = await fetch(new URL("markets/registry-service.json", document.baseURI), { cache: "no-store" });
      var endpoint = configResponse.ok ? (await configResponse.json()).endpoint : "";
      if (!endpoint || new URL(endpoint).protocol !== "https:") return;
      var changed = false;
      for (var item of pending) {
        try {
          var response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ signature: item.signature, mint: item.mint, creator: item.creator }) });
          if (response.ok) { item.directoryPublished = true; item.status = "confirmed"; changed = true; }
        } catch (_) { /* Retry on a later visit. */ }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        await refresh();
      }
    } catch (_) { /* Keep device receipts visible. */ }
    finally { state.publishing = false; }
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    var button = byId("market-refresh");
    button.disabled = true;
    button.textContent = "REFRESHING…";
    var registry = await loadRegistry();
    var searched = state.launches.filter(function (item) { return item.source === "search"; });
    if (sharedMint && !searched.some(function (item) { return item.mint === sharedMint; })) searched.push({ mint: sharedMint, source: "search" });
    state.launches = mergeLaunches(searched.concat(loadLocal(), registry));
    await fetchPairs(state.launches.map(function (item) { return item.mint; }));
    state.loading = false;
    button.disabled = false;
    button.textContent = "REFRESH DATA";
    render();
    void retryDirectoryReceipts();
  }

  byId("market-refresh").addEventListener("click", refresh);
  window.addEventListener('hmonhook-official-updated', render);
  byId("market-sort").addEventListener("change", function () { state.sort = this.value; render(); });
  document.querySelectorAll("[data-market-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      state.filter = button.dataset.marketFilter;
      document.querySelectorAll("[data-market-filter]").forEach(function (item) { item.classList.toggle("active", item === button); });
      render();
    });
  });
  byId("market-search-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var mint = byId("market-search").value.trim();
    var message = byId("market-search-message");
    if (!validMint(mint)) { message.textContent = "Enter a valid Solana Mint address."; return; }
    message.textContent = "Loading on-chain market data…";
    if (!state.launches.some(function (item) { return item.mint === mint; })) state.launches.unshift({ mint: mint, source: "search" });
    await fetchPairs([mint]);
    message.textContent = state.pairs.has(mint) ? "Live market found." : "Mint added; no indexed liquidity pool was found yet.";
    state.filter = "all";
    document.querySelectorAll("[data-market-filter]").forEach(function (item) { item.classList.toggle("active", item.dataset.marketFilter === "all"); });
    render();
  });
  if (sharedMint) {
    byId("market-search").value = sharedMint;
    byId("market-search-message").textContent = "Shared Mint loaded. Verify its address before trading.";
  }
  document.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-copy-mint]");
    if (!button) return;
    try { await navigator.clipboard.writeText(button.dataset.copyMint); button.textContent = "COPIED"; setTimeout(function () { button.textContent = "COPY"; }, 1200); }
    catch (_) { button.textContent = "COPY FAILED"; }
  });

  refresh();
}());
