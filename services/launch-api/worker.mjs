import { readBoundedFormData, validateUpload } from '../../supabase/functions/metadata-upload/validate-upload.mjs';
import { verifiedLaunch } from '../../supabase/functions/launch-registry/verify-launch.mjs';

const SITE_ORIGIN = 'https://dellmodrun.github.io';
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const IMAGE_PATH = /^\/images\/([a-f0-9]{64})\.(png|jpg|webp)$/;
const JSON_PATH = /^\/metadata\/([a-f0-9]{64})\.json$/;
const RPC = 'https://solana-rpc.publicnode.com';
const FALLBACK_RPC = 'https://api.mainnet-beta.solana.com';

function response(body, status = 200, type = 'application/json; charset=utf-8', extra = {}) {
  return new Response(type.startsWith('application/json') ? JSON.stringify(body) : body, {
    status, headers: { 'content-type': type, 'access-control-allow-origin': SITE_ORIGIN,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type', 'vary': 'Origin', ...extra },
  });
}

function originAllowed(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === SITE_ORIGIN;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function rateLimit(request, env, route, max) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return false;
  const day = new Date().toISOString().slice(0, 10);
  const key = `limits/${route}/${day}/${await sha256(new TextEncoder().encode(ip))}`;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await env.BUCKET.get(key);
    const count = current ? Number(await current.text()) : 0;
    if (!Number.isSafeInteger(count) || count >= max) return false;
    const condition = new Headers(current ? { 'if-match': current.httpEtag } : { 'if-none-match': '*' });
    // Conditional puts compare against the committed R2 object atomically.
    // A concurrent writer makes this return null, so read and try again.
    const stored = await env.BUCKET.put(key, String(count + 1), { onlyIf: condition });
    if (stored) return true;
  }
  return false;
}

function normalizedName(name) {
  return name.normalize('NFKC').trim().toLowerCase();
}

async function metadataUpload(request, env) {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (!await rateLimit(request, env, 'metadata', 20)) return response({ error: 'Upload limit reached' }, 429);
  let upload;
  try { upload = await validateUpload(await readBoundedFormData(request)); }
  catch (error) { return response({ error: error instanceof Error ? error.message : 'Invalid upload' }, 400); }
  const imagePath = `images/${upload.imageHash}.${upload.imageExtension}`;
  if (!await env.BUCKET.head(imagePath)) {
    await env.BUCKET.put(imagePath, upload.imageBytes, { httpMetadata: { contentType: upload.imageMime } });
  }
  const base = new URL(request.url).origin;
  const image = `${base}/${imagePath}`;
  const metadata = { name: upload.name, symbol: upload.symbol, description: upload.description,
    image, showName: true, createdOn: SITE_ORIGIN,
    ...(upload.website && { website: upload.website }),
    ...(upload.twitter && { twitter: upload.twitter }),
    ...(upload.telegram && { telegram: upload.telegram }) };
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  const hash = await sha256(bytes);
  const path = `metadata/${hash}.json`;
  if (!await env.BUCKET.head(path)) {
    await env.BUCKET.put(path, bytes, { httpMetadata: { contentType: 'application/json' } });
  }
  return response({ uri: `${base}/${path}`, image });
}

async function publicObject(path, env) {
  const image = IMAGE_PATH.exec(path);
  const metadata = JSON_PATH.exec(path);
  if (!image && !metadata) return response({ error: 'Not found' }, 404);
  const object = await env.BUCKET.get(path.slice(1));
  if (!object) return response({ error: 'Not found' }, 404);
  const type = metadata ? 'application/json; charset=utf-8' :
    ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' })[image[2]];
  return new Response(object.body, { headers: { 'content-type': type,
    'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable',
    'etag': object.httpEtag } });
}

async function hostedMetadata(request, env, launch) {
  let uri;
  try { uri = new URL(launch.metadata_uri); } catch { return {}; }
  if (uri.origin !== new URL(request.url).origin || !JSON_PATH.test(uri.pathname)) return {};
  const object = await env.BUCKET.get(uri.pathname.slice(1));
  if (!object) return {};
  let metadata;
  try { metadata = JSON.parse(await object.text()); } catch { return {}; }
  if (metadata.name !== launch.name || metadata.symbol !== launch.symbol) return {};
  let image;
  try { image = new URL(metadata.image); } catch { return {}; }
  if (image.origin !== uri.origin || !IMAGE_PATH.test(image.pathname)) return {};
  return {
    image: image.href,
    description: typeof metadata.description === 'string' ? metadata.description.slice(0, 500) : '',
    website: typeof metadata.website === 'string' && /^https:\/\//.test(metadata.website) ? metadata.website : '',
    twitter: typeof metadata.twitter === 'string' && /^https:\/\//.test(metadata.twitter) ? metadata.twitter : '',
  };
}

