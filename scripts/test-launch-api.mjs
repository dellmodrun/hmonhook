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
  const object = key => {
    const bytes = objects.get(key);
    return bytes && { body: new Response(bytes).body, text: async () => new TextDecoder().decode(bytes), httpEtag: '"test"' };
  };
  return {
    objects,
    head: async key => object(key),
    get: async key => object(key),
    put: async (key, data) => objects.set(key, typeof data === 'string' ? new TextEncoder().encode(data) : data),
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
  globalThis.fetch = async () => Response.json({ result: transaction });
  try {
    const submitted = await api.fetch(request('/launch-registry', { method: 'POST', body: JSON.stringify({ signature,
      mint: mint.toBase58(), creator: creator.toBase58() }) }), env);
    assert.equal(submitted.status, 200);
    const listed = await (await api.fetch(request('/launch-registry'), env)).json();
    assert.equal(listed.launches[0].mint, mint.toBase58());
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
