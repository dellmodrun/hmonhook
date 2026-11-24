import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { SOLANA_MAINNET_GENESIS_HASH } from '../options-network-core.mjs';

const source = readFileSync(new URL('../options-interface.js', import.meta.url), 'utf8');
const reviewedConfig = { enabled: true, cluster: 'mainnet-beta',
  programId: '11111111111111111111111111111111', programSha256: 'a'.repeat(64), upgradeAuthority: null };

async function inspectWithGenesis(genesis) {
  const elements = new Map();
  const handlers = new Map();
  for (const id of ['issuer-options-form', 'options-market-form', 'options-release-state',
    'options-market-release', 'issuer-options-controls', 'options-market-controls',
    'options-open', 'options-buy', 'options-confirm-buy', 'options-exercise', 'options-claim',
    'options-refund', 'options-register-default', 'options-reclaim', 'options-view-series',
    'options-series', 'options-market-rpc', 'options-lots', 'options-market-output']) {
    elements.set(id, { value: id === 'options-market-rpc' ? 'https://api.mainnet-beta.solana.com' : '1',
      hidden: true, textContent: '', addEventListener(type, fn) { handlers.set(`${id}:${type}`, fn); } });
  }
  let inspected = false;
  const context = { URL, BigInt, location: { href: 'https://example.test/markets/' },
    document: { baseURI: 'https://example.test/', getElementById(id) { return elements.get(id) || null; } },
    window: { HmonhookOptions: {
      SOLANA_MAINNET_GENESIS_HASH,
      Connection: class { async getGenesisHash() { return genesis; } },
      async loadOptionsProgram() {},
      async inspectOptionSeries() { inspected = true; throw new Error('inspection reached'); },
    }, JoltworkWallet: { getAddress() { return null; } } },
    fetch: async () => ({ ok: true, json: async () => reviewedConfig }),
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  await handlers.get('options-market-form:submit')({ preventDefault() {} });
  return { inspected, output: elements.get('options-market-output').textContent };
}

test('Solana mainnet genesis hash is complete and accepts the real cluster', async () => {
  assert.equal(SOLANA_MAINNET_GENESIS_HASH, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  const result = await inspectWithGenesis(SOLANA_MAINNET_GENESIS_HASH);
  assert.equal(result.inspected, true);
  assert.match(result.output, /inspection reached/);
});

test('options market rejects a different cluster before reading or signing', async () => {
  const result = await inspectWithGenesis('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  assert.equal(result.inspected, false);
  assert.match(result.output, /not Solana mainnet-beta/);
});
