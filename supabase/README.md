# Verified launch directory (not deployed)

This is the first writable cross-device launch directory for h/monhook. It is staged in the development branch. The production GitHub Pages site does not use it while `markets/registry-service.json` has an empty endpoint.

## Data path

1. The browser sends a Pump `create_v2` transaction signed by the creator wallet and a new Mint keypair.
2. After confirmation, it sends only the public signature, Mint and creator address to the `launch-registry` Edge Function.
3. The function reads the confirmed transaction from Solana RPC. It verifies the Pump program, `create_v2` discriminator, Mint account, payer, creator bytes and metadata fields before writing a row with its server-side database key.
4. The market page loads the bounded public directory and labels rows `PUMP LAUNCH VERIFIED`. A row proves the specified Pump creation transaction, not an issuer lock, option protection, a h/monhook Guard policy, or that the coin was created through the h/monhook website.

## Deployment inputs

- A project-controlled Supabase project and a production Solana RPC endpoint with `getTransaction` history are required.
- Run `supabase/migrations/20261124_launch_registry.sql` in that project and deploy `supabase/functions/launch-registry` with JWT verification disabled as specified in `supabase/config.toml`.
- Set Edge Function secrets `HMONHOOK_SITE_ORIGIN` (the exact public website origin) and `HMONHOOK_SOLANA_RPC_URL`. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its functions. Keep every service role and RPC secret server-side.
- Set the public function URL in `markets/registry-service.json` only after a real signed launch registration and a cross-device read pass. The frontend then publishes confirmed launches automatically and reads them without a full GitHub Pages rebuild for each new Mint.

## Remaining gates

- Add abuse controls and monitor RPC/database usage before opening public writes. A valid Pump launch can be submitted by anyone who knows its public signature; this is intentional for recoverability, but the endpoint has no per-client rate limit yet.
- Add secure image and metadata hosting. Pump's recommended flow requires server-side storage credentials or a storage provider's short-lived upload URL; the current launch form still requires an existing public metadata URI.
- Test the deployed Edge Function with real Solana transactions and verify CORS on the production domain. The Node tests only cover transaction parsing and fail-closed behavior; no Supabase instance is connected yet.
