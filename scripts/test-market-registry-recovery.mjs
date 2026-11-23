import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

test('market page retries a confirmed local receipt and then reads the shared directory', async () => {
  const mint = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const signature = bs58.encode(Keypair.generate().secretKey);
  const storageKey = 'joltwork.launches.v1';
  const storage = new Map([[storageKey, JSON.stringify([{
    mint, creator, signature, network: 'solana-mainnet-beta', name: 'Recovered coin',
  }])]]);
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', disabled: false, value: '',
      addEventListener() {}, classList: { toggle() {} },
    });
    return elements.get(id);
  };
  let posts = 0;
  let directoryReads = 0;
  let published = false;
  const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/markets/registry.json')) return response({ launches: [] });
    if (target.endsWith('/markets/registry-service.json')) return response({ endpoint: 'https://registry.example/launch-registry' });
    if (target === 'https://registry.example/launch-registry') {
      if (options.method === 'POST') {
        posts += 1;
        assert.deepEqual(JSON.parse(options.body), { mint, creator, signature });
        published = true;
        return response({ launch: { mint } });
      }
      directoryReads += 1;
      return response({ launches: published ? [{ mint, creator, signature, name: 'Recovered coin', symbol: 'REC', created_at: new Date().toISOString() }] : [] });
    }
    if (target.startsWith('https://api.dexscreener.com/')) return response([]);
    throw new Error(`Unexpected fetch: ${target}`);
  };
  const source = readFileSync(new URL('../markets.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window: { location: { search: '' } },
    document: { baseURI: 'https://site.example/', getElementById: element, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch, URL, URLSearchParams, Map, Set, Intl, Date, Number, String,
  });
  for (let attempt = 0; attempt < 50 && (!published || directoryReads < 2); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(posts, 1);
  assert.ok(directoryReads >= 2, 'the market should reload after publication');
  assert.equal(JSON.parse(storage.get(storageKey))[0].directoryPublished, true);
  assert.match(element('market-grid').innerHTML, /PUMP LAUNCH VERIFIED/);
});
