(function () {
  "use strict";

  var cachedWalletAddress = sessionStorage.getItem("joltwork-wallet") || null;
  var walletAddress = null;
  var verifiedMetadataUri = null;
  var verifiedMetadata = null;
  var launchManifestReady = false;
  var intentManifestReady = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function hex(bytes) {
    return Array.from(bytes).map(function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  async function sha256(value) {
    var encoded = new TextEncoder().encode(value);
    return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)));
  }

  function unsignedInteger(value, field) {
    if (!/^\d+$/.test(value)) throw new Error(field + " must be an unsigned integer");
    return value;
  }

  function solanaAddress(value, field) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new Error(field + " must be a valid base58 Solana address");
    return value;
  }

  function metadataUri(value) {
    var parsed;
    try { parsed = new URL(value); } catch (error) { throw new Error("metadata uri must be a valid URL"); }
    if (parsed.protocol !== "https:") throw new Error("metadata uri must use https");
    return parsed.href;
  }

  function solanaRpcUrl(value) {
    var url = metadataUri(value);
    if (!url.startsWith("https:")) throw new Error("RPC endpoint must use HTTPS");
    return url;
  }

  var activeProvider = null;
  var boundProviders = [];
  var walletButton = byId("connect-wallet");
  window.JoltworkWallet = {
    getProvider: function () { return activeProvider; },
    getAddress: function () { return walletAddress; }
  };

  function walletLogo(name) {
    var icons = window.JOLT_OFFICIAL_WALLET_ICONS || {};
    return icons[name] || "";
  }

  function shortAddress(address) {
    return address ? address.slice(0, 5) + "…" + address.slice(-5) : "NOT CONNECTED";
  }

  function showToast(message, tone) {
    var toast = byId("site-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "site-toast";
      toast.className = "site-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = "site-toast visible " + (tone || "");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove("visible"); }, 2600);
  }

  function setWalletAddress(address, providerObject) {
    walletAddress = address ? String(address) : null;
    activeProvider = providerObject || null;
    if (walletAddress) sessionStorage.setItem("joltwork-wallet", walletAddress);
    else sessionStorage.removeItem("joltwork-wallet");
    var label = walletButton && walletButton.querySelector(".rail-label");
    if (label) label.textContent = walletAddress ? shortAddress(walletAddress) : "CONNECT WALLET";
    document.querySelectorAll("[data-wallet-state]").forEach(function (item) {
      item.textContent = walletAddress ? shortAddress(walletAddress) : "not connected";
      item.classList.toggle("connected", Boolean(walletAddress));
    });
    var disconnect = byId("wallet-disconnect");
    if (disconnect) disconnect.hidden = !walletAddress;
    var launchSubmit = byId("launch-submit");
    if (launchSubmit) launchSubmit.disabled = !walletAddress || !launchManifestReady || verifiedMetadataUri !== (byId("coin-uri") && byId("coin-uri").value.trim());
    var intentSubmit = byId("intent-submit");
    if (intentSubmit) intentSubmit.disabled = !walletAddress || !intentManifestReady;
  }

  function detectedWallets() {
    var wallets = [];
    var seen = [];
    function add(name, wallet, install) {
      if (wallet && typeof wallet.connect === "function" && seen.indexOf(wallet) === -1) {
        seen.push(wallet);
        wallets.push({ name: name, provider: wallet, install: install, icon: walletLogo(name), detected: true });
      } else if (!wallet) wallets.push({ name: name, provider: null, install: install, icon: walletLogo(name), detected: false });
    }
    add("Phantom", window.phantom && window.phantom.solana, "https://phantom.com/download");
    add("Solflare", window.solflare, "https://www.solflare.com/download/");
    add("Backpack", (window.backpack && (window.backpack.solana || window.backpack)) || (window.xnft && window.xnft.solana), "https://backpack.app/download");
    if (window.solana && seen.indexOf(window.solana) === -1) add("Solana Wallet", window.solana, "https://solana.com/ecosystem/explore?categories=wallet");
    return wallets;
  }

  function bindWalletEvents(wallet) {
    if (!wallet || typeof wallet.on !== "function" || boundProviders.indexOf(wallet) !== -1) return;
    boundProviders.push(wallet);
    wallet.on("accountChanged", function (publicKey) {
      if (publicKey) setWalletAddress(publicKey, wallet);
      else setWalletAddress(null, null);
    });
    wallet.on("disconnect", function () { setWalletAddress(null, null); });
  }

  function ensureWalletModal() {
    if (byId("wallet-modal")) return;
    var modal = document.createElement("div");
    modal.id = "wallet-modal";
    modal.className = "wallet-modal";
    modal.hidden = true;
    modal.innerHTML = '<button class="wallet-backdrop" data-wallet-close aria-label="Close wallet dialog"></button>' +
      '<section class="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title">' +
      '<div class="wallet-dialog-head"><div><span>SOLANA / SIGNING AUTHORITY</span><h2 id="wallet-title">Connect a wallet</h2></div><button class="wallet-close" data-wallet-close aria-label="Close">×</button></div>' +
      '<p>Select an injected wallet. h/monhook never requests a seed phrase or private key.</p>' +
      '<div id="wallet-options" class="wallet-options"></div>' +
      '<button id="wallet-disconnect" class="button wallet-disconnect" type="button">disconnect current wallet</button>' +
      '<small>Wallet marks are sourced from the official Solana Wallet Adapter packages. Only install wallets from their official websites and review every transaction before signing.</small>' +
      '</section>';
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-wallet-close]").forEach(function (item) {
      item.addEventListener("click", closeWalletModal);
    });
    byId("wallet-disconnect").addEventListener("click", disconnectWallet);
  }

  function renderWalletOptions() {
    var options = byId("wallet-options");
    if (!options) return;
    options.innerHTML = "";
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      var currentUrl = encodeURIComponent(window.location.href);
      var referrer = encodeURIComponent(window.location.origin);
      var mobileHelp = document.createElement("div");
      mobileHelp.className = "wallet-mobile-help";
      mobileHelp.innerHTML = '<b>Using a mobile browser?</b><p>Open h/monhook inside a wallet browser so the provider can be injected securely.</p>' +
        '<div><a href="https://phantom.com/ul/browse/' + currentUrl + '?ref=' + referrer + '">open in Phantom</a>' +
        '<a href="https://solflare.com/ul/v1/browse/' + currentUrl + '?ref=' + referrer + '">open in Solflare</a></div>';
      options.appendChild(mobileHelp);
    }
    detectedWallets().forEach(function (wallet) {
      var item;
      if (wallet.detected) {
        item = document.createElement("button");
        item.type = "button";
        item.className = "wallet-option";
        item.innerHTML = '<span class="wallet-badge">' + (wallet.icon ? '<img src="' + wallet.icon + '" alt="' + wallet.name + ' official logo">' : '<span aria-hidden="true">◆</span>') + '</span><span><b>' + wallet.name + '</b><small>detected in this browser</small></span><em>connect</em>';
        item.addEventListener("click", function () { connectWallet(wallet); });
      } else {
        item = document.createElement("a");
        item.className = "wallet-option muted";
        item.href = wallet.install;
        item.target = "_blank";
        item.rel = "noreferrer";
        item.innerHTML = '<span class="wallet-badge">' + (wallet.icon ? '<img src="' + wallet.icon + '" alt="' + wallet.name + ' official logo">' : '<span aria-hidden="true">◆</span>') + '</span><span><b>' + wallet.name + '</b><small>not detected</small></span><em>install ↗</em>';
      }
      options.appendChild(item);
    });
    byId("wallet-disconnect").hidden = !walletAddress;
  }

  function openWalletModal() {
    ensureWalletModal();
    renderWalletOptions();
    byId("wallet-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeWalletModal() {
    var modal = byId("wallet-modal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  async function connectWallet(wallet) {
    try {
      var connection = await wallet.provider.connect();
      var publicKey = connection && connection.publicKey || wallet.provider.publicKey;
      if (!publicKey) throw new Error("Wallet returned no public key");
      bindWalletEvents(wallet.provider);
      setWalletAddress(publicKey, wallet.provider);
      closeWalletModal();
      showToast(wallet.name + " connected · " + shortAddress(String(publicKey)), "success");
    } catch (error) {
      showToast(error && error.message ? error.message : "Wallet connection declined", "error");
    }
  }

  async function disconnectWallet() {
    try {
      if (activeProvider && typeof activeProvider.disconnect === "function") await activeProvider.disconnect();
    } catch (error) { /* the local session must still be cleared */ }
    setWalletAddress(null, null);
    closeWalletModal();
    showToast("Wallet disconnected");
  }

  async function restoreTrustedWallet() {
    if (!cachedWalletAddress) return;
    var wallets = detectedWallets().filter(function (wallet) { return wallet.detected; });
    for (var index = 0; index < wallets.length; index += 1) {
      var wallet = wallets[index];
      try {
        var publicKey = wallet.provider.publicKey;
        if (!publicKey) {
          var connection = await wallet.provider.connect({ onlyIfTrusted: true });
          publicKey = connection && connection.publicKey || wallet.provider.publicKey;
        }
        if (publicKey && String(publicKey) === cachedWalletAddress) {
          bindWalletEvents(wallet.provider);
          setWalletAddress(publicKey, wallet.provider);
          return;
        }
      } catch (error) { /* not previously approved in this wallet */ }
    }
    sessionStorage.removeItem("joltwork-wallet");
    cachedWalletAddress = null;
  }

  if (walletButton) walletButton.addEventListener("click", openWalletModal);
  document.querySelectorAll("[data-wallet-connect]").forEach(function (button) {
    button.addEventListener("click", openWalletModal);
  });
  setWalletAddress(null, null);
  restoreTrustedWallet();

  var launchForm = byId("launch-form");
  var metadataCheck = byId("metadata-check");
  var metadataUpload = byId("metadata-upload");
  if (metadataUpload) metadataUpload.addEventListener("click", async function () {
    var image = byId("coin-upload-image").files[0];
    if (!image || image.size > 2000000 || !image.size) return showToast("Choose a PNG, JPEG or WebP image under 2 MB", "error");
    var name = byId("coin-name").value.trim();
    var symbol = byId("coin-symbol").value.trim().toUpperCase();
    var description = byId("coin-upload-description").value.trim();
    if (!name || name.length > 32 || !/^[A-Z0-9_$.-]{1,13}$/.test(symbol) || !description || description.length > 500) {
      return showToast("Enter the coin name, ticker and description before uploading", "error");
    }
    metadataUpload.disabled = true;
    metadataUpload.textContent = "uploading…";
    try {
      var configResponse = await fetch(new URL("launch/metadata-service.json", document.baseURI), { cache: "no-store" });
      var config = configResponse.ok ? await configResponse.json() : {};
      if (!config.endpoint || !/^https:\/\//.test(config.endpoint)) throw new Error("Image upload is not online yet. Use a public metadata JSON URI for now.");
      var form = new FormData();
      form.set("image", image);
      form.set("name", name);
      form.set("symbol", symbol);
      form.set("description", description);
      ["website", "twitter", "telegram"].forEach(function (field) { form.set(field, byId("coin-upload-" + field).value.trim()); });
      var response = await fetch(config.endpoint, { method: "POST", body: form });
      var result = await response.json();
      if (!response.ok || !result.uri) throw new Error(result.error || "Metadata upload failed");
      byId("coin-uri").value = metadataUri(result.uri);
      byId("coin-uri").dispatchEvent(new Event("input", { bubbles: true }));
      metadataCheck.click();
      showToast("Image and metadata uploaded. Verifying public URL…", "success");
    } catch (error) { showToast(error && error.message ? error.message : "Metadata upload failed", "error"); }
    finally { metadataUpload.disabled = false; metadataUpload.textContent = "upload image + metadata"; }
  });
  function clearMetadataPreview() {
    ["coin-description", "coin-image", "coin-website", "coin-twitter", "coin-telegram"].forEach(function (id) {
      if (byId(id)) byId(id).value = "";
    });
    if (byId("coin-image-preview")) {
      byId("coin-image-preview").removeAttribute("src");
      byId("coin-image-preview").hidden = true;
    }
  }
  if (metadataCheck) metadataCheck.addEventListener("click", async function () {
    var state = byId("metadata-state");
    var preview = byId("coin-image-preview");
    metadataCheck.disabled = true;
    metadataCheck.textContent = "verifying…";
    verifiedMetadataUri = null;
    verifiedMetadata = null;
    launchManifestReady = false;
    clearMetadataPreview();
    try {
      var uri = metadataUri(byId("coin-uri").value.trim());
      if (uri.length > 200) throw new Error("Pump metadata URI must not exceed 200 characters");
      var response = await fetch(uri, { cache: "no-store" });
      if (!response.ok) throw new Error("metadata returned HTTP " + response.status);
      var metadata = await response.json();
      var name = byId("coin-name").value.trim();
      var symbol = byId("coin-symbol").value.trim().toUpperCase();
      if (metadata.name !== name || String(metadata.symbol || "").toUpperCase() !== symbol) throw new Error("metadata name and symbol must match the form");
      if (!metadata.description || !metadata.image) throw new Error("metadata must include description and image");
      var image = metadataUri(metadata.image);
      byId("coin-description").value = metadata.description;
      byId("coin-image").value = image;
      byId("coin-website").value = metadata.website || "";
      byId("coin-twitter").value = metadata.twitter || "";
      byId("coin-telegram").value = metadata.telegram || "";
      preview.src = image;
      preview.hidden = false;
      verifiedMetadataUri = uri;
      verifiedMetadata = metadata;
      state.textContent = "METADATA VERIFIED";
      state.classList.add("ready");
      showToast("Public metadata verified", "success");
    } catch (error) {
      state.textContent = "METADATA INVALID";
      state.classList.remove("ready");
      preview.hidden = true;
      showToast(error.message + " · the host must allow browser access", "error");
    } finally {
      metadataCheck.disabled = false;
      metadataCheck.textContent = "verify metadata";
      setWalletAddress(walletAddress, activeProvider);
    }
  });
  function invalidateMetadata() {
    verifiedMetadataUri = null;
    verifiedMetadata = null;
    launchManifestReady = false;
    if (byId("launch-market-link")) byId("launch-market-link").hidden = true;
    clearMetadataPreview();
    if (byId("metadata-state")) { byId("metadata-state").textContent = "METADATA NOT VERIFIED"; byId("metadata-state").classList.remove("ready"); }
    setWalletAddress(walletAddress, activeProvider);
  }
  ["coin-uri", "coin-name", "coin-symbol"].forEach(function (id) {
    if (byId(id)) byId(id).addEventListener("input", invalidateMetadata);
  });
  if (byId("coin-policy")) byId("coin-policy").addEventListener("change", function () {
    launchManifestReady = false;
    if (byId("launch-submit")) byId("launch-submit").disabled = true;
    if (byId("launch-market-link")) byId("launch-market-link").hidden = true;
    if (byId("launch-output")) byId("launch-output").textContent = "The local policy plan changed. Compile it again before creating the coin.";
  });
  if (launchForm) launchForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (byId("launch-market-link")) byId("launch-market-link").hidden = true;
    var output = byId("launch-output");
    var name = byId("coin-name").value.trim();
    var symbol = byId("coin-symbol").value.trim().toUpperCase();
    if (!name || name.length > 32) {
      output.textContent = "error · coin name must contain 1–32 characters";
      showToast("Check the coin name", "error");
      return;
    }
    if (!/^[A-Z0-9_$.-]{1,13}$/.test(symbol)) {
      output.textContent = "error · symbol must contain 1–13 supported characters";
      showToast("Check the token symbol", "error");
      return;
    }
    var uri;
    try { uri = metadataUri(byId("coin-uri").value.trim()); }
    catch (error) {
      output.textContent = "error · " + error.message;
      showToast(error.message, "error");
      return;
    }
    if (uri !== verifiedMetadataUri || !verifiedMetadata || verifiedMetadata.name !== name || String(verifiedMetadata.symbol || "").toUpperCase() !== symbol) {
      output.textContent = "error · verify the public metadata JSON before compiling";
      showToast("Verify metadata first", "error");
      return;
    }
    var manifest = {
      format: "JLM1",
      network: "solana-mainnet-beta",
      creator: walletAddress || "wallet-not-connected",
      coin: {
        name: name,
        symbol: symbol,
        metadataUri: uri,
        description: String(verifiedMetadata.description),
        image: metadataUri(verifiedMetadata.image),
        website: verifiedMetadata.website || "",
        twitter: verifiedMetadata.twitter || "",
        telegram: verifiedMetadata.telegram || "",
        tokenProgram: "Token-2022",
        decimals: 6
      },
      launch: {
        route: byId("coin-route").value,
        quoteAsset: byId("coin-quote").value,
        network: byId("coin-network") ? byId("coin-network").value : "solana-mainnet-beta"
      },
      defaultIntentPolicy: {
        type: byId("coin-policy").value,
        status: "local-proposal-not-published"
      }
    };
    var canonical = JSON.stringify(manifest);
    output.textContent = JSON.stringify({
      localPlanHash: await sha256(canonical),
      manifest: manifest,
      liveAction: "create a Token-2022 coin through Pump create_v2 after wallet approval",
      notIncluded: ["publish the intended h/monhook policy", "create an issuer lock or option", "integrate Privacy Rings"],
      signingAuthority: walletAddress || "connect wallet before transaction assembly"
    }, null, 2);
    launchManifestReady = true;
    var launchSubmit = byId("launch-submit");
    if (launchSubmit) launchSubmit.disabled = !walletAddress;
    showToast("JLM1 launch manifest compiled", "success");
  });

  var launchSubmit = byId("launch-submit");
  if (launchSubmit) launchSubmit.addEventListener("click", async function () {
    var output = byId("launch-output");
    var provider = window.JoltworkWallet && window.JoltworkWallet.getProvider();
    var authority = window.JoltworkWallet && window.JoltworkWallet.getAddress();
    if (!provider || !authority) {
      openWalletModal();
      showToast("Connect a wallet before creating the coin", "error");
      return;
    }
    if (!launchManifestReady || verifiedMetadataUri !== byId("coin-uri").value.trim()) {
      showToast("Verify metadata and compile the launch plan first", "error");
      return;
    }
    if (!window.JoltworkLaunch || typeof window.JoltworkLaunch.createPumpCoin !== "function") {
      showToast("Pump transaction module is unavailable", "error");
      return;
    }
    var accepted = window.confirm("Create this coin on Solana mainnet through the official Pump program? Your wallet will show the transaction and network cost before signing.");
    if (!accepted) return;
    var launchName = byId("coin-name").value.trim();
    var launchSymbol = byId("coin-symbol").value.trim().toUpperCase();
    var launchUri = verifiedMetadataUri;
    var launchMetadata = verifiedMetadata;
    var launchRpc = byId("coin-rpc").value.trim();
    launchSubmit.disabled = true;
    launchSubmit.textContent = "waiting for wallet…";
    try {
      var result = await window.JoltworkLaunch.createPumpCoin({
        provider: provider,
        authority: authority,
        name: launchName,
        symbol: launchSymbol,
        uri: launchUri,
        rpcEndpoint: launchRpc
      });
      launchManifestReady = false;
      var launchResult = {
        status: result.status,
        network: "solana-mainnet-beta",
        mint: result.mint,
        signature: result.signature,
        solscan: result.explorer,
        pump: result.pump,
        shareableMarket: new URL(result.market, document.baseURI).href,
        directoryStatus: result.status === "pending" ? "awaiting on-chain confirmation" : "checking Pump creation in the directory",
        note: result.status === "pending" ? "The transaction was submitted, but confirmation is unresolved. Do not create the coin again; check the signature and Mint first." : "The transaction was confirmed. h/monhook is verifying the Pump creation and Mint before listing it. The local JLM1 policy plan was not published or enforced."
      };
      output.textContent = JSON.stringify(launchResult, null, 2);
      var marketLink = byId("launch-market-link");
      if (marketLink) { marketLink.href = result.market; marketLink.hidden = false; }
      try {
        var launchRecord = {
          format: "HMONHOOK_LAUNCH_RECEIPT_V1",
          status: result.status,
          network: "solana-mainnet-beta",
          mint: result.mint,
          signature: result.signature,
          creator: authority,
          name: launchName,
          symbol: launchSymbol,
          description: launchMetadata && launchMetadata.description || "",
          image: launchMetadata && launchMetadata.image || "",
          metadataUri: launchUri,
          website: launchMetadata && launchMetadata.website || "",
          twitter: launchMetadata && launchMetadata.twitter || "",
          pump: result.pump,
          explorer: result.explorer,
          createdAt: Date.now()
        };
        var storedLaunches = JSON.parse(localStorage.getItem("joltwork.launches.v1") || "[]");
        if (!Array.isArray(storedLaunches)) storedLaunches = [];
        storedLaunches = storedLaunches.filter(function (item) { return item && item.mint !== launchRecord.mint; });
        storedLaunches.unshift(launchRecord);
        localStorage.setItem("joltwork.launches.v1", JSON.stringify(storedLaunches.slice(0, 100)));
      } catch (_) { /* A confirmed launch remains valid if local storage is unavailable. */ }
      try {
        var serviceResponse = await fetch(new URL("markets/registry-service.json", document.baseURI), { cache: "no-store" });
        var serviceConfig = serviceResponse.ok ? await serviceResponse.json() : {};
        if (serviceConfig.endpoint && /^https:\/\//.test(serviceConfig.endpoint)) {
          var publishResponse;
          for (var publishAttempt = 0; publishAttempt < 4; publishAttempt += 1) {
            if (publishAttempt) await new Promise(function (resolve) { setTimeout(resolve, 750 * Math.pow(2, publishAttempt - 1)); });
            publishResponse = await fetch(serviceConfig.endpoint, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ signature: result.signature, mint: result.mint, creator: authority })
            });
            if (publishResponse.ok || publishResponse.status !== 409) break;
          }
          if (!publishResponse.ok) throw new Error("Verified directory did not accept this launch yet");
          launchResult.status = "confirmed";
          launchResult.directoryStatus = "published after on-chain verification";
          launchResult.note = "Pump coin creation was verified on-chain. The local JLM1 policy plan was not published or enforced by this transaction.";
          output.textContent = JSON.stringify(launchResult, null, 2);
          try {
            var savedReceipts = JSON.parse(localStorage.getItem("joltwork.launches.v1") || "[]");
            if (Array.isArray(savedReceipts)) {
              savedReceipts.forEach(function (item) { if (item && item.mint === result.mint) { item.directoryPublished = true; item.status = "confirmed"; } });
              localStorage.setItem("joltwork.launches.v1", JSON.stringify(savedReceipts));
            }
          } catch (_) { /* Directory publication succeeded even if local storage is unavailable. */ }
        }
      } catch (_) {
        launchResult.directoryStatus = result.status === "pending" ? "awaiting verification; do not resubmit" : "not published; use the shareable Mint link";
        if (result.status === "confirmed") launchResult.note = "The transaction was confirmed, but h/monhook has not verified the Pump creation and Mint. Check the signature before relying on this listing.";
        output.textContent = JSON.stringify(launchResult, null, 2);
      }
      showToast(launchResult.directoryStatus === "published after on-chain verification" ? "Coin creation verified on Solana" : launchResult.status === "confirmed" ? "Transaction confirmed; market verification is pending." : "Transaction submitted; confirmation is pending. Do not resubmit.", launchResult.directoryStatus === "published after on-chain verification" ? "success" : "");
    } catch (error) {
      output.textContent = "creation error · " + (error && error.message ? error.message : String(error));
      showToast(error && error.message ? error.message : "Coin creation failed", "error");
    } finally {
      launchSubmit.textContent = "create coin on mainnet";
      setWalletAddress(walletAddress, activeProvider);
    }
  });

  var latestIntentQuote = null;
  ["intent-input-mint", "intent-output-mint", "intent-input", "intent-slippage", "intent-output-min", "intent-expiry", "intent-rpc"].forEach(function (id) {
    if (!byId(id)) return;
    byId(id).addEventListener("input", function () {
      intentManifestReady = false;
      if (byId("intent-submit")) byId("intent-submit").disabled = true;
      if (["intent-input-mint", "intent-output-mint", "intent-input", "intent-slippage", "intent-rpc"].indexOf(id) !== -1) latestIntentQuote = null;
      if (byId("intent-output")) byId("intent-output").textContent = latestIntentQuote ? "Constraints changed. Compile the preview again before signing." : "Trade changed. Get a fresh quote and compile again before signing.";
    });
  });
  if (byId("intent-output-mint")) {
    try {
      var requestedOutputMint = new URLSearchParams(window.location.search).get("outputMint");
      if (requestedOutputMint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(requestedOutputMint)) byId("intent-output-mint").value = requestedOutputMint;
    } catch (_) { /* Ignore malformed query parameters. */ }
  }
  var intentQuoteButton = byId("intent-quote");
  if (intentQuoteButton) intentQuoteButton.addEventListener("click", async function () {
    var output = byId("intent-output");
    intentQuoteButton.disabled = true;
    intentQuoteButton.textContent = "requesting quote…";
    intentManifestReady = false;
    if (byId("intent-submit")) byId("intent-submit").disabled = true;
    try {
      var inputMint = solanaAddress(byId("intent-input-mint").value.trim(), "input mint");
      var outputMint = solanaAddress(byId("intent-output-mint").value.trim(), "output mint");
      if (inputMint === outputMint) throw new Error("input and output mint must be different");
      var amount = unsignedInteger(byId("intent-input").value.trim(), "input amount");
      if (amount === "0") throw new Error("input amount must be greater than zero");
      var slippage = Number(unsignedInteger(byId("intent-slippage").value.trim(), "slippage"));
      if (slippage < 1 || slippage > 5000) throw new Error("slippage must be between 1 and 5000 bps");
      var params = new URLSearchParams({
        inputMint: inputMint, outputMint: outputMint, amount: amount,
        slippageBps: String(slippage), swapMode: "ExactIn"
      });
      var quoteResponse = await fetch("https://api.jup.ag/swap/v2/order?" + params.toString(), { cache: "no-store" });
      if (!quoteResponse.ok) throw new Error("Jupiter quote failed with HTTP " + quoteResponse.status);
      var quote = await quoteResponse.json();
      if (!quote.outAmount || quote.errorCode) throw new Error(quote.errorMessage || quote.errorCode || "Jupiter could not build a quote");
      var minOutput = quote.otherAmountThreshold || (BigInt(quote.outAmount) * BigInt(10000 - slippage) / 10000n).toString();
      byId("intent-output-min").value = minOutput;
      var slotResponse = await fetch(solanaRpcUrl(byId("intent-rpc").value.trim()), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "confirmed" }] })
      });
      if (!slotResponse.ok) throw new Error("Solana RPC slot request failed with HTTP " + slotResponse.status);
      var slotJson = await slotResponse.json();
      if (!Number.isSafeInteger(slotJson.result) || slotJson.result <= 0) throw new Error(slotJson.error && slotJson.error.message || "Solana RPC returned no valid slot");
      byId("intent-expiry").value = String(slotJson.result + 150);
      latestIntentQuote = {
        requestId: quote.requestId || null, router: quote.router || "metis",
        inputMint: inputMint, outputMint: outputMint, inAmount: quote.inAmount,
        outAmount: quote.outAmount, minimumOutput: minOutput, slippageBps: slippage,
        priceImpactPct: quote.priceImpactPct || quote.priceImpact || null,
        route: (quote.routePlan || []).map(function (step) { return step.swapInfo && step.swapInfo.label || "unknown"; })
      };
      output.textContent = JSON.stringify({ status: "live quote received", quote: latestIntentQuote, next: "review constraints, then compile intent" }, null, 2);
      showToast("Live Jupiter quote received", "success");
    } catch (error) {
      latestIntentQuote = null;
      output.textContent = "quote error · " + error.message;
      showToast(error.message, "error");
    } finally {
      intentQuoteButton.disabled = false;
      intentQuoteButton.textContent = "get live quote";
    }
  });

  var intentForm = byId("intent-form");
  if (intentForm) intentForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var output = byId("intent-output");
    try {
      var manifest = {
        protocol: "hmonhook-intent-preview-v1",
        network: "solana-mainnet-beta",
        authority: walletAddress || "wallet-not-connected",
        routeProgram: solanaAddress(byId("intent-route").value.trim(), "route program"),
        inputMint: solanaAddress(byId("intent-input-mint").value.trim(), "input mint"),
        outputMint: solanaAddress(byId("intent-output-mint").value.trim(), "output mint"),
        maxInput: unsignedInteger(byId("intent-input").value.trim(), "maximum input"),
        minOutput: unsignedInteger(byId("intent-output-min").value.trim(), "minimum output"),
        slippageBps: unsignedInteger(byId("intent-slippage").value.trim(), "slippage"),
        expiresAtSlot: unsignedInteger(byId("intent-expiry").value.trim(), "expiry slot"),
        policy: byId("intent-policy").value
      };
      if (!latestIntentQuote || latestIntentQuote.inputMint !== manifest.inputMint || latestIntentQuote.outputMint !== manifest.outputMint || latestIntentQuote.inAmount !== manifest.maxInput || latestIntentQuote.minimumOutput !== manifest.minOutput || String(latestIntentQuote.slippageBps) !== manifest.slippageBps) {
        throw new Error("request a fresh quote after changing the trade fields");
      }
      output.textContent = JSON.stringify({
        localPreviewHash: await sha256(JSON.stringify(manifest)),
        constraints: manifest,
        quote: latestIntentQuote,
        note: "This local JSON hash is not the on-chain intent ID. Signing assembles a fresh Jupiter route and the actual guard instruction.",
        execution: [
          "snapshot source and destination token accounts",
          "invoke PRE policy hook",
          "invoke route through CPI",
          "reload balances and enforce postconditions",
          "return JRC1 receipt or revert transaction"
        ]
      }, null, 2);
      intentManifestReady = true;
      if (byId("intent-submit")) byId("intent-submit").disabled = !walletAddress;
      showToast("Trade preview compiled", "success");
    } catch (error) {
      output.textContent = "error · " + error.message;
      showToast(error.message, "error");
    }
  });

  var intentSubmit = byId("intent-submit");
  if (intentSubmit) intentSubmit.addEventListener("click", async function () {
    var output = byId("intent-output");
    var provider = window.JoltworkWallet && window.JoltworkWallet.getProvider();
    var authority = window.JoltworkWallet && window.JoltworkWallet.getAddress();
    if (!provider || !authority) return openWalletModal();
    if (!intentManifestReady || !latestIntentQuote) return showToast("Get a fresh quote and compile the intent first", "error");
    if (!window.JoltworkIntent || typeof window.JoltworkIntent.submitProtectedSwap !== "function") return showToast("Protected swap module is unavailable", "error");
    if (!window.confirm("Sign a mainnet swap protected by h/monhook Guard? Review the token amounts and network fee in your wallet.")) return;
    intentSubmit.disabled = true;
    intentSubmit.textContent = "building protected swap…";
    try {
      var result = await window.JoltworkIntent.submitProtectedSwap({
        provider: provider, authority: authority,
        inputMint: byId("intent-input-mint").value.trim(), outputMint: byId("intent-output-mint").value.trim(),
        amount: byId("intent-input").value.trim(), minimumOutput: byId("intent-output-min").value.trim(),
        slippageBps: byId("intent-slippage").value.trim(), expiresAtSlot: byId("intent-expiry").value.trim(),
        rpcEndpoint: solanaRpcUrl(byId("intent-rpc").value.trim())
      });
      output.textContent = JSON.stringify({ status: "confirmed", protection: "h/monhook Guard mainnet", programId: "6HfEuWvEmargNraXeqCiqCZRJ223kGjxsCB7H9S3ENTY", intentId: result.intentId, signature: result.signature, explorer: result.explorer }, null, 2);
      showToast("Protected swap confirmed", "success");
    } catch (error) {
      output.textContent = "protected swap error · " + (error && error.message ? error.message : String(error));
      showToast(error && error.message ? error.message : "Protected swap failed", "error");
    } finally {
      intentManifestReady = false;
      intentSubmit.disabled = true;
      intentSubmit.textContent = "sign protected swap";
    }
  });

  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var text = byId(button.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(text);
        var previous = button.textContent;
        button.textContent = "copied";
        showToast("Copied to clipboard", "success");
        setTimeout(function () { button.textContent = previous; }, 1200);
      } catch (error) {
        button.textContent = "select text";
      }
    });
  });

  document.querySelectorAll("[data-download]").forEach(function (button) {
    button.addEventListener("click", function () {
      var target = byId(button.dataset.download);
      if (!target || !target.textContent.trim().startsWith("{")) return;
      var blob = new Blob([target.textContent], { type: "application/json" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = button.dataset.filename || "hmonhook-manifest.json";
      link.click();
      URL.revokeObjectURL(link.href);
      showToast("JSON manifest downloaded", "success");
    });
  });

  var sourceBase = new URL("./", document.baseURI);
  var codeFiles = {};
  var codePaths = {
    program: "programs/jolt-guard/src/lib.rs",
    cargo: "programs/jolt-guard/Cargo.toml",
    sdkIndex: "sdk/src/index.ts",
    sdkConstants: "sdk/src/constants.ts",
    sdkTypes: "sdk/src/types.ts",
    sdkCodec: "sdk/src/codec.ts",
    sdkInstruction: "sdk/src/instruction.ts",
    sdkReceipt: "sdk/src/receipt.ts",
    jupiter: "sdk/src/adapters/jupiter.ts",
    codecTest: "sdk/test/codec.test.js",
    instructionTest: "sdk/test/instruction.test.js",
    jupiterTest: "sdk/test/jupiter.test.js",
    receiptTest: "sdk/test/receipt.test.js",
    launchClient: "launch-client.ts",
    intentClient: "intent-client.ts",
    appClient: "app.js",
    buildClient: "build-client.mjs",
    marketsClient: "markets.js",
    marketsRegistry: "markets/registry.json",
    webPackage: "package.json",
    sdkPackage: "sdk/package.json",
    deployment: "deployments/devnet.json",
    mainnetDeployment: "deployments/mainnet.json",
    verifyDeployment: "scripts/verify-deployment.mjs",
    checkSite: "scripts/check-site.mjs",
    readme: "README.md",
    productScope: "docs/PRODUCT_SCOPE.md",
    architecture: "docs/ARCHITECTURE.md",
    integration: "docs/INTEGRATION.md",
    security: "docs/SECURITY.md",
    operations: "docs/OPERATIONS.md",
    spec: "JOLT_GUARD.md",
    contributing: "CONTRIBUTING.md"
  };

  function renderSource(text) {
    var view = byId("code-view");
    if (!view) return;
    view.textContent = "";
    var list = document.createElement("ol");
    list.className = "code-lines";
    text.replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
      var item = document.createElement("li");
      var code = document.createElement("code");
      code.textContent = line || " ";
      item.appendChild(code);
      list.appendChild(item);
    });
    view.appendChild(list);
  }

  async function showCode(key, button) {
    if (!byId("code-view") || !byId("code-path")) return;
    var path = codePaths[key];
    byId("code-path").textContent = path;
    byId("code-view").textContent = "loading complete source…";
    if (byId("code-meta")) byId("code-meta").textContent = "loading source…";
    document.querySelectorAll("[data-code]").forEach(function (item) {
      item.classList.toggle("active", item === button);
    });
    try {
      if (!codeFiles[key]) {
        var response = await fetch(new URL(path, sourceBase), { cache: "no-store" });
        if (!response.ok) throw new Error("source request failed");
        codeFiles[key] = await response.text();
      }
      var text = codeFiles[key];
      renderSource(text);
      var lines = text.replace(/\r\n/g, "\n").split("\n").length;
      var bytes = new Blob([text]).size;
      if (byId("code-meta")) byId("code-meta").textContent = lines + " lines · " + bytes.toLocaleString() + " bytes · published source";
    } catch (error) {
      byId("code-view").textContent = "This published source file could not be loaded. Reload the page and try again.\n\nRequested path: " + path;
      if (byId("code-meta")) byId("code-meta").textContent = "published source unavailable";
    }
  }

  document.querySelectorAll("[data-code]").forEach(function (button) {
    button.addEventListener("click", function () {
      showCode(button.dataset.code, button);
    });
  });
  if (byId("code-view")) {
    var requestedCode = new URLSearchParams(window.location.search).get("file") || "program";
    if (!codePaths[requestedCode]) requestedCode = "program";
    showCode(requestedCode, document.querySelector('[data-code="' + requestedCode + '"]'));
  }

  if (byId("code-filter")) byId("code-filter").addEventListener("input", function () {
    var query = byId("code-filter").value.trim().toLowerCase();
    var visible = 0;
    document.querySelectorAll(".code-group").forEach(function (group) {
      var groupVisible = 0;
      group.querySelectorAll("[data-code]").forEach(function (button) {
        var match = !query || button.textContent.toLowerCase().includes(query);
        button.hidden = !match;
        if (match) { groupVisible += 1; visible += 1; }
      });
      group.hidden = groupVisible === 0;
    });
    if (byId("code-file-count")) byId("code-file-count").textContent = visible + (visible === 1 ? " FILE" : " FILES");
  });

  if (byId("code-copy")) byId("code-copy").addEventListener("click", async function () {
    var active = document.querySelector("[data-code].active");
    var text = active ? codeFiles[active.dataset.code] : "";
    if (!text) return showToast("Wait for the source file to load", "warn");
    try {
      await navigator.clipboard.writeText(text);
      byId("code-copy").textContent = "COPIED";
      setTimeout(function () { byId("code-copy").textContent = "COPY"; }, 1200);
    } catch (error) {
      showToast("Clipboard access was blocked", "warn");
    }
  });

  if (byId("code-download")) byId("code-download").addEventListener("click", function () {
    var active = document.querySelector("[data-code].active");
    var text = active ? codeFiles[active.dataset.code] : "";
    var path = active ? codePaths[active.dataset.code] : "";
    if (!text || !path) return showToast("Wait for the source file to load", "warn");
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = path.split("/").pop() || "hmonhook-source.txt";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Source file downloaded", "success");
  });

  var menuButton = byId("menu-toggle");
  if (menuButton) menuButton.addEventListener("click", function () {
    document.body.classList.toggle("menu-open");
    menuButton.setAttribute("aria-expanded", document.body.classList.contains("menu-open") ? "true" : "false");
  });

  document.querySelectorAll(".site-rail a").forEach(function (link) {
    link.addEventListener("click", function () { document.body.classList.remove("menu-open"); });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeWalletModal();
      document.body.classList.remove("menu-open");
    }
  });
}());