async function rpcTransaction(env, signature) {
  const endpoints = [...new Set([env.HMONHOOK_SOLANA_RPC_URL || RPC, FALLBACK_RPC])];
  let sawNull = false;
  for (const endpoint of endpoints) {
    try {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction',
          params: [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }] }) });
      if (!result.ok) continue;
      const payload = await result.json();
      if (payload.error) continue;
      if (payload.result) return payload.result;
      sawNull = true;
    } catch { /* Try the next RPC. */ }
  }
  if (sawNull) return null;
  throw new Error('Solana RPC unavailable');
}

async function listObjects(bucket, prefix, limit = 100) {
  const rows = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, limit: Math.min(1000, limit - rows.length), ...(cursor && { cursor }) });
    for (const item of page.objects) {
      const object = await bucket.get(item.key);
      if (object) rows.push(JSON.parse(await object.text()));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && rows.length < limit);
  return rows;
}

async function launchRegistry(request, env) {
  if (request.method === 'GET') {
    const name = new URL(request.url).searchParams.get('name');
    if (name !== null && (!name.trim() || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name))) {
      return response({ error: 'Invalid coin name' }, 400);
    }
    const prefix = name === null ? 'launch/by-time/' :
      `launch/by-name/${await sha256(new TextEncoder().encode(normalizedName(name)))}/`;
    return response({ launches: await listObjects(env.BUCKET, prefix, 100) }, 200, 'application/json; charset=utf-8',
      { 'cache-control': 'public, max-age=5' });
  }
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (!await rateLimit(request, env, 'registry', 100)) return response({ error: 'Submission limit reached' }, 429);
  if (Number(request.headers.get('content-length') || 0) > 4096) return response({ error: 'Request too large' }, 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > 4096) return response({ error: 'Request too large' }, 413);
    body = JSON.parse(text);
  } catch { return response({ error: 'Invalid JSON' }, 400); }
  const { signature, mint, creator } = body || {};
  if (typeof signature !== 'string' || typeof mint !== 'string' || typeof creator !== 'string' ||
    !SIGNATURE.test(signature) || !ADDRESS.test(mint) || !ADDRESS.test(creator)) {
    return response({ error: 'Invalid launch identifiers' }, 400);
  }
  let transaction;
  try { transaction = await rpcTransaction(env, signature); }
  catch { return response({ error: 'Solana RPC unavailable' }, 503); }
  if (!transaction) return response({ error: 'Transaction not confirmed or not indexed yet' }, 409);
  if (transaction.transaction?.signatures?.[0] !== signature) return response({ error: 'Signature mismatch' }, 400);
  const launch = verifiedLaunch(transaction, mint, creator);
  if (!launch) return response({ error: 'No matching confirmed Pump create_v2 launch' }, 422);
  const key = `launch/by-mint/${mint}.json`;
  if (!await env.BUCKET.head(key)) {
    const row = { ...launch, ...await hostedMetadata(request, env, launch),
      created_at: new Date((transaction.blockTime || Date.now() / 1000) * 1000).toISOString() };
    const bytes = JSON.stringify(row);
    const reverseSlot = String(999999999999n - BigInt(transaction.slot)).padStart(12, '0');
    const nameHash = await sha256(new TextEncoder().encode(normalizedName(launch.name)));
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'application/json' } });
    await env.BUCKET.put(`launch/by-time/${reverseSlot}-${mint}.json`, bytes);
    await env.BUCKET.put(`launch/by-name/${nameHash}/${mint}.json`, bytes);
  }
  return response({ launch });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return originAllowed(request) ? response({}, 200) : response({ error: 'Origin not allowed' }, 403);
    if (!originAllowed(request)) return response({ error: 'Origin not allowed' }, 403);
    if (!env.BUCKET) return response({ error: 'Storage is not configured' }, 503);
    try {
      if (path === '/health') return response({ ok: true, storage: true });
      if (path === '/metadata-upload') return await metadataUpload(request, env);
      if (path === '/launch-registry') return await launchRegistry(request, env);
      if (request.method === 'GET') return await publicObject(path, env);
      return response({ error: 'Not found' }, 404);
    } catch { return response({ error: 'Service unavailable' }, 503); }
  },
};
