(function () {
  'use strict';
  var api = window.HmonhookOptions;
  if (!api) return;
  var issuerForm = document.getElementById('issuer-options-form');
  var marketForm = document.getElementById('options-market-form');
  if (!issuerForm && !marketForm) return;
  var config;
  var issuerReview;
  var purchaseReview;
  var marketView;
  var inspectMarketSeries;
  var sharedSeries;
  function byId(id) { return document.getElementById(id); }
  function value(id) { return byId(id).value.trim(); }
  function wallet() {
    var provider = window.JoltworkWallet && window.JoltworkWallet.getProvider();
    var address = window.JoltworkWallet && window.JoltworkWallet.getAddress();
    if (!provider || !address) throw new Error('Connect a Solana wallet first.');
    return { provider: provider, address: address };
  }
  function show(id, lines) { byId(id).textContent = Array.isArray(lines) ? lines.join('\n') : String(lines); }
  function error(id, err) { show(id, 'ERROR: ' + (err && err.message || err)); }
  function configUrl() { return new URL('options/program.json', document.baseURI); }
  async function release(rpc) {
    if (!config || config.enabled !== true || config.cluster !== 'mainnet-beta' || !config.programId ||
        !/^[0-9a-f]{64}$/i.test(config.programSha256 || '') || !Object.hasOwn(config, 'upgradeAuthority')) {
      throw new Error('Options trading is not enabled on this release.');
    }
    var url = new URL(rpc);
    if (url.protocol !== 'https:') throw new Error('Use a mainnet HTTPS RPC endpoint.');
    var connection = new api.Connection(url.href, 'confirmed');
    var genesis = await connection.getGenesisHash();
    if (genesis !== api.SOLANA_MAINNET_GENESIS_HASH) throw new Error('RPC endpoint is not Solana mainnet-beta.');
    await api.loadOptionsProgram(connection, config);
    return connection;
  }
  function issuerInputs() { return [value('options-mint'), value('options-percent'), value('options-registered-tokens'), value('options-rpc'), value('options-sale-slots'), value('options-expiry-slots')].join('|'); }
  function marketInputs() { return [value('options-series'), value('options-market-rpc'), value('options-lots')].join('|'); }
  function formatSol(lamports) {
    var amount = BigInt(lamports);
    return (amount / 1000000000n) + '.' + String(amount % 1000000000n).padStart(9, '0') + ' SOL';
  }
  if (issuerForm) {
    issuerForm.addEventListener('input', function () { issuerReview = null; byId('options-open').disabled = true; byId('options-view-series').hidden = true; });
    issuerForm.addEventListener('submit', async function (event) {
      event.preventDefault(); issuerReview = null; byId('options-open').disabled = true;
      try {
        var who = wallet(); var rpc = value('options-rpc'); var submittedInputs = issuerInputs(); await release(rpc);
        show('options-issuer-output', 'Reading Mint, Pump curve and issuer treasury...');
        var prepared = await api.previewIssuerSeries({ rpcEndpoint: rpc, programId: config.programId,
          issuer: who.address, mint: value('options-mint'), percent: Number(value('options-percent')),
          registeredTokens: value('options-registered-tokens'),
          saleWindowSlots: Number(value('options-sale-slots')), expiryWindowSlots: Number(value('options-expiry-slots')) });
        if (submittedInputs !== issuerInputs() || who.address !== wallet().address) throw new Error('Inputs or wallet changed during review. Review again.');
        issuerReview = { prepared: prepared, inputs: issuerInputs(), address: who.address };
        show('options-issuer-output', ['MINT: ' + prepared.mint, 'ISSUER: ' + prepared.issuer,
          'SERIES: ' + prepared.series, 'SNAPSHOT SLOT: ' + prepared.snapshotSlot,
          'OPTION COLLATERAL: ' + prepared.deposit + ' base units / ' + prepared.totalLots + ' lots',
          'REGISTERED CUSTODY: ' + prepared.treasury, 'ADDITIONAL TOKENS HELD: ' + prepared.treasuryFloor + ' base units',
          'STRIKE / LOT: ' + formatSol(prepared.strikeLamports),
          'PREMIUM / LOT: ' + formatSol(prepared.premiumLamports),
          'SALE DEADLINE SLOT: ' + prepared.saleDeadlineSlot, 'EXERCISE EXPIRY SLOT: ' + prepared.expirySlot,
          'Both amounts leave your wallet when signing. Withdrawing registered tokens before expiry permanently defaults this series.',
          'Only this registered allocation is monitored; unrelated wallets are outside this protection.']);
        byId('options-open').disabled = false;
      } catch (err) { error('options-issuer-output', err); }
    });
    byId('options-open').addEventListener('click', async function () {
      try {
        var who = wallet();
        if (!issuerReview || issuerReview.inputs !== issuerInputs() || issuerReview.address !== who.address) throw new Error('Inputs or wallet changed. Review again.');
        await release(value('options-rpc'));
        byId('options-open').disabled = true; show('options-issuer-output', 'Waiting for wallet confirmation...');
        var result = await api.submitIssuerSeries(issuerReview.prepared, who.provider);
        show('options-issuer-output', ['STATUS: ' + result.status, 'SERIES: ' + result.series, 'SIGNATURE: ' + result.signature,
          result.status === 'confirmed' ? 'Collateral lock verified on chain.' : 'Check the signature in a Solana explorer before retrying.']);
        issuerReview = null;
        if (result.status === 'confirmed') {
          byId('options-view-series').href = './markets/?series=' + encodeURIComponent(result.series);
          byId('options-view-series').hidden = false;
        }
      } catch (err) { error('options-issuer-output', err); }
    });
  }
  if (marketForm) {
    sharedSeries = new URL(location.href).searchParams.get('series');
    if (sharedSeries && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sharedSeries)) byId('options-series').value = sharedSeries;
    var sharedMint = new URL(location.href).searchParams.get('mint');
    if (sharedMint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sharedMint)) byId('options-find-mint').value = sharedMint;
    byId('options-find-series').addEventListener('click', async function () {
      var results = byId('options-series-results');
      results.replaceChildren();
      try {
        var mint = value('options-find-mint'); var rpc = value('options-market-rpc');
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new Error('Enter a Solana Mint address.');
        await release(rpc);
        var rows = await api.listOptionSeriesForMint({ rpcEndpoint: rpc, programId: config.programId, mint: mint });
        if (mint !== value('options-find-mint') || rpc !== value('options-market-rpc')) throw new Error('Search inputs changed. Search again.');
        if (!rows.length) { results.textContent = 'No verified V3 option series found for this Mint.'; return; }
        var heading = document.createElement('p');
        heading.textContent = rows.length + ' verified V3 series found. Select one to inspect its current terms.';
        results.appendChild(heading);
        rows.slice(0, 20).forEach(function (row) {
          var button = document.createElement('button');
          button.className = 'button'; button.type = 'button';
          button.textContent = String(row.address) + ' / ' + ['ACTIVE', 'DEFAULT', 'CLOSED'][row.status];
          button.addEventListener('click', function () {
            byId('options-series').value = String(row.address);
            inspectMarketSeries().catch(function (err) { error('options-market-output', err); });
          });
          results.appendChild(button);
        });
        if (rows.length > 20) { var more = document.createElement('p'); more.textContent = 'Showing the first 20 series. Search by exact series address for others.'; results.appendChild(more); }
      } catch (err) { results.textContent = 'ERROR: ' + (err && err.message || err); }
    });
    var actionIds = ['options-buy', 'options-confirm-buy', 'options-exercise', 'options-claim', 'options-refund', 'options-register-default', 'options-withdraw-registered', 'options-reclaim'];
    function disableActions() { actionIds.forEach(function (id) { byId(id).disabled = true; }); purchaseReview = null; }
    marketForm.addEventListener('input', disableActions);
    inspectMarketSeries = async function () {
      disableActions(); marketView = null;
      var submittedInputs = marketInputs();
      await release(value('options-market-rpc'));
      var connected = window.JoltworkWallet && window.JoltworkWallet.getAddress();
      show('options-market-output', 'Reading series, vault and registered treasury...');
      var view = await api.inspectOptionSeries({ rpcEndpoint: value('options-market-rpc'), programId: config.programId,
        series: value('options-series'), buyer: connected || undefined });
      if (submittedInputs !== marketInputs() || connected !== (window.JoltworkWallet && window.JoltworkWallet.getAddress())) throw new Error('Inputs or wallet changed during inspection. Inspect again.');
      marketView = { view: view, inputs: marketInputs(), address: connected };
      var t = view.terms; var p = view.position;
      var available = t.totalLots - t.soldLots;
      var owned = p ? p.boughtLots - p.exercisedLots - p.defaultClaimedLots : 0n;
      var refundable = 0n;
      if (p && !p.premiumRefunded && t.soldLots > 0n) {
        var grossUnspent = t.soldLots * t.premiumLamports - t.premiumSpentLamports;
        var unclaimed = grossUnspent - t.premiumRefundedLamports;
        if (grossUnspent < 0n || unclaimed < 0n) throw new Error('On-chain premium accounting is inconsistent.');
        refundable = t.premiumRefundClaimedLots + p.boughtLots === t.soldLots
          ? unclaimed : grossUnspent * p.boughtLots / t.soldLots;
        if (refundable > unclaimed) throw new Error('On-chain premium refund accounting is inconsistent.');
      }
      show('options-market-output', ['MINT: ' + t.mint, 'ISSUER: ' + t.issuer, 'SERIES STATUS: ' + ['ACTIVE', 'DEFAULT', 'CLOSED'][t.status],
        'CURRENT SLOT: ' + view.slot, 'VAULT COLLATERAL: ' + view.vaultAmount + ' base units',
        'REGISTERED CUSTODY: ' + view.treasuryAmount + ' base units', 'REGISTERED ALLOCATION: ' + t.treasuryFloor + ' base units',
        'TREASURY BELOW FLOOR: ' + (view.registeredTreasuryBreached ? 'YES' : 'NO'),
        'LOT SIZE: ' + t.lotSize + ' base units', 'AVAILABLE LOTS: ' + available,
        'STRIKE / LOT: ' + formatSol(t.strikeLamports), 'PREMIUM / LOT: ' + formatSol(t.premiumLamports),
        'SALE DEADLINE SLOT: ' + t.saleDeadlineSlot, 'EXERCISE EXPIRY SLOT: ' + t.expirySlot,
        'YOUR OPEN LOTS: ' + owned, 'YOUR REFUND CLAIMED: ' + (p ? !!p.premiumRefunded : 'NO POSITION'),
        'ESTIMATED UNSPENT PREMIUM REFUND: ' + formatSol(refundable) + ' / AFTER EXPIRY ONLY',
        ...(p && !p.premiumRefunded && refundable === 0n ? ['Your refund may round to zero. Claiming still records that your position has settled.'] : []),
        'Only the registered allocation is covered. Issuer withdrawal before expiry permanently defaults this series.',
        'The option premium may be lost. Inspect terms and market price independently.']);
      if (connected && t.status === 0 && BigInt(view.slot) <= t.saleDeadlineSlot && available > 0n && !view.registeredTreasuryBreached) byId('options-buy').disabled = false;
      if (connected && owned > 0n && t.status === 0 && BigInt(view.slot) <= t.expirySlot) byId('options-exercise').disabled = false;
      if (connected && owned > 0n && t.status === 1) byId('options-claim').disabled = false;
      if (connected && p && !p.premiumRefunded && BigInt(view.slot) > t.expirySlot) byId('options-refund').disabled = false;
      if (connected && t.status === 0 && BigInt(view.slot) <= t.expirySlot && view.registeredTreasuryBreached) byId('options-register-default').disabled = false;
      if (connected && String(t.issuer) === connected && view.treasuryAmount > 0n) byId('options-withdraw-registered').disabled = false;
      var reclaimable = t.status === 1 || BigInt(view.slot) <= t.expirySlot
        ? t.totalLots - t.soldLots - t.reclaimedLots : t.totalLots - t.exercisedLots - t.reclaimedLots;
      if (connected && String(t.issuer) === connected && BigInt(view.slot) > t.saleDeadlineSlot && t.status !== 2 && reclaimable > 0n && view.vaultAmount >= reclaimable * t.lotSize) byId('options-reclaim').disabled = false;
      return view;
    };
    marketForm.addEventListener('submit', async function (event) { event.preventDefault(); try { await inspectMarketSeries(); } catch (err) { error('options-market-output', err); } });
    byId('options-buy').addEventListener('click', async function () {
      try {
        var who = wallet(); if (!marketView || marketView.inputs !== marketInputs() || marketView.address !== who.address) throw new Error('Refresh the series after changing inputs or wallet.');
        await release(value('options-market-rpc'));
        var prepared = await api.previewBuyerPosition({ rpcEndpoint: value('options-market-rpc'), programId: config.programId,
          series: value('options-series'), buyer: who.address, lots: value('options-lots') });
        if (marketView.inputs !== marketInputs() || who.address !== wallet().address) throw new Error('Inputs or wallet changed during review. Inspect again.');
        purchaseReview = { prepared: prepared, inputs: marketInputs(), address: who.address };
        show('options-market-output', ['BUYER: ' + who.address, 'SERIES: ' + prepared.series,
          'LOTS: ' + prepared.lots, 'TOTAL PREMIUM: ' + formatSol(prepared.premiumLamports),
          'STRIKE / LOT: ' + formatSol(prepared.terms.strikeLamports), 'EXERCISE EXPIRY SLOT: ' + prepared.terms.expirySlot,
          'Premium is paid now. Exercise later costs the strike per lot. Premium may be lost.']);
        byId('options-confirm-buy').disabled = false;
      } catch (err) { error('options-market-output', err); }
    });
    byId('options-confirm-buy').addEventListener('click', async function () {
      try {
        var who = wallet(); if (!purchaseReview || purchaseReview.inputs !== marketInputs() || purchaseReview.address !== who.address) throw new Error('Purchase review expired. Review again.');
        await release(value('options-market-rpc')); byId('options-confirm-buy').disabled = true;
        show('options-market-output', 'Waiting for wallet confirmation...');
        var result = await api.submitBuyerPosition(purchaseReview.prepared, who.provider);
        show('options-market-output', ['STATUS: ' + result.status, 'POSITION: ' + result.position, 'SIGNATURE: ' + result.signature]);
        purchaseReview = null;
      } catch (err) { error('options-market-output', err); }
    });
    [['options-exercise','exercise'],['options-claim','claim'],['options-refund','refund']].forEach(function (pair) {
      byId(pair[0]).addEventListener('click', async function () {
        try {
          var who = wallet(); if (!marketView || marketView.inputs !== marketInputs() || marketView.address !== who.address) throw new Error('Refresh the series after changing inputs or wallet.');
          await release(value('options-market-rpc')); byId(pair[0]).disabled = true;
          show('options-market-output', 'Waiting for wallet confirmation...');
          var result = await api.submitPositionAction({ rpcEndpoint: value('options-market-rpc'), programId: config.programId,
            series: value('options-series'), buyer: who.address, provider: who.provider, action: pair[1], lots: value('options-lots') });
          show('options-market-output', ['STATUS: ' + result.status, 'SIGNATURE: ' + result.signature,
            'Refresh the series to see the updated position.']);
          marketView = null;
        } catch (err) { error('options-market-output', err); }
      });
    });
    [['options-register-default','register-default'],['options-withdraw-registered','withdraw-registered'],['options-reclaim','reclaim']].forEach(function (pair) {
      byId(pair[0]).addEventListener('click', async function () {
        try {
          var who = wallet(); if (!marketView || marketView.inputs !== marketInputs() || marketView.address !== who.address) throw new Error('Refresh the series after changing inputs or wallet.');
          if (pair[1] === 'withdraw-registered' && BigInt(marketView.view.slot) <= marketView.view.terms.expirySlot &&
              !window.confirm('Withdrawing registered tokens before expiry permanently defaults this series. Option buyers may claim collateral. Continue?')) return;
          await release(value('options-market-rpc')); byId(pair[0]).disabled = true;
          show('options-market-output', 'Waiting for wallet confirmation...');
          var result = await api.submitSeriesAction({ rpcEndpoint: value('options-market-rpc'), programId: config.programId,
            series: value('options-series'), signer: who.address, provider: who.provider, action: pair[1] });
          show('options-market-output', ['STATUS: ' + result.status, 'SIGNATURE: ' + result.signature,
            'Refresh the series to see the updated state.']); marketView = null;
        } catch (err) { error('options-market-output', err); }
      });
    });
  }
  fetch(configUrl(), { cache: 'no-store' }).then(function (response) {
    if (!response.ok) throw new Error('Options release configuration unavailable.');
    return response.json();
  }).then(function (loaded) {
    config = loaded;
    var active = loaded.enabled === true && loaded.cluster === 'mainnet-beta' && !!loaded.programId &&
      /^[0-9a-f]{64}$/i.test(loaded.programSha256 || '') && Object.hasOwn(loaded, 'upgradeAuthority');
    if (issuerForm) { byId('options-release-state').textContent = active ? 'Contract configured. Review the on-chain program and terms before signing.' : 'Options trading is not enabled. Contract deployment and independent review are pending.'; byId('issuer-options-controls').hidden = !active; }
    if (marketForm) {
      byId('options-market-release').textContent = active ? 'Contract configured. Inspect a verified series before buying.' : 'Options trading is not enabled. Contract deployment and independent review are pending.';
      byId('options-market-controls').hidden = !active;
      if (active && sharedSeries) inspectMarketSeries().catch(function (err) { error('options-market-output', err); });
    }
  }).catch(function (err) {
    if (issuerForm) byId('options-release-state').textContent = err.message;
    if (marketForm) byId('options-market-release').textContent = err.message;
  });
}());
