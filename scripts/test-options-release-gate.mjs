import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../options-interface.js', import.meta.url), 'utf8');

function page(config) {
  const elements = new Map();
  for (const id of ['issuer-options-form', 'options-market-form', 'options-release-state',
    'options-market-release', 'issuer-options-controls', 'options-market-controls',
    'options-open', 'options-buy', 'options-confirm-buy', 'options-exercise', 'options-claim', 'options-refund']) {
    elements.set(id, { addEventListener() {}, hidden: id.endsWith('controls'), textContent: '' });
  }
  const context = {
    URL, BigInt,
    document: { baseURI: 'https://example.test/', getElementById(id) { return elements.get(id) || null; } },
    window: { HmonhookOptions: { Connection() { throw new Error('No RPC should be opened while disabled'); } } },
    fetch: async (url, options) => {
      assert.equal(String(url), 'https://example.test/options/program.json');
      assert.equal(options.cache, 'no-store');
      return { ok: true, json: async () => config };
    },
  };
  vm.runInNewContext(source, context);
  return elements;
}

test('undeployed options release keeps issuer and market controls hidden', async () => {
  const elements = page({ enabled: false, cluster: 'mainnet-beta', programId: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('issuer-options-controls').hidden, true);
  assert.equal(elements.get('options-market-controls').hidden, true);
  assert.match(elements.get('options-release-state').textContent, /not enabled/);
  assert.match(elements.get('options-market-release').textContent, /not enabled/);
});
