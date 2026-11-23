import assert from 'node:assert/strict';
import test from 'node:test';
import { readBoundedFormData, validateUpload } from '../supabase/functions/metadata-upload/validate-upload.mjs';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64'));
function validForm() {
  const form = new FormData();
  form.set('name', 'Sample Coin');
  form.set('symbol', 'SAMPLE');
  form.set('description', 'A public sample token.');
  form.set('website', '');
  form.set('twitter', '');
  form.set('telegram', '');
  form.set('image', new File([png], 'sample.png', { type: 'image/png' }));
  return form;
}

test('accepts a small image and returns a content-addressed upload plan', async () => {
  const request = new Request('https://upload.example/', { method: 'POST', body: validForm() });
  const upload = await validateUpload(await readBoundedFormData(request));
  assert.equal(upload.imageMime, 'image/png');
  assert.equal(upload.imageExtension, 'png');
  assert.match(upload.imageHash, /^[a-f0-9]{64}$/);
  assert.equal(upload.name, 'Sample Coin');
  assert.equal(upload.symbol, 'SAMPLE');
});

test('rejects oversized requests, disguised images and unsafe social URLs', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(64)); } });
  const request = new Request('https://upload.example/', { method: 'POST', body: stream, duplex: 'half' });
  await assert.rejects(() => readBoundedFormData(request, 32), /size limit/);
  const disguised = validForm();
  disguised.set('image', new File([png], 'sample.jpg', { type: 'image/jpeg' }));
  await assert.rejects(() => validateUpload(disguised), /MIME type/);
  const unsafe = validForm();
  unsafe.set('twitter', 'javascript:alert(1)');
  await assert.rejects(() => validateUpload(unsafe), /HTTPS URL/);
});
