import { readBoundedFormData, validateUpload } from './validate-upload.mjs';

const BUCKET = 'hmonhook-metadata';

function json(value: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'Origin',
  } });
}

async function uploadObject(base: string, serviceKey: string, path: string, bytes: Uint8Array, mime: string) {
  const response = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`,
      'content-type': mime, 'cache-control': '31536000', 'x-upsert': 'false' }, body: bytes,
  });
  if (!response.ok && response.status !== 409) throw new Error('Metadata storage upload failed');
}

Deno.serve(async (request) => {
  const allowedOrigin = Deno.env.get('HMONHOOK_SITE_ORIGIN') || '';
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigin || origin !== allowedOrigin) return json({ error: 'Origin not allowed' }, 403, allowedOrigin);
  if (request.method === 'OPTIONS') return json({}, 200, allowedOrigin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, allowedOrigin);
  const base = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !serviceKey) return json({ error: 'Metadata storage is not configured' }, 503, allowedOrigin);
  try {
    const upload = await validateUpload(await readBoundedFormData(request));
    const imagePath = `images/${upload.imageHash}.${upload.imageExtension}`;
    await uploadObject(base, serviceKey, imagePath, upload.imageBytes, upload.imageMime);
    const image = `${base}/storage/v1/object/public/${BUCKET}/${imagePath}`;
    const metadata = { name: upload.name, symbol: upload.symbol, description: upload.description, image,
      showName: true, createdOn: allowedOrigin,
      ...(upload.website && { website: upload.website }),
      ...(upload.twitter && { twitter: upload.twitter }),
      ...(upload.telegram && { telegram: upload.telegram }),
    };
    const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
    const digest = await crypto.subtle.digest('SHA-256', metadataBytes);
    const metadataHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const metadataPath = `json/${metadataHash}.json`;
    await uploadObject(base, serviceKey, metadataPath, metadataBytes, 'application/json');
    return json({ uri: `${base}/storage/v1/object/public/${BUCKET}/${metadataPath}`, image }, 200, allowedOrigin);
  } catch (error) {
    const invalid = error instanceof RangeError || error instanceof Error && /^(Invalid|Missing|Image|.*must be|.*too long|Upload exceeds)/.test(error.message);
    return json({ error: error instanceof Error ? error.message : 'Upload failed' }, invalid ? 400 : 502, allowedOrigin);
  }
});
