import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import api from '../services/launch-api/worker.mjs';

const { PUMP_SDK, PUMP_PROGRAM_ID } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
const origin = 'https://dellmodrun.github.io';
const base = 'https://api.example';
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64'));

function bucket() {
  const objects = new Map();
  let version = 0;
  const object = key => {
    const stored = objects.get(key);
    return stored && { body: new Response(stored.bytes).body,
      text: async () => new TextDecoder().decode(stored.bytes),
      etag: stored.etag, httpEtag: `"${stored.etag}"` };
  };
  return {
    objects,
    head: async key => object(key),
    get: async key => object(key),
    put: async (key, data, options = {}) => {
      const current = objects.get(key);
      const onlyIf = options.onlyIf;
      if (onlyIf?.get('if-none-match') === '*' && current) return null;
      if (onlyIf?.has('if-match') && (!current || onlyIf.get('if-match') !== `"${current.etag}"`)) return null;
      const etag = String(++version);
      objects.set(key, { bytes: typeof data === 'string' ? new TextEncoder().encode(data) : data, etag });
      return { etag, httpEtag: `"${etag}"` };
    },
    list: async ({ prefix, limit }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).sort().slice(0, limit).map(key => ({ key })), truncated: false }),
  };
}

function request(path, init = {}) {
  return new Request(`${base}${path}`, { ...init, headers: { origin, 'cf-connecting-ip': '192.0.2.1', ...init.headers } });
}

test('persistent upload and verified launch are visible across requests', async () => {
  const env = { BUCKET: bucket() };
  const form = new FormData();
  form.set('name', 'Service Test');
  form.set('symbol', 'TEST');
  form.set('description', 'A real upload flow test.');
  for (const key of ['website', 'twitter', 'telegram']) form.set(key, '');
  form.set('image', new File([png], 'art.png', { type: 'image/png' }));
  const uploaded = await api.fetch(request('/metadata-upload', { method: 'POST', body: form }), env);
  assert.equal(uploaded.status, 200);
  const { uri, image } = await uploaded.json();
  assert.match(uri, /^https:\/\/api\.example\/metadata\/[a-f0-9]{64}\.json$/);
  assert.deepEqual(await (await api.fetch(request(new URL(uri).pathname), env)).json(), {
    name: 'Service Test', symbol: 'TEST', description: 'A real upload flow test.', image,
    showName: true, createdOn: origin,
  });
  assert.deepEqual(new Uint8Array(await (await api.fetch(request(new URL(image).pathname), env)).arrayBuffer()), png);

  const creator = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const instruction = await PUMP_SDK.createV2Instruction({
    mint, name: 'Service Test', symbol: 'TEST', uri, creator, user: creator,
    mayhemMode: false, holderReward: false,
  });
  const keys = [...new Set([creator.toBase58(), ...instruction.keys.map(key => key.pubkey.toBase58()), PUMP_PROGRAM_ID.toBase58()])];
  const signature = bs58.encode(Keypair.generate().secretKey);
  const transaction = { slot: 400, blockTime: 1_800_000_000, meta: { err: null }, transaction: {
    signatures: [signature], message: { accountKeys: keys, instructions: [{
      programIdIndex: keys.indexOf(PUMP_PROGRAM_ID.toBase58()),
      accounts: instruction.keys.map(key => keys.indexOf(key.pubkey.toBase58())),
      data: bs58.encode(instruction.data),
    }] },
  } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).params[1].maxSupportedTransactionVersion, 1);
    return Response.json({ result: transaction });
  };
  try {
    const submitted = await api.fetch(request('/launch-registry', { method: 'POST', body: JSON.stringify({ signature,
      mint: mint.toBase58(), creator: creator.toBase58() }) }), env);
    assert.equal(submitted.status, 200);
    const listed = await (await api.fetch(request('/launch-registry'), env)).json();
    assert.equal(listed.launches[0].mint, mint.toBase58());
    assert.equal(listed.launches[0].image, image);
    assert.equal(listed.launches[0].description, 'A real upload flow test.');
    const searched = await (await api.fetch(request('/launch-registry?name=service%20test'), env)).json();
    assert.equal(searched.launches[0].signature, signature);
    assert.equal(env.BUCKET.objects.size, 7);
  } finally { globalThis.fetch = originalFetch; }
});

test('upload rejects other origins and does not touch storage', async () => {
  const env = { BUCKET: bucket() };
  const result = await api.fetch(new Request(`${base}/metadata-upload`, { method: 'POST',
    headers: { origin: 'https://other.example', 'cf-connecting-ip': '192.0.2.1' } }), env);
  assert.equal(result.status, 403);
  assert.equal(env.BUCKET.objects.size, 0);
});

test('concurrent upload requests cannot exceed the per-IP daily cap', async () => {
  const env = { BUCKET: bucket() };
  const results = await Promise.all(Array.from({ length: 30 }, () => api.fetch(request('/metadata-upload', {
    method: 'POST', body: 'invalid multipart body',
  }), env)));
  const admitted = results.filter(result => result.status === 400).length;
  assert.ok(admitted <= 20);
  assert.ok(results.some(result => result.status === 429));
  const counter = [...env.BUCKET.objects.entries()].find(([key]) => key.startsWith('limits/metadata/'));
  assert.equal(Number(new TextDecoder().decode(counter[1].bytes)), admitted);
});

test('registry tries the official RPC if the primary provider fails', async () => {
  const env = { BUCKET: bucket() };
  const endpoints = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    endpoints.push(url);
    assert.equal(JSON.parse(options.body).params[1].maxSupportedTransactionVersion, 1);
    if (endpoints.length === 1) throw new Error('Primary RPC unavailable');
    return Response.json({ result: null });
  };
  try {
    const result = await api.fetch(request('/launch-registry', { method: 'POST', body: JSON.stringify({
      signature: bs58.encode(Keypair.generate().secretKey),
      mint: Keypair.generate().publicKey.toBase58(), creator: Keypair.generate().publicKey.toBase58(),
    }) }), env);
    assert.equal(result.status, 409);
    assert.deepEqual(endpoints, ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com']);
  } finally { globalThis.fetch = originalFetch; }
});
