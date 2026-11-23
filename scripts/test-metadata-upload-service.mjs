import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64'));

test('metadata service stores an image and public JSON without exposing its service key', async () => {
  const compiled = await build({ entryPoints: ['supabase/functions/metadata-upload/index.ts'], bundle: true,
    write: false, platform: 'neutral', format: 'esm' });
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  let handler;
  const uploads = [];
  globalThis.Deno = { env: { get: (key) => ({ HMONHOOK_SITE_ORIGIN: 'https://site.example',
    SUPABASE_URL: 'https://storage.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' })[key] },
  serve: (callback) => { handler = callback; } };
  globalThis.fetch = async (url, options) => {
    uploads.push({ url: String(url), options });
    return new Response('{}', { status: 200 });
  };
  try {
    await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
    const form = new FormData();
    form.set('name', 'Sample Coin');
    form.set('symbol', 'SAMPLE');
    form.set('description', 'A public token description.');
    for (const key of ['website', 'twitter', 'telegram']) form.set(key, '');
    form.set('image', new File([png], 'sample.png', { type: 'image/png' }));
    const request = new Request('https://edge.example/metadata-upload', { method: 'POST',
      headers: { origin: 'https://site.example' }, body: form });
    const result = await handler(request);
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.match(body.uri, /^https:\/\/storage\.example\/storage\/v1\/object\/public\/hmonhook-metadata\/json\/[a-f0-9]{64}\.json$/);
    assert.equal(uploads.length, 2);
    assert.match(uploads[0].url, /\/images\/[a-f0-9]{64}\.png$/);
    assert.equal(uploads[0].options.headers.authorization, 'Bearer server-secret');
    assert.ok(!JSON.stringify(body).includes('server-secret'));
    const metadata = JSON.parse(new TextDecoder().decode(uploads[1].options.body));
    assert.equal(metadata.name, 'Sample Coin');
    assert.equal(metadata.image, body.image);
    const rejected = await handler(new Request('https://edge.example/metadata-upload', { method: 'POST',
      headers: { origin: 'https://other.example' }, body: form }));
    assert.equal(rejected.status, 403);
    assert.equal(uploads.length, 2);
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
});
