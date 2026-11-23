import { verifiedLaunch } from './verify-launch.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function json(value: unknown, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, apikey',
    'vary': 'Origin',
  } });
}

async function rpcTransaction(rpc: string, signature: string) {
  const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'getTransaction',
    params: [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
  }) });
  if (!response.ok) throw new Error('Solana RPC unavailable');
  const payload = await response.json();
  if (payload.error) throw new Error('Solana RPC rejected transaction lookup');
  return payload.result;
}

Deno.serve(async (request) => {
  const allowedOrigin = Deno.env.get('HMONHOOK_SITE_ORIGIN') || '';
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigin || (origin && origin !== allowedOrigin)) return json({ error: 'Origin not allowed' }, 403, allowedOrigin);
  if (request.method === 'OPTIONS') return json({}, 200, allowedOrigin);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rpc = Deno.env.get('HMONHOOK_SOLANA_RPC_URL');
  if (!supabaseUrl || !serviceKey || !rpc) return json({ error: 'Registry is not configured' }, 503, allowedOrigin);
  const table = `${supabaseUrl}/rest/v1/hmonhook_launches`;
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  try {
    if (request.method === 'GET') {
      const response = await fetch(`${table}?select=mint,signature,creator,name,symbol,metadata_uri,created_at&order=created_at.desc&limit=100`, { headers });
      if (!response.ok) throw new Error('Registry read failed');
      return json({ launches: await response.json() }, 200, allowedOrigin);
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, allowedOrigin);
    if (Number(request.headers.get('content-length') || 0) > 4096) return json({ error: 'Request too large' }, 413, allowedOrigin);
    const rawBody = await request.text();
    if (rawBody.length > 4096) return json({ error: 'Request too large' }, 413, allowedOrigin);
    const body = JSON.parse(rawBody);
    const { signature, mint, creator } = body || {};
    if (!SIGNATURE.test(signature) || !ADDRESS.test(mint) || !ADDRESS.test(creator)) return json({ error: 'Invalid launch identifiers' }, 400, allowedOrigin);
    const transaction = await rpcTransaction(rpc, signature);
    if (!transaction) return json({ error: 'Transaction not confirmed or not indexed yet' }, 409, allowedOrigin);
    if (transaction.transaction?.signatures?.[0] !== signature) return json({ error: 'Signature mismatch' }, 400, allowedOrigin);
    const launch = verifiedLaunch(transaction, mint, creator);
    if (!launch) return json({ error: 'No matching confirmed Pump create_v2 launch' }, 422, allowedOrigin);
    const response = await fetch(`${table}?on_conflict=mint`, { method: 'POST', headers: {
      ...headers, 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=minimal',
    }, body: JSON.stringify(launch) });
    if (!response.ok) throw new Error('Registry write failed');
    return json({ launch }, 200, allowedOrigin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Registry error' }, 502, allowedOrigin);
  }
});
