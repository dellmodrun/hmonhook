import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { Keypair } from '@solana/web3.js';

test('a connected wallet change invalidates the compiled launch plan', async () => {
  const first = Keypair.generate().publicKey.toBase58();
  const second = Keypair.generate().publicKey.toBase58();
  const listeners = {};
  const provider = {
    publicKey: first,
    connect: async () => ({ publicKey: first }),
    on: (event, callback) => { listeners[event] = callback; },
  };
  const ids = new Set([
    'site-toast', 'launch-form', 'metadata-check', 'metadata-state', 'coin-image-preview',
    'coin-name', 'coin-symbol', 'coin-uri', 'coin-description', 'coin-image',
    'coin-website', 'coin-twitter', 'coin-telegram', 'coin-route', 'coin-quote',
    'coin-network', 'coin-policy', 'coin-rpc', 'launch-submit', 'launch-output',
  ]);
  const elements = new Map();
  const element = (id) => {
    if (!ids.has(id)) return null;
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', disabled: false, hidden: false, listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      classList: { add() {}, remove() {}, toggle() {} },
      removeAttribute() {},
    });
    return elements.get(id);
  };
  const values = {
    'coin-name': 'Switch test', 'coin-symbol': 'SWITCH',
    'coin-uri': 'https://metadata.example/coin.json', 'coin-route': 'pump-create-v2',
    'coin-quote': 'SOL', 'coin-network': 'solana-mainnet-beta',
    'coin-policy': 'none', 'coin-rpc': 'https://rpc.example/',
  };
  for (const [id, value] of Object.entries(values)) element(id).value = value;
  const storage = new Map([['joltwork-wallet', first]]);
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window: { solana: provider, location: { search: '', origin: 'https://site.example/' } },
    document: { baseURI: 'https://site.example/', getElementById: element,
      querySelectorAll: () => [], addEventListener() {},
      body: { classList: { add() {}, remove() {} } },
    },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async () => ({ ok: true, json: async () => ({
      name: 'Switch test', symbol: 'SWITCH', description: 'A test coin',
      image: 'https://metadata.example/coin.png',
    }) }),
    URL, URLSearchParams, crypto: webcrypto, TextEncoder, Uint8Array, Array, String,
    setTimeout: () => 1, clearTimeout() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  await element('metadata-check').listeners.click();
  await element('launch-form').listeners.submit({ preventDefault() {} });
  assert.equal(element('launch-submit').disabled, false);
  assert.match(element('launch-output').textContent, new RegExp(first));

  listeners.accountChanged(second);
  assert.equal(element('launch-submit').disabled, true);
  assert.match(element('launch-output').textContent, /signing wallet changed/i);
});
